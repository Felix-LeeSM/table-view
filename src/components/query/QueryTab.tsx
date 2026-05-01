import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import type { EditorView } from "@codemirror/view";
import type { QueryTab, QueryMode } from "@stores/tabStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  executeQuery,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
} from "@lib/tauri";
import { splitSqlStatements, formatSql, uglifySql } from "@lib/sql/sqlUtils";
import { databaseTypeToSqlDialect } from "@lib/sql/sqlDialect";
import {
  extractDbMutation,
  type SqlMutationDialect,
} from "@lib/sql/sqlDialectMutations";
import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { useSchemaStore } from "@stores/schemaStore";
import { toast } from "@lib/toast";
import type { Paradigm } from "@/types/connection";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { useMongoAutocomplete } from "@hooks/useMongoAutocomplete";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { analyzeMongoPipeline } from "@lib/mongo/mongoSafety";
import ConfirmDangerousDialog from "@components/workspace/ConfirmDangerousDialog";
import { useDocumentStore } from "@stores/documentStore";
import { useResizablePanel } from "@hooks/useResizablePanel";
import { assertNever } from "@/lib/paradigm";
import SqlQueryEditor from "./SqlQueryEditor";
import MongoQueryEditor from "./MongoQueryEditor";
import QueryResultGrid from "./QueryResultGrid";
import FavoritesPanel from "./FavoritesPanel";
import QuerySyntax from "@components/shared/QuerySyntax";
import type { FindBody } from "@/types/document";
import {
  Play,
  Square,
  Loader2,
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Paintbrush,
  Star,
  Save,
  X,
  CornerDownLeft,
} from "lucide-react";

// ─── Document paradigm helpers ─────────────────────────────────────────────
// Document-paradigm query tabs execute raw JSON that the backend consumes
// as MongoDB find bodies or aggregation pipelines. The backend requires
// `database` + `collection`, so we surface a clear error whenever the tab
// is missing that context instead of silently failing the `invoke` call.

interface DocumentQueryContext {
  database: string;
  collection: string;
}

function readDocumentContext(tab: QueryTab): DocumentQueryContext | null {
  if (!tab.database || !tab.collection) return null;
  return { database: tab.database, collection: tab.collection };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

// ─── Sprint 132 — raw-query DB-change detection hook ──────────────────────
// After `await executeQuery(...)` we re-scan the SQL the user just ran for
// dialect-specific DB / schema / Redis-index switch patterns. A match
// triggers an *optimistic* `setActiveDb(targetDb)` so the toolbar / sidebar
// reflect the new context without a manual click, followed by a backend
// `verify_active_db` round-trip. A verify-mismatch surfaces a `toast.warn`
// and reverts the optimistic value to whatever the backend actually sees.
//
// `applyDbMutationHint` is intentionally fire-and-forget from the caller's
// perspective: it never throws — verify failures are swallowed with a
// console-free best-effort recovery so the query result panel stays
// rendered even when the network bounced.
//
// Document-paradigm tabs short-circuit immediately — Mongo doesn't use the
// SQL-style `\c` / `USE` syntax. Search/Kv paradigms aren't routed through
// `executeQuery` so they never reach this helper.
async function applyDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
  setActiveDb: (id: string, dbName: string) => void,
  clearForConnection: (id: string) => void,
): Promise<void> {
  if (paradigm !== "rdb") return;
  // Sprint 132 only ships Postgres. MySQL/Redis dialects fall through here
  // (the lexer accepts them) but the QueryTab UI today only routes PG raw
  // SQL, so the dialect map is hard-coded. A future MySQL adapter sprint
  // will resolve dialect from `tab.connectionMeta.databaseType`.
  const dialect: SqlMutationDialect = "postgres";
  const hint = extractDbMutation(sql, dialect);
  if (!hint) return;

  try {
    if (hint.kind === "switch_database") {
      // Optimistic local update — toolbar trigger label and any reader of
      // `activeStatuses[id].activeDb` flips immediately.
      setActiveDb(connectionId, hint.targetDb);
      // Schema cache must be evicted before any sidebar refresh request
      // can race in with the old DB's tables.
      clearForConnection(connectionId);
      try {
        const actual = await verifyActiveDb(connectionId);
        // Empty string === "could not verify" (Mongo-side semantic borrowed
        // for symmetry); skip the mismatch toast.
        if (actual && actual !== hint.targetDb) {
          toast.warning(
            `Active DB mismatch: expected '${hint.targetDb}', got '${actual}'. Reverting.`,
          );
          setActiveDb(connectionId, actual);
        }
      } catch {
        // Verify-best-effort. The query result must remain visible even
        // when verify fails (network blip, backend restart) — sprint 132
        // contract: "verify 실패 ≠ query 실패".
      }
    } else if (hint.kind === "switch_schema") {
      // Schema-level change — there's no cheap PG accessor to verify, so
      // we just evict the schema cache and surface an info toast.
      clearForConnection(connectionId);
      toast.info(`Active schema set to '${hint.targetSchema}'.`);
    } else if (hint.kind === "redis_select") {
      // Phase 9 Redis adapter will wire DB-index switching. For sprint 132
      // we only acknowledge the user's intent.
      toast.info(`Redis SELECT ${hint.databaseIndex} acknowledged.`);
    }
  } catch {
    // Outer guard — the hook must never propagate to the user. Any
    // exception thrown by the store mutators or the extractor is treated
    // as a no-op.
  }
}

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const updateQueryState = useTabStore((s) => s.updateQueryState);
  const setQueryMode = useTabStore((s) => s.setQueryMode);
  const loadQueryIntoTab = useTabStore((s) => s.loadQueryIntoTab);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);
  const historyEntries = useQueryHistoryStore((s) => s.entries);
  // Sprint 82 — resolve the active connection's dialect so the editor +
  // autocomplete namespace can tailor keywords / identifier quoting. A
  // missing connection (e.g. deleted mid-session) falls back to StandardSQL
  // via `databaseTypeToSqlDialect(undefined)`; document paradigm tabs keep
  // receiving the resolved dialect but ignore it inside `QueryEditor`.
  const connections = useConnectionStore((s) => s.connections);
  const connection = useMemo(
    () => connections.find((c) => c.id === tab.connectionId),
    [connections, tab.connectionId],
  );
  const sqlDialect = useMemo(
    () => databaseTypeToSqlDialect(connection?.db_type),
    [connection?.db_type],
  );
  // Sprint 139 — pipe `dbType` so the autocomplete namespace surfaces
  // dialect-specific keywords (PG: RETURNING/ILIKE; MySQL: AUTO_INCREMENT;
  // SQLite: PRAGMA / WITHOUT ROWID).
  const schemaNamespace = useSqlAutocomplete(tab.connectionId, {
    dialect: sqlDialect,
    dbType: connection?.db_type,
  });
  // Sprint 83 — surface cached Mongo field names for autocomplete. The
  // document store stores columns under `${connectionId}:${db}:${collection}`;
  // we read the single slice relevant to this tab and map to a string array
  // so the hook's memo key is stable across unrelated cache updates. RDB
  // paradigm tabs compute `undefined` here and the hook receives a no-op
  // extension set that remains unused because `QueryEditor` gates on
  // `paradigm === "document"`.
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
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);

  // Sprint 188 — Mongo aggregate pipeline danger gate. The hook centralises
  // the strict / warn / off decision against the connection's environment;
  // pendingMongoConfirm holds the pipeline + reason while the warn-tier
  // confirm dialog is open so executing it requires re-dispatching with the
  // exact stages the user already typed.
  const mongoGate = useSafeModeGate(tab.connectionId);
  const [pendingMongoConfirm, setPendingMongoConfirm] = useState<{
    pipeline: Record<string, unknown>[];
    reason: string;
  } | null>(null);

  const handleSaveFavorite = useCallback(() => {
    const name = favoriteName.trim();
    const sql = tab.sql.trim();
    if (!name || !sql) return;
    addFavorite(name, sql, tab.connectionId);
    setFavoriteName("");
    setShowSaveForm(false);
  }, [favoriteName, tab.sql, tab.connectionId, addFavorite]);

  const handleLoadFavoriteSql = useCallback(
    (sql: string) => {
      updateQuerySql(tab.id, sql);
    },
    [tab.id, updateQuerySql],
  );

  // Sprint 188 — Mongo aggregate dispatch + queryState/history book-keeping
  // extracted so the warn-confirm dialog can re-enter the same path with
  // the pending pipeline. Mirrors the inline find branch below
  // (running-set → dispatch → queryResult adapt → completed/error sync →
  // history entry) but for `aggregateDocuments` only.
  const runMongoAggregateNow = useCallback(
    async (pipeline: Record<string, unknown>[]) => {
      const docCtx = readDocumentContext(tab);
      if (!docCtx) {
        updateQueryState(tab.id, {
          status: "error",
          error:
            "Document query tabs require a target database and collection.",
        });
        return;
      }
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const docResult = await aggregateDocuments(
          tab.connectionId,
          docCtx.database,
          docCtx.collection,
          pipeline,
        );
        const queryResult: import("@/types/query").QueryResult = {
          columns: docResult.columns,
          rows: docResult.rows,
          total_count: docResult.total_count,
          execution_time_ms: docResult.execution_time_ms,
          query_type: "select",
        };
        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: {
                        status: "completed" as const,
                        result: queryResult,
                      },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql: tab.sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      } catch (err) {
        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: {
                        status: "error" as const,
                        error: err instanceof Error ? err.message : String(err),
                      },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql: tab.sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      }
    },
    [tab, addHistoryEntry, updateQueryState],
  );

  const confirmMongoDangerous = useCallback(async () => {
    const pending = pendingMongoConfirm;
    if (!pending) return;
    setPendingMongoConfirm(null);
    await runMongoAggregateNow(pending.pipeline);
  }, [pendingMongoConfirm, runMongoAggregateNow]);

  const cancelMongoDangerous = useCallback(() => {
    setPendingMongoConfirm(null);
  }, []);

  const handleExecute = useCallback(async () => {
    const sql = tab.sql.trim();
    if (!sql) return;

    // If already running, cancel
    if (tab.queryState.status === "running") {
      try {
        await cancelQuery(tab.queryState.queryId);
      } catch {
        // Query may have already completed
      }
      return;
    }

    // Sprint 73 — document paradigm (MongoDB find / aggregate). Runs on a
    // separate code path from the SQL flow below: parses the editor body
    // as JSON, dispatches to the matching Tauri command, and funnels the
    // DocumentQueryResult into the existing queryState via a synthesized
    // QueryResult shape so the downstream QueryResultGrid can render rows
    // unchanged. Errors (invalid JSON, wrong pipeline type, backend
    // failures) land in `queryState: "error"` with a descriptive message.
    if (tab.paradigm === "document") {
      const docCtx = readDocumentContext(tab);
      if (!docCtx) {
        updateQueryState(tab.id, {
          status: "error",
          error:
            "Document query tabs require a target database and collection.",
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(sql);
      } catch (err) {
        updateQueryState(tab.id, {
          status: "error",
          error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      // Sprint 188 — aggregate pipeline danger gate. Runs before the
      // running-state set so a blocked / pending-confirm pipeline cannot
      // strand the tab in a "running" indicator. The actual dispatch +
      // queryState/history book-keeping is shared with the warn-confirm
      // path through `runMongoAggregateNow`.
      if (tab.queryMode === "aggregate") {
        if (!isRecordArray(parsed)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "Pipeline must be a JSON array of stage objects.",
          });
          return;
        }
        const decision = mongoGate.decide(analyzeMongoPipeline(parsed));
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        if (decision.action === "confirm") {
          setPendingMongoConfirm({
            pipeline: parsed,
            reason: decision.reason,
          });
          return;
        }
        await runMongoAggregateNow(parsed);
        return;
      }

      // Document find path — kept inline because the FindBody shaping is
      // unique to this branch and adding a helper would not save a call site.
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });

      try {
        // Default find path. Accept either an object (treated as the
        // filter) or the full FindBody shape if the user already wrapped
        // it.
        if (!isRecord(parsed)) {
          throw new Error(
            "Find body must be a JSON object (filter or FindBody).",
          );
        }
        const candidate = parsed as Record<string, unknown>;
        const looksLikeFindBody =
          "filter" in candidate ||
          "sort" in candidate ||
          "projection" in candidate ||
          "skip" in candidate ||
          "limit" in candidate;
        const body: FindBody = looksLikeFindBody
          ? (candidate as FindBody)
          : { filter: candidate };
        const docResult = await findDocuments(
          tab.connectionId,
          docCtx.database,
          docCtx.collection,
          body,
        );

        // Adapt DocumentQueryResult → QueryResult so the existing grid
        // can render the flattened rows without forking the result panel.
        const queryResult: import("@/types/query").QueryResult = {
          columns: docResult.columns,
          rows: docResult.rows,
          total_count: docResult.total_count,
          execution_time_ms: docResult.execution_time_ms,
          query_type: "select",
        };

        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: {
                        status: "completed" as const,
                        result: queryResult,
                      },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      } catch (err) {
        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: {
                        status: "error" as const,
                        error: err instanceof Error ? err.message : String(err),
                      },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      }
      return;
    }

    const statements = splitSqlStatements(sql).filter((stmt) => {
      // Strip SQL comments and whitespace to detect statements that are
      // effectively empty (e.g. "-- comment only" or "/* block */").
      // Line comments: -- ... (to end of line)
      // Block comments: /* ... */
      let s = stmt;
      s = s.replace(/--[^\n]*/g, "");
      s = s.replace(/\/\*[\s\S]*?\*\//g, "");
      return s.trim().length > 0;
    });
    if (statements.length === 0) return;

    // Single statement — use original behavior
    if (statements.length === 1) {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });

      try {
        const result = await executeQuery(tab.connectionId, sql, queryId);
        // Only update if this is still the active query (prevent stale overwrites)
        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: { status: "completed" as const, result },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      } catch (err) {
        useTabStore.setState((state) => {
          const current = state.tabs.find((t) => t.id === tab.id);
          if (
            current &&
            current.type === "query" &&
            current.queryState.status === "running" &&
            "queryId" in current.queryState &&
            current.queryState.queryId === queryId
          ) {
            return {
              tabs: state.tabs.map((t) =>
                t.id === tab.id && t.type === "query"
                  ? {
                      ...t,
                      queryState: {
                        status: "error" as const,
                        error: err instanceof Error ? err.message : String(err),
                      },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          connectionId: tab.connectionId,
          paradigm: tab.paradigm,
          queryMode: tab.queryMode,
          database: tab.database,
          collection: tab.collection,
        });
      }
      // Sprint 132 — DB-change detection runs after the awaited execute
      // resolves, regardless of success/error. We call it from outside the
      // try/catch so a thrown query error doesn't bypass the lex pass —
      // `\c another_db` may surface as a PG syntax error but still flips
      // the active pool on the backend, so the optimistic update + verify
      // round-trip is still meaningful. The helper itself never throws.
      void applyDbMutationHint(
        tab.connectionId,
        tab.paradigm,
        sql,
        useConnectionStore.getState().setActiveDb,
        useSchemaStore.getState().clearForConnection,
      );
      return;
    }

    // Multiple statements — execute sequentially.
    // Sprint 100 — collect a per-statement breakdown so the result panel
    // can render one tab per statement. Each iteration pushes either a
    // `success` entry (with `result`) or an `error` entry (with `error`).
    // We track wall-clock duration per statement around `executeQuery`.
    const queryId = `${tab.id}-${Date.now()}`;
    const startTime = Date.now();
    updateQueryState(tab.id, { status: "running", queryId });

    let lastResult: import("@/types/query").QueryResult | null = null;
    const statementResults: import("@/types/query").QueryStatementResult[] = [];

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!;
      const stmtQueryId = `${queryId}-${i}`;
      const stmtStart = Date.now();
      try {
        const result = await executeQuery(tab.connectionId, stmt, stmtQueryId);
        lastResult = result;
        statementResults.push({
          sql: stmt,
          status: "success",
          result,
          durationMs: Date.now() - stmtStart,
        });
      } catch (err) {
        statementResults.push({
          sql: stmt,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - stmtStart,
        });
      }
    }

    const successCount = statementResults.filter(
      (s) => s.status === "success",
    ).length;
    const allFailed = successCount === 0;

    useTabStore.setState((state) => {
      const current = state.tabs.find((t) => t.id === tab.id);
      if (
        current &&
        current.type === "query" &&
        current.queryState.status === "running" &&
        "queryId" in current.queryState &&
        current.queryState.queryId === queryId
      ) {
        if (allFailed) {
          // All statements failed — collapse to `error` (same shape as the
          // single-statement failure path) with a joined error message.
          const joinedErrors = statementResults
            .map((s, idx) => `Statement ${idx + 1}: ${s.error ?? ""}`)
            .join("\n");
          return {
            tabs: state.tabs.map((t) =>
              t.id === tab.id && t.type === "query"
                ? {
                    ...t,
                    queryState: {
                      status: "error" as const,
                      error: joinedErrors,
                    },
                  }
                : t,
            ),
          };
        }
        // At least one success — keep `status: "completed"` and surface the
        // full per-statement breakdown via `statements`. `result` mirrors
        // the LAST SUCCESSFUL result so single-result fallbacks (history,
        // grid collapse) keep working when callers ignore `statements`.
        const fallbackResult = lastResult!;
        return {
          tabs: state.tabs.map((t) =>
            t.id === tab.id && t.type === "query"
              ? {
                  ...t,
                  queryState: {
                    status: "completed" as const,
                    result: fallbackResult,
                    statements: statementResults,
                  },
                }
              : t,
          ),
        };
      }
      return state;
    });

    addHistoryEntry({
      sql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      // History entry status reflects whether *any* statement failed —
      // partial failure still surfaces a destructive marker in the
      // history list so users can spot it without opening the tab.
      status: successCount === statements.length ? "success" : "error",
      connectionId: tab.connectionId,
      paradigm: tab.paradigm,
      queryMode: tab.queryMode,
      database: tab.database,
      collection: tab.collection,
    });
    // Sprint 132 — same hook as the single-statement path. Multi-statement
    // input feeds the full SQL through the lexer, which already takes the
    // last match (sprint contract — "마지막만"). So a script ending in
    // `... ; \c admin` flips active_db to "admin" and verifies once.
    void applyDbMutationHint(
      tab.connectionId,
      tab.paradigm,
      sql,
      useConnectionStore.getState().setActiveDb,
      useSchemaStore.getState().clearForConnection,
    );
    // The original Sprint 25 callback intentionally excluded
    // addHistoryEntry/updateQueryState from the dependency list so stale
    // closure issues don't fire on every store subscription. Sprint 73
    // reuses that contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab.id,
    tab.sql,
    tab.queryState.status,
    tab.connectionId,
    tab.paradigm,
    tab.queryMode,
    tab.database,
    tab.collection,
    mongoGate,
    runMongoAggregateNow,
  ]);
  useEffect(() => {
    const handler = (e: Event) => {
      const { queryId } = (e as CustomEvent<{ queryId: string }>).detail;
      if (
        tab.queryState.status === "running" &&
        "queryId" in tab.queryState &&
        tab.queryState.queryId === queryId
      ) {
        cancelQuery(queryId).catch(() => {
          // Query may have already completed
        });
      }
    };
    window.addEventListener("cancel-query", handler);
    return () => window.removeEventListener("cancel-query", handler);
  }, [tab.id, tab.queryState]);

  // Format SQL event listener (Cmd+I) — supports selection-only formatting.
  // Skipped on document paradigm tabs; JSON bodies should not be run through
  // the SQL formatter.
  useEffect(() => {
    if (tab.paradigm === "document") return;
    const handler = () => {
      // Only format if this tab is the active tab
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;

      // If the editor has a selection, format only the selection
      const view = editorRef.current;
      if (view) {
        const { from, to } = view.state.selection.main;
        if (from !== to) {
          const selectedText = view.state.sliceDoc(from, to);
          const formatted = formatSql(selectedText);
          view.dispatch({
            changes: { from, to, insert: formatted },
          });
          return;
        }
      }

      const formatted = formatSql(tab.sql);
      updateQuerySql(tab.id, formatted);
    };
    window.addEventListener("format-sql", handler);
    return () => window.removeEventListener("format-sql", handler);
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

  // Uglify SQL event listener (Cmd+Shift+I). Also skipped for document tabs.
  useEffect(() => {
    if (tab.paradigm === "document") return;
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;
      const uglified = uglifySql(tab.sql);
      updateQuerySql(tab.id, uglified);
    };
    window.addEventListener("uglify-sql", handler);
    return () => window.removeEventListener("uglify-sql", handler);
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

  // Toggle favorites panel event listener (Cmd+Shift+F)
  useEffect(() => {
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      setShowFavorites((v) => !v);
      setShowSaveForm(false);
    };
    window.addEventListener("toggle-favorites", handler);
    return () => window.removeEventListener("toggle-favorites", handler);
  }, [tab.id]);

  const editorRef = useRef<EditorView | null>(null);

  const handleFormat = useCallback(() => {
    if (!tab.sql.trim()) return;

    // If the editor has a selection, format only the selection
    const view = editorRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const selectedText = view.state.sliceDoc(from, to);
        const formatted = formatSql(selectedText);
        view.dispatch({
          changes: { from, to, insert: formatted },
        });
        return;
      }
    }

    const formatted = formatSql(tab.sql);
    updateQuerySql(tab.id, formatted);
  }, [tab.id, tab.sql, updateQuerySql]);

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
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1">
        {tab.queryState.status === "running" ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleExecute}
            aria-label="Cancel query"
          >
            <Square className="text-destructive" />
            <Loader2 className="animate-spin" />
            <span>Cancel</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleExecute}
            disabled={!tab.sql.trim()}
            aria-label="Run query"
          >
            <Play className="text-success" />
            <span>Run</span>
            <span className="text-3xs text-muted-foreground">
              {"\u2318\u23CE"}
            </span>
          </Button>
        )}
        {!isDocument && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleFormat}
            disabled={!tab.sql.trim()}
            aria-label="Format SQL"
            title="Format SQL (Cmd+I)"
          >
            <Paintbrush />
            <span>Format</span>
          </Button>
        )}
        {isDocument && (
          <ToggleGroup
            type="single"
            value={tab.queryMode}
            onValueChange={(value) => {
              if (value === "find" || value === "aggregate") {
                setQueryMode(tab.id, value as QueryMode);
              }
            }}
            aria-label="Mongo query mode"
            className="ml-1"
          >
            <ToggleGroupItem value="find" aria-label="Find mode">
              Find
            </ToggleGroupItem>
            <ToggleGroupItem value="aggregate" aria-label="Aggregate mode">
              Aggregate
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <div className="ml-auto flex items-center gap-1 relative">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setShowSaveForm(!showSaveForm);
              setShowFavorites(false);
            }}
            disabled={!tab.sql.trim()}
            aria-label="Save to favorites"
            title="Save to favorites"
          >
            <Star />
            <span>Save</span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setShowFavorites(!showFavorites);
              setShowSaveForm(false);
            }}
            aria-label="Open favorites"
            title="Favorites (Cmd+Shift+F)"
          >
            <Star className="text-primary" />
            <span>
              Favorites{favorites.length > 0 ? ` (${favorites.length})` : ""}
            </span>
          </Button>
          {showSaveForm && (
            <div className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1 rounded border border-border bg-background p-2 shadow-lg">
              <input
                type="text"
                value={favoriteName}
                onChange={(e) => setFavoriteName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveFavorite();
                  if (e.key === "Escape") setShowSaveForm(false);
                }}
                placeholder="Favorite name..."
                className="h-6 w-40 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
                autoFocus
              />
              <Button
                size="xs"
                onClick={handleSaveFavorite}
                disabled={!favoriteName.trim()}
                aria-label="Confirm save"
              >
                <Save />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowSaveForm(false);
                  setFavoriteName("");
                }}
                aria-label="Cancel save"
              >
                <X />
              </Button>
            </div>
          )}
          {showFavorites && (
            <div className="absolute right-0 top-full mt-1 z-50">
              <FavoritesPanel
                connectionId={tab.connectionId}
                onLoadSql={handleLoadFavoriteSql}
                onClose={() => setShowFavorites(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Editor area — Sprint 139: route to the paradigm-specific editor.
          The router lives here (not in a wrapper component) so the
          paradigm → editor mapping is colocated with the dialect /
          autocomplete wiring, and so structural separation between
          paradigms is visible in the call site. `assertNever` guards
          against future paradigm additions falling through silently. */}
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

      {/* History panel */}
      {historyEntries.length > 0 && (
        <div className="border-t border-border bg-secondary">
          <Button
            variant="ghost"
            size="xs"
            className="w-full justify-start text-secondary-foreground"
            onClick={() => setHistoryExpanded((v) => !v)}
          >
            {historyExpanded ? <ChevronDown /> : <ChevronRight />}
            <Clock />
            <span>History ({historyEntries.length})</span>
          </Button>
          {historyExpanded && (
            <ul className="max-h-40 overflow-y-auto">
              {historyEntries.map((entry) => {
                // Sprint 84 — both the double-click row and the explicit
                // "Load into editor" button route through the paradigm-aware
                // `loadQueryIntoTab` helper so the restore branches (same
                // paradigm / different paradigm / new tab) live in a single
                // store-owned function. Entry-level defaults guard against
                // legacy entries missing paradigm / queryMode fields.
                const handleLoad = () =>
                  loadQueryIntoTab({
                    connectionId: entry.connectionId,
                    paradigm: entry.paradigm ?? "rdb",
                    queryMode: entry.queryMode ?? "sql",
                    database: entry.database,
                    collection: entry.collection,
                    sql: entry.sql,
                  });
                return (
                  <li
                    key={entry.id}
                    className="group flex items-center gap-2 border-t border-border px-3 py-1 hover:bg-muted"
                    onDoubleClick={handleLoad}
                    title="Double-click to load into editor"
                  >
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${
                        entry.status === "success"
                          ? "bg-success"
                          : "bg-destructive"
                      }`}
                      title={entry.status}
                    />
                    <QuerySyntax
                      sql={entry.sql}
                      paradigm={entry.paradigm}
                      queryMode={entry.queryMode}
                      className="min-w-0 flex-1 select-text cursor-text truncate text-xs"
                    />
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {entry.duration}ms
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                      onClick={handleLoad}
                      aria-label={`Load query into editor: ${entry.sql}`}
                      title="Load into editor"
                    >
                      <CornerDownLeft />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-end border-t border-border px-2 py-0.5">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={clearHistory}
              aria-label="Clear history"
            >
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>
      )}
      {pendingMongoConfirm && (
        <ConfirmDangerousDialog
          open
          reason={pendingMongoConfirm.reason}
          sqlPreview={JSON.stringify(pendingMongoConfirm.pipeline, null, 2)}
          onConfirm={confirmMongoDangerous}
          onCancel={cancelMongoDangerous}
        />
      )}
    </div>
  );
}
