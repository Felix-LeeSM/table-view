import { useCallback, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  recordHistoryEntry,
  type DocumentRecordHistoryQueryMode,
} from "@lib/runtime/history/recordHistoryEntry";
import {
  cancelQuery,
  insertDocument,
  insertManyDocuments,
  updateDocument,
  updateMany,
  deleteDocument,
  deleteMany,
  bulkWriteDocuments,
  createMongoIndex,
  dropMongoIndex,
  executeKvCommand,
  executeSearchQuery,
  type CreateMongoIndexRequest,
} from "@lib/tauri";
import { parseRedisDatabaseIndex } from "@lib/redis/redisDatabase";
import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { toast } from "@lib/runtime/toast";
import { getDataSourceProfile } from "@/types/dataSource";
import { DATABASE_TYPE_LABELS } from "@/types/connection";
import type { QueryTab } from "@stores/workspaceStore";
import type { BulkWriteOp, BulkWriteResult } from "@/types/documentMutate";
import { type WriteSummaryData } from "@/types/query";
import type { SearchQueryRequest } from "@/types/search";
import { executeMongoAggregate } from "./mongoDocumentResults";
import { executeMongoQuery } from "./mongoQueryExecution";
import { idOnlyFilter, isRecord } from "./queryHelpers";
import { kvCommandConfirmationKey } from "./kvCommandConfirmation";
import {
  executeRdbDryRun,
  executeRdbQuery,
  executeRdbSingleStatement,
  executeRdbStatementBatch,
  type RdbBatchRunner,
  type RdbSingleRunner,
} from "./rdbQueryExecution";

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
  pendingKvConfirm: {
    command: string;
    database: number | undefined;
    reason: string;
  } | null;
  confirmKvDangerous: () => Promise<void>;
  cancelKvDangerous: () => void;
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

function parseSearchDslRequest(sql: string): SearchQueryRequest {
  const parsed: unknown = JSON.parse(sql);
  if (!isRecord(parsed)) {
    throw new Error("Search DSL request must be a JSON object.");
  }
  const index = parsed.index;
  const body = parsed.body;
  if (typeof index !== "string" || index.trim().length === 0) {
    throw new Error("Search DSL request requires a string index.");
  }
  if (!isRecord(body)) {
    throw new Error("Search DSL request requires an object body.");
  }
  return {
    index,
    body,
    from: numberField(parsed.from),
    size: numberField(parsed.size),
    trackTotalHits:
      typeof parsed.trackTotalHits === "boolean"
        ? parsed.trackTotalHits
        : undefined,
  };
}

function analyzeKvCommandSafety(command: string): StatementAnalysis {
  const verb = command
    .trim()
    .match(/^([A-Za-z]+)/)?.[1]
    ?.toUpperCase();
  if (verb === "KEYS") {
    return {
      kind: "other",
      severity: "danger",
      reasons: ["Redis KEYS scans the full keyspace"],
    };
  }
  return { kind: "other", severity: "info", reasons: [] };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === tab.connectionId)?.dbType,
  );
  const canCancelQuery = dbType
    ? getDataSourceProfile(dbType).capabilities.query.cancel
    : true;
  const canExecuteQuery = dbType
    ? getDataSourceProfile(dbType).capabilities.query.query
    : true;
  const queryProductLabel = dbType
    ? DATABASE_TYPE_LABELS[dbType]
    : "This adapter";
  const wsConnId = tab.connectionId;
  const updateQueryStateAction = useWorkspaceStore((s) => s.updateQueryState);
  const completeQueryAction = useWorkspaceStore((s) => s.completeQuery);
  const completeSearchQueryAction = useWorkspaceStore(
    (s) => s.completeSearchQuery,
  );
  const failQueryAction = useWorkspaceStore((s) => s.failQuery);
  const cancelRunningQueryAction = useWorkspaceStore(
    (s) => s.cancelRunningQuery,
  );
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
  const completeSearchQuery = useCallback(
    (
      tabId: string,
      queryId: string,
      result: Parameters<typeof completeSearchQueryAction>[4],
    ) => {
      completeSearchQueryAction(wsConnId, workspaceDb, tabId, queryId, result);
    },
    [completeSearchQueryAction, wsConnId, workspaceDb],
  );
  const failQuery = useCallback(
    (tabId: string, queryId: string, errorMessage: string) => {
      failQueryAction(wsConnId, workspaceDb, tabId, queryId, errorMessage);
    },
    [failQueryAction, wsConnId, workspaceDb],
  );
  const cancelRunningQuery = useCallback(
    (tabId: string, queryId: string, message: string) => {
      cancelRunningQueryAction(wsConnId, workspaceDb, tabId, queryId, message);
    },
    [cancelRunningQueryAction, wsConnId, workspaceDb],
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
  // method name** instead of the persisted `tab.queryMode`.
  // RDB call sites continue
  // to pass nothing and fall back to `tab.queryMode` (`"sql"`).
  // Backwards-compat: any filter/search consumer that previously matched
  // `queryMode === "aggregate"` keeps working unchanged because aggregate
  // entries still carry `"aggregate"` — only the source of truth flipped
  // from the toggle state to the parser output.
  // Sprint 360 Phase 2 (Q23) — self-window schemaCache invalidate. When a
  // raw RDB dispatch finishes with `queryType === "ddl"` we wipe the
  // connection's entire schema cache (`schemas` / `tables` / `views` /
  // `functions` / `tableColumnsCache` / `triggers`) so the sidebar's
  // `useSchemaCache` re-fetches against the post-DDL backend. Cross-window
  // broadcast (sprint-365) layers on top of this same store action.
  const clearSchemaForConnection = useSchemaStore((s) => s.clearForConnection);
  // sprint-373 (2026-05-17) — `addHistoryEntry` (in-memory) retired.
  // `recordHistoryEntry` 가 (1) `query_history_enabled` 검사 + (2) wire
  // shape normalise + (3) `addOptimisticEntry` 호출을 한 번에 처리한다.
  // tab paradigm 이 `"kv"` / `"search"` 면 여기서 skip
  // (해당 paradigm 의 backend wire 가 미정).
  const recordHistory = useCallback(
    (payload: {
      sql: string;
      executedAt: number;
      duration: number;
      status: "success" | "error" | "cancelled";
      queryMode?: DocumentRecordHistoryQueryMode;
    }) => {
      const common = {
        sql: payload.sql,
        executedAt: payload.executedAt,
        duration: payload.duration,
        status: payload.status,
        source: "raw" as const,
        connectionId: tab.connectionId,
        database: tab.database,
        collection: tab.collection,
        tabId: tab.id,
      };
      if (tab.paradigm === "rdb") {
        recordHistoryEntry({
          ...common,
          paradigm: "rdb",
          queryMode: "sql",
        });
        return;
      }
      if (tab.paradigm !== "document") {
        return;
      }
      recordHistoryEntry({
        ...common,
        paradigm: tab.paradigm,
        queryMode:
          payload.queryMode ??
          (tab.queryMode === "aggregate" ? "aggregate" : "find"),
      });
    },
    [
      tab.connectionId,
      tab.paradigm,
      tab.queryMode,
      tab.database,
      tab.collection,
      tab.id,
    ],
  );

  // Safe Mode danger gate (strict / warn / off). Wraps the paradigm-agnostic
  // `decideSafeModeAction` matrix so the Mongo aggregate path AND the raw
  // RDB single / multi-statement paths share one decision policy.
  // While a warn-tier dialog is open, `pendingMongoConfirm` /
  // `pendingRdbConfirm` retains the exact pipeline / statements + reason
  // so the re-dispatch on confirm runs the same input the user typed.
  const { decide: decideSafeMode } = useSafeModeGate(tab.connectionId, {
    // Fail closed until workspace snapshot hydrates connection metadata.
    missingConnectionEnvironment: "production",
  });
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
  const [pendingKvConfirm, setPendingKvConfirm] = useState<{
    command: string;
    database: number | undefined;
    confirmKey?: string;
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

  const runKvCommandNow = useCallback(
    async (
      command: string,
      database: number | undefined,
      confirmKey?: string,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const result = await executeKvCommand(
          tab.connectionId,
          { command, database, ...(confirmKey ? { confirmKey } : {}) },
          queryId,
        );
        completeQuery(tab.id, queryId, result);
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [tab.id, tab.connectionId, updateQueryState, completeQuery, failQuery],
  );

  const confirmKvDangerous = useCallback(async () => {
    const pending = pendingKvConfirm;
    if (!pending) return;
    setPendingKvConfirm(null);
    await runKvCommandNow(
      pending.command,
      pending.database,
      pending.confirmKey,
    );
  }, [pendingKvConfirm, runKvCommandNow]);

  const cancelKvDangerous = useCallback(() => {
    setPendingKvConfirm(null);
  }, []);

  // Aggregate dispatch + book-keeping, extracted so the warn-confirm
  // dialog can re-enter the same path with the pending pipeline. Mirrors
  // the inline find branch (running-set → dispatch → adapt → complete →
  // history) but for the document aggregate seam.
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
      await executeMongoAggregate({
        tab,
        pipeline,
        collectionOverride,
        updateQueryState,
        completeQuery,
        failQuery,
        recordHistory,
      });
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
  const runRdbSingleRef = useRef<RdbSingleRunner | null>(null);
  const runRdbBatchRef = useRef<RdbBatchRunner | null>(null);

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
      await executeRdbSingleStatement({
        tab,
        stmt,
        workspaceDb,
        updateQueryState,
        completeQuery,
        failQuery,
        cancelRunningQuery,
        clearSchemaForConnection,
        recordHistory,
        findLiveIdleTab,
        runRdbSingleRef,
      });
    },
    [
      tab,
      workspaceDb,
      updateQueryState,
      completeQuery,
      failQuery,
      cancelRunningQuery,
      recordHistory,
      findLiveIdleTab,
      clearSchemaForConnection,
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
      await executeRdbStatementBatch({
        tab,
        statements,
        joinedSql,
        workspaceDb,
        updateQueryState,
        cancelRunningQuery,
        completeMultiStatementQuery,
        clearSchemaForConnection,
        recordHistory,
        findLiveIdleTab,
        runRdbBatchRef,
      });
    },
    [
      tab,
      workspaceDb,
      updateQueryState,
      completeMultiStatementQuery,
      cancelRunningQuery,
      recordHistory,
      findLiveIdleTab,
      clearSchemaForConnection,
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
      queryMode: DocumentRecordHistoryQueryMode,
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
          totalCount: 0,
          executionTimeMs: Date.now() - startTime,
          queryType: "select",
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
          true,
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
          true,
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
          true,
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
          true,
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
          true,
        );
        return { kind: "bulkWrite", result };
      });
    },
    [runWriteHelper],
  );

  const runReplaceOne = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      op: Extract<BulkWriteOp, { op: "replaceOne" }>,
      rawSql: string,
    ) => {
      await runWriteHelper("replaceOne", rawSql, async () => {
        const result: BulkWriteResult = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [op],
          true,
        );
        return { kind: "bulkWrite", result };
      });
    },
    [runWriteHelper],
  );

  const runMongoIndexHelper = useCallback(
    async (
      queryMode: "createIndex" | "dropIndex",
      rawSql: string,
      writer: () => Promise<string>,
    ) => {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const indexName = await writer();
        const queryResult: import("@/types/query").QueryResult = {
          columns: [
            { name: "operation", dataType: "string", category: "text" },
            { name: "index", dataType: "string", category: "text" },
          ],
          rows: [[queryMode, indexName]],
          totalCount: 1,
          executionTimeMs: Date.now() - startTime,
          queryType: "ddl",
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

  const runCreateIndex = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      request: CreateMongoIndexRequest,
      rawSql: string,
    ) => {
      await runMongoIndexHelper("createIndex", rawSql, async () => {
        const result = await createMongoIndex(
          connectionId,
          database,
          collection,
          request,
        );
        return result.name;
      });
    },
    [runMongoIndexHelper],
  );

  const runDropIndex = useCallback(
    async (
      connectionId: string,
      database: string,
      collection: string,
      indexName: string,
      rawSql: string,
    ) => {
      await runMongoIndexHelper("dropIndex", rawSql, async () => {
        await dropMongoIndex(
          connectionId,
          database,
          collection,
          indexName,
          true,
        );
        return indexName;
      });
    },
    [runMongoIndexHelper],
  );

  const handleExecute = useCallback(async () => {
    const sql = tab.sql.trim();
    if (!sql) return;

    // If already running, cancel
    if (tab.queryState.status === "running") {
      if (!canCancelQuery) return;
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

    if (tab.paradigm === "kv") {
      if (!canExecuteQuery) {
        updateQueryState(tab.id, {
          status: "error",
          error: `${queryProductLabel} command query is not supported yet.`,
        });
        return;
      }

      let database: number | undefined;
      try {
        database = parseRedisDatabaseIndex(workspaceDb);
      } catch (err) {
        updateQueryState(tab.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const decision = decideSafeMode(analyzeKvCommandSafety(sql));
      const confirmKey = kvCommandConfirmationKey(sql);
      if (decision.action === "confirm") {
        setPendingKvConfirm({
          command: sql,
          database,
          confirmKey,
          reason: decision.reason,
        });
        return;
      }
      if (decision.action === "block") {
        updateQueryState(tab.id, { status: "error", error: decision.reason });
        return;
      }
      await runKvCommandNow(sql, database, confirmKey);
      return;
    }

    if (tab.paradigm === "search") {
      let request: SearchQueryRequest;
      try {
        request = parseSearchDslRequest(sql);
      } catch (err) {
        updateQueryState(tab.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const queryId = `${tab.id}-${Date.now()}`;
      updateQueryState(tab.id, { status: "running", queryId });
      try {
        const result = await executeSearchQuery(
          tab.connectionId,
          request,
          queryId,
        );
        completeSearchQuery(tab.id, queryId, result);
      } catch (err) {
        failQuery(
          tab.id,
          queryId,
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    }

    if (tab.paradigm === "document") {
      await executeMongoQuery({
        tab,
        sql,
        decideSafeMode,
        updateQueryState,
        completeQuery,
        failQuery,
        recordHistory,
        setPendingMongoConfirm,
        setPendingMongoWarn,
        pendingWriteRunnerRef,
        runMongoAggregate: runMongoAggregateNow,
        runInsertOne,
        runInsertMany,
        runDeleteMany,
        runUpdateMany,
        runDeleteOne,
        runUpdateOne,
        runReplaceOne,
        runBulkWrite,
        runCreateIndex,
        runDropIndex,
      });
      return;
    }

    await executeRdbQuery({
      tab,
      sql,
      dbType,
      decideSafeMode,
      updateQueryState,
      recordHistory,
      setPendingRdbConfirm,
      setPendingRdbWarn,
      runRdbSingle: runRdbSingleNow,
      runRdbBatch: runRdbBatchNow,
    });
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
    workspaceDb,
    canCancelQuery,
    canExecuteQuery,
    dbType,
    queryProductLabel,
    decideSafeMode,
    completeQuery,
    completeSearchQuery,
    failQuery,
    recordHistory,
    updateQueryState,
    runKvCommandNow,
    runMongoAggregateNow,
    runInsertOne,
    runInsertMany,
    runDeleteMany,
    runUpdateMany,
    runDeleteOne,
    runUpdateOne,
    runReplaceOne,
    runBulkWrite,
    runCreateIndex,
    runDropIndex,
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

    await executeRdbDryRun({
      tab,
      dbType,
      workspaceDb,
      updateQueryState,
      completeQueryDryRun,
      failQuery,
    });
    // Excluding store actions from deps is deliberate — see hook header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    tab.paradigm,
    workspaceDb,
    dbType,
    updateQueryState,
    completeQueryDryRun,
    failQuery,
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
    pendingKvConfirm,
    confirmKvDangerous,
    cancelKvDangerous,
    pendingRdbWarn,
    confirmRdbWarn,
    cancelRdbWarn,
    pendingMongoWarn,
    confirmMongoWarn,
    cancelMongoWarn,
  };
}
