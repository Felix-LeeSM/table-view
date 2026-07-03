import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeRdbQuery,
  executeRdbSingleStatement,
} from "./rdbQueryExecution";
import type { SafeModeDecision } from "@/lib/safeMode";

const executeQueryMock = vi.hoisted(() => vi.fn());
const dispatchDbMutationHintMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
  executeQueryDryRun: vi.fn(),
}));

vi.mock("@lib/runtime/recovery/syncMismatchedActiveDb", () => ({
  syncMismatchedActiveDb: vi.fn(),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: vi.fn() },
}));

vi.mock("./queryHelpers", () => ({
  dispatchDbMutationHint: (...args: unknown[]) =>
    dispatchDbMutationHintMock(...args),
}));

const tab = {
  id: "query-rdb",
  connectionId: "conn-rdb",
  paradigm: "rdb" as const,
  sql: "SELECT 1",
  queryState: { status: "idle" as const },
};

function createSingleActions() {
  return {
    updateQueryState: vi.fn(),
    completeQuery: vi.fn(),
    failQuery: vi.fn(),
    cancelRunningQuery: vi.fn(),
    clearSchemaForConnection: vi.fn(),
    recordHistory: vi.fn(),
  };
}

describe("rdbQueryExecution seam", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  it("routes typed Cancel envelopes with normalized Cancel prefix to cancellation", async () => {
    executeQueryMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "PermissionDenied", message: "role cannot kill query" },
    });
    const actions = createSingleActions();

    await executeRdbSingleStatement({
      tab,
      stmt: "SELECT 1",
      workspaceDb: "app",
      findLiveIdleTab: vi.fn(),
      runRdbSingleRef: { current: null },
      ...actions,
    });

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-rdb",
      expect.stringMatching(/^query-rdb-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT 1",
        status: "cancelled",
      }),
    );
  });
});

// Purpose: #1223 regression — the single-statement dispatch path must send the
// comment-stripped `statements[0]` to the backend, not the raw editor SQL, so a
// trailing `;`-plus-comment tail doesn't reach the driver as a 2nd statement.
// Wires the *real* `executeRdbSingleStatement` as the runner (production parity
// via `runRdbSingleNow`) so the assertion lands on the `executeQuery` IPC
// boundary — the layer the bug actually corrupts.
const allow: SafeModeDecision = { action: "allow" };

function makeProductionSingleRunner(
  actions: ReturnType<typeof createSingleActions>,
) {
  const runRdbSingleRef = { current: null as unknown };
  const runner = (
    stmt: string,
    history?: { source?: string; collection?: string | null },
    safetyConfirmed?: boolean,
  ) =>
    executeRdbSingleStatement({
      tab,
      stmt,
      history: history as never,
      workspaceDb: "app",
      updateQueryState: actions.updateQueryState,
      completeQuery: actions.completeQuery,
      failQuery: actions.failQuery,
      cancelRunningQuery: actions.cancelRunningQuery,
      clearSchemaForConnection: actions.clearSchemaForConnection,
      recordHistory: actions.recordHistory,
      findLiveIdleTab: vi.fn(),
      runRdbSingleRef: runRdbSingleRef as never,
      safetyConfirmed,
    });
  runRdbSingleRef.current = runner;
  return runner;
}

async function runSinglePath(sql: string) {
  executeQueryMock.mockResolvedValue({
    columns: [],
    rows: [],
    totalCount: 0,
    executionTimeMs: 0,
    queryType: "select",
  });
  const actions = createSingleActions();
  await executeRdbQuery({
    tab: { ...tab, sql },
    sql,
    dbType: "postgresql",
    decideSafeMode: () => allow,
    updateQueryState: actions.updateQueryState,
    recordHistory: actions.recordHistory,
    setPendingRdbConfirm: vi.fn(),
    setPendingRdbWarn: vi.fn(),
    runRdbSingle: makeProductionSingleRunner(actions),
    runRdbBatch: vi.fn(),
  });
}

describe("executeRdbQuery single-statement routing (#1223)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  // Reason: 사용자 보고 (2026-07-03) — RAW Query 밑에 주석 추가 시 syntax error.
  // 원인: 단일 경로가 정제된 statements[0] 대신 원본 sql 재주입 (#1223).
  it("sends the comment-stripped statement to executeQuery when a single statement has a trailing comment", async () => {
    await runSinglePath("SELECT * FROM users;\n-- trailing comment");

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn-rdb",
      "SELECT * FROM users",
      expect.stringMatching(/^query-rdb-/),
      "app",
      undefined,
    );
  });

  // Reason: #1223 GREEN 불변 — inline 주석은 statements[0] 안에 보존되어야 하므로
  // 단일 stmt `SELECT 1 -- x` 는 fix 전후 동일하게 주석 포함 전문이 전달된다.
  it("preserves an inline trailing comment inside a single statement", async () => {
    await runSinglePath("SELECT 1 -- keep me");

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn-rdb",
      "SELECT 1 -- keep me",
      expect.stringMatching(/^query-rdb-/),
      "app",
      undefined,
    );
  });
});
