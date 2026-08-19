import type { SafeModeGate } from "@hooks/useSafeModeGate";
import { parseRedisDatabaseIndex } from "@lib/redis/redisDatabase";
import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import { executeKvCommand } from "@lib/tauri";
import type { QueryTab } from "@stores/workspaceStore";
import type { QueryResult, QueryState } from "@/types/query";
import {
  KV_CONFIRM_COMMANDS,
  kvCommandConfirmationKey,
  kvDataLossReason,
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
}

export interface ExecuteConfirmedKvCommandRequest extends KvLifecycleActions {
  tab: KvTabContext;
  confirmation: PendingKvConfirmation;
}

interface DispatchKvCommandRequest extends KvLifecycleActions {
  tab: KvTabContext;
  command: string;
  database: number | undefined;
  confirmKey: string | undefined;
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
  // command allowlist bounds which commands exist at all.
  //
  // Issue #2421 — this severity is *not* what puts DEL behind the dialog. The
  // Safe Mode matrix hands `danger` back as `allow` on a non-production
  // connection under mode `warn` (the shipped default), so the data-loss gate
  // in `executeKvQuery` / `executeKvCommandNow` reads `kvDataLossReason`
  // instead of this tier. Tier assignment stays untouched (ADR 0022 / 0023).
  const entry = verb ? KV_CONFIRM_COMMANDS[verb] : undefined;
  if (entry) {
    return { kind: "other", severity: "danger", reasons: [entry.reason] };
  }
  return { kind: "other", severity: "info", reasons: [] };
}

/**
 * Issue #2421 — dispatch a command the user was never asked about.
 *
 * A command `kvDataLossReason` names is refused here rather than sent — today
 * that predicate names `DEL` and nothing else. The backend's
 * `require_confirm_key` gate compares the request's key against the key it
 * parsed out of the same command string, so any caller can satisfy it by
 * deriving the key from the command text — which is exactly what this seam used
 * to do on the no-dialog path, leaving `DEL k` to run silently on the shipped
 * default. The guard sits inside the dispatch instead of at each call site so a
 * branch added later fails closed: forgetting the dialog produces a refusal,
 * not a deletion. Getting a command that predicate names through requires
 * `executeConfirmedKvCommand`, which only a cleared dialog reaches.
 *
 * The refusal is bounded by that predicate, not by what actually loses data.
 * `HDEL`, `LREM`, `SREM`, `ZREM`, `XDEL` and `XTRIM` are
 * `RedisCommandEffect::Destructive` on the backend
 * (`src-tauri/table-view-core/src/db/redis/command_parser.rs`) but are absent
 * from `KV_CONFIRM_COMMANDS`, so they classify as `info` and pass through here
 * with no dialog in every Safe Mode tier. That gap predates #2421, which scoped
 * itself to `DEL`, and is tracked separately
 * (`docs/product/known-limitations-cross-cutting.md`).
 *
 * The confirm key is still echoed for the gated-but-not-data-loss commands
 * (KEYS pattern / PERSIST key): the backend rejects those without it and they
 * would become unrunnable on the shipped default, and issue #2421 scoped the
 * dialog change to DEL because a scan and a TTL removal lose nothing.
 */
export async function executeKvCommandNow({
  tab,
  command,
  database,
  updateQueryState,
  completeQuery,
  failQuery,
  recordHistory,
}: ExecuteKvCommandNowRequest): Promise<void> {
  const dataLossReason = kvDataLossReason(command);
  if (dataLossReason !== undefined) {
    updateQueryState(tab.id, {
      status: "error",
      error: `${dataLossReason}. Confirm it in the destructive-action dialog before running it.`,
    });
    return;
  }
  await dispatchKvCommand({
    tab,
    command,
    database,
    confirmKey: kvCommandConfirmationKey(command),
    updateQueryState,
    completeQuery,
    failQuery,
    recordHistory,
  });
}

/** Issue #2421 — dispatch the command the user cleared in the confirm dialog.
 * Takes the staged confirmation whole so the command that runs is the one the
 * dialog showed, and the confirm key travels with the user's approval. */
export async function executeConfirmedKvCommand({
  tab,
  confirmation,
  updateQueryState,
  completeQuery,
  failQuery,
  recordHistory,
}: ExecuteConfirmedKvCommandRequest): Promise<void> {
  await dispatchKvCommand({
    tab,
    command: confirmation.command,
    database: confirmation.database,
    confirmKey: confirmation.confirmKey,
    updateQueryState,
    completeQuery,
    failQuery,
    recordHistory,
  });
}

async function dispatchKvCommand({
  tab,
  command,
  database,
  confirmKey,
  updateQueryState,
  completeQuery,
  failQuery,
  recordHistory,
}: DispatchKvCommandRequest): Promise<void> {
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
  if (decision.action === "block") {
    updateQueryState(tab.id, { status: "error", error: decision.reason });
    return;
  }

  // Issue #2421 — a data-loss command takes the dialog whatever the Safe Mode
  // matrix returned. The matrix answers `allow` for `danger` on a
  // non-production connection under mode `warn` / `off` and that pass-through
  // is deliberate (ADR 0022), but the KV console mounts no preview to catch it,
  // so `DEL k` reached the driver with nothing shown. Routing here rather than
  // widening the matrix keeps ADR 0022 / 0023 frozen — `src/lib/safeMode.ts`
  // delegates this surface to the QueryTab layer. It also pairs with the
  // refusal in `executeKvCommandNow`: without it a user would meet that
  // refusal with no dialog to clear.
  const dataLossReason = kvDataLossReason(sql);
  if (decision.action === "confirm" || dataLossReason !== undefined) {
    setPendingKvConfirm({
      command: sql,
      database,
      confirmKey: kvCommandConfirmationKey(sql),
      reason:
        decision.action === "confirm"
          ? decision.reason
          : (dataLossReason ?? ""),
    });
    return;
  }

  await executeKvCommandNow({
    tab,
    command: sql,
    database,
    updateQueryState,
    completeQuery,
    failQuery,
    recordHistory,
  });
}
