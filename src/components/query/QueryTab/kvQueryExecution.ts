import { executeKvCommand } from "@lib/tauri";
import { parseRedisDatabaseIndex } from "@lib/redis/redisDatabase";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import type { QueryResult, QueryState } from "@/types/query";
import type { QueryTab } from "@stores/workspaceStore";
import { kvCommandConfirmationKey } from "./kvCommandConfirmation";

export interface PendingKvConfirmation {
  command: string;
  database: number | undefined;
  confirmKey?: string;
  reason: string;
}

type KvTabContext = Pick<QueryTab, "id" | "connectionId">;

interface KvLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
}

export interface ExecuteKvCommandNowRequest extends KvLifecycleActions {
  tab: KvTabContext;
  command: string;
  database: number | undefined;
  confirmKey?: string;
}

export interface ExecuteKvQueryRequest extends KvLifecycleActions {
  tab: KvTabContext;
  sql: string;
  workspaceDb: string | null | undefined;
  canExecuteQuery: boolean;
  queryProductLabel: string;
  decideSafeMode: SafeModeGate["decide"];
  setPendingKvConfirm: (pending: PendingKvConfirmation) => void;
}

export function analyzeKvCommandSafety(command: string): StatementAnalysis {
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

export async function executeKvCommandNow({
  tab,
  command,
  database,
  confirmKey,
  updateQueryState,
  completeQuery,
  failQuery,
}: ExecuteKvCommandNowRequest): Promise<void> {
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
}

export async function executeKvQuery({
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
}: ExecuteKvQueryRequest): Promise<void> {
  if (!canExecuteQuery) {
    updateQueryState(tab.id, {
      status: "error",
      error: `${queryProductLabel} command query is not supported yet.`,
    });
    return;
  }

  let database: number | undefined;
  try {
    database = parseRedisDatabaseIndex(workspaceDb ?? undefined);
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

  await executeKvCommandNow({
    tab,
    command: sql,
    database,
    confirmKey,
    updateQueryState,
    completeQuery,
    failQuery,
  });
}
