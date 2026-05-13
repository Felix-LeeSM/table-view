import { useCallback, useMemo, useRef, useState } from "react";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  executeQuery,
  executeQueryDryRun,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
} from "@lib/tauri";
import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { parseDbMismatch } from "@lib/api/dbMismatch";
import { splitSqlStatements } from "@lib/sql/sqlUtils";
import { analyzeMongoPipeline } from "@lib/mongo/mongoSafety";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { escalateWarnIfLargeImpact } from "@lib/sql/escalateWarnIfLargeImpact";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { toast } from "@lib/toast";
import type { QueryTab } from "@stores/workspaceStore";
import type { FindBody } from "@/types/document";
import type { QueryHistoryStatus } from "@stores/queryHistoryStore";
import {
  readDocumentContext,
  isRecord,
  isRecordArray,
  dispatchDbMutationHint,
} from "./queryHelpers";

/**
 * Sprint 267 — DbMismatch recovery: when backend rejects with
 * `AppError::DbMismatch` (Sprint 266 가드 has detected that the connection
 * pool's active db diverged from what the frontend tab requested), pull
 * the backend's actual db via `verifyActiveDb` and sync the frontend
 * stores so the user's next click dispatches against the correct
 * expectedDatabase. Fire-and-forget — verify failures stay invisible so
 * the query result panel survives a network blip.
 *
 * Sprint 269 — the passive `toast.warning(...)` previously surfaced here
 * is REPLACED by a Retry-bearing toast pushed from the catch site (so the
 * Retry closure has lexical access to `stmt` / `statements` / `joinedSql`).
 * `onSynced` is invoked only when verify resolved with a non-empty actual
 * db — preserves the Sprint 267 "verify-failed = silent" invariant.
 */
async function syncMismatchedActiveDb(
  connectionId: string,
  onSynced: (actual: string) => void,
): Promise<void> {
  try {
    const actual = await verifyActiveDb(connectionId);
    if (!actual) return;
    useConnectionStore.getState().setActiveDb(connectionId, actual);
    useSchemaStore.getState().clearForConnection(connectionId);
    onSynced(actual);
  } catch {
    // Best-effort — verify failure must not turn into a second user-facing
    // failure on top of the original DbMismatch. The Retry toast is NOT
    // surfaced when verify rejects: a Retry whose first action would race
    // an unsynced backend would just re-trigger the same DbMismatch.
  }
}
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
  /**
   * Sprint 255 — raw RDB WARN-tier preview payload. ADR 0023 grill Q3-(b)
   * "모든 환경 + 모든 write 표면" 의 핵심 보호. STOP-tier ConfirmDestructiveDialog
   * 와 별개로, `severity: "safe"` 인 non-INFO statement (INSERT / UPDATE WHERE
   * / DELETE WHERE / CREATE / ALTER additive) 직전에 SqlPreviewDialog 를
   * mount 하기 위한 pending state. INFO (SELECT / WITH …SELECT /
   * EXPLAIN / SHOW / DESCRIBE) 는 휴리스틱 (`isInfoStatement`) 로 식별 후 dialog
   * skip → 직접 IPC. STOP (`severity: "danger"`) 는 기존
   * `pendingRdbConfirm` 으로 routing — 두 dialog 동시 mount 금지 (STOP > WARN
   * 우선).
   */
  pendingRdbWarn: {
    statements: string[];
  } | null;
  confirmRdbWarn: () => Promise<void>;
  cancelRdbWarn: () => void;
  /**
   * Sprint 255 — raw Mongo aggregate WARN-tier preview payload. Mirrors
   * `pendingRdbWarn` for the document paradigm. INFO (find / read-only
   * aggregate pipeline) 은 `isInfoMongoOperation` 로 dialog skip; STOP
   * ($out / $merge) 은 기존 `pendingMongoConfirm`. `severity: "safe"` 이지만
   * non-INFO 인 aggregate (현재 분류상 거의 없음 — 보존을 위한 발판이며
   * Sprint 254 의 3-tier split 후 확장 예정) 만 본 dialog 발동.
   */
  pendingMongoWarn: {
    pipeline: Record<string, unknown>[];
  } | null;
  confirmMongoWarn: () => Promise<void>;
  cancelMongoWarn: () => void;
}

export function useQueryExecution({
  tab,
}: UseQueryExecutionArgs): QueryExecution {
  // The query tab's workspace coordinate. For Mongo tabs `tab.database`
  // is the user-selected db; for RDB it carries the active sub-pool. We
  // resolve once per tab change so the lifecycle wrappers don't recompute
  // each call.
  const workspaceDb = useMemo(
    () => tab.database ?? resolveActiveDb(tab.connectionId),
    [tab.database, tab.connectionId],
  );
  const wsConnId = tab.connectionId;
  const updateQueryStateAction = useWorkspaceStore((s) => s.updateQueryState);
  const completeQueryAction = useWorkspaceStore((s) => s.completeQuery);
  const failQueryAction = useWorkspaceStore((s) => s.failQuery);
  const completeMultiStatementQueryAction = useWorkspaceStore(
    (s) => s.completeMultiStatementQuery,
  );
  const completeQueryDryRunAction = useWorkspaceStore(
    (s) => s.completeQueryDryRun,
  );
  const updateQueryState = useCallback(
    (tabId: string, state: Parameters<typeof updateQueryStateAction>[3]) => {
      updateQueryStateAction(wsConnId, workspaceDb, tabId, state);
    },
    [updateQueryStateAction, wsConnId, workspaceDb],
  );
  const completeQuery = useCallback(
    (
      tabId: string,
      queryId: string,
      result: Parameters<typeof completeQueryAction>[4],
    ) => {
      completeQueryAction(wsConnId, workspaceDb, tabId, queryId, result);
    },
    [completeQueryAction, wsConnId, workspaceDb],
  );
  const failQuery = useCallback(
    (tabId: string, queryId: string, errorMessage: string) => {
      failQueryAction(wsConnId, workspaceDb, tabId, queryId, errorMessage);
    },
    [failQueryAction, wsConnId, workspaceDb],
  );
  const completeMultiStatementQuery = useCallback(
    (
      tabId: string,
      queryId: string,
      payload: Parameters<typeof completeMultiStatementQueryAction>[4],
    ) => {
      completeMultiStatementQueryAction(
        wsConnId,
        workspaceDb,
        tabId,
        queryId,
        payload,
      );
    },
    [completeMultiStatementQueryAction, wsConnId, workspaceDb],
  );
  const completeQueryDryRun = useCallback(
    (
      tabId: string,
      queryId: string,
      result: Parameters<typeof completeQueryDryRunAction>[4],
      statements?: Parameters<typeof completeQueryDryRunAction>[5],
    ) => {
      completeQueryDryRunAction(
        wsConnId,
        workspaceDb,
        tabId,
        queryId,
        result,
        statements,
      );
    },
    [completeQueryDryRunAction, wsConnId, workspaceDb],
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
  // Sprint 255 — raw RDB / Mongo WARN-tier pending state. `null` until a
  // non-INFO safe statement (INSERT / UPDATE WHERE / CREATE / ALTER additive
  // for RDB; non-read-only aggregate for Mongo) is detected. Distinct from
  // the STOP-tier `pendingRdbConfirm` / `pendingMongoConfirm` so the JSX
  // can mount SqlPreviewDialog (RDB) / MqlPreviewModal (Mongo) without
  // colliding with ConfirmDestructiveDialog. STOP > WARN priority is
  // enforced inside `handleExecute`: if any statement is danger, only
  // `pendingRdbConfirm` is set (WARN state untouched).
  const [pendingRdbWarn, setPendingRdbWarn] = useState<{
    statements: string[];
  } | null>(null);
  const [pendingMongoWarn, setPendingMongoWarn] = useState<{
    pipeline: Record<string, unknown>[];
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

  // Sprint 269 — refs the Retry closure dereferences when invoked. The
  // closure captured at catch time would otherwise hold a stale function
  // identity (each `useCallback` re-creates `runRdbSingleNow` /
  // `runRdbBatchNow` on tab-mutation re-render), so the user clicking
  // Retry after a re-render would dispatch through the *previous* render's
  // function. Refs decouple closure identity from `useCallback` deps.
  const runRdbSingleRef = useRef<((stmt: string) => Promise<void>) | null>(
    null,
  );
  const runRdbBatchRef = useRef<
    ((statements: string[], joinedSql: string) => Promise<void>) | null
  >(null);

  // Sprint 269 — Retry closure helper. Looks up the live tab via
  // `useWorkspaceStore.getState()` (tabs live nested at
  // `workspaces[connId][db].tabs`) and returns it only when (a) it still
  // exists and (b) is NOT currently `running`. `null` ⇒ Retry no-ops.
  // Walks every (connId, db) slot for the connection because the tab may
  // have moved if the active db flipped mid-flight.
  const findLiveIdleTab = useCallback(
    (tabId: string, connectionId: string): QueryTab | null => {
      const conns = useWorkspaceStore.getState().workspaces[connectionId];
      if (!conns) return null;
      for (const ws of Object.values(conns)) {
        const found = ws?.tabs.find((t) => t.id === tabId);
        if (!found) continue;
        if (found.type !== "query") return null;
        if (found.queryState.status === "running") return null;
        return found;
      }
      return null;
    },
    [],
  );

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
        // Sprint 266 — opt-in db-mismatch guard. `workspaceDb` is the
        // (resolved) active db for this tab; passing it lets the backend
        // refuse the query if the connection pool has been swapped to a
        // different db between user click and dispatch.
        const result = await executeQuery(
          tab.connectionId,
          stmt,
          queryId,
          workspaceDb ?? undefined,
        );
        completeQuery(tab.id, queryId, result);
        recordHistory({
          sql: stmt,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failQuery(tab.id, queryId, message);
        recordHistory({
          sql: stmt,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
        });
        // Sprint 267 — Sprint 266 의 가드가 backend 의 active db 변동을
        // 알려준 것. 즉시 verify + sync 하여 다음 user click 이 올바른
        // expectedDatabase 로 dispatch 되도록.
        //
        // Sprint 269 — push the Retry-bearing toast from the catch site
        // (rather than from inside `syncMismatchedActiveDb`) so the closure
        // captures `stmt` lexically. The Retry closure re-invokes the live
        // `runRdbSingleNow` via `runRdbSingleRef.current` only when the tab
        // still exists and is NOT currently running.
        if (parseDbMismatch(message)) {
          const capturedTabId = tab.id;
          const capturedConnectionId = tab.connectionId;
          const capturedStmt = stmt;
          void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
            toast.warning(
              `Active DB synced to '${actual}'. Re-run the query if needed.`,
              {
                action: {
                  label: "Retry",
                  onClick: () => {
                    const live = findLiveIdleTab(
                      capturedTabId,
                      capturedConnectionId,
                    );
                    if (!live) return;
                    const fn = runRdbSingleRef.current;
                    if (!fn) return;
                    void fn(capturedStmt);
                  },
                },
              },
            );
          });
        }
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
      workspaceDb,
      updateQueryState,
      completeQuery,
      failQuery,
      recordHistory,
      findLiveIdleTab,
    ],
  );
  // Keep the ref in sync with the latest function identity so the Retry
  // closure (captured at catch time) routes to the current render's helper.
  runRdbSingleRef.current = runRdbSingleNow;

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
      // Sprint 269 — only push ONE Retry toast per batch even if multiple
      // statements trip the mismatch guard. The first observed mismatch
      // fires the verify + sync; subsequent statement-level mismatches
      // skip the toast push (sync is idempotent so the store update is
      // still safe to repeat, but a second toast would clutter the queue).
      let mismatchToastPushed = false;

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        const stmtQueryId = `${queryId}-${i}`;
        const stmtStart = Date.now();
        try {
          const result = await executeQuery(
            tab.connectionId,
            stmt,
            stmtQueryId,
            workspaceDb ?? undefined,
          );
          lastResult = result;
          statementResults.push({
            sql: stmt,
            status: "success",
            result,
            durationMs: Date.now() - stmtStart,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          statementResults.push({
            sql: stmt,
            status: "error",
            error: message,
            durationMs: Date.now() - stmtStart,
          });
          // Sprint 267 — mismatch sync (per statement-level catch).
          // 같은 mismatch 가 batch 안에서 반복되어도 setActiveDb 는 동일
          // 결과 idempotent — overhead 만 약간 더 큰 round-trip 수준.
          //
          // Sprint 269 — push the Retry-bearing toast (once per batch) from
          // the catch site so the closure captures `(statements, joinedSql)`
          // lexically. Retry re-invokes the live `runRdbBatchNow` via the
          // ref iff the tab still exists and is NOT currently running.
          if (parseDbMismatch(message) && !mismatchToastPushed) {
            mismatchToastPushed = true;
            const capturedTabId = tab.id;
            const capturedConnectionId = tab.connectionId;
            const capturedStatements = statements;
            const capturedJoinedSql = joinedSql;
            void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
              toast.warning(
                `Active DB synced to '${actual}'. Re-run the query if needed.`,
                {
                  action: {
                    label: "Retry",
                    onClick: () => {
                      const live = findLiveIdleTab(
                        capturedTabId,
                        capturedConnectionId,
                      );
                      if (!live) return;
                      const fn = runRdbBatchRef.current;
                      if (!fn) return;
                      void fn(capturedStatements, capturedJoinedSql);
                    },
                  },
                },
              );
            });
          } else if (parseDbMismatch(message)) {
            // Subsequent statements hitting the same mismatch: still run
            // verify+sync (idempotent) but suppress an extra toast.
            void syncMismatchedActiveDb(tab.connectionId, () => {
              /* no toast on repeat — keep queue uncluttered */
            });
          }
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
      workspaceDb,
      updateQueryState,
      completeMultiStatementQuery,
      recordHistory,
      findLiveIdleTab,
    ],
  );
  // Sprint 269 — see `runRdbSingleRef` rationale above. Mirror for batch.
  runRdbBatchRef.current = runRdbBatchNow;

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

  // Sprint 255 — WARN-tier confirm callback (RDB). Re-enters the same
  // single / multi helper used by `confirmRdbDangerous`, so the user's
  // input is dispatched verbatim after they review the SqlPreviewDialog.
  // Multi-statement reuses `joinedSql` for history bookkeeping.
  const confirmRdbWarn = useCallback(async () => {
    const pending = pendingRdbWarn;
    if (!pending) return;
    setPendingRdbWarn(null);
    if (pending.statements.length === 1) {
      await runRdbSingleNow(pending.statements[0]!);
      return;
    }
    await runRdbBatchNow(pending.statements, pending.statements.join(";\n"));
  }, [pendingRdbWarn, runRdbSingleNow, runRdbBatchNow]);

  const cancelRdbWarn = useCallback(() => {
    setPendingRdbWarn(null);
  }, []);

  // Sprint 255 — WARN-tier confirm callback (Mongo aggregate). Mirrors
  // `confirmMongoDangerous` but reuses the WARN pending pipeline. Mongo
  // find path never triggers WARN (always INFO).
  const confirmMongoWarn = useCallback(async () => {
    const pending = pendingMongoWarn;
    if (!pending) return;
    setPendingMongoWarn(null);
    await runMongoAggregateNow(pending.pipeline);
  }, [pendingMongoWarn, runMongoAggregateNow]);

  const cancelMongoWarn = useCallback(() => {
    setPendingMongoWarn(null);
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
        const analysis = analyzeMongoPipeline(parsed);
        const decision = safeModeGate.decide(analysis);
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        // STOP tier — destructive aggregate ($out / $merge) always routes
        // to the existing ConfirmDestructiveDialog (Sprint 231).
        if (decision.action === "confirm") {
          setPendingMongoConfirm({
            pipeline: parsed,
            reason: decision.reason,
          });
          return;
        }
        // Sprint 255 — gate said `allow`. Apply INFO heuristic: read-only
        // pipeline → direct IPC; otherwise WARN dialog (MqlPreviewModal).
        // Only severity:"warn" triggers WARN; severity:"danger" pipelines
        // that the gate allowed (e.g. $out on dev + warn — env-gated
        // unguarded under ADR 0022) bypass WARN entirely so the existing
        // destructive-on-dev-warn unguarded behavior stays intact.
        //
        // Sprint 254 — Mongo `*-many` (non-empty filter) is now classified
        // as severity:"warn" (was "safe"), so the WARN dialog finally
        // covers Mongo bulk-write previews. INFO (`mongo-other`) skips
        // dialog. Mongo paradigm has no dry-run IPC support so escalation
        // is skipped (`escalateWarnIfLargeImpact` is rdb-only).
        if (analysis.severity === "warn") {
          setPendingMongoWarn({ pipeline: parsed });
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
    //
    // Sprint 255 (ADR 0023 grill Q3-(b)) — extended to track WARN tier
    // via `isInfoStatement`. Final priority across the batch is
    // `STOP (block / confirm) > WARN (non-INFO safe) > INFO (read-only)`.
    // STOP routes to `pendingRdbConfirm` (existing ConfirmDestructiveDialog);
    // WARN routes to the new `pendingRdbWarn` (SqlPreviewDialog mount);
    // INFO falls through to direct IPC. STOP and WARN are mutually
    // exclusive — STOP wins, WARN state stays null.
    let worstAction: "allow" | "confirm" | "block" = "allow";
    let worstReason = "";
    let hasWarn = false;
    // Sprint 254 — bounded UPDATE/DELETE WHERE candidates for dry-run
    // row-count escalation. We collect them during the classifier pass so
    // we can probe each (in order) only if no STOP statement exists.
    const escalationCandidates: { stmt: string; reason: string }[] = [];
    for (const stmt of statements) {
      const analysis = analyzeStatement(stmt);
      const decision = safeModeGate.decide(analysis);
      if (decision.action === "block") {
        worstAction = "block";
        worstReason = decision.reason;
        break;
      }
      if (decision.action === "confirm" && worstAction === "allow") {
        worstAction = "confirm";
        worstReason = decision.reason;
      }
      // Sprint 254 — `severity: "warn"` 직접 비교로 단순화. INFO (`severity:
      // "info"`) 는 dialog skip; WARN (`severity: "warn"`) 은 dialog mount;
      // STOP (`severity: "danger"`) 이 gate 통과 (e.g. DROP TABLE on dev +
      // warn — env-gated unguarded under ADR 0022) 한 경우는 worst 아래
      // 분기 (`if (worstAction === "confirm")`) 가 아닌 본 분기에서 WARN
      // 으로 끌어올리지 않는다 — 즉 destructive-on-dev-warn unguarded 의
      // direct IPC 발동 invariant 보존.
      if (decision.action === "allow" && analysis.severity === "warn") {
        hasWarn = true;
        // Sprint 254 — bounded UPDATE/DELETE 만 escalation 대상. INSERT /
        // CREATE / ALTER additive 는 dry-run 비용 대비 ROI 낮음.
        if (analysis.kind === "update" || analysis.kind === "delete") {
          escalationCandidates.push({
            stmt,
            reason:
              analysis.kind === "update"
                ? "UPDATE affects 100+ rows (dry-run threshold)"
                : "DELETE affects 100+ rows (dry-run threshold)",
          });
        }
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
      // STOP wins over WARN — set only the destructive-confirm state.
      // One dialog per batch. The user types the reason verbatim once
      // and the batch runs as a unit (per-statement individual approval
      // is forbidden by AC-231-02).
      setPendingRdbConfirm({ statements, reason: worstReason });
      return;
    }
    // Sprint 254 — WARN-tier bounded UPDATE/DELETE escalation. Probe each
    // candidate via dry-run; if any reports rowCount >= 100, escalate the
    // whole batch to STOP (`pendingRdbConfirm`). Timeout / IPC unsupported
    // → STOP fallback (conservative). Probes run sequentially because
    // each shares the connection's transaction surface.
    if (hasWarn && escalationCandidates.length > 0) {
      for (const candidate of escalationCandidates) {
        const escalated = await escalateWarnIfLargeImpact(
          tab.connectionId,
          candidate.stmt,
          "warn",
        );
        if (escalated === "danger") {
          setPendingRdbConfirm({ statements, reason: candidate.reason });
          return;
        }
      }
    }
    // Sprint 255 — WARN tier: every statement gate-allowed and at least
    // one is a non-INFO write. Mount SqlPreviewDialog for the whole batch
    // (single-line INFO statements are joined into the preview alongside
    // the WARN ones so the user reviews exactly what executes).
    if (hasWarn) {
      setPendingRdbWarn({ statements });
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
    pendingRdbWarn,
    confirmRdbWarn,
    cancelRdbWarn,
    pendingMongoWarn,
    confirmMongoWarn,
    cancelMongoWarn,
  };
}
