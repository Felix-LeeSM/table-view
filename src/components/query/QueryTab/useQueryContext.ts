import { useCallback, useMemo } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  recordHistoryEntry,
  type DocumentRecordHistoryQueryMode,
} from "@lib/runtime/history/recordHistoryEntry";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { getDataSourceProfile } from "@/types/dataSource";
import { DATABASE_TYPE_LABELS } from "@/types/connection";
import type { DatabaseType } from "@/types/connection";
import type { QueryTab } from "@stores/workspaceStore";
import type { RdbHistoryOverrides } from "./rdbQueryExecution";

/**
 * Issue #1230 — DBMS whose adapter implements native (server-side) cancel,
 * i.e. `execute_query` captures a server pid the Cancel button can pass to
 * `cancelQueryNative` (pg `pg_cancel_backend` / mysql `KILL QUERY`). Every
 * other cancel-capable DBMS keeps only the cooperative token.
 *
 * Issue #1269 — mongo is now promoted. Unlike RDB (which captures a server
 * pid into `query_server_pids` at execute time), mongo has no client-visible
 * opid, so its query-tab runners (`find` / `aggregate` / `run_mongo_command`)
 * stamp the op with `command.comment == queryId`. Native cancel routes through
 * the tag path (`cancelQueryNative(conn, 0, queryId)` → `cancel_query_by_tag`
 * → `$currentOp` match → `killOp`) rather than the pid path. The Cancel branch
 * in `useQueryExecution` dispatches the tag route for `dbType === "mongodb"`.
 *
 * Derived from `dbType` rather than a new capability field: it is a fixed
 * small-value check the adapter side already fixes (`execute_sql_tracked`
 * overrides), and expanding the capability contract across ~13 profiles buys
 * nothing here.
 */
export function supportsNativeCancel(
  dbType: DatabaseType | null | undefined,
): boolean {
  return (
    dbType === "postgresql" ||
    dbType === "mysql" ||
    dbType === "mariadb" ||
    dbType === "mongodb"
  );
}

/**
 * `useQueryContext` — `useQueryExecution` 의 "context substrate" 추출
 * (docs/ROADMAP.md H1 후속 `useQueryExecution decomposition`). connection/db
 * 식별자에 바인딩된 store-action 래퍼 7개, capability 파생, history-record
 * 팩토리, Safe Mode 게이트를 한 곳에 모은다.
 *
 * paradigm dispatch runner / confirmation state 는 호출자(`useQueryExecution`)가
 * 계속 소유한다 — 본 hook 은 부수효과 없는 substrate 만 제공한다.
 *
 * 동작 보존: 추출한 모든 `useMemo`/`useCallback`/store-subscription 의 deps 와
 * 호출 순서는 inline 버전과 byte-for-byte 동일하다. hook 호출 순서가 보존되도록
 * `useQueryExecution` 본체의 첫 hook 호출로 사용해야 한다.
 */
export function useQueryContext(tab: QueryTab) {
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
  // Issue #1230 — does this DBMS have a native server-side cancel path?
  const canNativeCancel = supportsNativeCancel(dbType);
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
  const setRunningQueryServerPidAction = useWorkspaceStore(
    (s) => s.setRunningQueryServerPid,
  );
  const setRunningQueryServerPid = useCallback(
    (tabId: string, queryId: string, serverPid: number) => {
      setRunningQueryServerPidAction(
        wsConnId,
        workspaceDb,
        tabId,
        queryId,
        serverPid,
      );
    },
    [setRunningQueryServerPidAction, wsConnId, workspaceDb],
  );
  const completeQuery = useCallback(
    (
      tabId: string,
      queryId: string,
      result: Parameters<typeof completeQueryAction>[4],
      sql?: Parameters<typeof completeQueryAction>[5],
    ) => {
      completeQueryAction(wsConnId, workspaceDb, tabId, queryId, result, sql);
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
      sql?: Parameters<typeof completeQueryDryRunAction>[6],
    ) => {
      completeQueryDryRunAction(
        wsConnId,
        workspaceDb,
        tabId,
        queryId,
        result,
        statements,
        sql,
      );
    },
    [completeQueryDryRunAction, wsConnId, workspaceDb],
  );

  const clearSchemaForConnection = useSchemaStore((s) => s.clearForConnection);
  const fileAnalyticsSources = useSchemaStore(
    (s) => s.fileAnalyticsSources[tab.connectionId],
  );
  const recordHistory = useCallback(
    (payload: {
      sql: string;
      executedAt: number;
      duration: number;
      status: "success" | "error" | "cancelled";
      queryMode?: DocumentRecordHistoryQueryMode;
      source?: RdbHistoryOverrides["source"];
      collection?: RdbHistoryOverrides["collection"];
    }) => {
      const common = {
        sql: payload.sql,
        executedAt: payload.executedAt,
        duration: payload.duration,
        status: payload.status,
        source: payload.source ?? ("raw" as const),
        connectionId: tab.connectionId,
        database: tab.database,
        collection: payload.collection ?? tab.collection,
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
      if (tab.paradigm === "document") {
        recordHistoryEntry({
          ...common,
          paradigm: "document",
          queryMode:
            payload.queryMode ??
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- #1403: QueryTab.queryMode is intentional migration debt, removed when sprint-311 A5 lands
            (tab.queryMode === "aggregate" ? "aggregate" : "find"),
        });
        return;
      }
      // Issue #1171 — kv / search record with a paradigm-only entry; the
      // backend fixes the query mode (`command` / `dsl`).
      recordHistoryEntry({ ...common, paradigm: tab.paradigm });
    },
    [
      tab.connectionId,
      tab.paradigm,
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- #1403: QueryTab.queryMode is intentional migration debt, removed when sprint-311 A5 lands
      tab.queryMode,
      tab.database,
      tab.collection,
      tab.id,
    ],
  );

  const { decide: decideSafeMode } = useSafeModeGate(tab.connectionId);

  return {
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
  };
}
