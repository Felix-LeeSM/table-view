import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryTab } from "@stores/workspaceStore";
import {
  resolveActiveDb,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { databaseTypeToSqlDialect } from "@lib/sql/sqlDialect";
import { getDataSourceProfile } from "@/types/dataSource";
import { buildSqlCompletionContext } from "@lib/sql/sqlCompletionContext";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { useMongoAutocomplete } from "@hooks/useMongoAutocomplete";
import { useRedisKeySuggestions } from "@hooks/useRedisKeySuggestions";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { assertNever } from "@/lib/paradigm";
import SqlQueryEditor from "./SqlQueryEditor";
import MongoQueryEditor from "./MongoQueryEditor";
import RedisCommandEditor from "./RedisCommandEditor";
import QueryResultGrid from "./QueryResultGrid";
import { SearchResultView } from "@components/search/SearchResultView";
import { ExplainViewer } from "./ExplainViewer";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import SqlPreviewDialog from "@components/structure/SqlPreviewDialog";
import MqlPreviewModal from "@components/document/MqlPreviewModal";
import QueryTabToolbar from "./QueryTab/Toolbar";
import DuckdbFileAnalyticsDialog from "./DuckdbFileAnalyticsDialog";
// sprint-373 (2026-05-17) — legacy in-memory HistoryPanel retired. The
// sprint-372 backend-driven `QueryHistoryPanel` consumes `list_history`
// IPC via `useQueryHistory` hook + cross-window events.
import QueryHistoryPanel from "./QueryHistoryPanel";
import { useQueryExecution } from "./QueryTab/useQueryExecution";
import { useQueryEvents } from "./QueryTab/useQueryEvents";
import { useQueryFavorites } from "./QueryTab/useQueryFavorites";
import { recordHistoryEntryAsync } from "@lib/runtime/history/recordHistoryEntry";
import { resolveSafeModeEnvironment } from "@hooks/useSafeModeGate";

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
 *   schemaNamespace / mongoExtensions / editorRef 의존도 많아 분리 시
 *   prop drilling 비용이 가독성 이득보다 큼.
 */

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const workspaceKey = useCurrentWorkspaceKey();
  const updateQuerySqlAction = useWorkspaceStore((s) => s.updateQuerySql);
  const updateQuerySql = (tabId: string, sql: string) => {
    if (!workspaceKey) return;
    updateQuerySqlAction(workspaceKey.connId, workspaceKey.db, tabId, sql);
  };
  // sprint-373 — `clearHistory` (in-memory) + `entries` retired. The
  // backend-driven `QueryHistoryPanel` (sprint-372) owns clear via the
  // `ClearHistoryButton` it composes (or the global QueryLog dock).
  // `loadQueryIntoTab` + `markConnectionUsed` were only used by the
  // legacy panel's per-entry "Load" button — the new panel routes detail
  // inspection through `QueryHistoryDetailModal` and load-into-tab is
  // deferred to sprint-376 (UI audit).
  // Active connection's dialect for editor keywords + identifier quoting.
  // Missing connection (e.g. deleted mid-session) falls back to
  // StandardSQL; document tabs receive the dialect but ignore it.
  const connections = useConnectionStore((s) => s.connections);
  const connection = useMemo(
    () => connections.find((c) => c.id === tab.connectionId),
    [connections, tab.connectionId],
  );
  const safeModeEnvironment = useMemo(
    () =>
      resolveSafeModeEnvironment(connections, tab.connectionId, "production"),
    [connections, tab.connectionId],
  );
  const destructiveDialogEnvironment =
    safeModeEnvironment === "production" ? "production" : "non-production";
  const sqlDialect = useMemo(
    () => databaseTypeToSqlDialect(connection?.dbType),
    [connection?.dbType],
  );
  const canCancelQuery = useMemo(
    () =>
      connection
        ? getDataSourceProfile(connection.dbType).capabilities.query.cancel
        : true,
    [connection],
  );
  const canPreviewLocalFile = useMemo(() => {
    if (!connection) return false;
    return (
      getDataSourceProfile(
        connection.dbType,
      ).fileConnection?.supportedInputs.some(
        (input) => input.kind === "analytics" && input.status === "supported",
      ) ?? false
    );
  }, [connection]);
  const [showFileAnalytics, setShowFileAnalytics] = useState(false);
  const [explainSql, setExplainSql] = useState<string | null>(null);
  // `dbType` flows in so the autocomplete namespace surfaces
  // dialect-specific keywords (PG: RETURNING/ILIKE; MySQL: AUTO_INCREMENT;
  // SQLite: PRAGMA / WITHOUT ROWID).
  const schemaNamespace = useSqlAutocomplete(
    tab.connectionId,
    tab.database ?? "",
    {
      dialect: sqlDialect,
      dbType: connection?.dbType,
    },
  );
  const schemas = useSchemaStore((s) => s.schemas);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);
  const postgresExtensions = useSchemaStore((s) => s.postgresExtensions);
  const loadPostgresExtensions = useSchemaStore(
    (s) => s.loadPostgresExtensions,
  );
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const fileAnalyticsSources = useSchemaStore((s) => s.fileAnalyticsSources);
  useEffect(() => {
    if (
      tab.paradigm !== "rdb" ||
      connection?.dbType !== "postgresql" ||
      !tab.database
    ) {
      return;
    }
    void loadPostgresExtensions(tab.connectionId, tab.database).catch(() => {
      // Background completion inventory; schemaStore records the error.
    });
  }, [
    tab.paradigm,
    tab.connectionId,
    tab.database,
    connection?.dbType,
    loadPostgresExtensions,
  ]);
  const completionContext = useMemo(() => {
    if (tab.paradigm !== "rdb") return undefined;
    return buildSqlCompletionContext({
      schemas,
      tables,
      views,
      functions,
      postgresExtensions,
      tableColumnsCache,
      fileAnalyticsSources,
      connectionId: tab.connectionId,
      database: tab.database ?? "",
      dbType: connection?.dbType,
    });
  }, [
    schemas,
    tables,
    views,
    functions,
    postgresExtensions,
    tableColumnsCache,
    fileAnalyticsSources,
    tab.paradigm,
    tab.connectionId,
    tab.database,
    connection?.dbType,
  ]);
  // Cached Mongo field names for autocomplete. We project the single
  // cache slice for this tab to a string array so the hook's memo key is
  // stable against unrelated cache updates. RDB tabs compute `undefined`
  // and the resulting no-op extension set is gated out by paradigm.
  const fieldsCache = useDocumentCatalogStore((s) => s.fieldsCache);
  const indexesCache = useDocumentCatalogStore((s) => s.indexesCache);
  const collectionsCache = useDocumentCatalogStore((s) => s.collections);
  const loadCollectionIndexes = useDocumentCatalogStore(
    (s) => s.loadCollectionIndexes,
  );
  const mongoFieldNames = useMemo(() => {
    if (tab.paradigm !== "document" || !tab.database || !tab.collection) {
      return undefined;
    }
    const columns =
      fieldsCache[tab.connectionId]?.[tab.database]?.[tab.collection];
    if (!columns) return undefined;
    return columns.map((c) => c.name);
  }, [
    fieldsCache,
    tab.connectionId,
    tab.database,
    tab.collection,
    tab.paradigm,
  ]);
  // Collection-name candidates surfaced after `db.`. Primary source is
  // `documentStore.collections` — the same cache that backs the sidebar
  // tree (`list_mongo_collections` IPC), so the popup proposes every
  // collection the user can see in the sidebar even when they haven't
  // opened any. `fieldsCache` is the secondary source for collections
  // that were opened ad-hoc without populating the database's list (rare,
  // but kept so the union never shrinks). The mongosh method whitelist
  // still fires through `createMongoshDbSource` so `db.<anyName>.fi`
  // autocompletes regardless of whether either cache is populated.
  const mongoCollectionNames = useMemo(() => {
    if (tab.paradigm !== "document" || !tab.database) return undefined;
    const fromList = collectionsCache[tab.connectionId]?.[tab.database];
    const fromFields = fieldsCache[tab.connectionId]?.[tab.database];
    if (!fromList && !fromFields) return undefined;
    const names = new Set<string>();
    fromList?.forEach((c) => names.add(c.name));
    if (fromFields) Object.keys(fromFields).forEach((name) => names.add(name));
    return Array.from(names);
  }, [
    collectionsCache,
    fieldsCache,
    tab.connectionId,
    tab.database,
    tab.paradigm,
  ]);
  const mongoIndexNames = useMemo(() => {
    if (tab.paradigm !== "document" || !tab.database || !tab.collection) {
      return undefined;
    }
    const indexes =
      indexesCache[tab.connectionId]?.[tab.database]?.[tab.collection];
    if (!indexes) return undefined;
    return indexes.map((idx) => idx.name);
  }, [
    indexesCache,
    tab.connectionId,
    tab.database,
    tab.collection,
    tab.paradigm,
  ]);
  useEffect(() => {
    if (tab.paradigm !== "document" || !tab.database || !tab.collection) {
      return;
    }
    void loadCollectionIndexes(
      tab.connectionId,
      tab.database,
      tab.collection,
    ).catch(() => {
      // Background completion inventory; index panel remains the visible
      // error surface for index permissions.
    });
  }, [
    tab.paradigm,
    tab.connectionId,
    tab.database,
    tab.collection,
    loadCollectionIndexes,
  ]);
  // Sprint 309 — `useMongoAutocomplete` no longer branches on the legacy
  // mode toggle. The unified completion source surfaces both the find
  // operator set and aggregate stages / accumulators so the user can type
  // either flavour without flipping a toggle; A4 owns the snippet menu
  // that distinguishes intent at insertion time.
  const mongoExtensions = useMongoAutocomplete({
    activeCollectionName: tab.collection,
    fieldNames: mongoFieldNames,
    collectionNames: mongoCollectionNames,
    indexNames: mongoIndexNames,
  });
  const isDocument = tab.paradigm === "document";
  const canExplainQuery =
    tab.paradigm === "rdb" && connection?.dbType === "postgresql";

  const favorites = useQueryFavorites({ tab });
  const {
    handleExecute,
    handleDryRun,
    pendingMongoConfirm,
    confirmMongoDangerous,
    cancelMongoDangerous,
    pendingRdbConfirm,
    confirmRdbDangerous,
    cancelRdbDangerous,
    pendingKvConfirm,
    confirmKvDangerous,
    cancelKvDangerous,
    pendingRdbWarn,
    confirmRdbWarn,
    cancelRdbWarn,
    pendingMongoWarn,
    confirmMongoWarn,
    cancelMongoWarn,
  } = useQueryExecution({ tab });
  const { editorRef, handleFormat } = useQueryEvents({
    tab,
    updateQuerySql,
    canCancelQuery,
  });

  const handleExecuteAndShowResults = useCallback(() => {
    setExplainSql(null);
    handleExecute();
  }, [handleExecute]);

  const handleDryRunAndShowResults = useCallback(() => {
    setExplainSql(null);
    handleDryRun();
  }, [handleDryRun]);

  const handleExplain = useCallback(() => {
    const sql = tab.sql.trim();
    if (!sql || tab.queryState.status === "running" || !canExplainQuery) {
      return;
    }
    setExplainSql(sql);
  }, [canExplainQuery, tab.queryState.status, tab.sql]);

  const handleExplainSettled = useCallback(
    (result: {
      status: "success" | "error";
      durationMs: number;
      executedAt: number;
      errorMessage?: string;
    }) => {
      if (!explainSql) return;
      return recordHistoryEntryAsync({
        connectionId: tab.connectionId,
        database: tab.database,
        tabId: tab.id,
        paradigm: "rdb",
        queryMode: "sql",
        source: "explain",
        sql: explainSql,
        status: result.status,
        errorMessage: result.errorMessage,
        executedAt: result.executedAt,
        duration: result.durationMs,
      });
    },
    [explainSql, tab.connectionId, tab.database, tab.id],
  );
  const explainExpectedDatabase = useMemo(
    () => tab.database ?? resolveActiveDb(tab.connectionId),
    [tab.database, tab.connectionId],
  );
  const redisKeySuggestionState = useRedisKeySuggestions({
    connectionId: tab.connectionId,
    database: explainExpectedDatabase,
    enabled: tab.paradigm === "kv",
  });
  const redisCommandTarget =
    connection?.dbType === "valkey" ? "valkey" : "redis";

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
        canCancelQuery={canCancelQuery}
        onExecute={handleExecuteAndShowResults}
        onDryRun={handleDryRunAndShowResults}
        onExplain={handleExplain}
        canExplain={canExplainQuery}
        onFormat={handleFormat}
        showFileAnalytics={canPreviewLocalFile}
        onOpenFileAnalytics={() => setShowFileAnalytics(true)}
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
                  onExecute={handleExecuteAndShowResults}
                  onDryRun={handleDryRunAndShowResults}
                  schemaNamespace={schemaNamespace}
                  sqlDialect={sqlDialect}
                  completionContext={completionContext}
                />
              );
            case "document":
              return (
                // Sprint 309 — the Mongo editor is a single mongosh-flavoured
                // surface. The legacy mode field remains on the QueryTab type
                // for backward-compat (deprecated) but is no longer threaded
                // into the editor.
                <MongoQueryEditor
                  ref={editorRef}
                  sql={tab.sql}
                  onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
                  onExecute={handleExecuteAndShowResults}
                  onDryRun={handleDryRunAndShowResults}
                  mongoExtensions={mongoExtensions}
                />
              );
            case "kv":
              return (
                <RedisCommandEditor
                  ref={editorRef}
                  sql={tab.sql}
                  onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
                  onExecute={handleExecuteAndShowResults}
                  onDryRun={handleDryRunAndShowResults}
                  redisKeySuggestions={redisKeySuggestionState.keySuggestions}
                  redisCommandTarget={redisCommandTarget}
                />
              );
            case "search":
              return (
                <div
                  className="flex h-full w-full items-center justify-center overflow-hidden bg-background p-4 text-center text-sm text-muted-foreground"
                  role="textbox"
                  aria-label="Search Query Editor"
                  aria-multiline="true"
                  data-paradigm="search"
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
        {explainSql && canExplainQuery ? (
          <ExplainViewer
            connectionId={tab.connectionId}
            paradigm="table"
            rdbSql={explainSql}
            expectedDatabase={explainExpectedDatabase ?? undefined}
            onPlanSettled={handleExplainSettled}
          />
        ) : tab.paradigm === "search" ? (
          <SearchResultView queryState={tab.queryState} />
        ) : (
          <QueryResultGrid
            queryState={tab.queryState}
            connectionId={tab.connectionId}
            database={tab.database}
            sql={tab.sql}
            onAfterCommit={handleExecuteAndShowResults}
            // Sprint 248 (ADR 0022 Phase 4) — surface the dry-run flag so
            // the result grid renders the rolled-back banner. Derived
            // here so the grid stays paradigm-agnostic.
            isDryRun={
              tab.queryState.status === "completed" &&
              tab.queryState.isDryRun === true
            }
          />
        )}
      </div>

      <QueryHistoryPanel connectionId={tab.connectionId} tabId={tab.id} />

      {canPreviewLocalFile && showFileAnalytics && (
        <DuckdbFileAnalyticsDialog
          connectionId={tab.connectionId}
          database={tab.database}
          tabId={tab.id}
          onClose={() => setShowFileAnalytics(false)}
        />
      )}

      {pendingMongoConfirm && (
        <ConfirmDestructiveDialog
          open
          reason={pendingMongoConfirm.reason}
          // Sprint 312 — write STOP (drop-equivalent) carries
          // `previewLines` (formatted mongosh); aggregate STOP keeps the
          // pipeline-JSON preview from A5. Dialog stays paradigm-agnostic.
          sqlPreview={
            pendingMongoConfirm.previewLines
              ? pendingMongoConfirm.previewLines.join("\n")
              : JSON.stringify(pendingMongoConfirm.pipeline, null, 2)
          }
          environment={destructiveDialogEnvironment}
          connectionId={tab.connectionId}
          // Mongo dry-run is unsupported (paradigm="document" routes to
          // disclaimer); statements are still serialized for symmetry.
          statements={
            pendingMongoConfirm.previewLines
              ? pendingMongoConfirm.previewLines
              : [JSON.stringify(pendingMongoConfirm.pipeline)]
          }
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
          environment={destructiveDialogEnvironment}
          connectionId={tab.connectionId}
          statements={pendingRdbConfirm.statements}
          paradigm="rdb"
          onConfirm={confirmRdbDangerous}
          onCancel={cancelRdbDangerous}
        />
      )}

      {pendingKvConfirm && (
        <ConfirmDestructiveDialog
          open
          reason={pendingKvConfirm.reason}
          sqlPreview={pendingKvConfirm.command}
          environment={destructiveDialogEnvironment}
          connectionId={tab.connectionId}
          statements={[pendingKvConfirm.command]}
          paradigm="kv"
          onConfirm={confirmKvDangerous}
          onCancel={cancelKvDangerous}
        />
      )}

      {/* Sprint 255 — raw RDB WARN-tier preview dialog. Mounts ONLY when
          the batch contains at least one non-INFO safe statement
          (INSERT / UPDATE WHERE / CREATE / ALTER additive) AND no STOP
          statement. STOP > WARN priority is enforced inside
          `handleExecute`, so `pendingRdbWarn` is `null` when
          `pendingRdbConfirm` is set — the two dialogs never co-mount.
          INFO statements (SELECT / EXPLAIN / SHOW / DESCRIBE / WITH …
          SELECT) bypass this dialog entirely (direct IPC). */}
      {pendingRdbWarn && (
        <SqlPreviewDialog
          sql={pendingRdbWarn.statements.join(";\n")}
          loading={false}
          error={null}
          commitError={null}
          environment={connection?.environment ?? null}
          onConfirm={confirmRdbWarn}
          onCancel={cancelRdbWarn}
        />
      )}

      {/* Sprint 255 — raw Mongo aggregate WARN-tier preview modal.
          Mounts when `severity: "safe"` aggregate is non-INFO (currently
          a thin slice — `analyzeMongoPipeline` classifies all safe
          pipelines as `mongo-other` which `isInfoMongoOperation` treats
          as INFO; Sprint 254's 3-tier split will widen WARN coverage).
          Mongo find path never WARNs (always INFO); $out / $merge
          ($out / $merge) route to `pendingMongoConfirm` (STOP). */}
      {pendingMongoWarn && (
        <MqlPreviewModal
          // Sprint 312 — write WARN cases prefer the parser-formatted
          // mongosh string; aggregate WARN keeps the pipeline-JSON
          // preview for backward-compat with sprint 255 tests.
          previewLines={
            pendingMongoWarn.previewLines ??
            JSON.stringify(pendingMongoWarn.pipeline, null, 2).split("\n")
          }
          errors={[]}
          onExecute={confirmMongoWarn}
          onCancel={cancelMongoWarn}
          loading={false}
        />
      )}
    </div>
  );
}
