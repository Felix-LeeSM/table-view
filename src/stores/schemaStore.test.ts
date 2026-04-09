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
  getTableIndexes: vi.fn(() =>
    Promise.resolve([
      {
        name: "users_pkey",
        columns: ["id"],
        index_type: "btree",
        is_unique: true,
        is_primary: true,
      },
    ]),
  ),
  getTableConstraints: vi.fn(() =>
    Promise.resolve([
      {
        name: "users_pkey",
        constraint_type: "PRIMARY KEY",
        columns: ["id"],
        reference_table: null,
        reference_columns: null,
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
      executed_query: "SELECT * FROM public.users LIMIT 50 OFFSET 0",
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
      undefined,
    );
    expect(data.total_count).toBe(1);
    expect(data.rows).toHaveLength(1);
  });

  it("delegates getTableIndexes", async () => {
    const { getTableIndexes } = await import("../lib/tauri");
    const indexes = await useSchemaStore
      .getState()
      .getTableIndexes("conn1", "users", "public");

    expect(getTableIndexes).toHaveBeenCalledWith("conn1", "users", "public");
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.name).toBe("users_pkey");
    expect(indexes[0]!.is_primary).toBe(true);
  });

  it("delegates getTableConstraints", async () => {
    const { getTableConstraints } = await import("../lib/tauri");
    const constraints = await useSchemaStore
      .getState()
      .getTableConstraints("conn1", "users", "public");

    expect(getTableConstraints).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.constraint_type).toBe("PRIMARY KEY");
  });

  it("passes filters to queryTableData", async () => {
    const { queryTableData } = await import("../lib/tauri");
    const filters = [
      {
        column: "name",
        operator: "Eq" as const,
        value: "Alice",
        id: "f1",
      },
    ];

    await useSchemaStore
      .getState()
      .queryTableData("conn1", "users", "public", 1, 50, undefined, filters);

    expect(queryTableData).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      1,
      50,
      undefined,
      filters,
      undefined,
    );
  });

  it("passes rawWhere to queryTableData", async () => {
    const { queryTableData } = await import("../lib/tauri");

    await useSchemaStore
      .getState()
      .queryTableData(
        "conn1",
        "users",
        "public",
        1,
        50,
        undefined,
        undefined,
        "id = 13",
      );

    expect(queryTableData).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      1,
      50,
      undefined,
      undefined,
      "id = 13",
    );
  });

  it("clearSchema removes connection-related tables", async () => {
    // Set up tables for multiple schemas of same connection
    useSchemaStore.setState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 1 }],
        "conn1:private": [{ name: "secrets", schema: "private", row_count: 5 }],
        "conn2:public": [{ name: "orders", schema: "public", row_count: 10 }],
      },
    });

    useSchemaStore.getState().clearSchema("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toBeUndefined();
    expect(state.tables["conn1:public"]).toBeUndefined();
    expect(state.tables["conn1:private"]).toBeUndefined();
    // Other connection should be unaffected
    expect(state.tables["conn2:public"]).toHaveLength(1);
  });
});
