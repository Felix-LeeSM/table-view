import { useCallback, useMemo, useRef, useState } from "react";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  executeQuery,
  executeQueryDryRun,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
  findOneDocument,
  countDocuments,
  estimatedDocumentCount,
  distinctDocuments,
  insertDocument,
  insertManyDocuments,
  updateDocument,
  updateMany,
  deleteDocument,
  deleteMany,
  bulkWriteDocuments,
} from "@lib/tauri";
import { parseDbMismatch } from "@lib/api/dbMismatch";
import { syncMismatchedActiveDb } from "@lib/api/syncMismatchedActiveDb";
import { splitSqlStatements } from "@lib/sql/sqlUtils";
import {
  analyzeMongoPipeline,
  analyzeMongoOperation,
} from "@lib/mongo/mongoSafety";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { escalateWarnIfLargeImpact } from "@lib/sql/escalateWarnIfLargeImpact";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { toast } from "@lib/toast";
import type { QueryTab, QueryMode } from "@stores/workspaceStore";
import type { FindBody } from "@/types/document";
import type { QueryHistoryStatus } from "@stores/queryHistoryStore";
import type { BulkWriteOp, BulkWriteResult } from "@/types/documentMutate";
import type { WriteSummaryData } from "@/types/query";
import {
  parseMongoshExpression,
  type ParsedMongoshCall,
} from "@lib/mongo/mongoshParser";
import {
  readDocumentContext,
  isRecord,
  dispatchDbMutationHint,
  idOnlyFilter,
  extractDollarSet,
} from "./queryHelpers";

// Sprint 271a — `syncMismatchedActiveDb` extracted to
// `src/lib/api/syncMismatchedActiveDb.ts` so background introspection paths
// (schemaStore) reuse the same verify + sync logic. Behaviour unchanged.
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
  /**
   * Sprint 312 (Phase 28 Slice A6, 2026-05-14) — STOP-tier confirm payload.
   * Aggregate variant carries `pipeline` (A5 invariant retained); write
   * variant carries `previewLines` (already-formatted mongosh) + an
   * internal `runner` closure the confirm callback invokes verbatim. The
   * discriminator keeps the JSX dialog mount paradigm-agnostic.
   */
  pendingMongoConfirm: {
    pipeline: Record<string, unknown>[];
    reason: string;
    /** Sprint 312 — populated only for write STOP cases (drop-equivalent). */
    previewLines?: string[];
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
  /**
   * Sprint 312 — WARN-tier preview payload. Aggregate variant carries
   * `pipeline`; write variant carries `previewLines` so MqlPreviewModal
   * renders the formatted mongosh expression instead of JSON-stringified
   * pipeline.
   */
  pendingMongoWarn: {
    pipeline: Record<string, unknown>[];
    /** Sprint 312 — populated only for write WARN cases. */
    previewLines?: string[];
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
  //
  // Sprint 311 (Phase 28 Slice A5, 2026-05-14) — `queryMode` now accepts
  // an override so document-paradigm dispatch can record the **parsed
  // method name** (`"find"` / `"aggregate"` / `"countDocuments"` / etc.)
  // instead of the persisted `tab.queryMode`. RDB call sites continue
  // to pass nothing and fall back to `tab.queryMode` (`"sql"`).
  // Backwards-compat: any filter/search consumer that previously matched
  // `queryMode === "aggregate"` keeps working unchanged because aggregate
  // entries still carry `"aggregate"` — only the source of truth flipped
  // from the toggle state to the parser output.
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const recordHistory = useCallback(
    (payload: {
      sql: string;
      executedAt: number;
      duration: number;
      status: QueryHistoryStatus;
      queryMode?: QueryMode;
    }) => {
      addHistoryEntry({
        sql: payload.sql,
        executedAt: payload.executedAt,
        duration: payload.duration,
        status: payload.status,
        source: "raw",
        connectionId: tab.connectionId,
        paradigm: tab.paradigm,
        queryMode: payload.queryMode ?? tab.queryMode,
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
    previewLines?: string[];
  } | null>(null);
  // Sprint 312 (Phase 28 Slice A6, 2026-05-14) — write-path STOP/WARN
  // dispatch closure stored in a ref (not in setState) because the
  // re-runner captures the parsed write op + parsed filter / update
  // payload verbatim. Stashing it next to `pendingMongoConfirm` keeps
  // AC-311-09 stale-editor isolation (the closure is whatever the parser
  // produced at prompt time; editor mutations between prompt and confirm
  // click cannot leak into the IPC dispatch).
  const pendingWriteRunnerRef = useRef<(() => Promise<void>) | null>(null);
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
    previewLines?: string[];
  } | null>(null);

  // Aggregate dispatch + book-keeping, extracted so the warn-confirm
  // dialog can re-enter the same path with the pending pipeline. Mirrors
  // the inline find branch (running-set → dispatch → adapt → complete →
  // history) but for `aggregateDocuments`.
  //
  // Sprint 311 (Phase 28 Slice A5, 2026-05-14) — accepts an optional
  // `collectionOverride` so free-form document tabs (without bound
  // `tab.collection`) can re-enter the confirm flow with the
  // parser-extracted collection name. History records the parsed method
  // (`"aggregate"`) explicitly so backward-compat consumers keep seeing
  // the same value the legacy `tab.queryMode === "aggregate"` branch
  // emitted.
  const runMongoAggregateNow = useCallback(
    async (
      pipeline: Record<string, unknown>[],
      collectionOverride?: string,
    ) => {
      const baseCtx = readDocumentContext(tab);
      const resolvedDatabase = baseCtx?.database ?? tab.database;
      const resolvedCollection = collectionOverride ?? baseCtx?.collection;
      if (!resolvedDatabase || !resolvedCollection) {
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
          resolvedDatabase,
          resolvedCollection,
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
          queryMode: "aggregate",
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
          queryMode: "aggregate",
        });
      }
    },
    [tab, recordHistory, completeQuery, failQuery, updateQueryState],
  );

  const confirmMongoDangerous = useCallback(async () => {
    const pending = pendingMongoConfirm;
    if (!pending) return;
    setPendingMongoConfirm(null);
    // Sprint 312 — when the STOP came from a write op the parser stashed
    // an op-specific runner closure; aggregate STOP falls through to the
    // pipeline re-runner. Either path runs the parsed payload verbatim.
    const writeRunner = pendingWriteRunnerRef.current;
    pendingWriteRunnerRef.current = null;
    if (writeRunner) {
      await writeRunner();
      return;
    }
    await runMongoAggregateNow(pending.pipeline);
  }, [pendingMongoConfirm, runMongoAggregateNow]);

  const cancelMongoDangerous = useCallback(() => {
    setPendingMongoConfirm(null);
    pendingWriteRunnerRef.current = null;
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
    // Sprint 312 — same write-runner pattern as confirmMongoDangerous.
    const writeRunner = pendingWriteRunnerRef.current;
    pendingWriteRunnerRef.current = null;
    if (writeRunner) {
      await writeRunner();
      return;
    }
    await runMongoAggregateNow(pending.pipeline);
  }, [pendingMongoWarn, runMongoAggregateNow]);

  const cancelMongoWarn = useCallback(() => {
    setPendingMongoWarn(null);
    pendingWriteRunnerRef.current = null;
  }, []);

  // Sprint 311 (Phase 28 Slice A5, 2026-05-14) — parser-driven document
  // dispatch. Routes a `ParsedMongoshCall` to one of the 6 read-path
  // IPC wrappers (find / findOne / aggregate / countDocuments /
  // estimatedDocumentCount / distinct), adapts the response into the
  // shared `QueryResult` shape (with `resultKind` for scalar/list
  // panels — A6 polishes the actual rendering), and records history
  // with the parsed method name. Aggregate retains the Safe Mode gate
  // path; STOP/WARN dialogs store the PARSED pipeline so the confirm
  // flow is isolated from any editor mutation between prompt and click.
  // Write methods land in A6 (Sprint 312) — A5 returns an explanatory
  // error if the parser surfaces one.
  const dispatchMongoshCall = useCallback(
    async (
      parsed: ParsedMongoshCall,
      ctx: {
        connectionId: string;
        database: string;
        collection: string;
        rawSql: string;
      },
    ) => {
      const { connectionId, database, collection, rawSql } = ctx;

      // ── aggregate (Safe Mode gate retained) ───────────────────────────
      if (parsed.method === "aggregate") {
        const pipelineRaw = parsed.args[0];
        if (!Array.isArray(pipelineRaw)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "Pipeline must be an array of stage objects.",
          });
          return;
        }
        const pipeline = pipelineRaw.filter(isRecord) as Record<
          string,
          unknown
        >[];
        if (pipeline.length !== pipelineRaw.length) {
          updateQueryState(tab.id, {
            status: "error",
            error: "Pipeline must be an array of stage objects.",
          });
          return;
        }
        const analysis = analyzeMongoPipeline(pipeline);
        const decision = safeModeGate.decide(analysis);
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        // STOP tier — parsed pipeline stored verbatim. Confirm-flow
        // re-enters with the captured value so editor mutation between
        // prompt and click cannot smuggle a benign pipeline through the
        // gate.
        if (decision.action === "confirm") {
          setPendingMongoConfirm({
            pipeline,
            reason: decision.reason,
          });
          return;
        }
        if (analysis.severity === "warn") {
          setPendingMongoWarn({ pipeline });
          return;
        }
        await runMongoAggregateNow(pipeline, collection);
        return;
      }

      // ── find (FindBody from args + cursor chain) ──────────────────────
      if (parsed.method === "find") {
        const filterArg = parsed.args[0];
        const body: FindBody = {};
        if (isRecord(filterArg)) {
          body.filter = filterArg;
        } else if (filterArg !== undefined) {
          updateQueryState(tab.id, {
            status: "error",
            error: "find() filter must be an object.",
          });
          return;
        }
        // D-11 — cursor chain → FindBody fields. `projection` is not
        // captured by A1's chain shape yet; users wanting projection
        // pass it via the A4 snippet template. `.toArray()` is parsed
        // but a no-op (default IPC behaviour returns an array).
        for (const step of parsed.cursorChain) {
          if (step.name === "sort") {
            const arg = step.args[0];
            if (isRecord(arg)) body.sort = arg;
          } else if (step.name === "limit") {
            const arg = step.args[0];
            if (typeof arg === "number") body.limit = arg;
          } else if (step.name === "skip") {
            const arg = step.args[0];
            if (typeof arg === "number") body.skip = arg;
          }
          // `toArray` — no-op.
        }
        await runDocumentFind(connectionId, database, collection, body, rawSql);
        return;
      }

      // ── findOne ───────────────────────────────────────────────────────
      if (parsed.method === "findOne") {
        const filterArg = parsed.args[0];
        if (filterArg !== undefined && !isRecord(filterArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "findOne() filter must be an object.",
          });
          return;
        }
        await runDocumentFindOne(
          connectionId,
          database,
          collection,
          filterArg as Record<string, unknown> | undefined,
          rawSql,
        );
        return;
      }

      // ── countDocuments → scalar ───────────────────────────────────────
      if (parsed.method === "countDocuments") {
        const filterArg = parsed.args[0];
        if (filterArg !== undefined && !isRecord(filterArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "countDocuments() filter must be an object.",
          });
          return;
        }
        await runDocumentCount(
          connectionId,
          database,
          collection,
          filterArg as Record<string, unknown> | undefined,
          rawSql,
        );
        return;
      }

      // ── estimatedDocumentCount → scalar ───────────────────────────────
      if (parsed.method === "estimatedDocumentCount") {
        await runDocumentEstimatedCount(
          connectionId,
          database,
          collection,
          rawSql,
        );
        return;
      }

      // ── distinct → list ───────────────────────────────────────────────
      if (parsed.method === "distinct") {
        const fieldArg = parsed.args[0];
        if (typeof fieldArg !== "string") {
          updateQueryState(tab.id, {
            status: "error",
            error:
              "distinct() requires a string field name as the first argument.",
          });
          return;
        }
        const filterArg = parsed.args[1];
        if (filterArg !== undefined && !isRecord(filterArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "distinct() filter must be an object.",
          });
          return;
        }
        await runDocumentDistinct(
          connectionId,
          database,
          collection,
          fieldArg,
          filterArg as Record<string, unknown> | undefined,
          rawSql,
        );
        return;
      }

      // ── write methods (A6 / Sprint 312) ───────────────────────────────
      // Each branch (1) reifies the parser args into typed payloads,
      // (2) runs the Safe Mode classifier via `analyzeMongoOperation`,
      // (3) STOP → `pendingMongoConfirm` + write runner; WARN →
      // `pendingMongoWarn` + write runner; INFO → direct IPC dispatch.
      // The runner closure captures the parsed payload verbatim so the
      // user's editor mutations between prompt and confirm-click cannot
      // mutate the IPC payload (same AC-311-09 invariant as aggregate).
      if (parsed.method === "insertOne") {
        const doc = parsed.args[0];
        if (!isRecord(doc)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "insertOne() requires a document object.",
          });
          return;
        }
        await runInsertOne(connectionId, database, collection, doc, rawSql);
        return;
      }
      if (parsed.method === "insertMany") {
        const docs = parsed.args[0];
        if (!Array.isArray(docs) || !docs.every(isRecord)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "insertMany() requires an array of documents.",
          });
          return;
        }
        await runInsertMany(
          connectionId,
          database,
          collection,
          docs as Record<string, unknown>[],
          rawSql,
        );
        return;
      }
      if (parsed.method === "deleteMany") {
        const filterArg = parsed.args[0];
        const filter = isRecord(filterArg) ? filterArg : {};
        if (filterArg !== undefined && !isRecord(filterArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "deleteMany() filter must be an object.",
          });
          return;
        }
        const analysis = analyzeMongoOperation({ kind: "deleteMany", filter });
        const decision = safeModeGate.decide(analysis);
        const runner = () =>
          runDeleteMany(connectionId, database, collection, filter, rawSql);
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        if (decision.action === "confirm") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoConfirm({
            pipeline: [],
            reason: decision.reason,
            previewLines: [rawSql],
          });
          return;
        }
        if (analysis.severity === "warn") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
          return;
        }
        await runner();
        return;
      }
      if (parsed.method === "updateMany") {
        const filterArg = parsed.args[0];
        const updateArg = parsed.args[1];
        if (!isRecord(filterArg) || !isRecord(updateArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error:
              "updateMany() requires a filter object and an update object.",
          });
          return;
        }
        const filter = filterArg;
        const patch = extractDollarSet(updateArg);
        if (patch === null) {
          updateQueryState(tab.id, {
            status: "error",
            error:
              "updateMany() update document must use `$set` with a non-_id patch.",
          });
          return;
        }
        const analysis = analyzeMongoOperation({
          kind: "updateMany",
          filter,
          patch,
        });
        const decision = safeModeGate.decide(analysis);
        const runner = () =>
          runUpdateMany(
            connectionId,
            database,
            collection,
            filter,
            patch,
            rawSql,
          );
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        if (decision.action === "confirm") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoConfirm({
            pipeline: [],
            reason: decision.reason,
            previewLines: [rawSql],
          });
          return;
        }
        if (analysis.severity === "warn") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
          return;
        }
        await runner();
        return;
      }
      if (parsed.method === "deleteOne") {
        const filterArg = parsed.args[0];
        if (!isRecord(filterArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "deleteOne() filter must be an object.",
          });
          return;
        }
        await runDeleteOne(
          connectionId,
          database,
          collection,
          filterArg,
          rawSql,
        );
        return;
      }
      if (parsed.method === "updateOne") {
        const filterArg = parsed.args[0];
        const updateArg = parsed.args[1];
        if (!isRecord(filterArg) || !isRecord(updateArg)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "updateOne() requires a filter object and an update object.",
          });
          return;
        }
        const patch = extractDollarSet(updateArg);
        if (patch === null) {
          updateQueryState(tab.id, {
            status: "error",
            error:
              "updateOne() update document must use `$set` with a non-_id patch.",
          });
          return;
        }
        await runUpdateOne(
          connectionId,
          database,
          collection,
          filterArg,
          patch,
          rawSql,
        );
        return;
      }
      if (parsed.method === "bulkWrite") {
        const opsRaw = parsed.args[0];
        if (!Array.isArray(opsRaw)) {
          updateQueryState(tab.id, {
            status: "error",
            error: "bulkWrite() requires an array of operations.",
          });
          return;
        }
        const ops = opsRaw as readonly BulkWriteOp[];
        const analysis = analyzeMongoOperation({ kind: "bulkWrite", ops });
        const decision = safeModeGate.decide(analysis);
        const runner = () =>
          runBulkWrite(connectionId, database, collection, ops, rawSql);
        if (decision.action === "block") {
          updateQueryState(tab.id, {
            status: "error",
            error: decision.reason,
          });
          return;
        }
        if (decision.action === "confirm") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoConfirm({
            pipeline: [],
            reason: decision.reason,
            previewLines: [rawSql],
          });
          return;
        }
        if (analysis.severity === "warn") {
          pendingWriteRunnerRef.current = runner;
          setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
          return;
        }
        await runner();
        return;
      }

      // Exhaustiveness fallback — every `MongoshMethod` should branch
      // above. If a future spec adds a new method, surface a friendly
      // error rather than silently no-oping.
      updateQueryState(tab.id, {
        status: "error",
        error: `Method '${parsed.method}' is not yet wired.`,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id, safeModeGate, runMongoAggregateNow, updateQueryState],
  );

  // Sprint 311 — find dispatch helper. Mirrors the previous inline
  // findDocuments block; kept inline-ish so the cursor-chain mapping
  // above retains a single dispatch site per method.
  const runDocumentFind = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      body: FindBody,
      rawSql: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const docResult = await findDocuments(
          connectionId,
          database,
          collection,
          body,
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
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode: "find",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode: "find",
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

  // Sprint 311 — findOne dispatch. D-12: `null` (no match) renders as
  // an empty grid (`columns: []`, `rows: []`) for now; A6 will swap in
  // a dedicated "No match" panel.
  const runDocumentFindOne = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown> | undefined,
      rawSql: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const docRow = await findOneDocument(
          connectionId,
          database,
          collection,
          filter,
        );
        const queryResult: import("@/types/query").QueryResult =
          docRow === null
            ? {
                columns: [],
                rows: [],
                total_count: 0,
                execution_time_ms: Date.now() - startTime,
                query_type: "select",
              }
            : {
                columns: docRow.columns,
                rows: [docRow.row],
                total_count: 1,
                execution_time_ms: Date.now() - startTime,
                query_type: "select",
              };
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode: "findOne",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode: "findOne",
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

  // Sprint 311 — count → scalar QueryResult (`resultKind: "scalar"`).
  // A6 will render the dedicated ScalarPanel; A5 wires the shape only.
  const runDocumentCount = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown> | undefined,
      rawSql: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const count = await countDocuments(
          connectionId,
          database,
          collection,
          filter,
        );
        const queryResult: import("@/types/query").QueryResult = {
          columns: [{ name: "count", data_type: "Int64", category: "int" }],
          rows: [[count]],
          total_count: 1,
          execution_time_ms: Date.now() - startTime,
          query_type: "select",
          resultKind: "scalar",
        };
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode: "countDocuments",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode: "countDocuments",
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

  // Sprint 311 — estimatedDocumentCount → scalar QueryResult (same
  // shape as `countDocuments`). Backed by the cheap metadata count IPC.
  const runDocumentEstimatedCount = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      rawSql: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const count = await estimatedDocumentCount(
          connectionId,
          database,
          collection,
        );
        const queryResult: import("@/types/query").QueryResult = {
          columns: [{ name: "count", data_type: "Int64", category: "int" }],
          rows: [[count]],
          total_count: 1,
          execution_time_ms: Date.now() - startTime,
          query_type: "select",
          resultKind: "scalar",
        };
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode: "estimatedDocumentCount",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode: "estimatedDocumentCount",
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

  // ── Sprint 312 (Phase 28 Slice A6, 2026-05-14) — write helpers ────────
  //
  // Each runner mirrors the read-path helper structure (running-state
  // → IPC → adapt response → completeQuery + record history) but builds
  // a `WriteSummaryData` payload from the IPC result so the result panel
  // routes to `WriteSummaryPanel`.
  //
  // D-16 (autonomous decision, 2026-05-14): `updateOne` / `deleteOne` on
  // a non-`_id` filter are translated to `bulkWriteDocuments` with a
  // single-op `updateOne` / `deleteOne` sub-op. The user's mongosh text
  // in the editor + history still reads `updateOne(...)` — only the
  // wire transport changes. Rationale: avoids a 2-IPC round-trip
  // (`findOne` → `_id` → `updateDocument`) which would be non-atomic
  // and slower, and reuses A2's `bulk_write` IPC that already accepts
  // arbitrary filters. `{ _id: ... }`-only filters go through the
  // existing `updateDocument` / `deleteDocument` IPC directly (faster
  // single-doc path, no bulk wrapping).

  /**
   * Adapt a writer's result + history bookkeeping into the shared shape.
   * Returns a curried function the runner invokes inside its try/catch.
   */
  const runWriteHelper = useCallback(
    async (
      queryMode: QueryMode,
      rawSql: string,
      writer: () => Promise<WriteSummaryData>,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const summary = await writer();
        const queryResult: import("@/types/query").QueryResult = {
          columns: [],
          rows: [],
          total_count: 0,
          execution_time_ms: Date.now() - startTime,
          query_type: "select",
          resultKind: "writeSummary",
          writeSummary: summary,
        };
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode,
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode,
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

  const runInsertOne = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      doc: Record<string, unknown>,
      rawSql: string,
    ) => {
      await runWriteHelper("insertOne", rawSql, async () => {
        const id = await insertDocument(
          connectionId,
          database,
          collection,
          doc,
        );
        return { kind: "insert", insertedIds: [id] };
      });
    },
    [runWriteHelper],
  );

  const runInsertMany = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      docs: Record<string, unknown>[],
      rawSql: string,
    ) => {
      await runWriteHelper("insertMany", rawSql, async () => {
        const ids = await insertManyDocuments(
          connectionId,
          database,
          collection,
          docs,
        );
        return { kind: "insert", insertedIds: ids };
      });
    },
    [runWriteHelper],
  );

  const runDeleteMany = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown>,
      rawSql: string,
    ) => {
      await runWriteHelper("deleteMany", rawSql, async () => {
        const deletedCount = await deleteMany(
          connectionId,
          database,
          collection,
          filter,
        );
        return { kind: "delete", deletedCount };
      });
    },
    [runWriteHelper],
  );

  const runUpdateMany = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown>,
      patch: Record<string, unknown>,
      rawSql: string,
    ) => {
      await runWriteHelper("updateMany", rawSql, async () => {
        const modifiedCount = await updateMany(
          connectionId,
          database,
          collection,
          filter,
          patch,
        );
        // The IPC currently surfaces only `modifiedCount`; we expose it
        // as both matched and modified counts (the lower-bound estimate)
        // until A2 widens the wire shape. See A2 spec for the upgrade.
        return {
          kind: "update",
          matchedCount: modifiedCount,
          modifiedCount,
        };
      });
    },
    [runWriteHelper],
  );

  const runDeleteOne = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown>,
      rawSql: string,
    ) => {
      await runWriteHelper("deleteOne", rawSql, async () => {
        const idFilter = idOnlyFilter(filter);
        if (idFilter !== null) {
          // Fast path — single-IPC `delete_document` with the parsed `_id`.
          await deleteDocument(connectionId, database, collection, idFilter);
          return { kind: "delete", deletedCount: 1 };
        }
        // D-16 fallback — translate to bulkWrite single-op for arbitrary
        // filters so the user's mongosh text stays unchanged.
        const result = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [{ op: "deleteOne", filter }],
        );
        return { kind: "delete", deletedCount: result.deleted_count };
      });
    },
    [runWriteHelper],
  );

  const runUpdateOne = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      filter: Record<string, unknown>,
      patch: Record<string, unknown>,
      rawSql: string,
    ) => {
      await runWriteHelper("updateOne", rawSql, async () => {
        const idFilter = idOnlyFilter(filter);
        if (idFilter !== null) {
          await updateDocument(
            connectionId,
            database,
            collection,
            idFilter,
            patch,
          );
          // `update_document` IPC returns `void`; one-doc update path
          // never matches more than one document so matched/modified == 1.
          return { kind: "update", matchedCount: 1, modifiedCount: 1 };
        }
        // D-16 fallback — translate to bulkWrite single-op updateOne.
        const result = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [{ op: "updateOne", filter, update: { $set: patch } }],
        );
        return {
          kind: "update",
          matchedCount: result.matched_count,
          modifiedCount: result.modified_count,
        };
      });
    },
    [runWriteHelper],
  );

  const runBulkWrite = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      ops: readonly BulkWriteOp[],
      rawSql: string,
    ) => {
      await runWriteHelper("bulkWrite", rawSql, async () => {
        const result: BulkWriteResult = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          ops as BulkWriteOp[],
        );
        return { kind: "bulkWrite", result };
      });
    },
    [runWriteHelper],
  );

  // Sprint 311 — distinct → list QueryResult (1col `value`, N rows).
  // `resultKind: "list"` flags the response so A6 can swap the grid
  // for a vertical list panel.
  const runDocumentDistinct = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      field: string,
      filter: Record<string, unknown> | undefined,
      rawSql: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const values = await distinctDocuments(
          connectionId,
          database,
          collection,
          field,
          filter,
        );
        const queryResult: import("@/types/query").QueryResult = {
          columns: [{ name: "value", data_type: "string", category: "text" }],
          rows: values.map((v) => [v]),
          total_count: values.length,
          execution_time_ms: Date.now() - startTime,
          query_type: "select",
          resultKind: "list",
        };
        completeQuery(tab.id, queryId, queryResult);
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          queryMode: "distinct",
        });
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
        recordHistory({
          sql: rawSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          queryMode: "distinct",
        });
      }
    },
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
  );

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

    // Sprint 311 (Phase 28 Slice A5, 2026-05-14) — document paradigm
    // Run dispatch is now driven by `parseMongoshExpression`. The legacy
    // `JSON.parse(sql)` + `tab.queryMode === "aggregate"` branch is
    // gone; the parsed method discriminator picks the matching IPC
    // wrapper. Free-form tabs (no `tab.collection` binding) inherit the
    // collection from the parsed expression. STOP-tier aggregates still
    // route through `pendingMongoConfirm` with the **parsed pipeline**
    // stored verbatim — confirm-flow re-dispatch is isolated from any
    // editor mutation that happens between prompt and confirm-click.
    if (tab.paradigm === "document") {
      if (!tab.database) {
        updateQueryState(tab.id, {
          status: "error",
          error:
            "Document query tabs require a target database and collection.",
        });
        return;
      }

      const parsed = parseMongoshExpression(sql);
      if (parsed.kind === "error") {
        updateQueryState(tab.id, {
          status: "error",
          error: parsed.message,
        });
        return;
      }

      // AC-311-02 — `tab.collection` is the source of truth when set.
      // Free-form tabs (no binding) fall through to the parsed value.
      // Wording from contract AC-02 verbatim (D-14).
      if (tab.collection && tab.collection !== parsed.collection) {
        updateQueryState(tab.id, {
          status: "error",
          error: `Editor targets collection '${parsed.collection}' but tab is bound to '${tab.collection}'.`,
        });
        return;
      }
      const targetCollection = tab.collection ?? parsed.collection;
      const targetDatabase = tab.database;

      await dispatchMongoshCall(parsed, {
        connectionId: tab.connectionId,
        database: targetDatabase,
        collection: targetCollection,
        rawSql: sql,
      });
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
    //
    // Sprint 311 (Phase 28 Slice A5) — `tab.queryMode` is intentionally
    // ABSENT from the deps. The document branch no longer reads it
    // (parser decides dispatch); the RDB branch always treats the tab
    // as `"sql"`. The field remains on the QueryTab type only for
    // backward-compat with persisted legacy tabs + history filter UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab.id,
    tab.sql,
    tab.queryState.status,
    tab.connectionId,
    tab.paradigm,
    tab.database,
    tab.collection,
    dispatchMongoshCall,
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
      // Sprint 271b — forward the resolved workspace db as the
      // `expectedDatabase` guard. The dry-run preview MUST run on the
      // same db the eventual commit will hit; the backend rejects a
      // swapped pool before the preview rolls back against the wrong db.
      const results = await executeQueryDryRun(
        tab.connectionId,
        statements,
        queryId,
        workspaceDb ?? undefined,
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
      const message = err instanceof Error ? err.message : String(err);
      failQuery(tab.id, queryId, message);
      // Sprint 271b — when the backend rejects with DbMismatch, sync the
      // frontend stores so the next click dispatches against the correct
      // db. Dry-run is user-initiated (toolbar button / Cmd+Shift+Enter)
      // so we surface the Sprint 269 Retry toast just like
      // `runRdbSingleNow`. Background introspection paths stay silent.
      if (parseDbMismatch(message)) {
        const capturedConnectionId = tab.connectionId;
        void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
          toast.warning(
            `Active DB synced to '${actual}'. Re-run the dry-run if needed.`,
          );
        });
      }
    }
    // Excluding store actions from deps is deliberate — see hook header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab.id,
    tab.sql,
    tab.queryState.status,
    tab.connectionId,
    tab.paradigm,
    workspaceDb,
  ]);

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
