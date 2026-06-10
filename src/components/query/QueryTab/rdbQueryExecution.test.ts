import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRdbSingleStatement } from "./rdbQueryExecution";

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
