import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportContext, SchemaDumpTable } from "./export";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  EXPORT_IPC_CHUNK_ROWS,
  exportGridRows,
  exportSchemaDump,
  writeTextFileExport,
  type SchemaDumpOptions,
} from "./export";

describe("export Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("exports grid rows with query context and a null cancel token by default", async () => {
    const context: ExportContext = {
      kind: "query",
      source_table: { schema: "public", name: "users" },
    };
    invokeMock.mockResolvedValueOnce({ rows_written: 2, bytes_written: 128 });

    const summary = await exportGridRows(
      "csv",
      "/tmp/users.csv",
      ["id", "email"],
      [
        [1, "a@example.com"],
        [2, "b@example.com"],
      ],
      context,
    );

    expect(invokeMock).toHaveBeenCalledWith("export_grid_rows", {
      format: "csv",
      targetPath: "/tmp/users.csv",
      headers: ["id", "email"],
      rows: [
        [1, "a@example.com"],
        [2, "b@example.com"],
      ],
      context,
      exportId: null,
    });
    expect(summary.rows_written).toBe(2);
  });

  it("serializes BigInt / Decimal cells to wire strings so Tauri IPC never throws (issue #1082)", async () => {
    // SQLite INTEGER PRIMARY KEY (and PG bigint / numeric) cells arrive as
    // BigInt / Decimal after wrapNumericCells. Passing them raw makes Tauri's
    // native JSON.stringify throw `TypeError: Do not know how to serialize a
    // BigInt`, which broke Export for most SQLite tables. They must cross the
    // IPC boundary as digit-preserving strings.
    const context: ExportContext = {
      kind: "table",
      schema: "main",
      name: "big",
    };
    invokeMock.mockResolvedValueOnce({ rows_written: 1, bytes_written: 64 });

    await exportGridRows(
      "csv",
      "/tmp/big.csv",
      ["id", "amount"],
      [[9223372036854775807n, new Decimal("0.10")]],
      context,
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "export_grid_rows",
      expect.objectContaining({
        rows: [["9223372036854775807", "0.1"]],
      }),
    );
    // The serialized arg must be JSON-stringifiable (the real IPC codec path).
    expect(() => JSON.stringify(invokeMock.mock.calls[0]?.[1])).not.toThrow();
  });

  it("passes caller-owned export ids for cancellable row streaming", async () => {
    const context: ExportContext = { kind: "collection", name: "orders" };
    invokeMock.mockResolvedValueOnce({ rows_written: 1, bytes_written: 32 });

    await exportGridRows(
      "json",
      "/tmp/orders.json",
      ["_id"],
      [["1"]],
      context,
      "exp-1",
    );

    expect(invokeMock).toHaveBeenCalledWith("export_grid_rows", {
      format: "json",
      targetPath: "/tmp/orders.json",
      headers: ["_id"],
      rows: [["1"]],
      context,
      exportId: "exp-1",
    });
  });

  it("writes text exports without row-streaming options", async () => {
    invokeMock.mockResolvedValueOnce({ rows_written: 0, bytes_written: 64 });

    await writeTextFileExport("/tmp/schema.sql", "CREATE TABLE users(id int);");

    expect(invokeMock).toHaveBeenCalledWith("write_text_file_export", {
      targetPath: "/tmp/schema.sql",
      content: "CREATE TABLE users(id int);",
    });
  });

  it("keeps exports at the chunk threshold on the single-shot command (#1443)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    const rows = Array.from({ length: EXPORT_IPC_CHUNK_ROWS }, (_, i) => [i]);
    invokeMock.mockResolvedValueOnce({
      rows_written: rows.length,
      bytes_written: 1,
    });

    await exportGridRows("csv", "/tmp/t.csv", ["id"], rows, context);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("export_grid_rows");
  });

  it("streams large exports through begin/chunk/finish sessions (#1443)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    const rows = Array.from(
      { length: EXPORT_IPC_CHUNK_ROWS * 2 + 1 },
      (_, i) => [i, "v"],
    );
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "export_grid_begin") return "sess-1";
      if (cmd === "export_grid_finish")
        return { rows_written: rows.length, bytes_written: 42 };
      return undefined;
    });

    const summary = await exportGridRows(
      "csv",
      "/tmp/big.csv",
      ["id", "v"],
      rows,
      context,
      "exp-9",
    );

    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "export_grid_begin",
      "export_grid_chunk",
      "export_grid_chunk",
      "export_grid_chunk",
      "export_grid_finish",
    ]);
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      format: "csv",
      targetPath: "/tmp/big.csv",
      headers: ["id", "v"],
      context,
      exportId: "exp-9",
    });
    const chunkArgs = (i: number) =>
      invokeMock.mock.calls[i]?.[1] as { sessionId: string; rows: unknown[][] };
    expect(chunkArgs(1).sessionId).toBe("sess-1");
    expect(chunkArgs(1).rows).toHaveLength(EXPORT_IPC_CHUNK_ROWS);
    expect(chunkArgs(2).rows).toHaveLength(EXPORT_IPC_CHUNK_ROWS);
    expect(chunkArgs(3).rows).toHaveLength(1);
    expect(invokeMock.mock.calls[4]?.[1]).toEqual({ sessionId: "sess-1" });
    expect(summary.rows_written).toBe(rows.length);
  });

  it("reports cumulative chunk progress via onProgress for streamed exports (#1448 F15)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    const rows = Array.from(
      { length: EXPORT_IPC_CHUNK_ROWS * 2 + 1 },
      (_, i) => [i],
    );
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "export_grid_begin") return "sess-p";
      if (cmd === "export_grid_finish")
        return { rows_written: rows.length, bytes_written: 1 };
      return undefined;
    });
    const onProgress = vi.fn();

    await exportGridRows(
      "csv",
      "/tmp/big.csv",
      ["id"],
      rows,
      context,
      null,
      onProgress,
    );

    // One cumulative report per chunk; the final short chunk clamps to the total.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      EXPORT_IPC_CHUNK_ROWS,
      EXPORT_IPC_CHUNK_ROWS * 2,
      EXPORT_IPC_CHUNK_ROWS * 2 + 1,
    ]);
  });

  it("does not report progress for the instant single-shot path (#1448 F15)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    invokeMock.mockResolvedValueOnce({ rows_written: 1, bytes_written: 8 });
    const onProgress = vi.fn();

    await exportGridRows(
      "csv",
      "/tmp/t.csv",
      ["id"],
      [[1]],
      context,
      null,
      onProgress,
    );

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("serializes BigInt / Decimal cells per chunk so late rows stay IPC-safe (#1443)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    const rows: unknown[][] = Array.from(
      { length: EXPORT_IPC_CHUNK_ROWS + 1 },
      (_, i) => [i],
    );
    rows[rows.length - 1] = [9223372036854775807n, new Decimal("0.10")];
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "export_grid_begin") return "sess-2";
      if (cmd === "export_grid_finish")
        return { rows_written: rows.length, bytes_written: 1 };
      return undefined;
    });

    await exportGridRows("csv", "/tmp/big.csv", ["id"], rows, context);

    const lastChunk = invokeMock.mock.calls[2]?.[1] as { rows: unknown[][] };
    expect(lastChunk.rows).toEqual([["9223372036854775807", "0.1"]]);
    // Every chunk arg must survive the real IPC codec path.
    for (const call of invokeMock.mock.calls) {
      expect(() => JSON.stringify(call[1])).not.toThrow();
    }
  });

  it("aborts the session and rethrows when a chunk write fails (#1443)", async () => {
    const context: ExportContext = { kind: "table", schema: "main", name: "t" };
    const rows = Array.from({ length: EXPORT_IPC_CHUNK_ROWS + 1 }, (_, i) => [
      i,
    ]);
    invokeMock.mockImplementation(async (cmd: unknown) => {
      if (cmd === "export_grid_begin") return "sess-3";
      if (cmd === "export_grid_chunk")
        throw new Error("Validation error: Export cancelled");
      return undefined;
    });

    await expect(
      exportGridRows("csv", "/tmp/big.csv", ["id"], rows, context, "exp-c"),
    ).rejects.toThrow(/cancelled/i);

    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "export_grid_begin",
      "export_grid_chunk",
      "export_grid_abort",
    ]);
    expect(invokeMock.mock.calls[2]?.[1]).toEqual({ sessionId: "sess-3" });
  });

  it("exports schema dumps with ordered table metadata and null exportId default", async () => {
    const tables: SchemaDumpTable[] = [
      { schema: "public", table: "users", columnNames: ["id", "email"] },
    ];
    const options: SchemaDumpOptions = {
      include: "both",
      batchSize: 500,
      dialect: "mysql",
    };
    invokeMock.mockResolvedValueOnce({ rows_written: 10, bytes_written: 4096 });

    await exportSchemaDump(
      "conn-1",
      "/tmp/app.sql",
      "-- ddl",
      "-- footer",
      tables,
      options,
    );

    expect(invokeMock).toHaveBeenCalledWith("export_schema_dump", {
      connectionId: "conn-1",
      targetPath: "/tmp/app.sql",
      ddlHeader: "-- ddl",
      ddlFooter: "-- footer",
      tables,
      options,
      exportId: null,
    });
  });
});
