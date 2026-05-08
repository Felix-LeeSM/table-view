import { useMemo, useRef } from "react";
import type { QueryTab } from "@stores/tabStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useMruStore } from "@stores/mruStore";
import { useConnectionStore } from "@stores/connectionStore";
import { databaseTypeToSqlDialect } from "@lib/sql/sqlDialect";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { useMongoAutocomplete } from "@hooks/useMongoAutocomplete";
import { useDocumentStore } from "@stores/documentStore";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { assertNever } from "@/lib/paradigm";
import SqlQueryEditor from "./SqlQueryEditor";
import MongoQueryEditor from "./MongoQueryEditor";
import QueryResultGrid from "./QueryResultGrid";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import QueryTabToolbar from "./QueryTab/Toolbar";
import QueryHistoryPanel from "./QueryTab/HistoryPanel";
import { useQueryExecution } from "./QueryTab/useQueryExecution";
import { useQueryEvents } from "./QueryTab/useQueryEvents";
import { useQueryFavorites } from "./QueryTab/useQueryFavorites";

/**
 * `QueryTab` — RDB / Document paradigm 의 단일 query tab shell. 책임은
 * `QueryTab/{queryHelpers, useQueryExecution, useQueryEvents,
 * useQueryFavorites, Toolbar, HistoryPanel}` 로 분산. 본 entry 는
 * imports + props interface + paradigm 파생 + 4 hook 호출 + return JSX
 * shell.
 *
 * 외부 invariant:
 * - `<QueryTab tab={...} />` props (`QueryTabProps`) 시그니처 byte-for-byte
 *   동결 — `src/components/layout/MainArea.tsx` 가 직접 import.
 * - default export 위치 동결 (`QueryTab.tsx`).
 * - Editor area (paradigm router) 는 entry inline — sqlDialect /
 *   schemaNamespace / mongoExtensions / editorRef / queryMode 의존도
 *   많아 분리 시 prop drilling 비용이 가독성 이득보다 큼.
 */

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const setQueryMode = useTabStore((s) => s.setQueryMode);
  const loadQueryIntoTab = useTabStore((s) => s.loadQueryIntoTab);
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);
  const historyEntries = useQueryHistoryStore((s) => s.entries);
  // Active connection's dialect for editor keywords + identifier quoting.
  // Missing connection (e.g. deleted mid-session) falls back to
  // StandardSQL; document tabs receive the dialect but ignore it.
  const connections = useConnectionStore((s) => s.connections);
  const connection = useMemo(
    () => connections.find((c) => c.id === tab.connectionId),
    [connections, tab.connectionId],
  );
  const sqlDialect = useMemo(
    () => databaseTypeToSqlDialect(connection?.db_type),
    [connection?.db_type],
  );
  // `dbType` flows in so the autocomplete namespace surfaces
  // dialect-specific keywords (PG: RETURNING/ILIKE; MySQL: AUTO_INCREMENT;
  // SQLite: PRAGMA / WITHOUT ROWID).
  const schemaNamespace = useSqlAutocomplete(tab.connectionId, {
    dialect: sqlDialect,
    dbType: connection?.db_type,
  });
  // Cached Mongo field names for autocomplete. We project the single
  // cache slice for this tab to a string array so the hook's memo key is
  // stable against unrelated cache updates. RDB tabs compute `undefined`
  // and the resulting no-op extension set is gated out by paradigm.
  const fieldsCache = useDocumentStore((s) => s.fieldsCache);
  const mongoFieldNames = useMemo(() => {
    if (tab.paradigm !== "document" || !tab.database || !tab.collection) {
      return undefined;
    }
    const cacheKey = `${tab.connectionId}:${tab.database}:${tab.collection}`;
    const columns = fieldsCache[cacheKey];
    if (!columns) return undefined;
    return columns.map((c) => c.name);
  }, [
    fieldsCache,
    tab.connectionId,
    tab.database,
    tab.collection,
    tab.paradigm,
  ]);
  const mongoExtensions = useMongoAutocomplete({
    queryMode: tab.queryMode === "aggregate" ? "aggregate" : "find",
    fieldNames: mongoFieldNames,
  });
  const isDocument = tab.paradigm === "document";

  const favorites = useQueryFavorites({ tab });
  const {
    handleExecute,
    pendingMongoConfirm,
    confirmMongoDangerous,
    cancelMongoDangerous,
    pendingRdbConfirm,
    confirmRdbDangerous,
    cancelRdbDangerous,
  } = useQueryExecution({ tab });
  const { editorRef, handleFormat } = useQueryEvents({ tab, updateQuerySql });

  // Resizable split state
  const containerRef = useRef<HTMLDivElement>(null);
  const { size: editorPct, handleMouseDown: handleResizeMouseDown } =
    useResizablePanel({
      axis: "vertical",
      min: 10,
      max: 90,
      initial: 50,
      percentage: true,
      containerRef,
    });

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden">
      <QueryTabToolbar
        tab={tab}
        isDocument={isDocument}
        onExecute={handleExecute}
        onFormat={handleFormat}
        onSetQueryMode={setQueryMode}
        favorites={favorites}
      />

      {/* Paradigm router lives inline (not in a wrapper) so the
          paradigm → editor mapping sits next to the dialect/autocomplete
          wiring and is visible at the call site. `assertNever` guards
          against silent fallthrough on future paradigms. */}
      <div
        className="min-h-0 overflow-hidden"
        style={{ flex: `0 0 ${editorPct}%` }}
      >
        {(() => {
          switch (tab.paradigm) {
            case "rdb":
              return (
                <SqlQueryEditor
                  ref={editorRef}
                  sql={tab.sql}
                  onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
                  onExecute={handleExecute}
                  schemaNamespace={schemaNamespace}
                  sqlDialect={sqlDialect}
                />
              );
            case "document":
              return (
                <MongoQueryEditor
                  ref={editorRef}
                  sql={tab.sql}
                  onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
                  onExecute={handleExecute}
                  queryMode={tab.queryMode}
                  mongoExtensions={mongoExtensions}
                />
              );
            case "kv":
              return (
                <div
                  className="flex h-full w-full items-center justify-center overflow-hidden bg-background p-4 text-center text-sm text-muted-foreground"
                  role="textbox"
                  aria-label="Key-Value Query Editor"
                  aria-multiline="true"
                  data-paradigm="kv"
                  data-query-mode={tab.queryMode}
                >
                  Redis query editor is planned but not yet available.
                </div>
              );
            case "search":
              return (
                <div
                  className="flex h-full w-full items-center justify-center overflow-hidden bg-background p-4 text-center text-sm text-muted-foreground"
                  role="textbox"
                  aria-label="Search Query Editor"
                  aria-multiline="true"
                  data-paradigm="search"
                  data-query-mode={tab.queryMode}
                >
                  Search query editor is planned but not yet available.
                </div>
              );
            default:
              return assertNever(tab.paradigm);
          }
        })()}
      </div>

      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize shrink-0 border-y border-border hover:bg-primary/90 active:bg-primary/90"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Result area — flex column so QueryResultGrid's flex-1 children fill
          the remaining height and the inner table can actually scroll. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryResultGrid
          queryState={tab.queryState}
          connectionId={tab.connectionId}
          sql={tab.sql}
          onAfterCommit={handleExecute}
        />
      </div>

      <QueryHistoryPanel
        entries={historyEntries}
        onLoad={(args) => {
          loadQueryIntoTab(args);
          markConnectionUsed(args.connectionId);
        }}
        onClear={clearHistory}
      />

      {pendingMongoConfirm && (
        <ConfirmDestructiveDialog
          open
          reason={pendingMongoConfirm.reason}
          sqlPreview={JSON.stringify(pendingMongoConfirm.pipeline, null, 2)}
          environment={
            connection?.environment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={tab.connectionId}
          // Mongo dry-run is unsupported (paradigm="document" routes to
          // disclaimer); statements are still serialized for symmetry.
          statements={[JSON.stringify(pendingMongoConfirm.pipeline)]}
          paradigm="document"
          onConfirm={confirmMongoDangerous}
          onCancel={cancelMongoDangerous}
        />
      )}

      {/* Sprint 231 — raw RDB warn-tier confirm dialog. Mirrors the Mongo
          dialog above but joins the batch verbatim (`;\n`) so the user
          sees every dangerous statement before approving. Sprint 246
          (ADR 0022 Phase 2) replaced the type-to-confirm gate with a
          simple Yes/No + environment-aware header; the dialog mounts
          via the same `pendingRdbConfirm` shape. */}
      {pendingRdbConfirm && (
        <ConfirmDestructiveDialog
          open
          reason={pendingRdbConfirm.reason}
          sqlPreview={pendingRdbConfirm.statements.join(";\n")}
          environment={
            connection?.environment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={tab.connectionId}
          statements={pendingRdbConfirm.statements}
          paradigm="rdb"
          onConfirm={confirmRdbDangerous}
          onCancel={cancelRdbDangerous}
        />
      )}
    </div>
  );
}
