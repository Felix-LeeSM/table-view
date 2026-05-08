import { useCallback, useState } from "react";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  executeQuery,
  executeQueryDryRun,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
} from "@lib/tauri";
import { splitSqlStatements } from "@lib/sql/sqlUtils";
import { analyzeMongoPipeline } from "@lib/mongo/mongoSafety";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { toast } from "@lib/toast";
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
  /**
   * Sprint 248 (ADR 0022 Phase 4) — explicit dry-run dispatch. Wraps the
   * SQL in a transaction that is unconditionally rolled back via
   * `executeQueryDryRun`, so the user can preview destructive results
   * without committing. Mongo paradigm short-circuits to a `toast.info`
   * disclaimer (the IPC supports rdb only). Empty SQL / running tab are
   * no-ops; Safe Mode dialogs do NOT trigger because nothing commits.
   * History is intentionally not recorded for dry-runs.
   */
  handleDryRun: () => Promise<void>;
  pendingMongoConfirm: {
    pipeline: Record<string, unknown>[];
    reason: string;
  } | null;
  confirmMongoDangerous: () => Promise<void>;
  cancelMongoDangerous: () => void;
  /**
   * Sprint 231 — raw RDB warn-tier confirm payload. Mirrors
   * `pendingMongoConfirm` (`pipeline` ↔ `statements`). One dialog covers
   * the whole batch (per-statement individual approval is forbidden by
   * AC-231-02): single-statement path stuffs `[sql]`, multi-statement
   * path stuffs the full ordered list. `reason` is the FIRST dangerous
   * statement's analyzer reason (matrix decided by `decideSafeModeAction`).
   */
  pendingRdbConfirm: {
    statements: string[];
    reason: string;
  } | null;
  confirmRdbDangerous: () => Promise<void>;
  cancelRdbDangerous: () => void;
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
  // Sprint 248 — explicit dry-run completion path. Mirrors
  // `completeQuery` / `completeMultiStatementQuery` but stamps
  // `isDryRun: true` so `<QueryResultGrid>` can render the rolled-back
  // banner.
  const completeQueryDryRun = useTabStore((s) => s.completeQueryDryRun);
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

  // Safe Mode danger gate (strict / warn / off). Wraps the paradigm-agnostic
  // `decideSafeModeAction` matrix so the Mongo aggregate path AND the raw
  // RDB single / multi-statement paths share one decision policy.
  // While a warn-tier dialog is open, `pendingMongoConfirm` /
  // `pendingRdbConfirm` retains the exact pipeline / statements + reason
  // so the re-dispatch on confirm runs the same input the user typed.
  const safeModeGate = useSafeModeGate(tab.connectionId);
  const [pendingMongoConfirm, setPendingMongoConfirm] = useState<{
    pipeline: Record<string, unknown>[];
    reason: string;
  } | null>(null);
  // Sprint 231 — raw RDB warn-tier pending state. Mirrors
  // `pendingMongoConfirm`. `null` until a dangerous statement is detected
  // under `mode === "warn"` on a production connection.
  const [pendingRdbConfirm, setPendingRdbConfirm] = useState<{
    statements: string[];
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

  // Sprint 231 — single-statement RDB dispatch + book-keeping. Mirrors
  // `runMongoAggregateNow`: extracted so the warn-tier confirm path can
  // re-enter the same try/catch + recordHistory + DB-mutation hint flow
  // without inline duplication.
  const runRdbSingleNow = useCallback(
    async (stmt: string) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const result = await executeQuery(tab.connectionId, stmt, queryId);
        completeQuery(tab.id, queryId, result);
        recordHistory({
          sql: stmt,
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
          sql: stmt,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
        });
      }
      // Run DB-change detection regardless of query success — `\c x` can
      // surface as a PG syntax error yet still flip the active pool on
      // the backend, so the optimistic update + verify is still useful.
      dispatchDbMutationHint(tab.connectionId, tab.paradigm, stmt);
    },
    [
      tab.id,
      tab.connectionId,
      tab.paradigm,
      updateQueryState,
      completeQuery,
      failQuery,
      recordHistory,
    ],
  );

  // Sprint 231 — multi-statement RDB dispatch + per-statement breakdown.
  // Mirrors the original inline loop in `handleExecute` but takes the
  // pre-split `statements` (post-comment-strip) so the warn-tier confirm
  // path executes the exact same batch the user typed.
  const runRdbBatchNow = useCallback(
    async (statements: string[], joinedSql: string) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });

      let lastResult: import("@/types/query").QueryResult | null = null;
      const statementResults: import("@/types/query").QueryStatementResult[] =
        [];

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        const stmtQueryId = `${queryId}-${i}`;
        const stmtStart = Date.now();
        try {
          const result = await executeQuery(
            tab.connectionId,
            stmt,
            stmtQueryId,
          );
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
        sql: joinedSql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        // Partial failure still flags the entry as `error` so users can
        // spot it in the history list without opening the tab.
        status: successCount === statements.length ? "success" : "error",
      });
      // The lexer takes the last DB-mutation match in the full script, so
      // a script ending in `...; \c admin` flips active_db once.
      dispatchDbMutationHint(tab.connectionId, tab.paradigm, joinedSql);
    },
    [
      tab.id,
      tab.connectionId,
      tab.paradigm,
      updateQueryState,
      completeMultiStatementQuery,
      recordHistory,
    ],
  );

  // Sprint 231 — warn-tier confirm callback. Re-enters the same single /
  // multi helper without the gate, so the user's input is dispatched
  // verbatim. Multi-statement reuses `joinedSql` for history bookkeeping
  // (matches the pre-fix recordHistory shape).
  const confirmRdbDangerous = useCallback(async () => {
    const pending = pendingRdbConfirm;
    if (!pending) return;
    setPendingRdbConfirm(null);
    if (pending.statements.length === 1) {
      await runRdbSingleNow(pending.statements[0]!);
      return;
    }
    await runRdbBatchNow(pending.statements, pending.statements.join(";\n"));
  }, [pendingRdbConfirm, runRdbSingleNow, runRdbBatchNow]);

  const cancelRdbDangerous = useCallback(() => {
    setPendingRdbConfirm(null);
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
        const decision = safeModeGate.decide(analyzeMongoPipeline(parsed));
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

    // Sprint 231 — Safe Mode gate for raw RDB query path. Single pass
    // analyzes every statement; the matrix decision priority is
    // `block > confirm > allow`, and we record the first dangerous
    // statement's reason so the dialog / error message stays concise.
    // The gate runs BEFORE `updateQueryState({ status: "running" })`, so
    // a block / confirm decision never strands the tab in `running`.
    let worstAction: "allow" | "confirm" | "block" = "allow";
    let worstReason = "";
    for (const stmt of statements) {
      const decision = safeModeGate.decide(analyzeStatement(stmt));
      if (decision.action === "block") {
        worstAction = "block";
        worstReason = decision.reason;
        break;
      }
      if (decision.action === "confirm" && worstAction === "allow") {
        worstAction = "confirm";
        worstReason = decision.reason;
      }
    }
    if (worstAction === "block") {
      // History on block: status=error, duration=0. We do NOT call
      // `dispatchDbMutationHint` because no SQL hit the backend.
      updateQueryState(tab.id, { status: "error", error: worstReason });
      recordHistory({
        sql,
        executedAt: Date.now(),
        duration: 0,
        status: "error",
      });
      return;
    }
    if (worstAction === "confirm") {
      // One dialog per batch. The user types the reason verbatim once
      // and the batch runs as a unit (per-statement individual approval
      // is forbidden by AC-231-02).
      setPendingRdbConfirm({ statements, reason: worstReason });
      return;
    }

    if (statements.length === 1) {
      // Helper handles the running-state transition + book-keeping +
      // DB-mutation hint dispatch. The single-statement branch passes
      // `sql` (not `statements[0]`) for byte-equivalent history copy
      // when the original input contained a trailing semicolon — the
      // analyzer normalizes statements but history records the user's
      // exact buffer.
      await runRdbSingleNow(sql);
      return;
    }

    // Multi-statement: dispatch the same helper used by `confirmRdbDangerous`.
    // `joinedSql` mirrors the user's exact buffer for history (Sprint
    // 100 multi-statement history invariant).
    await runRdbBatchNow(statements, sql);
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
    safeModeGate,
    runMongoAggregateNow,
    runRdbSingleNow,
    runRdbBatchNow,
  ]);

  // Sprint 248 (ADR 0022 Phase 4) — explicit dry-run dispatch. Bypasses
  // the Safe Mode destructive-confirm dialog (no commit happens) and
  // routes the same `executeQueryDryRun` IPC the confirm dialog's
  // `<DryRunPreview>` uses. Mongo paradigm is unsupported (the IPC is
  // rdb-only); we surface a toast disclaimer + return without invoking
  // the IPC. History is intentionally not recorded — dry-runs are
  // ephemeral previews. The `queryId` is prefixed with `"dry:"` so the
  // backend cancel-token registry (and any future filtering by id) can
  // distinguish dry-run cancels from real-query cancels.
  const handleDryRun = useCallback(async () => {
    // Mongo paradigm — disclaimer + return. The IPC throws Unsupported
    // for document connections; surface the message before the round
    // trip so users get instant feedback.
    if (tab.paradigm === "document") {
      toast.info("Dry-run is not supported for MongoDB.");
      return;
    }

    // Empty / running guards mirror `handleExecute`. Running takes
    // priority because firing a second dry-run while a query is in
    // flight would race the queryState transition.
    if (tab.queryState.status === "running") return;
    const sql = tab.sql.trim();
    if (!sql) return;

    const statements = splitSqlStatements(sql).filter((stmt) => {
      // Mirror the comment-strip-then-non-empty filter used by
      // `handleExecute` so dry-run treats `-- comment` only as empty.
      let s = stmt;
      s = s.replace(/--[^\n]*/g, "");
      s = s.replace(/\/\*[\s\S]*?\*\//g, "");
      return s.trim().length > 0;
    });
    if (statements.length === 0) return;

    const queryId = `dry:${tab.id}-${Date.now()}`;
    updateQueryState(tab.id, { status: "running", queryId });
    try {
      const results = await executeQueryDryRun(
        tab.connectionId,
        statements,
        queryId,
      );
      // Backend always returns one QueryResult per statement, in input
      // order. Single-statement → no statements breakdown; multi → adapt
      // each into the QueryStatementResult shape so the result grid's
      // multi-statement Tabs view can reuse its existing rendering.
      if (results.length <= 1) {
        const lastResult: import("@/types/query").QueryResult =
          results[0] ??
          ({
            columns: [],
            rows: [],
            total_count: 0,
            execution_time_ms: 0,
            query_type: "ddl",
          } satisfies import("@/types/query").QueryResult);
        completeQueryDryRun(tab.id, queryId, lastResult);
        return;
      }
      const statementResults: import("@/types/query").QueryStatementResult[] =
        results.map((res, idx) => ({
          sql: statements[idx] ?? "",
          status: "success" as const,
          result: res,
          durationMs: res.execution_time_ms,
        }));
      const lastResult = results[results.length - 1]!;
      completeQueryDryRun(tab.id, queryId, lastResult, statementResults);
    } catch (err) {
      failQuery(
        tab.id,
        queryId,
        err instanceof Error ? err.message : String(err),
      );
    }
    // Excluding store actions from deps is deliberate — see hook header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sql, tab.queryState.status, tab.connectionId, tab.paradigm]);

  return {
    handleExecute,
    handleDryRun,
    pendingMongoConfirm,
    confirmMongoDangerous,
    cancelMongoDangerous,
    pendingRdbConfirm,
    confirmRdbDangerous,
    cancelRdbDangerous,
  };
}
