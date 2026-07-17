import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { cancelQuery, cancelQueryNative, getQueryServerPid } from "@lib/tauri";
import { toast } from "@lib/runtime/toast";
import type { QueryTab } from "@stores/workspaceStore";
import type { ConnectionId, TabId } from "@/types/branded";
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
  type RdbHistoryOverrides,
  type RdbBatchRunner,
  type RdbSingleRunner,
} from "./rdbQueryExecution";
import { executeSearchDslQuery } from "./searchQueryExecution";
import { useQueryContext } from "./useQueryContext";

import { logger } from "@lib/logger";

export interface UseQueryExecutionArgs {
  tab: QueryTab;
}

// Issue #1230 — read the native server pid off the *live* running tab. The
// pid is recorded a beat after the query starts (status stays "running"), so
// the Cancel callback's closed-over `tab` is stale; the store is the source
// of truth. Walks the connection's workspaces because the tab may have moved
// db slots mid-flight (mirrors `findLiveIdleTab`).
function readRunningServerPid(
  connectionId: string,
  tabId: string,
  queryId: string,
): number | undefined {
  const conns = useWorkspaceStore.getState().workspaces[connectionId];
  if (!conns) return undefined;
  for (const ws of Object.values(conns)) {
    const found = ws?.tabs.find((t) => t.id === tabId);
    if (!found || found.type !== "query") continue;
    const qs = found.queryState;
    if (qs.status === "running" && qs.queryId === queryId) {
      return qs.serverPid;
    }
  }
  return undefined;
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
  // Sprint follow-up (docs/ROADMAP.md H1) — connection/db 식별자에 바인딩된
  // store-action 래퍼, capability 파생, history-record 팩토리, Safe Mode 게이트는
  // `useQueryContext` substrate 로 추출됐다. 본 hook 은 paradigm dispatch runner +
  // confirmation state 만 소유한다. 추출 코드는 deps/호출순서 byte-for-byte 보존.
  const {
    workspaceDb,
    dbType,
    canCancelQuery,
    canNativeCancel,
    canExecuteQuery,
    queryProductLabel,
    updateQueryState,
    setRunningQueryServerPid,
    completeQuery,
    completeSearchQuery,
    failQuery,
    cancelRunningQuery,
    completeMultiStatementQuery,
    completeQueryDryRun,
    clearSchemaForConnection,
    fileAnalyticsSources,
    recordHistory,
    decideSafeMode,
  } = useQueryContext(tab);
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
        recordHistory,
      });
    },
    [tab, updateQueryState, completeQuery, failQuery, recordHistory],
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
        cancelRunningQuery,
        recordHistory,
      });
    },
    [
      tab,
      recordHistory,
      completeQuery,
      failQuery,
      cancelRunningQuery,
      updateQueryState,
    ],
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
    (connectionId: ConnectionId, tabId: TabId): QueryTab | null => {
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
    async (
      stmt: string,
      history?: RdbHistoryOverrides,
      safetyConfirmed?: boolean,
    ) => {
      await executeRdbSingleStatement({
        tab,
        stmt,
        history,
        workspaceDb,
        updateQueryState,
        completeQuery,
        failQuery,
        cancelRunningQuery,
        clearSchemaForConnection,
        recordHistory,
        findLiveIdleTab,
        runRdbSingleRef,
        safetyConfirmed,
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
    async (
      statements: string[],
      joinedSql: string,
      safetyConfirmed?: boolean,
    ) => {
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
        safetyConfirmed,
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
    // Issue #1112 — the user cleared the destructive confirm dialog; forward
    // the proof so the backend Safe Mode gate lets the statement through.
    if (pending.statements.length === 1) {
      await runRdbSingleNow(pending.statements[0]!, undefined, true);
      return;
    }
    await runRdbBatchNow(
      pending.statements,
      pending.statements.join(";\n"),
      true,
    );
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

  // Issue #1230 — once a native-cancel DBMS enters the running state, fetch
  // the executing backend's server pid and stash it on the running tab so the
  // Cancel button can issue a server-side abort. The backend fetch resolves
  // while the query is still in flight (that is the point — long queries), and
  // is a no-op fallback (null) for adapters without a native path.
  const runningQueryId =
    tab.queryState.status === "running" ? tab.queryState.queryId : null;
  useEffect(() => {
    if (!runningQueryId || !canNativeCancel) return;
    // Issue #1269 — mongo cancels via the comment tag (queryId), not a pid, so
    // the pid fetch is a guaranteed null no-op; skip the pointless round-trip.
    if (dbType === "mongodb") return;
    let active = true;
    void (async () => {
      try {
        const pid = await getQueryServerPid(runningQueryId);
        if (active && pid != null) {
          setRunningQueryServerPid(tab.id, runningQueryId, pid);
        }
      } catch {
        // pid fetch failed — keep cooperative cancel, no native pid. Never
        // let a pid-lookup fault surface to the user.
      }
    })();
    return () => {
      active = false;
    };
  }, [
    runningQueryId,
    canNativeCancel,
    setRunningQueryServerPid,
    tab.id,
    dbType,
  ]);

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
      const { queryId } = tab.queryState;
      // Issue #1230 (PR #1241 review) — fire the cooperative token FIRST. It
      // flips the backend CancellationToken, which the executor's
      // `tokio::select!` observes immediately and returns the canonical
      // "Query cancelled" → the frontend cancelled-state. Firing native first
      // let a fast `KILL QUERY` end the statement as ER_QUERY_INTERRUPTED (or
      // a spurious SLEEP success) before the token branch won the select!, so
      // mysql/mariadb never reached cancelled-state (PG only slipped through
      // because 57014 maps to a cancelled message). backend `finalize_cancelled`
      // now also converges any raced outcome, but ordering keeps the common
      // path race-free.
      try {
        await cancelQuery(queryId);
      } catch (err) {
        // Most cancel failures are benign races: the query finished between
        // the user clicking Cancel and the IPC dispatch (backend returns
        // NotFound for an unregistered token). Surface via dev logger so a
        // genuine IPC/backend regression isn't silent — store-side
        // stale-response guards already handle state transition.
        logger.warn("cancelQuery failed (likely already completed):", err);
      }
      // Then native: tear down the actual server-side backend so a long query
      // (pg_sleep, big JOIN) doesn't keep consuming server resources after the
      // client gave up.
      if (canNativeCancel) {
        if (dbType === "mongodb") {
          // Issue #1269 — mongo has no client-visible pid; the running op is
          // tagged with `command.comment == queryId`, so cancel routes through
          // the tag path (`cancelQueryNative(conn, 0, queryId)` →
          // `cancel_query_by_tag` → `$currentOp` match → `killOp`).
          try {
            await cancelQueryNative(tab.connectionId, 0, queryId);
          } catch (err) {
            logger.warn(
              "cancelQueryNative (mongo tag) failed (likely already completed):",
              err,
            );
          }
        } else {
          // RDB pid path — the pid is read live from the store (recorded after
          // this closure captured `tab`).
          const serverPid = readRunningServerPid(
            tab.connectionId,
            tab.id,
            queryId,
          );
          if (serverPid != null) {
            try {
              await cancelQueryNative(tab.connectionId, serverPid);
            } catch (err) {
              logger.warn(
                "cancelQueryNative failed (likely already completed):",
                err,
              );
            }
          }
        }
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
        recordHistory,
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
        cancelRunningQuery,
        failQuery,
        recordHistory,
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
        cancelRunningQuery,
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
      fileAnalyticsSources,
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
    canNativeCancel,
    canExecuteQuery,
    dbType,
    fileAnalyticsSources,
    queryProductLabel,
    decideSafeMode,
    cancelRunningQuery,
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
    // #1049 — Dry-run is rdb-only: it wraps the statement in a
    // transaction that is unconditionally rolled back, which has no
    // kv/search/document equivalent. The Toolbar hides the button off the
    // rdb paradigm, but ⌘⇧⏎ routes every editor into this handler, so this
    // paradigm gate is the single shared judgment both the button and the
    // shortcut pass through. Gating on `document` alone let kv/search fall
    // through to the rdb dry-run IPC.
    if (tab.paradigm !== "rdb") {
      toast.info(
        tab.paradigm === "document"
          ? "Dry-run is not supported for MongoDB."
          : "Dry-run is only available for SQL databases.",
      );
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
