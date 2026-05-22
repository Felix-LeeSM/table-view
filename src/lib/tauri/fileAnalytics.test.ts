import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  executeFileAnalyticsQuery,
  previewFileAnalyticsSource,
  registerFileAnalyticsSource,
} from "./fileAnalytics";

const source = {
  id: "src-1",
  alias: "sales_csv",
  fileName: "sales.csv",
  kind: "csv" as const,
  sizeBytes: 2048,
};

describe("DuckDB file analytics wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("registers a local analytics file with the DuckDB command args", async () => {
    invokeMock.mockResolvedValueOnce(source);

    const registered = await registerFileAnalyticsSource(
      "conn-1",
      "/tmp/sales.csv",
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "duckdb_register_file_analytics_source",
      {
        connectionId: "conn-1",
        path: "/tmp/sales.csv",
      },
    );
    expect(registered).toEqual(source);
  });

  it("previews a source and normalizes/wraps the QueryResult payload", async () => {
    invokeMock.mockResolvedValueOnce({
      source,
      executedSql: "SELECT * FROM sales_csv LIMIT 5",
      result: {
        columns: [
          { name: "id", data_type: "int8", category: "number" },
          { name: "amount", data_type: "decimal", category: "number" },
        ],
        rows: [["9007199254740993", "12.3400"]],
        total_count: 1,
        execution_time_ms: 3,
        query_type: "select",
      },
    });

    const preview = await previewFileAnalyticsSource("conn-1", "src-1", 5);

    expect(invokeMock).toHaveBeenCalledWith(
      "duckdb_preview_file_analytics_source",
      {
        connectionId: "conn-1",
        sourceId: "src-1",
        limit: 5,
      },
    );
    expect(preview.executedSql).toBe("SELECT * FROM sales_csv LIMIT 5");
    expect(preview.result.columns[0]?.dataType).toBe("int8");
    expect(preview.result.totalCount).toBe(1);
    expect(preview.result.executionTimeMs).toBe(3);
    expect(preview.result.rows[0]?.[0]).toBe(9007199254740993n);
    expect(preview.result.rows[0]?.[1]).toBeInstanceOf(Decimal);
    expect((preview.result.rows[0]?.[1] as Decimal).toString()).toBe("12.34");
  });

  it("sends null preview limit when omitted", async () => {
    invokeMock.mockResolvedValueOnce({
      source,
      executedSql: "SELECT * FROM sales_csv LIMIT 100",
      result: {
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        queryType: "select",
      },
    });

    await previewFileAnalyticsSource("conn-1", "src-1");

    expect(invokeMock).toHaveBeenCalledWith(
      "duckdb_preview_file_analytics_source",
      {
        connectionId: "conn-1",
        sourceId: "src-1",
        limit: null,
      },
    );
  });

  it("executes source-scoped SQL and adapts the QueryResult payload", async () => {
    invokeMock.mockResolvedValueOnce({
      source: { ...source, kind: "parquet", fileName: "sales.parquet" },
      executedSql: "SELECT count(*) FROM sales_parquet",
      result: {
        columns: [{ name: "count", dataType: "bigint", category: "number" }],
        rows: [["42"]],
        totalCount: 1,
        executionTimeMs: 7,
        queryType: "select",
      },
    });

    const response = await executeFileAnalyticsQuery(
      "conn-1",
      "src-2",
      "SELECT count(*) FROM sales_parquet",
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "duckdb_execute_file_analytics_query",
      {
        connectionId: "conn-1",
        sourceId: "src-2",
        sql: "SELECT count(*) FROM sales_parquet",
      },
    );
    expect(response.source.kind).toBe("parquet");
    expect(response.result.rows[0]?.[0]).toBe(42n);
  });

  it("does not write query history from register, preview, or execute wrappers", async () => {
    invokeMock
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({
        source,
        executedSql: "SELECT * FROM sales_csv LIMIT 100",
        result: {
          columns: [],
          rows: [],
          totalCount: 0,
          executionTimeMs: 1,
          queryType: "select",
        },
      })
      .mockResolvedValueOnce({
        source,
        executedSql: "SELECT 1",
        result: {
          columns: [],
          rows: [],
          totalCount: 0,
          executionTimeMs: 1,
          queryType: "select",
        },
      });

    await registerFileAnalyticsSource("conn-1", "/tmp/sales.csv");
    await previewFileAnalyticsSource("conn-1", "src-1");
    await executeFileAnalyticsQuery("conn-1", "src-1", "SELECT 1");

    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual([
      "duckdb_register_file_analytics_source",
      "duckdb_preview_file_analytics_source",
      "duckdb_execute_file_analytics_query",
    ]);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "add_history_entry",
      expect.anything(),
    );
  });
});
