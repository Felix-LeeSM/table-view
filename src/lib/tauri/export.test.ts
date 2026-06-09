import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportContext, SchemaDumpTable } from "./export";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
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

  it("exports schema dumps with ordered table metadata and null exportId default", async () => {
    const tables: SchemaDumpTable[] = [
      { schema: "public", table: "users", columnNames: ["id", "email"] },
    ];
    const options: SchemaDumpOptions = { include: "both", batchSize: 500 };
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
