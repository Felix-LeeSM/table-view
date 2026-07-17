import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { executeMongoAggregate, runDocumentFind } from "./mongoDocumentResults";

const findDocumentsMock = vi.hoisted(() => vi.fn());
const aggregateDocumentsMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
  findOneDocument: vi.fn(),
  countDocuments: vi.fn(),
  estimatedDocumentCount: vi.fn(),
  distinctDocuments: vi.fn(),
  aggregateDocuments: (...args: unknown[]) => aggregateDocumentsMock(...args),
}));

const tab = {
  id: "query-mongo" as TabId,
  connectionId: "conn-mongo" as ConnectionId,
  database: "app",
  collection: "users",
  paradigm: "document" as const,
  sql: "db.users.find({})",
};

function createActions() {
  return {
    updateQueryState: vi.fn(),
    completeQuery: vi.fn(),
    failQuery: vi.fn(),
    cancelRunningQuery: vi.fn(),
    recordHistory: vi.fn(),
  };
}

// Issue #1561 — mongo cancel returns AppError::Database("Operation cancelled").
// The runner catch must route it to cancelled-state + history "cancelled"
// (like RDB/Search), not the red `failQuery` error banner.
describe("mongoDocumentResults cancellation routing (#1561)", () => {
  beforeEach(() => {
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
  });

  it("routes a runDocumentFind cancellation to cancelled state + history", async () => {
    findDocumentsMock.mockRejectedValueOnce(new Error("Operation cancelled"));
    const actions = createActions();

    await runDocumentFind(
      actions,
      tab,
      tab.connectionId,
      tab.database,
      tab.collection,
      {},
      tab.sql,
    );

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-mongo",
      expect.stringMatching(/^query-mongo-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "db.users.find({})",
        status: "cancelled",
        queryMode: "find",
      }),
    );
  });

  it("routes a typed Cancel envelope to cancelled state", async () => {
    findDocumentsMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "AlreadyCompleted" },
    });
    const actions = createActions();

    await runDocumentFind(
      actions,
      tab,
      tab.connectionId,
      tab.database,
      tab.collection,
      {},
      tab.sql,
    );

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-mongo",
      expect.stringMatching(/^query-mongo-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
  });

  it("keeps a non-cancellation runDocumentFind error as an error", async () => {
    findDocumentsMock.mockRejectedValueOnce(
      new Error("E11000 duplicate key error"),
    );
    const actions = createActions();

    await runDocumentFind(
      actions,
      tab,
      tab.connectionId,
      tab.database,
      tab.collection,
      {},
      tab.sql,
    );

    expect(actions.failQuery).toHaveBeenCalled();
    expect(actions.cancelRunningQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("routes an executeMongoAggregate cancellation to cancelled state + history", async () => {
    aggregateDocumentsMock.mockRejectedValueOnce(
      new Error("Operation cancelled"),
    );
    const actions = createActions();

    await executeMongoAggregate({
      tab,
      pipeline: [{ $match: {} }],
      ...actions,
    });

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-mongo",
      expect.stringMatching(/^query-mongo-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", queryMode: "aggregate" }),
    );
  });
});
