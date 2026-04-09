import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSchemaStore } from "./schemaStore";

// Mock the tauri invoke wrapper
vi.mock("../lib/tauri", () => ({
  listSchemas: vi.fn(() =>
    Promise.resolve([{ name: "public" }, { name: "test_schema" }]),
  ),
  listTables: vi.fn(() =>
    Promise.resolve([
      { name: "users", schema: "public", row_count: 42 },
      { name: "orders", schema: "public", row_count: null },
    ]),
  ),
  getTableColumns: vi.fn(() =>
    Promise.resolve([
      {
        name: "id",
        data_type: "integer",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ]),
  ),
  queryTableData: vi.fn(() =>
    Promise.resolve({
      columns: [
        {
          name: "id",
          data_type: "integer",
          nullable: false,
          default_value: null,
          is_primary_key: true,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
      rows: [[1]],
      total_count: 1,
      page: 1,
      page_size: 50,
    }),
  ),
}));

describe("schemaStore", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it("loads schemas from backend", async () => {
    await useSchemaStore.getState().loadSchemas("conn1");
    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toHaveLength(2);
    expect(state.schemas["conn1"]![0]!.name).toBe("public");
    expect(state.schemas["conn1"]![1]!.name).toBe("test_schema");
  });

  it("loads tables for schema", async () => {
    await useSchemaStore.getState().loadTables("conn1", "public");
    const state = useSchemaStore.getState();
    const key = "conn1:public";
    expect(state.tables[key]).toHaveLength(2);
    expect(state.tables[key]![0]!.name).toBe("users");
    expect(state.tables[key]![0]!.row_count).toBe(42);
  });

  it("clears schema data", async () => {
    // Load some data first
    await useSchemaStore.getState().loadSchemas("conn1");
    await useSchemaStore.getState().loadTables("conn1", "public");

    // Clear
    useSchemaStore.getState().clearSchema("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toBeUndefined();
    expect(state.tables["conn1:public"]).toBeUndefined();
  });

  it("handles load error", async () => {
    const { listSchemas } = await import("../lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    await useSchemaStore.getState().loadSchemas("conn1");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Connection refused");
  });

  it("delegates getTableColumns", async () => {
    const { getTableColumns } = await import("../lib/tauri");
    const columns = await useSchemaStore
      .getState()
      .getTableColumns("conn1", "users", "public");

    expect(getTableColumns).toHaveBeenCalledWith("conn1", "users", "public");
    expect(columns).toHaveLength(1);
    expect(columns[0]!.name).toBe("id");
    expect(columns[0]!.is_primary_key).toBe(true);
  });

  it("delegates queryTableData", async () => {
    const { queryTableData } = await import("../lib/tauri");
    const data = await useSchemaStore
      .getState()
      .queryTableData("conn1", "users", "public", 1, 50, "id");

    expect(queryTableData).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      1,
      50,
      "id",
      undefined,
    );
    expect(data.total_count).toBe(1);
    expect(data.rows).toHaveLength(1);
  });
});
