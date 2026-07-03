import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  executeQuery,
  executeQueryBatch,
  executeQueryBatchEnvelopes,
  executeQueryDryRun,
  executeQueryDryRunEnvelopes,
  executeQueryEnvelope,
} from "./query";

const rawResult = {
  columns: [{ name: "id", data_type: "integer", category: "int" }],
  rows: [["9007199254740993"]],
  total_count: 1,
  execution_time_ms: 7,
  query_type: "select",
};

describe("RDBMS query Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("wraps single-query IPC output in a tabular result envelope", async () => {
    invokeMock.mockResolvedValueOnce(rawResult);

    const envelope = await executeQueryEnvelope(
      "conn-1",
      "select id from users",
      "q-1",
      "app",
    );

    expect(invokeMock).toHaveBeenCalledWith("execute_query", {
      connectionId: "conn-1",
      sql: "select id from users",
      queryId: "q-1",
      expectedDatabase: "app",
    });
    expect(envelope).toEqual({
      kind: "tabular",
      queryResult: {
        columns: [{ name: "id", dataType: "integer", category: "int" }],
        // SQLite `integer` 컬럼의 정밀도-보존 string token 은 ADR 0026
        // (issue #1082) 에 따라 BigInt 로 승격된다.
        rows: [[9007199254740993n]],
        totalCount: 1,
        executionTimeMs: 7,
        queryType: "select",
      },
    });
  });

  it("keeps the legacy executeQuery compatibility projection", async () => {
    invokeMock.mockResolvedValueOnce(rawResult);

    await expect(executeQuery("conn-1", "select 1", "q-2")).resolves.toEqual({
      columns: [{ name: "id", dataType: "integer", category: "int" }],
      // SQLite `integer` string token → BigInt (ADR 0026 / issue #1082).
      rows: [[9007199254740993n]],
      totalCount: 1,
      executionTimeMs: 7,
      queryType: "select",
    });

    expect(invokeMock).toHaveBeenCalledWith("execute_query", {
      connectionId: "conn-1",
      sql: "select 1",
      queryId: "q-2",
      expectedDatabase: null,
    });
  });

  it("wraps batch and dry-run outputs as tabular envelopes while preserving legacy projections", async () => {
    invokeMock
      .mockResolvedValueOnce([rawResult, rawResult])
      .mockResolvedValueOnce([rawResult])
      .mockResolvedValueOnce([rawResult])
      .mockResolvedValueOnce([rawResult]);

    await expect(
      executeQueryBatchEnvelopes("conn-1", ["select 1", "select 2"], "q-batch"),
    ).resolves.toEqual([
      {
        kind: "tabular",
        queryResult: expect.objectContaining({ totalCount: 1 }),
      },
      {
        kind: "tabular",
        queryResult: expect.objectContaining({ totalCount: 1 }),
      },
    ]);
    await expect(
      executeQueryBatch("conn-1", ["select 1"], "q-batch-legacy"),
    ).resolves.toEqual([expect.objectContaining({ totalCount: 1 })]);
    await expect(
      executeQueryDryRunEnvelopes("conn-1", ["delete from users"], "q-dry"),
    ).resolves.toEqual([
      {
        kind: "tabular",
        queryResult: expect.objectContaining({ totalCount: 1 }),
      },
    ]);
    await expect(
      executeQueryDryRun("conn-1", ["delete from users"], "q-dry-legacy"),
    ).resolves.toEqual([expect.objectContaining({ totalCount: 1 })]);
  });
});
