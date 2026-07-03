import { executeKvCommand } from "@lib/tauri";
import { parseRedisDatabaseIndex } from "@lib/redis/redisDatabase";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import type { QueryResult, QueryState } from "@/types/query";
import type { QueryTab } from "@stores/workspaceStore";
import {
  KV_CONFIRM_COMMANDS,
  kvCommandConfirmationKey,
} from "./kvCommandConfirmation";

export interface PendingKvConfirmation {
  command: string;
  database: number | undefined;
  confirmKey?: string;
  reason: string;
}

type KvTabContext = Pick<QueryTab, "id" | "connectionId">;

/** Issue #1171 — KV execution history payload (paradigm/queryMode resolved by
 * the `recordHistory` factory in `useQueryContext`). */
export interface KvHistoryPayload {
  sql: string;
  executedAt: number;
  duration: number;
  status: "success" | "error" | "cancelled";
}

interface KvLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
  recordHistory: (payload: KvHistoryPayload) => void;
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
  // Issue #1120 — `danger` here is the confirm-dialog lever, NOT an
  // "irreversible destruction" verdict: the KV path has no warn→confirm
  // surface, so mirroring the backend's `required_confirmation_key` set
  // (KEYS pattern-confirm + DEL/PERSIST key-confirm) onto `danger` is what
  // routes these to the same confirm dialog SQL destructive statements use.
  // KEYS (scan) and PERSIST (TTL removal) are not destructive; they ride
  // `danger` only for the confirm gate. Everything else is info; the backend
  // command allowlist remains the real safety boundary.
  const reason = verb ? KV_CONFIRM_COMMANDS[verb] : undefined;
  if (reason) {
    return { kind: "other", severity: "danger", reasons: [reason] };
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
  recordHistory,
}: ExecuteKvCommandNowRequest): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  updateQueryState(tab.id, { status: "running", queryId });
  try {
    const result = await executeKvCommand(
      tab.connectionId,
      { command, database, ...(confirmKey ? { confirmKey } : {}) },
      queryId,
    );
    completeQuery(tab.id, queryId, result);
    recordHistory({
      sql: command,
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
      sql: command,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
    });
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
  recordHistory,
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
    recordHistory,
  });
}
