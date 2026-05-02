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
import { useTabStore } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMigrationExport } from "@/hooks/useMigrationExport";
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
  DropTableConfirmDialog,
  RenameTableDialog,
} from "./SchemaTree/dialogs";
import { useSchemaTreeActions } from "./SchemaTree/useSchemaTreeActions";

/**
 * Sprint 199 — entry shell. Pre-split (1-2105 lines) 의 4 책임 (helper /
 * action / row render / dialog) 을 sub-file 4개 로 분리한 뒤 남은 thin
 * shell. 본 파일에 남는 것은:
 *   1. import / props
 *   2. cross-slice state (connection name / dbType / treeShape /
 *      activeSchema·activeTable / migration export hook 결과)
 *   3. virtualizer wiring (`useVirtualizer` + scroll container ref)
 *   4. effect 3개 (refresh-schema 리스너, active-tab → schema 자동 펼침,
 *      schemas load 시 전체 자동 펼침)
 *   5. return JSX shell — 헤더 (Schemas 라벨 + Export Popover + Refresh
 *      버튼) + `<SchemaTreeBody>` + 두 dialog
 *
 * `useSchemaTreeActions` 가 12 handler + dialog state + 트리 UI state
 * (expandedSchemas / selectedNodeId / tableSearch / ...) 를 모두 제공
 * 하므로 entry 는 dispatch 만 한다.
 */

interface SchemaTreeProps {
  connectionId: string;
}

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const actions = useSchemaTreeActions({ connectionId });
  // useEffect 의존성을 좁히기 위해 자주 쓰이는 필드를 destructure.
  // (action 객체 전체를 dep 으로 넣으면 매 렌더마다 effect 가 다시
  // 실행돼 setExpandedSchemas 가 매번 모든 schema 를 펼쳐 collapse
  // 동작이 즉시 되감기 — Sprint 199 회귀.)
  const { schemas, setExpandedSchemas, refreshConnection } = actions;

  // 트리 본문 렌더에 필요한 read-only selector. write 는 hook 안에서만
  // 발생 (Sprint 196 store-coupling 정책 준수).
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);

  const connectionName = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name,
  );
  // Sprint 135 — DBMS-shape-aware tree depth. Driven off `db_type` because
  // `paradigm` is always `"rdb"` for the three relational DBMSes we
  // currently ship (PG / MySQL / SQLite); the shape difference is *within*
  // the rdb paradigm. Defaults to `"with-schema"` (PG) when the connection
  // hasn't loaded yet so the initial paint matches the most explicit shape.
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.db_type,
  );
  const treeShape: RdbTreeShape = dbType
    ? resolveRdbTreeShape(dbType)
    : "with-schema";

  // Sprint 192 (AC-192-04) — RDB schema 단위 migration export. Mongo /
  // Redis 연결에서는 메뉴를 hide. dbType 미정 (load 전) 도 hide.
  const isRdbConnection =
    dbType === "postgresql" || dbType === "mysql" || dbType === "sqlite";
  const {
    exportSchema: exportSchemaWithInclude,
    exportDatabase: exportDatabaseWithInclude,
    isExporting: isMigrationExporting,
  } = useMigrationExport();

  // Track active tab for highlight & auto-expand
  const activeTab = useTabStore((s) => {
    const tabId = s.activeTabId;
    return tabId ? s.tabs.find((t) => t.id === tabId) : null;
  });
  const activeSchema = activeTab?.type === "table" ? activeTab.schema : null;
  const activeTable = activeTab?.type === "table" ? activeTab.table : null;

  // Sprint 191 (AC-191-04) — refresh-schema (Cmd+R / F5) listener.
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

  // Sprint 135 — for `no-schema` (MySQL) and `flat` (SQLite) shapes the
  // schema row is hidden, but every backend-returned schema must still
  // be expanded behind the scenes so `loadTables` fires and the table
  // list appears under the sidebar root.
  //
  // Sprint 144 (AC-145-1) — extend the same auto-expand to `with-schema`
  // (PostgreSQL) so users with multiple custom schemas don't have to
  // click every chevron individually. The user-facing effect: every PG
  // schema paints expanded on first load. Per the AC-145-1 toggle
  // contract, `handleExpandSchema` still collapses on click; the auto-
  // expand only seeds the *initial* state.
  useEffect(() => {
    if (schemas.length === 0) return;
    setExpandedSchemas((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const s of schemas) {
        if (!next.has(s.name)) {
          next.add(s.name);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [treeShape, schemas, setExpandedSchemas]);

  // ──────────────────────────────────────────────────────────────────────
  // Sprint-115 — virtualization plumbing. The flat visible-rows list is
  // computed unconditionally (single array walk over already-derived
  // state) so the threshold check is one comparison and the virtualized
  // branch indexes the same data the eager branch reads.
  // ──────────────────────────────────────────────────────────────────────
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
  });

  // Sprint 135 — only the `with-schema` shape can fan out far enough to
  // need virtualization (PG: schemas × categories × items). MySQL/SQLite
  // shapes cap at table count which is bounded by the user's database
  // contents and rarely crosses the threshold; gating the virtualizer
  // keeps the simpler shapes on the eager path.
  const shouldVirtualize =
    treeShape === "with-schema" && visibleRows.length > VIRTUALIZE_THRESHOLD;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleRows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 8,
  });

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
    handleDropTable: actions.handleDropTable,
    handleStartRename: actions.handleStartRename,
    handleViewClick: actions.handleViewClick,
    handleOpenViewStructure: actions.handleOpenViewStructure,
    handleFunctionClick: actions.handleFunctionClick,
  };

  return (
    <div
      ref={scrollContainerRef}
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
          {/* Sprint 192 (AC-192-04) — RDB export 진입점. 헤더 Popover 안
              에서 3 모드 (DDL / DML / Full) × 2 단위 (single schema / all
              schemas) 노출. icon 옆 native title 로 의미 명시.
              MySQL/SQLite adapter 가 Phase 9 placeholder 라 현재 실제 동작
              은 PG only — UI 는 paradigm === rdb 면 노출. */}
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
                            exportSchemaWithInclude(connectionId, s.name, "ddl")
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
                            exportSchemaWithInclude(connectionId, s.name, "dml")
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
      />

      <DropTableConfirmDialog
        confirmDialog={actions.confirmDialog}
        isOperating={actions.isOperating}
        onCancel={() => actions.setConfirmDialog(null)}
      />

      <RenameTableDialog
        renameDialog={actions.renameDialog}
        renameInput={actions.renameInput}
        renameError={actions.renameError}
        isOperating={actions.isOperating}
        renameInputRef={actions.renameInputRef}
        onChangeInput={(value) => {
          actions.setRenameInput(value);
          actions.setRenameError(null);
        }}
        onConfirm={actions.handleConfirmRename}
        onCancel={() => actions.setRenameDialog(null)}
      />
    </div>
  );
}
