import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import type { QueryResult } from "@/types/query";
import {
  analyzeKvCommandSafety,
  executeConfirmedKvCommand,
  executeKvCommandNow,
  executeKvQuery,
} from "./kvQueryExecution";

const executeKvCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  executeKvCommand: (...args: unknown[]) => executeKvCommandMock(...args),
}));

const REDIS_RESULT: QueryResult = {
  columns: [{ name: "value", dataType: "text", category: "text" }],
  rows: [["Ada"]],
  totalCount: 1,
  executionTimeMs: 2,
  queryType: "select",
};

const tab = {
  id: "query-redis" as TabId,
  connectionId: "conn-redis" as ConnectionId,
};

function createActions() {
  return {
    updateQueryState: vi.fn(),
    completeQuery: vi.fn(),
    failQuery: vi.fn(),
    setPendingKvConfirm: vi.fn(),
    recordHistory: vi.fn(),
  };
}

describe("kvQueryExecution seam", () => {
  beforeEach(() => {
    executeKvCommandMock.mockReset();
  });

  it("classifies KEYS as a confirm-gated KV command and leaves bounded commands informational", () => {
    expect(analyzeKvCommandSafety("KEYS *")).toMatchObject({
      severity: "danger",
      reasons: ["Redis KEYS scans the full keyspace"],
    });
    expect(analyzeKvCommandSafety("SCAN 0 COUNT 25")).toMatchObject({
      severity: "info",
      reasons: [],
    });
  });

  it("dispatches bounded Redis commands through the KV IPC wrapper and completes the tab", async () => {
    executeKvCommandMock.mockResolvedValueOnce(REDIS_RESULT);
    const actions = createActions();

    await executeKvQuery({
      tab,
      sql: "GET profile:1",
      workspaceDb: "2",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      decideSafeMode: () => ({ action: "allow" }),
      ...actions,
    });

    expect(actions.setPendingKvConfirm).not.toHaveBeenCalled();
    expect(actions.updateQueryState).toHaveBeenCalledWith("query-redis", {
      status: "running",
      queryId: expect.stringMatching(/^query-redis-/),
    });
    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-redis",
      { command: "GET profile:1", database: 2 },
      expect.stringMatching(/^query-redis-/),
    );
    expect(actions.completeQuery).toHaveBeenCalledWith(
      "query-redis",
      expect.stringMatching(/^query-redis-/),
      REDIS_RESULT,
    );
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "GET profile:1", status: "success" }),
    );
  });

  it("routes confirm-gated KV commands to pending confirmation before IPC", async () => {
    const actions = createActions();

    await executeKvQuery({
      tab,
      sql: "KEYS *",
      workspaceDb: "2",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      decideSafeMode: () => ({
        action: "confirm",
        reason: "Redis KEYS scans the full keyspace",
      }),
      ...actions,
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(actions.updateQueryState).not.toHaveBeenCalled();
    expect(actions.setPendingKvConfirm).toHaveBeenCalledWith({
      command: "KEYS *",
      database: 2,
      confirmKey: "*",
      reason: "Redis KEYS scans the full keyspace",
    });
  });

  // Issue #1120 symptom 3 — the frontend classifier answers `danger` for the
  // commands the backend gates with a confirmation value (KEYS / DEL /
  // PERSIST), so they surface the same confirm dialog as SQL destructive
  // statements instead of the backend rejecting them with a bare error after a
  // silent frontend pass. This case pins DEL and PERSIST; since #2513 the same
  // `danger` also covers every verb the backend calls
  // `RedisCommandEffect::Destructive`, asserted per verb in
  // `kvDestructiveTier.test.ts`. `danger` here is the confirm lever,
  // not a destruction verdict — KEYS (scan) and PERSIST (TTL removal) are not
  // destructive (see memory/product §2 + kvQueryExecution.ts).
  it("[AC-1120-kv] classifies DEL/PERSIST as confirm-requiring danger (backend parity)", () => {
    expect(analyzeKvCommandSafety("DEL session:1")).toMatchObject({
      severity: "danger",
      reasons: ["Redis DEL permanently removes the key"],
    });
    expect(analyzeKvCommandSafety("PERSIST session:1")).toMatchObject({
      severity: "danger",
      reasons: ["Redis PERSIST removes the key's expiry"],
    });
    // Bounded writes stay info — the backend command allowlist is the real gate.
    expect(analyzeKvCommandSafety("SET k v")).toMatchObject({
      severity: "info",
    });
  });

  it("[AC-1120-kv] routes DEL to the confirm dialog with its key (not a backend rejection)", async () => {
    const actions = createActions();

    await executeKvQuery({
      tab,
      sql: "DEL session:1",
      workspaceDb: "2",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      decideSafeMode: () => ({
        action: "confirm",
        reason: "Redis DEL permanently removes the key",
      }),
      ...actions,
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(actions.setPendingKvConfirm).toHaveBeenCalledWith({
      command: "DEL session:1",
      database: 2,
      confirmKey: "session:1",
      reason: "Redis DEL permanently removes the key",
    });
  });

  // Issue #2421 — the backend `require_confirm_key` gate compares the request's
  // key against the key the backend parsed out of the same command string, so a
  // frontend that derives the key from the command text satisfies it without a
  // dialog. These two lock the halves of the fix separately: the dispatch seam
  // refuses an unconfirmed command `kvDataLossReason` names — `DEL` in this
  // case, and since #2513 every verb the backend calls
  // `RedisCommandEffect::Destructive` — and the router sends DEL to the dialog
  // whatever the Safe Mode matrix returned.
  it("[kv-confirm-gate] refuses an unconfirmed data-loss dispatch and only runs it with the dialog's confirmation", async () => {
    const actions = createActions();

    await executeKvCommandNow({
      tab,
      command: "DEL session:1",
      database: 2,
      updateQueryState: actions.updateQueryState,
      completeQuery: actions.completeQuery,
      failQuery: actions.failQuery,
      recordHistory: actions.recordHistory,
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(actions.updateQueryState).toHaveBeenCalledWith("query-redis", {
      status: "error",
      error:
        "Redis DEL permanently removes the key. Confirm it in the destructive-action dialog before running it.",
    });

    // The same command dispatched with the staged confirmation does reach IPC —
    // the guard gates on where the request came from, not on the verb.
    executeKvCommandMock.mockResolvedValueOnce(REDIS_RESULT);
    await executeConfirmedKvCommand({
      tab,
      confirmation: {
        command: "DEL session:1",
        database: 2,
        confirmKey: "session:1",
        reason: "Redis DEL permanently removes the key",
      },
      updateQueryState: actions.updateQueryState,
      completeQuery: actions.completeQuery,
      failQuery: actions.failQuery,
      recordHistory: actions.recordHistory,
    });

    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-redis",
      { command: "DEL session:1", database: 2, confirmKey: "session:1" },
      expect.stringMatching(/^query-redis-/),
    );
  });

  it("[kv-confirm-gate] stages DEL for confirmation even when Safe Mode allows, and leaves KEYS on the direct path", async () => {
    const actions = createActions();

    await executeKvQuery({
      tab,
      sql: "DEL session:1",
      workspaceDb: "2",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      // The shipped default (non-production + mode "warn") resolves to this.
      decideSafeMode: () => ({ action: "allow" }),
      ...actions,
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(actions.setPendingKvConfirm).toHaveBeenCalledWith({
      command: "DEL session:1",
      database: 2,
      confirmKey: "session:1",
      reason: "Redis DEL permanently removes the key",
    });

    // KEYS is gated by the backend but loses nothing (#2421 kept it on the
    // direct path), so the same `allow` still dispatches it with its pattern.
    executeKvCommandMock.mockResolvedValueOnce(REDIS_RESULT);
    const keysActions = createActions();
    await executeKvQuery({
      tab,
      sql: "KEYS *",
      workspaceDb: "2",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      decideSafeMode: () => ({ action: "allow" }),
      ...keysActions,
    });

    expect(keysActions.setPendingKvConfirm).not.toHaveBeenCalled();
    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-redis",
      { command: "KEYS *", database: 2, confirmKey: "*" },
      expect.stringMatching(/^query-redis-/),
    );
  });

  it("rejects invalid Redis database chips before KV IPC dispatch", async () => {
    const actions = createActions();

    await executeKvQuery({
      tab,
      sql: "GET profile:1",
      workspaceDb: "not-a-db",
      canExecuteQuery: true,
      queryProductLabel: "Redis",
      decideSafeMode: () => ({ action: "allow" }),
      ...actions,
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    expect(actions.updateQueryState).toHaveBeenCalledWith("query-redis", {
      status: "error",
      error: "Redis database must be an integer between 0 and 65535.",
    });
  });

  it("fails the tab when the KV IPC wrapper rejects", async () => {
    executeKvCommandMock.mockRejectedValueOnce(new Error("redis unavailable"));
    const actions = createActions();

    await executeKvCommandNow({
      tab,
      command: "GET profile:1",
      database: 2,
      updateQueryState: actions.updateQueryState,
      completeQuery: actions.completeQuery,
      failQuery: actions.failQuery,
      recordHistory: actions.recordHistory,
    });

    expect(actions.completeQuery).not.toHaveBeenCalled();
    expect(actions.failQuery).toHaveBeenCalledWith(
      "query-redis",
      expect.stringMatching(/^query-redis-/),
      "redis unavailable",
    );
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "GET profile:1", status: "error" }),
    );
  });
});
