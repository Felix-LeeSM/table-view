import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RefreshCw,
  Loader2,
  Download,
  Database,
  FileText,
  Rows3,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import { useActiveTab } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useMigrationExport,
  supportsMigrationExport,
} from "@/hooks/useMigrationExport";
import { useSidebarScrollPersistence } from "@/hooks/useSidebarScrollPersistence";
import { supportsRowEditing } from "@/types/dataSource";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@components/ui/popover";
import { Button } from "@components/ui/button";
import { resolveRdbTreeProfile, type RdbTreeShape } from "./treeShape";
import {
  applyGlobalFilter,
  getVisibleRows,
  nodeIdToString,
  ROW_HEIGHT_ESTIMATE,
  VIRTUALIZE_THRESHOLD,
} from "./SchemaTree/treeRows";
import { SchemaTreeBody } from "./SchemaTree/body";
import type { SchemaTreeRowsContext } from "./SchemaTree/rows";
import { PinnedRecentSections } from "./SchemaTree/PinnedRecentSections";
import { useTreeRoving } from "./SchemaTree/useTreeRoving";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import {
  CreateTableDialogSlot,
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
const EMPTY_FILE_SOURCES: ReadonlyArray<FileAnalyticsSourceMetadata> =
  Object.freeze([]);

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const { t } = useTranslation("schema");
  const connectionName = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name,
  );
  // DBMS-shape-aware tree profile. The shape (with-schema / no-schema / flat)
  // *and* its derived behavior flags come from one central resolver
  // (`resolveRdbTreeProfile`, #1363) so SchemaTree never re-branches on
  // `dbType` and drifts from `treeShape.ts`. Falls back to the PostgreSQL
  // profile (with-schema, all flags off) before `dbType` has loaded so the
  // initial paint matches the most explicit shape.
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.dbType,
  );
  const profile = resolveRdbTreeProfile(dbType ?? "postgresql");
  const treeShape: RdbTreeShape = profile.shape;

  const actions = useSchemaTreeActions({
    connectionId,
    autoLoadAuxiliaryCatalog: profile.autoLoadsAuxiliaryCatalog,
    autoLoadFileAnalyticsSources: profile.isFileAnalyticsSource,
    clearFileAnalyticsSourcesOnRefresh: profile.isFileAnalyticsSource,
  });
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
  const fileAnalyticsSources = useSchemaStore(
    (s): ReadonlyArray<FileAnalyticsSourceMetadata> =>
      s.fileAnalyticsSources[connectionId] ?? EMPTY_FILE_SOURCES,
  );

  // RDB schema-level migration export. Surfaced only where the backend
  // `stream_table_rows` path is implemented (PG / MySQL / MariaDB) — SQLite,
  // DuckDB, MSSQL and Oracle reject DML/Full dumps as `Unsupported`, so
  // showing the control there would be an error-on-click (#1048). Also hidden
  // on Mongo/Redis and before dbType has loaded.
  const canExportMigration = supportsMigrationExport(dbType);
  // #1052 — DuckDB's backend adapter has no write/DDL path, so its DDL entries
  // (Create / Rename / Drop table) are hidden. `supportsRowEditing` is the
  // reliable read-only discriminator among RDB engines (see its doc comment).
  const canMutateSchema = supportsRowEditing(dbType);
  const flatCreateTableSchema = profile.hasImplicitSingleSchema
    ? (actions.schemas[0]?.name ?? null)
    : null;
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

  // #1217 — top-level global filter. `applyGlobalFilter` narrows schemas +
  // objects to the matches (or returns the inputs by reference when the box
  // is empty). No-schema (MySQL) / flat (SQLite) keep their single implicit
  // schema so an empty match still shows a placeholder rather than a blank
  // pane. The matching schemas are force-expanded (filter visibility beats
  // the collapse rule); non-`with-schema` shapes are always expanded anyway.
  const globalFilterActive = actions.globalFilter.trim().length > 0;
  const filtered = useMemo(
    () =>
      applyGlobalFilter(actions.globalFilter, treeShape !== "with-schema", {
        schemas: actions.schemas,
        tables,
        views,
        functions,
      }),
    [
      actions.globalFilter,
      treeShape,
      actions.schemas,
      tables,
      views,
      functions,
    ],
  );
  const effectiveExpandedSchemas =
    globalFilterActive && filtered.matchedSchemaNames
      ? filtered.matchedSchemaNames
      : actions.expandedSchemas;

  // The flat visible-rows list is computed unconditionally — a single
  // walk over already-derived state — so the threshold check is one
  // comparison and the virtualized/eager branches index the same data.
  const visibleRows = getVisibleRows({
    schemas: filtered.schemas,
    expandedSchemas: effectiveExpandedSchemas,
    expandedCategories: actions.expandedCategories,
    loadingTables: actions.loadingTables,
    tables: filtered.tables,
    views: filtered.views,
    functions: filtered.functions,
    connectionId,
    selectedNodeId: actions.selectedNodeId,
    activeSchema: activeSchema ?? null,
    activeTable: activeTable ?? null,
    tableSearch: actions.tableSearch,
    globalFilterActive,
  });

  // Only `with-schema` fans out far enough to need virtualization
  // (schemas × categories × items). Flat/no-schema rarely cross the
  // threshold, so they stay on the eager path.
  const shouldVirtualize =
    treeShape === "with-schema" && visibleRows.length > VIRTUALIZE_THRESHOLD;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // The virtualized list is not at the top of its scroll container — the
  // "Schemas" header (label + action buttons) sits above it. Feed the
  // header height to the virtualizer as `scrollMargin` so its coordinate
  // origin matches where the list actually starts; without it the last
  // rows fall past the computed end and the bottom of the list clips.
  const [scrollMargin, setScrollMargin] = useState(0);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleRows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 8,
    scrollMargin,
  });

  // Sprint 262 Slice B — sidebar scrollTop persistence per `(connId, db)`.
  // The hook handles one-shot restore on workspace key change + write-back
  // on every scroll event. `.ts` seam, see `useSidebarScrollPersistence`
  // for rationale.
  const handleScroll = useSidebarScrollPersistence(
    scrollContainerRef,
    actions.workspaceKey,
  );

  // WAI-ARIA tree roving-tabindex + arrow-key navigation. The first
  // focusable row is the default tab stop until the user moves focus, so
  // the tree is always reachable with a single Tab.
  const treeRef = useRef<HTMLDivElement>(null);

  // Measure the header offset that precedes the list and keep it in sync
  // as the header reflows. `offsetTop` is relative to the (now `relative`)
  // scroll container, so it equals the header height that the virtualizer
  // needs as `scrollMargin`.
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const measure = () => setScrollMargin(tree.offsetTop);
    measure();
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const roving = useTreeRoving(
    visibleRows,
    {
      onToggleSchema: actions.handleExpandSchema,
      onToggleCategory: (row) =>
        actions.toggleCategory(row.schemaName, row.category.key),
    },
    treeRef,
    // Virtualized rows outside the window aren't in the DOM, so a Home/End
    // jump would focus nothing. Let roving scroll the target into view first.
    shouldVirtualize
      ? (index) => rowVirtualizer.scrollToIndex(index)
      : undefined,
  );
  const firstFocusableKey =
    visibleRows.find(
      (r) => r.kind === "schema" || r.kind === "category" || r.kind === "item",
    )?.key ?? null;

  // Quick Open "schema" result reveal (#1216). The mounted tree owns the
  // *visible* outcome: ensure the target schema is expanded, then focus/scroll
  // its row into view via the shared roving `focusByKey`. Reads expansion +
  // the toggle through refs so the listener never re-subscribes per render;
  // `focusByKey` is stable (keyed on `treeRef`). QuickOpen scopes schema
  // results to this window's connection, so a matching event always targets
  // the tree the user is looking at.
  const expandedSchemasRef = useRef(actions.expandedSchemas);
  expandedSchemasRef.current = actions.expandedSchemas;
  const handleExpandSchemaRef = useRef(actions.handleExpandSchema);
  handleExpandSchemaRef.current = actions.handleExpandSchema;
  const { focusByKey } = roving;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ connectionId: string; schema: string }>
      ).detail;
      if (!detail || detail.connectionId !== connectionId) return;
      if (!expandedSchemasRef.current.has(detail.schema)) {
        void handleExpandSchemaRef.current(detail.schema);
      }
      focusByKey(nodeIdToString({ type: "schema", schema: detail.schema }));
    };
    window.addEventListener("reveal-schema", handler);
    return () => window.removeEventListener("reveal-schema", handler);
  }, [connectionId, focusByKey]);

  const ctx: SchemaTreeRowsContext = {
    t: (key, options) => t(key, options as Record<string, unknown>),
    dbType,
    canMutateSchema,
    treeShape,
    globalFilterActive,
    rovingFocusKey: roving.focusKey ?? firstFocusableKey,
    onFocusRow: roving.setFocusKey,
    toggleCategory: actions.toggleCategory,
    setSelectedNodeId: actions.setSelectedNodeId,
    setTableSearch: actions.setTableSearch,
    isCategoryExpanded: actions.isCategoryExpanded,
    handleExpandSchema: actions.handleExpandSchema,
    handleRefreshSchema: actions.handleRefreshSchema,
    handleTableClick: actions.handleTableClick,
    handleTableDoubleClick: actions.handleTableDoubleClick,
    handleOpenStructure: actions.handleOpenStructure,
    handleDropTable: actions.handleDropTable,
    handleStartRename: actions.handleStartRename,
    handleTogglePin: actions.handleTogglePin,
    isTablePinned: actions.isTablePinned,
    handleViewClick: actions.handleViewClick,
    handleOpenViewStructure: actions.handleOpenViewStructure,
    handleFunctionClick: actions.handleFunctionClick,
    handleCreateTable: actions.handleCreateTable,
    handleExportSchema: actions.handleExportSchema,
    handleExportTable: actions.handleExportTable,
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="relative flex flex-col select-none overflow-y-auto"
    >
      {/* sr-only connection name for accessibility */}
      <span className="sr-only">{connectionName || connectionId}</span>

      {/* #1243 — everything above `role="tree"` (header + #1217 filter +
          #1218 pinned/recent) is measured as the virtualizer `scrollMargin`
          so the list's last rows never clip. `headerRef` wraps the whole
          stack (not just the header row) and the `ResizeObserver` on it
          catches the filter / pinned sections appearing or reflowing. */}
      <div ref={headerRef}>
        {/* "Schemas" header label + action buttons (export, refresh).
            Sprint 380 — only PG (`with-schema`) shows the "Schemas" header
            text. MySQL (`no-schema`) and SQLite (`flat`) hide the label
            because schema == database in their model. Action buttons row
            stays visible for all RDB shapes. */}
        <div className="flex items-center justify-between px-3 py-1">
          {treeShape === "with-schema" ? (
            <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("schemasHeader")}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-0.5">
            {flatCreateTableSchema && canMutateSchema && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => actions.handleCreateTable(flatCreateTableSchema)}
                aria-label={t("createTableInAria", {
                  schema: flatCreateTableSchema,
                })}
                title={t("createTableTitle")}
              >
                <Plus size={12} />
              </Button>
            )}
            {/* RDB export Popover — three modes (DDL / DML / Full) ×
              two scopes (single schema / all schemas). Gated to engines with
              a real `stream_table_rows` backend (PG / MySQL / MariaDB) via
              `supportsMigrationExport` so unsupported engines don't surface an
              error-on-click control (#1048). */}
            {canExportMigration && actions.schemas.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={isMigrationExporting}
                    aria-label={t("exportAria")}
                    title={t("exportTitle")}
                  >
                    <Download size={12} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={4}
                  className="w-56 p-1"
                >
                  {actions.schemas.length > 1 && (
                    <>
                      <div className="flex items-center justify-between rounded-sm py-0.5 hover:bg-muted/50">
                        <span className="truncate flex-1 px-2 text-xs italic text-muted-foreground">
                          {t("allSchemas")}
                        </span>
                        <div className="flex items-center gap-0.5 pr-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={isMigrationExporting}
                            aria-label={t("exportAllDdlAria")}
                            title={t("ddlTitle")}
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
                            aria-label={t("exportAllDataAria")}
                            title={t("dmlTitle")}
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
                            aria-label={t("exportAllFullAria")}
                            title={t("fullDumpTitle")}
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
                    {t("schemasPopoverLabel")}
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
                            aria-label={t("exportSchemaDdlAria", {
                              schema: s.name,
                            })}
                            title={t("ddlTitle")}
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
                            aria-label={t("exportSchemaDataAria", {
                              schema: s.name,
                            })}
                            title={t("dmlTitle")}
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
                            aria-label={t("exportSchemaFullAria", {
                              schema: s.name,
                            })}
                            title={t("fullDumpTitle")}
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
              aria-label={t("refreshSchemasAria")}
              title={t("refreshSchemasTitle")}
            >
              {actions.loadingSchemas ? (
                <Loader2 className="animate-spin" size={12} />
              ) : (
                <RefreshCw size={12} />
              )}
            </Button>
          </div>
        </div>

        {/* #1217 — top-level global filter. Lives outside `role="tree"` (like
          the Pinned/Recent sections) so its input never enters the tree's
          roving-tabindex model (#1129). Matches across every schema and
          object; matching schemas auto-expand so the collapse-by-default
          rule is overridden while filtering. */}
        {actions.schemas.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1">
            <Search size={12} className="shrink-0 text-muted-foreground" />
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              placeholder={t("filterAllPlaceholder")}
              value={actions.globalFilter}
              onChange={(e) => actions.setGlobalFilter(e.target.value)}
              aria-label={t("filterAllAria")}
            />
            {actions.globalFilter && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => actions.setGlobalFilter("")}
                aria-label={t("clearFilterAllAria")}
              >
                <X />
              </Button>
            )}
          </div>
        )}

        {/* #1218 — Pinned + Recent table sections. Rendered above the tree and
          outside `role="tree"` so their native <button> rows stay
          keyboard-reachable without touching the tree's roving-tabindex
          model (#1129). Clicking a row reuses `handleTableClick` — the same
          entry point as a tree node click. */}
        {db && (
          <PinnedRecentSections
            connectionId={connectionId}
            db={db}
            treeShape={treeShape}
            onOpenTable={actions.handleTableClick}
          />
        )}
      </div>

      <div
        ref={treeRef}
        role="tree"
        aria-label={t("schemaTreeAria", {
          name: connectionName || connectionId,
        })}
        onKeyDown={roving.onKeyDown}
      >
        <SchemaTreeBody
          schemas={filtered.schemas}
          treeShape={treeShape}
          expandedSchemas={effectiveExpandedSchemas}
          loadingTables={actions.loadingTables}
          tables={filtered.tables}
          views={filtered.views}
          functions={filtered.functions}
          fileAnalyticsSources={fileAnalyticsSources}
          connectionId={connectionId}
          selectedNodeId={actions.selectedNodeId}
          activeSchema={activeSchema ?? null}
          activeTable={activeTable ?? null}
          tableSearch={actions.tableSearch}
          visibleRows={visibleRows}
          shouldVirtualize={shouldVirtualize}
          rowVirtualizer={rowVirtualizer}
          ctx={ctx}
        />
        {globalFilterActive && filtered.schemas.length === 0 && (
          <div className="px-3 py-2 text-2xs italic text-muted-foreground">
            {t("noFilterMatches")}
          </div>
        )}
      </div>

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
    </div>
  );
}
