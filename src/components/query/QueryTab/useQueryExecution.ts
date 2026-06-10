import { useCallback, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  recordHistoryEntry,
  type DocumentRecordHistoryQueryMode,
} from "@lib/runtime/history/recordHistoryEntry";
import { cancelQuery } from "@lib/tauri";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { toast } from "@lib/runtime/toast";
import { getDataSourceProfile } from "@/types/dataSource";
import { DATABASE_TYPE_LABELS } from "@/types/connection";
import type { QueryTab } from "@stores/workspaceStore";
import { createMongoWriteDispatchers } from "@features/query";
import {
  executeKvCommandNow,
  executeKvQuery,
  type PendingKvConfirmation,
} from "./kvQueryExecution";
import { executeMongoAggregate } from "./mongoDocumentResults";
import { executeMongoQuery } from "./mongoQueryExecution";
import {
  executeRdbDryRun,
  executeRdbQuery,
  executeRdbSingleStatement,
  executeRdbStatementBatch,
  type RdbBatchRunner,
  type RdbSingleRunner,
} from "./rdbQueryExecution";
import { executeSearchDslQuery } from "./searchQueryExecution";

import { logger } from "@lib/logger";

export interface UseQueryExecutionArgs {
  tab: QueryTab;
}

export interface QueryExecution {
  handleExecute: () => Promise<void>;
  handleDryRun: () => Promise<void>;
  pendingMongoConfirm: {
    pipeline: Record<string, unknown>[];
    reason: string;
    previewLines?: string[];
  } | null;
  confirmMongoDangerous: () => Promise<void>;
  cancelMongoDangerous: () => void;
  pendingRdbConfirm: {
    statements: string[];
    reason: string;
  } | null;
  confirmRdbDangerous: () => Promise<void>;
  cancelRdbDangerous: () => void;
  pendingKvConfirm: {
    command: string;
    database: number | undefined;
    confirmKey?: string;
    reason: string;
  } | null;
  confirmKvDangerous: () => Promise<void>;
  cancelKvDangerous: () => void;
  pendingRdbWarn: {
    statements: string[];
  } | null;
  confirmRdbWarn: () => Promise<void>;
  cancelRdbWarn: () => void;
  pendingMongoWarn: {
    pipeline: Record<string, unknown>[];
    previewLines?: string[];
  } | null;
  confirmMongoWarn: () => Promise<void>;
  cancelMongoWarn: () => void;
}

export function useQueryExecution({
  tab,
}: UseQueryExecutionArgs): QueryExecution {
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

  const clearSchemaForConnection = useSchemaStore((s) => s.clearForConnection);
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

  const { decide: decideSafeMode } = useSafeModeGate(tab.connectionId, {
    missingConnectionEnvironment: "production",
  });
  const [pendingMongoConfirm, setPendingMongoConfirm] = useState<{
    pipeline: Record<string, unknown>[];
    reason: string;
    previewLines?: string[];
  } | null>(null);
  const pendingWriteRunnerRef = useRef<(() => Promise<void>) | null>(null);
  const [pendingRdbConfirm, setPendingRdbConfirm] = useState<{
    statements: string[];
    reason: string;
  } | null>(null);
  const [pendingKvConfirm, setPendingKvConfirm] =
    useState<PendingKvConfirmation | null>(null);
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
      await executeKvCommandNow({
        tab,
        command,
        database,
        confirmKey,
        updateQueryState,
        completeQuery,
        failQuery,
      });
    },
    [tab, updateQueryState, completeQuery, failQuery],
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

  const mongoWriteDispatchers = useMemo(
    () =>
      createMongoWriteDispatchers({
        tabId: tab.id,
        updateQueryState,
        completeQuery,
        failQuery,
        recordHistory,
      }),
    [tab.id, updateQueryState, completeQuery, failQuery, recordHistory],
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
      await executeKvQuery({
        tab,
        sql,
        workspaceDb,
        canExecuteQuery,
        queryProductLabel,
        decideSafeMode,
        updateQueryState,
        completeQuery,
        failQuery,
        setPendingKvConfirm,
      });
      return;
    }

    if (tab.paradigm === "search") {
      await executeSearchDslQuery({
        tab,
        sql,
        updateQueryState,
        completeSearchQuery,
        failQuery,
      });
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
        ...mongoWriteDispatchers,
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
    // Store-action deps are excluded because keyboard execution keeps a stable ref.
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
    mongoWriteDispatchers,
    runRdbSingleNow,
    runRdbBatchNow,
  ]);

  const handleDryRun = useCallback(async () => {
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
    // Store-action deps are excluded because keyboard execution keeps a stable ref.
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
