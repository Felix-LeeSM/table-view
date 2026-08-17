import MqlPreviewModal from "@components/document/MqlPreviewModal";
import { SearchResultView } from "@components/search/SearchResultView";
import SqlPreviewDialog from "@components/structure/SqlPreviewDialog";
import {
  buildSqlCompletionContext,
  useMongoAutocomplete,
} from "@features/completion";
import { ConfirmDestructiveDialog } from "@features/workspace";
import { useRedisKeySuggestions } from "@hooks/useRedisKeySuggestions";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { resolveSafeModeEnvironment } from "@hooks/useSafeModeGate";
import { useSearchAutocomplete } from "@hooks/useSearchAutocomplete";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { recordHistoryEntryAsync } from "@lib/runtime/history/recordHistoryEntry";
import { toast } from "@lib/runtime/toast";
import { databaseTypeToSqlDialect } from "@lib/sql/sqlDialect";
import { readTextFileImport } from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useSchemaStore } from "@stores/schemaStore";
// Aliased: the default export below is also named `QueryTab`, and the bare
// import would shadow-redeclare it in module scope (biome noRedeclare).
import type { QueryTab as QueryTabModel } from "@stores/workspaceStore";
import {
  resolveActiveDb,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assertNever } from "@/lib/paradigm";
import { getDataSourceProfile } from "@/types/dataSource";
import DuckdbFileAnalyticsDialog from "./DuckdbFileAnalyticsDialog";
import { ExplainViewer } from "./ExplainViewer";
import MongoQueryEditor from "./MongoQueryEditor";
// sprint-373 (2026-05-17) — legacy in-memory HistoryPanel retired. The
// sprint-372 backend-driven `QueryHistoryPanel` consumes `list_history`
// IPC via `useQueryHistory` hook + cross-window events.
import QueryHistoryPanel from "./QueryHistoryPanel";
import QueryResultGrid from "./QueryResultGrid";
import { deriveMongoExplainSpec } from "./QueryTab/queryHelpers";
import { deriveSearchExplainSpec } from "./QueryTab/searchQueryExecution";
import QueryTabToolbar from "./QueryTab/Toolbar";
import { useQueryEvents } from "./QueryTab/useQueryEvents";
import { useQueryExecution } from "./QueryTab/useQueryExecution";
import { useQueryFavorites } from "./QueryTab/useQueryFavorites";
import RedisCommandEditor from "./RedisCommandEditor";
import SearchQueryEditor from "./SearchQueryEditor";
import SqlQueryEditor from "./SqlQueryEditor";

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
  tab: QueryTabModel;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const { t } = useTranslation("query");
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
    () => resolveSafeModeEnvironment(connections, tab.connectionId),
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
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);
  const postgresExtensions = useSchemaStore((s) => s.postgresExtensions);
  const sqliteCapabilities = useSchemaStore((s) => s.sqliteCapabilities);
  const loadPostgresExtensions = useSchemaStore(
    (s) => s.loadPostgresExtensions,
  );
  const loadSqliteCapabilities = useSchemaStore(
    (s) => s.loadSqliteCapabilities,
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
  useEffect(() => {
    if (
      tab.paradigm !== "rdb" ||
      connection?.dbType !== "sqlite" ||
      !tab.database
    ) {
      return;
    }
    void loadSqliteCapabilities(tab.connectionId, tab.database).catch(() => {
      // Background completion inventory; schemaStore records the error.
    });
  }, [
    tab.paradigm,
    tab.connectionId,
    tab.database,
    connection?.dbType,
    loadSqliteCapabilities,
  ]);
  const completionContext = useMemo(() => {
    if (tab.paradigm !== "rdb") return undefined;
    return buildSqlCompletionContext({
      schemas,
      databases,
      tables,
      views,
      functions,
      postgresExtensions,
      sqliteCapabilities,
      tableColumnsCache,
      fileAnalyticsSources,
      connectionId: tab.connectionId,
      database: tab.database ?? "",
      dbType: connection?.dbType,
    });
  }, [
    schemas,
    databases,
    tables,
    views,
    functions,
    postgresExtensions,
    sqliteCapabilities,
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
    fromList?.forEach((c) => {
      names.add(c.name);
    });
    if (fromFields) {
      Object.keys(fromFields).forEach((name) => {
        names.add(name);
      });
    }
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
  const isSearch = tab.paradigm === "search";
  // #1041 — Explain visibility follows the `capabilities.query.explain`
  // contract instead of a hardcoded dbType. Paradigms the ExplainViewer can't
  // display stay excluded even if a future source flips the flag; #2153 added
  // search to what it displays, so the paradigm list now names rdb (table),
  // document and search. The plan source differs per paradigm — rdb and
  // document call a backend `explain_query`, search re-runs `_search` with
  // the bounded `profile` flag (#1818/#2198) — but the gate is the same flag.
  const canExplainQuery =
    (tab.paradigm === "rdb" || isDocument || isSearch) &&
    !!connection &&
    getDataSourceProfile(connection.dbType).capabilities.query.explain;
  const explainMongo = useMemo(
    () =>
      isDocument && explainSql
        ? deriveMongoExplainSpec(explainSql, tab.database)
        : null,
    [isDocument, explainSql, tab.database],
  );
  const explainSearch = useMemo(() => {
    if (!isSearch || !explainSql) return null;
    const derived = deriveSearchExplainSpec(explainSql, tab.searchTarget);
    return "request" in derived ? derived.request : null;
  }, [isSearch, explainSql, tab.searchTarget]);

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

  // #1528 — snippet panel toggle + insert-at-cursor. `replaceSelection`
  // inserts at the caret (replacing any selection) and lands on the undo
  // stack; the editor's updateListener syncs the new text back to the store.
  const [showSnippets, setShowSnippets] = useState(false);
  const handleInsertSnippet = useCallback(
    (text: string) => {
      const view = editorRef.current;
      if (!view) return;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    [editorRef],
  );

  const handleExecuteAndShowResults = useCallback(() => {
    setExplainSql(null);
    handleExecute();
  }, [handleExecute]);

  const handleDryRunAndShowResults = useCallback(() => {
    setExplainSql(null);
    handleDryRun();
  }, [handleDryRun]);

  // Stage 1 (#1077) import — open a `.sql` file and load it into the editor.
  // Deliberately does NOT auto-run: the user reviews the loaded SQL and runs
  // it through the normal Run path, so destructive statements still hit the
  // Safe Mode confirm gate. Symmetric inverse of the SQL export.
  const handleImportSqlFile = useCallback(async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SQL", extensions: ["sql"] }],
      });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const content = await readTextFileImport(path);
      updateQuerySql(tab.id, content);
      toast.success(t("importSqlFile.loaded"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("importSqlFile.failed", { message }));
    }
    // updateQuerySql is re-created each render but closes over the stable
    // workspace key; tab.id is the only value that changes the target tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, t]);

  const handleExplain = useCallback(() => {
    const sql = tab.sql.trim();
    if (!sql || tab.queryState.status === "running" || !canExplainQuery) {
      return;
    }
    // #1041 — Mongo explain is find-only (see `deriveMongoExplainSpec`).
    // Mirror the dry-run toast pattern so a non-find statement fails loudly
    // instead of leaving the result area blank.
    if (isDocument && !deriveMongoExplainSpec(sql, tab.database)) {
      toast.info("Explain is only available for find() queries in MongoDB.");
      return;
    }
    // #2153 — the search plan comes from re-running the request, so a body the
    // bounded parser rejects has no plan. Surface the parser's own reason
    // (bad JSON, missing index target) instead of a blank result area.
    if (isSearch) {
      const derived = deriveSearchExplainSpec(sql, tab.searchTarget);
      if ("error" in derived) {
        toast.info(derived.error);
        return;
      }
    }
    setExplainSql(sql);
  }, [
    canExplainQuery,
    isDocument,
    isSearch,
    tab.database,
    tab.queryState.status,
    tab.searchTarget,
    tab.sql,
  ]);

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
        // #1041 — record the explain under the tab's own paradigm so Mongo
        // explains aren't logged as rdb/sql. #2153 — same for search, whose
        // single backend query mode the recorder fills in itself.
        ...(isDocument
          ? {
              paradigm: "document" as const,
              queryMode: "find" as const,
              collection: tab.collection,
            }
          : isSearch
            ? { paradigm: "search" as const }
            : { paradigm: "rdb" as const, queryMode: "sql" as const }),
        source: "explain",
        sql: explainSql,
        status: result.status,
        errorMessage: result.errorMessage,
        executedAt: result.executedAt,
        duration: result.durationMs,
      });
    },
    [
      explainSql,
      isDocument,
      isSearch,
      tab.collection,
      tab.connectionId,
      tab.database,
      tab.id,
    ],
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
  const searchCompletionTarget =
    connection?.dbType === "opensearch" ? "opensearch" : "elasticsearch";
  const searchExtensions = useSearchAutocomplete({
    connectionId: tab.connectionId,
    queryText: tab.sql,
    enabled: tab.paradigm === "search",
    target: searchCompletionTarget,
  });

  // Resizable split state
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    size: editorPct,
    handleMouseDown: handleResizeMouseDown,
    handleKeyDown: handleResizeKeyDown,
    min: editorMinPct,
    max: editorMaxPct,
  } = useResizablePanel({
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
        onImportSqlFile={handleImportSqlFile}
        showFileAnalytics={canPreviewLocalFile}
        onOpenFileAnalytics={() => setShowFileAnalytics(true)}
        favorites={favorites}
        showSnippets={showSnippets}
        setShowSnippets={setShowSnippets}
        onInsertSnippet={handleInsertSnippet}
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
                <SearchQueryEditor
                  ref={editorRef}
                  sql={tab.sql}
                  onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
                  onExecute={handleExecuteAndShowResults}
                  onDryRun={handleDryRunAndShowResults}
                  searchExtensions={searchExtensions}
                />
              );
            default:
              return assertNever(tab.paradigm);
          }
        })()}
      </div>

      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize shrink-0 border-y border-border hover:bg-primary/90 active:bg-primary/90 focus-visible:outline-1 focus-visible:outline-ring"
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        tabIndex={0}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("resizeEditorAria")}
        aria-valuemin={editorMinPct}
        aria-valuemax={editorMaxPct}
        aria-valuenow={Math.round(editorPct)}
      />

      {/* Result area — flex column so QueryResultGrid's flex-1 children fill
          the remaining height and the inner table can actually scroll. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {connection &&
        explainSql &&
        canExplainQuery &&
        isDocument &&
        explainMongo ? (
          <ExplainViewer
            connectionId={tab.connectionId}
            dbType={connection.dbType}
            mongoSpec={explainMongo}
            onPlanSettled={handleExplainSettled}
          />
        ) : connection && explainSql && canExplainQuery && explainSearch ? (
          <ExplainViewer
            connectionId={tab.connectionId}
            dbType={connection.dbType}
            searchSpec={explainSearch}
            onPlanSettled={handleExplainSettled}
          />
        ) : connection &&
          explainSql &&
          canExplainQuery &&
          !isDocument &&
          !isSearch ? (
          <ExplainViewer
            connectionId={tab.connectionId}
            dbType={connection.dbType}
            rdbSql={explainSql}
            expectedDatabase={explainExpectedDatabase ?? undefined}
            onPlanSettled={handleExplainSettled}
          />
        ) : isSearch ? (
          <SearchResultView queryState={tab.queryState} />
        ) : (
          <QueryResultGrid
            queryState={tab.queryState}
            connectionId={tab.connectionId}
            database={tab.database}
            // #1226 — live editor text; only a fallback. Edit-ability is
            // judged against `tab.queryState.completed.sql` (executed snapshot)
            // inside the grid, so post-run edits don't retoggle it.
            sql={tab.sql}
            tabId={tab.id}
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

      {/* Sprint 255 — raw RDB preview dialog. Mounts when the batch has at
          least one statement the analyzer puts above the INFO tier, the
          Safe Mode gate raised no STOP, and the dry-run row-impact probe
          did not escalate. Both of those exits return before the mount in
          `executeRdbQuery`, so `pendingRdbWarn` is `null` whenever
          `pendingRdbConfirm` is set — the two dialogs never co-mount, and
          an escalated 100+-row DELETE gets the confirm instead of this
          dialog rather than both.
          INFO statements (SELECT / EXPLAIN / SHOW / DESCRIBE / WITH …
          SELECT / INSERT / CREATE) bypass this dialog entirely (direct
          IPC).
          Issue #2375 widened the mount from the WARN tier to every
          non-INFO tier: on a non-production connection under Safe Mode
          `warn` / `off` the gate hands destructive statements back as
          `allow`, and they used to fall past this dialog and reach the
          driver with nothing shown. */}
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

      {/* Sprint 255 — raw Mongo preview modal, plus the parser-driven
          write dispatch (Sprint 312). Mounts when the dispatch branch's
          analysis is above the INFO tier and the Safe Mode gate raised no
          STOP. The find path never mounts it. `dropIndex` builds its
          analysis inline rather than through `analyzeMongoOperation`, so
          the branch — not the analyzer roster — is what decides.
          `db.runCommand` / `db.adminCommand` never land here: that branch
          routes a non-INFO command to `pendingMongoConfirm`, a stricter
          gate than this preview.
          Issue #2375 — `$out` / `$merge` and the empty-filter `*-many`
          writes reach `pendingMongoConfirm` only where the gate returns
          `confirm` (production, or non-production under `strict`). On a
          non-production connection under `warn` / `off` the gate returns
          `allow` and they now land here instead of executing unannounced. */}
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
