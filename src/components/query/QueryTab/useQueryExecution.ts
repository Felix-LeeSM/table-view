import { useCallback, useState } from "react";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  executeQuery,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
} from "@lib/tauri";
import { splitSqlStatements } from "@lib/sql/sqlUtils";
import { analyzeMongoPipeline } from "@lib/mongo/mongoSafety";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import type { QueryTab } from "@stores/tabStore";
import type { FindBody } from "@/types/document";
import type { QueryHistoryStatus } from "@stores/queryHistoryStore";
import {
  readDocumentContext,
  isRecord,
  isRecordArray,
  dispatchDbMutationHint,
} from "./queryHelpers";
import { logger } from "@lib/logger";

/**
 * `QueryTab` query-execution hook covering four `handleExecute` branches
 * (cancel-running / document find+aggregate / SQL single / SQL multi),
 * the Mongo aggregate danger gate, and history book-keeping.
 *
 * Invariants:
 * - The raw-query DB-change detection (`dispatchDbMutationHint`) fires
 *   fire-and-forget after every `await executeQuery`; verify failures
 *   never tear down the result panel.
 * - The Mongo aggregate 3-tier gate (block / confirm / off) runs before
 *   the running-state transition, so `block`/`confirm` decisions never
 *   strand the tab in `running`.
 * - The lifecycle actions (`completeQuery`, `failQuery`,
 *   `completeMultiStatementQuery`) match `queryId` against the currently
 *   running query and ignore stale responses.
 * - Multi-statement: the last success populates the grid; the
 *   per-statement breakdown lives alongside; history is `error` if any
 *   statement failed (partial failure ⇒ destructive marker).
 * - The handler's `exhaustive-deps` is intentionally suppressed — the
 *   keyboard layer holds a ref to it and a per-store-change identity
 *   churn would stale that ref.
 */

export interface UseQueryExecutionArgs {
  tab: QueryTab;
}

export interface QueryExecution {
  handleExecute: () => Promise<void>;
  pendingMongoConfirm: {
    pipeline: Record<string, unknown>[];
    reason: string;
  } | null;
  confirmMongoDangerous: () => Promise<void>;
  cancelMongoDangerous: () => void;
}

export function useQueryExecution({
  tab,
}: UseQueryExecutionArgs): QueryExecution {
  const updateQueryState = useTabStore((s) => s.updateQueryState);
  // Lifecycle actions; their queryId guards encode the stale-response
  // policy that used to be inlined as direct `useTabStore.setState` calls.
  const completeQuery = useTabStore((s) => s.completeQuery);
  const failQuery = useTabStore((s) => s.failQuery);
  const completeMultiStatementQuery = useTabStore(
    (s) => s.completeMultiStatementQuery,
  );
  // History recording is the caller's responsibility (the tabStore no
  // longer reaches across stores). We rebuild the payload here so the
  // 8 call sites can pass only the variable fields below.
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const recordHistory = useCallback(
    (payload: {
      sql: string;
      executedAt: number;
      duration: number;
      status: QueryHistoryStatus;
    }) => {
      addHistoryEntry({
        sql: payload.sql,
        executedAt: payload.executedAt,
        duration: payload.duration,
        status: payload.status,
        source: "raw",
        connectionId: tab.connectionId,
        paradigm: tab.paradigm,
        queryMode: tab.queryMode,
        database: tab.database,
        collection: tab.collection,
      });
    },
    [
      addHistoryEntry,
      tab.connectionId,
      tab.paradigm,
      tab.queryMode,
      tab.database,
      tab.collection,
    ],
  );

  // Mongo aggregate danger gate (strict / warn / off). While the
  // warn-tier dialog is open, `pendingMongoConfirm` keeps the exact
  // pipeline + reason so the re-dispatch on confirm runs the same
  // stages the user typed.
  const mongoGate = useSafeModeGate(tab.connectionId);
  const [pendingMongoConfirm, setPendingMongoConfirm] = useState<{
    pipeline: Record<string, unknown>[];
    reason: string;
  } | null>(null);

  // Aggregate dispatch + book-keeping, extracted so the warn-confirm
  // dialog can re-enter the same path with the pending pipeline. Mirrors
  // the inline find branch (running-set → dispatch → adapt → complete →
  // history) but for `aggregateDocuments`.
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
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: tab.sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: tab.sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
        });
      }
    },
    [tab, recordHistory, completeQuery, failQuery, updateQueryState],
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
      } catch (err) {
        // Most cancel failures are benign races: the query finished between
        // the user clicking Cancel and the IPC dispatch (backend returns
        // NotFound for an unregistered token). Surface via dev logger so a
        // genuine IPC/backend regression isn't silent — store-side
        // stale-response guards already handle state transition.
        logger.warn("cancelQuery failed (likely already completed):", err);
      }
      return;
    }

    // Document paradigm (find / aggregate). Parses the editor body as
    // JSON, dispatches the matching Tauri command, and adapts
    // DocumentQueryResult into the shared QueryResult shape so the grid
    // doesn't fork by paradigm.
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

      // The aggregate gate runs before the running-state transition so
      // `block`/`confirm` decisions cannot strand the tab in `running`.
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

        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
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
        // Stale-response guard lives in the store action — late responses to
        // a superseded queryId no-op there.
        completeQuery(tab.id, queryId, result);
        recordHistory({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
        });
      }
      // Run DB-change detection regardless of query success — `\c x` can
      // surface as a PG syntax error yet still flip the active pool on
      // the backend, so the optimistic update + verify is still useful.
      dispatchDbMutationHint(tab.connectionId, tab.paradigm, sql);
      return;
    }

    // Multiple statements: execute sequentially and collect a
    // per-statement breakdown so the result panel can render one tab per
    // statement (success entries carry `result`, errors carry `error`).
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

    // Final transition: `allFailed` → error (joined message); else
    // completed with `lastResult` + the per-statement breakdown.
    const joinedErrors = statementResults
      .map((s, idx) => `Statement ${idx + 1}: ${s.error ?? ""}`)
      .join("\n");
    completeMultiStatementQuery(tab.id, queryId, {
      statementResults,
      lastResult,
      allFailed,
      joinedErrorMessage: joinedErrors,
    });

    recordHistory({
      sql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      // Partial failure still flags the entry as `error` so users can
      // spot it in the history list without opening the tab.
      status: successCount === statements.length ? "success" : "error",
    });
    // The lexer takes the last DB-mutation match in the full script, so a
    // script ending in `...; \c admin` flips active_db once.
    dispatchDbMutationHint(tab.connectionId, tab.paradigm, sql);
    // Excluding store actions from deps is deliberate — see hook header.
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

  return {
    handleExecute,
    pendingMongoConfirm,
    confirmMongoDangerous,
    cancelMongoDangerous,
  };
}
