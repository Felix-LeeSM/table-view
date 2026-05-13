import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RefreshCw,
  Loader2,
  Download,
  Database,
  FileText,
  Rows3,
} from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import { useActiveTab } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMigrationExport } from "@/hooks/useMigrationExport";
import { useSidebarScrollPersistence } from "@/hooks/useSidebarScrollPersistence";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@components/ui/popover";
import { Button } from "@components/ui/button";
import { resolveRdbTreeShape, type RdbTreeShape } from "./treeShape";
import {
  getVisibleRows,
  ROW_HEIGHT_ESTIMATE,
  VIRTUALIZE_THRESHOLD,
} from "./SchemaTree/treeRows";
import { SchemaTreeBody } from "./SchemaTree/body";
import type { SchemaTreeRowsContext } from "./SchemaTree/rows";
import {
  CreateTableDialogSlot,
  CreateTriggerDialogSlot,
  DropTableDialogSlot,
  RenameTableDialogSlot,
} from "./SchemaTree/dialogs";
import { useSchemaTreeActions } from "./SchemaTree/useSchemaTreeActions";

/**
 * Entry shell for the relational schema tree. Owns cross-slice state
 * (connection name / dbType / treeShape / active tab pointers /
 * migration export), virtualizer wiring, three effects (refresh-schema
 * listener, active-tab → schema auto-expand, schemas-loaded auto-expand),
 * and the JSX shell (header + body + dialogs). `useSchemaTreeActions`
 * supplies the 12 handlers and the tree's UI state.
 */

interface SchemaTreeProps {
  connectionId: string;
}

// Stable empty reference for the per-schema slice — avoids re-running
// the body's `useMemo`s when the slot for this `(connId, db)` is still
// unpopulated.
const EMPTY_BY_SCHEMA = Object.freeze({}) as Record<string, never>;

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const actions = useSchemaTreeActions({ connectionId });
  // Destructure the fields effects depend on. Using the whole `actions`
  // object as a dep would re-run effects every render.
  const { setExpandedSchemas, refreshConnection, workspaceKey } = actions;

  // Read-only selectors for tree body rendering; writes live in the hook.
  // Sprint 263 — pre-slice the per-`(connId, db)` portion of each cache
  // so downstream `treeRows` / `body` can index by bare schema name.
  const db = workspaceKey?.db ?? "";
  const tables = useSchemaStore(
    (s) => s.tables[connectionId]?.[db] ?? EMPTY_BY_SCHEMA,
  );
  const views = useSchemaStore(
    (s) => s.views[connectionId]?.[db] ?? EMPTY_BY_SCHEMA,
  );
  const functions = useSchemaStore(
    (s) => s.functions[connectionId]?.[db] ?? EMPTY_BY_SCHEMA,
  );
  // Sprint 272 — pre-slice the per-`(connId, db)` portion of the
  // triggers cache. The eager + virtualized branches both index by
  // bare `[schema][table]` keys.
  const triggersBySchemaTable = useSchemaStore(
    (s) => s.triggers[connectionId]?.[db] ?? EMPTY_BY_SCHEMA,
  );

  const connectionName = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name,
  );
  // DBMS-shape-aware tree depth. Driven off `db_type` because the shape
  // difference (with-schema / no-schema / flat) is *within* the rdb
  // paradigm. Defaults to `with-schema` (PG) on first render so the
  // initial paint matches the most explicit shape.
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.db_type,
  );
  const treeShape: RdbTreeShape = dbType
    ? resolveRdbTreeShape(dbType)
    : "with-schema";

  // RDB schema-level migration export. Hidden on Mongo/Redis and when
  // dbType hasn't loaded yet.
  const isRdbConnection =
    dbType === "postgresql" || dbType === "mysql" || dbType === "sqlite";
  const {
    exportSchema: exportSchemaWithInclude,
    exportDatabase: exportDatabaseWithInclude,
    isExporting: isMigrationExporting,
  } = useMigrationExport();

  // Track active tab for highlight & auto-expand
  const activeTab = useActiveTab();
  const activeSchema = activeTab?.type === "table" ? activeTab.schema : null;
  const activeTable = activeTab?.type === "table" ? activeTab.table : null;

  // refresh-schema (Cmd+R / F5) listener.
  useEffect(() => {
    const handler = () => refreshConnection();
    window.addEventListener("refresh-schema", handler);
    return () => window.removeEventListener("refresh-schema", handler);
  }, [refreshConnection]);

  // Auto-expand schema when active tab changes to a table in that schema
  useEffect(() => {
    if (activeSchema) {
      setExpandedSchemas((prev) => {
        if (prev.has(activeSchema)) return prev;
        const next = new Set(prev);
        next.add(activeSchema);
        return next;
      });
    }
  }, [activeSchema, setExpandedSchemas]);

  // Sprint 262 Slice B: 첫 방문 워크스페이스에 "모든 스키마 expanded" 시드는
  // `useSchemaTreeActions` 내부의 session-scoped ref 가 처리한다. 여기에
  // 중복 효과를 두면 user 의 collapse 가 매 store 업데이트마다 다시 덮이는
  // 회귀가 발생.

  // The flat visible-rows list is computed unconditionally — a single
  // walk over already-derived state — so the threshold check is one
  // comparison and the virtualized/eager branches index the same data.
  const visibleRows = getVisibleRows({
    schemas: actions.schemas,
    expandedSchemas: actions.expandedSchemas,
    expandedCategories: actions.expandedCategories,
    loadingTables: actions.loadingTables,
    tables,
    views,
    functions,
    connectionId,
    selectedNodeId: actions.selectedNodeId,
    activeSchema: activeSchema ?? null,
    activeTable: activeTable ?? null,
    tableSearch: actions.tableSearch,
    // Sprint 272 — trigger child group state. Empty defaults are
    // fine: an empty `expandedTriggerGroups` set means every group is
    // collapsed (the row still renders, no children).
    expandedTriggerGroups: actions.expandedTriggerGroups,
    triggersBySchemaTable,
    loadingTriggerGroups: actions.loadingTriggerGroups,
    triggerErrors: actions.triggerErrors,
  });

  // Only `with-schema` fans out far enough to need virtualization
  // (schemas × categories × items). Flat/no-schema rarely cross the
  // threshold, so they stay on the eager path.
  const shouldVirtualize =
    treeShape === "with-schema" && visibleRows.length > VIRTUALIZE_THRESHOLD;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleRows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 8,
  });

  // Sprint 262 Slice B — sidebar scrollTop persistence per `(connId, db)`.
  // The hook handles one-shot restore on workspace key change + write-back
  // on every scroll event. `.ts` seam, see `useSidebarScrollPersistence`
  // for rationale.
  const handleScroll = useSidebarScrollPersistence(
    scrollContainerRef,
    actions.workspaceKey,
  );

  const ctx: SchemaTreeRowsContext = {
    dbType,
    toggleCategory: actions.toggleCategory,
    setSelectedNodeId: actions.setSelectedNodeId,
    setTableSearch: actions.setTableSearch,
    isCategoryExpanded: actions.isCategoryExpanded,
    handleExpandSchema: actions.handleExpandSchema,
    handleRefreshSchema: actions.handleRefreshSchema,
    handleTableClick: actions.handleTableClick,
    handleTableDoubleClick: actions.handleTableDoubleClick,
    handleOpenStructure: actions.handleOpenStructure,
    handleViewTableTriggers: actions.handleViewTableTriggers,
    handleDropTable: actions.handleDropTable,
    handleStartRename: actions.handleStartRename,
    handleViewClick: actions.handleViewClick,
    handleOpenViewStructure: actions.handleOpenViewStructure,
    handleFunctionClick: actions.handleFunctionClick,
    handleCreateTable: actions.handleCreateTable,
    // Sprint 273 — CreateTriggerDialog opener.
    handleCreateTrigger: actions.handleCreateTrigger,
    // Sprint 272 — Triggers child group handlers.
    toggleTriggerGroup: actions.toggleTriggerGroup,
    retryLoadTriggers: actions.retryLoadTriggers,
    handleViewTriggerSource: actions.handleViewTriggerSource,
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex flex-col select-none overflow-y-auto"
    >
      {/* sr-only connection name for accessibility */}
      <span className="sr-only">{connectionName || connectionId}</span>

      {/* "Schemas" header label + action buttons (export, refresh) */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          Schemas
        </span>
        <div className="flex items-center gap-0.5">
          {/* RDB export Popover — three modes (DDL / DML / Full) ×
              two scopes (single schema / all schemas). MySQL/SQLite
              adapters are still placeholders, so the actual export only
              succeeds on PG today, but the UI surfaces for any rdb. */}
          {isRdbConnection && actions.schemas.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={isMigrationExporting}
                  aria-label="Export"
                  title="Export"
                >
                  <Download size={12} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={4} className="w-56 p-1">
                {actions.schemas.length > 1 && (
                  <>
                    <div className="flex items-center justify-between rounded-sm py-0.5 hover:bg-muted/50">
                      <span className="truncate flex-1 px-2 text-xs italic text-muted-foreground">
                        All schemas
                      </span>
                      <div className="flex items-center gap-0.5 pr-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label="Export all schemas DDL"
                          title="Schema only (DDL — CREATE TABLE/INDEX/FK)"
                          onClick={() =>
                            exportDatabaseWithInclude(
                              connectionId,
                              db,
                              actions.schemas.map((s) => s.name),
                              "ddl",
                            )
                          }
                        >
                          <FileText size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label="Export all schemas data"
                          title="Data only (DML — INSERT)"
                          onClick={() =>
                            exportDatabaseWithInclude(
                              connectionId,
                              db,
                              actions.schemas.map((s) => s.name),
                              "dml",
                            )
                          }
                        >
                          <Rows3 size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label="Export all schemas full"
                          title="Full dump (DDL + data)"
                          onClick={() =>
                            exportDatabaseWithInclude(
                              connectionId,
                              db,
                              actions.schemas.map((s) => s.name),
                              "both",
                            )
                          }
                        >
                          <Database size={12} />
                        </Button>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-border" />
                  </>
                )}
                <div className="px-2 py-1 text-3xs uppercase tracking-wider text-muted-foreground">
                  Schemas
                </div>
                <div className="flex flex-col">
                  {actions.schemas.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between rounded-sm py-0.5 hover:bg-muted/50"
                    >
                      <span className="truncate flex-1 px-2 text-xs">
                        {s.name}
                      </span>
                      <div className="flex items-center gap-0.5 pr-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label={`Export ${s.name} DDL`}
                          title="Schema only (DDL — CREATE TABLE/INDEX/FK)"
                          onClick={() =>
                            exportSchemaWithInclude(
                              connectionId,
                              db,
                              s.name,
                              "ddl",
                            )
                          }
                        >
                          <FileText size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label={`Export ${s.name} data`}
                          title="Data only (DML — INSERT)"
                          onClick={() =>
                            exportSchemaWithInclude(
                              connectionId,
                              db,
                              s.name,
                              "dml",
                            )
                          }
                        >
                          <Rows3 size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isMigrationExporting}
                          aria-label={`Export ${s.name} full`}
                          title="Full dump (DDL + data)"
                          onClick={() =>
                            exportSchemaWithInclude(
                              connectionId,
                              db,
                              s.name,
                              "both",
                            )
                          }
                        >
                          <Database size={12} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={actions.handleRefresh}
            disabled={actions.loadingSchemas}
            aria-label="Refresh schemas"
            title="Refresh schemas"
          >
            {actions.loadingSchemas ? (
              <Loader2 className="animate-spin" size={12} />
            ) : (
              <RefreshCw size={12} />
            )}
          </Button>
        </div>
      </div>

      <SchemaTreeBody
        schemas={actions.schemas}
        treeShape={treeShape}
        expandedSchemas={actions.expandedSchemas}
        loadingTables={actions.loadingTables}
        tables={tables}
        views={views}
        functions={functions}
        connectionId={connectionId}
        selectedNodeId={actions.selectedNodeId}
        activeSchema={activeSchema ?? null}
        activeTable={activeTable ?? null}
        tableSearch={actions.tableSearch}
        visibleRows={visibleRows}
        shouldVirtualize={shouldVirtualize}
        rowVirtualizer={rowVirtualizer}
        ctx={ctx}
        expandedTriggerGroups={actions.expandedTriggerGroups}
        triggersBySchemaTable={triggersBySchemaTable}
        loadingTriggerGroups={actions.loadingTriggerGroups}
        triggerErrors={actions.triggerErrors}
      />

      {/* Sprint 235 — Phase 27 Rename / Drop modal slots replacing the
          legacy minimal confirm-dialog versions. The slot wrappers
          delegate to `RenameTableDialog` / `DropTableDialog` (inline
          DDL preview + Safe Mode dispatch via `useDdlPreviewExecution`). */}
      <RenameTableDialogSlot
        connectionId={connectionId}
        database={db}
        renameTableDialog={actions.renameTableDialog}
        onClose={() => actions.setRenameTableDialog(null)}
      />

      <DropTableDialogSlot
        connectionId={connectionId}
        database={db}
        dropTableDialog={actions.dropTableDialog}
        onClose={() => actions.setDropTableDialog(null)}
      />

      <CreateTableDialogSlot
        connectionId={connectionId}
        database={db}
        createTableDialog={actions.createTableDialog}
        onClose={() => actions.setCreateTableDialog(null)}
        onRefresh={async (schemaName) => {
          actions.refreshSchema(schemaName);
        }}
      />

      <CreateTriggerDialogSlot
        connectionId={connectionId}
        database={db}
        createTriggerDialog={actions.createTriggerDialog}
        onClose={() => actions.setCreateTriggerDialog(null)}
        onRefresh={actions.refreshTableTriggersForSlot}
      />
    </div>
  );
}
