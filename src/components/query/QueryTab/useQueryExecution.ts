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
 * `QueryTab` 의 query execution + mongo aggregate danger gate 캡슐화.
 *
 * 책임:
 *   - `handleExecute` — Run/Cancel 버튼 핸들러. 4 분기를 한 곳에서:
 *     1. 이미 running 이면 cancel.
 *     2. document paradigm + find/aggregate.
 *     3. SQL single statement.
 *     4. SQL multi-statement (Sprint 100 — 순차 실행 + per-statement
 *        breakdown).
 *   - `runMongoAggregateNow` — aggregate dispatch + queryState/history
 *     book-keeping. warn-confirm 경로가 같은 함수로 재진입.
 *   - `confirmMongoDangerous` / `cancelMongoDangerous` — Sprint 188
 *     warn-tier dialog handlers.
 *   - `pendingMongoConfirm` state — pipeline + reason 보존 (dialog 가
 *     열려 있는 동안).
 *
 * Sprint 201 에서 entry 로부터 추출. 동작 0 변경. deps 억제 (Sprint 25
 * 정책 — keyboard shortcut layer ref staleness 회피) 1곳 보존.
 * cancelQuery 의 빈 catch 는 dev-only logger.warn 으로 대체 — race vs
 * 진짜 backend regression 구분 가능.
 *
 * 외부 invariant:
 * - Sprint 132 raw-query DB-change detection ("verify 실패 ≠ query 실패")
 *   — `dispatchDbMutationHint` 가 fire-and-forget. SQL single + multi
 *   양쪽 path 의 `await executeQuery` 직후 호출.
 * - Sprint 188 mongo aggregate 3-tier gate (block / confirm / off) —
 *   running-state set 이전에 실행. block / confirm 결정은 tab 을 running
 *   상태로 strand 시키지 않음.
 * - Sprint 195 intent-revealing query lifecycle actions — completeQuery /
 *   failQuery / completeMultiStatementQuery 의 stale-response guard 가
 *   running queryId 매칭 시에만 transition (store action 측 보장).
 * - Sprint 100 multi-statement — 마지막 success result 를 grid 에 노출
 *   + per-statement breakdown 별도 보존. allFailed → error transition.
 *   history entry 의 status 는 "any failed" 기준 (partial failure 도
 *   destructive marker).
 * - deps 억제 (`react-hooks/exhaustive-deps`) — Sprint 25 부터 동결된
 *   stale-closure 회피 정책. addHistoryEntry / updateQueryState 등을
 *   의도적으로 deps 에서 제외 (handler 가 매 store 변화에 재생성되면
 *   keyboard shortcut layer 의 ref 가 stale 됨).
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
  // Sprint 195 — intent-revealing query lifecycle actions. They replace the
  // 7 inline `useTabStore.setState` sites previously inlined here. Their
  // guards (running queryId match) are equivalent to the inlined version,
  // so stale-response semantics are preserved.
  const completeQuery = useTabStore((s) => s.completeQuery);
  const failQuery = useTabStore((s) => s.failQuery);
  const completeMultiStatementQuery = useTabStore(
    (s) => s.completeMultiStatementQuery,
  );
  // Sprint 212 — cross-store coupling 제거. 사전에는 `useTabStore.recordHistory`
  // action 안에서 tab 객체로부터 paradigm/queryMode/database/collection 을
  // 자동 추출 + `useQueryHistoryStore.addHistoryEntry({...})` 를 호출했지만,
  // store 행위에서 cross-store side effect 가 빠지면서 caller (이 hook) 가
  // 동일 payload 모양을 직접 구성한다. `tab` 은 hook arg 로 보유 — store-side
  // 와 동일한 데이터를 본다.
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  // 8 call site 가 동일 mood 의 payload 를 만들어 보낸다. closure 로 묶어
  // 호출 사이트가 가변 필드 (sql / executedAt / duration / status) 만
  // 책임지게. 사전 store-side 의미 (Sprint 195 + 196 default `source: "raw"`)
  // 보존.
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
      // Sprint 132 — DB-change detection runs after the awaited execute
      // resolves, regardless of success/error. We call it from outside the
      // try/catch so a thrown query error doesn't bypass the lex pass —
      // `\c another_db` may surface as a PG syntax error but still flips
      // the active pool on the backend, so the optimistic update + verify
      // round-trip is still meaningful. The helper itself never throws.
      dispatchDbMutationHint(tab.connectionId, tab.paradigm, sql);
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

    // Sprint 195 — multi-statement final transition delegated to a single
    // intent action. allFailed → error (with joined message); otherwise
    // completed with `lastResult` + per-statement breakdown.
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
      // History entry status reflects whether *any* statement failed —
      // partial failure still surfaces a destructive marker in the
      // history list so users can spot it without opening the tab.
      status: successCount === statements.length ? "success" : "error",
    });
    // Sprint 132 — same hook as the single-statement path. Multi-statement
    // input feeds the full SQL through the lexer, which already takes the
    // last match (sprint contract — "마지막만"). So a script ending in
    // `... ; \c admin` flips active_db to "admin" and verifies once.
    dispatchDbMutationHint(tab.connectionId, tab.paradigm, sql);
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

  return {
    handleExecute,
    pendingMongoConfirm,
    confirmMongoDangerous,
    cancelMongoDangerous,
  };
}
