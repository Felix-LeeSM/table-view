import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSchemaStore } from "./schemaStore";

// Mock the tauri invoke wrapper
vi.mock("@lib/tauri", () => ({
  listSchemas: vi.fn(() =>
    Promise.resolve([{ name: "public" }, { name: "test_schema" }]),
  ),
  listTables: vi.fn(() =>
    Promise.resolve([
      { name: "users", schema: "public", row_count: 42 },
      { name: "orders", schema: "public", row_count: null },
    ]),
  ),
  listViews: vi.fn(() =>
    Promise.resolve([
      {
        name: "active_users",
        schema: "public",
        definition: "SELECT * FROM users WHERE active = true",
      },
    ]),
  ),
  listFunctions: vi.fn(() =>
    Promise.resolve([
      {
        name: "calculate_total",
        schema: "public",
        arguments: "user_id integer",
        returnType: "numeric",
        language: "plpgsql",
        source: "BEGIN RETURN 0; END",
        kind: "function",
      },
      {
        name: "do_migration",
        schema: "public",
        arguments: null,
        returnType: null,
        language: "plpgsql",
        source: "BEGIN END",
        kind: "procedure",
      },
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
  executeQuery: vi.fn(() =>
    Promise.resolve({
      columns: [{ name: "id", data_type: "integer" }],
      rows: [[1]],
      total_count: 1,
      execution_time_ms: 3,
      query_type: "select",
    }),
  ),
  // Sprint 183 — schemaStore exposes a batch helper that wraps the
  // multi-statement Tauri command. Mock kept simple; the store layer just
  // forwards arguments.
  executeQueryBatch: vi.fn((_id: string, statements: string[]) =>
    Promise.resolve(
      statements.map(() => ({
        columns: [],
        rows: [],
        total_count: 0,
        execution_time_ms: 1,
        query_type: "dml" as const,
      })),
    ),
  ),
  dropTable: vi.fn(() => Promise.resolve()),
  renameTable: vi.fn(() => Promise.resolve()),
  getViewColumns: vi.fn(() =>
    Promise.resolve([
      {
        name: "id",
        data_type: "integer",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "text",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: "display name",
      },
    ]),
  ),
  getViewDefinition: vi.fn(() =>
    Promise.resolve("SELECT id, name FROM users WHERE active = true"),
  ),
}));

describe("schemaStore", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
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
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    await useSchemaStore.getState().loadSchemas("conn1");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Connection refused");
  });

  it("delegates getTableColumns", async () => {
    const { getTableColumns } = await import("@lib/tauri");
    const columns = await useSchemaStore
      .getState()
      .getTableColumns("conn1", "users", "public");

    expect(getTableColumns).toHaveBeenCalledWith("conn1", "users", "public");
    expect(columns).toHaveLength(1);
    expect(columns[0]!.name).toBe("id");
    expect(columns[0]!.is_primary_key).toBe(true);
  });

  it("getTableColumns populates tableColumnsCache for autocomplete", async () => {
    await useSchemaStore.getState().getTableColumns("conn1", "users", "public");
    const state = useSchemaStore.getState();
    expect(state.tableColumnsCache["conn1:public:users"]).toBeDefined();
    expect(state.tableColumnsCache["conn1:public:users"]).toHaveLength(1);
    expect(state.tableColumnsCache["conn1:public:users"]![0]!.name).toBe("id");
  });

  it("clearSchema also drops cached columns for that connection", async () => {
    useSchemaStore.setState({
      tableColumnsCache: {
        "conn1:public:users": [],
        "conn1:public:orders": [],
        "conn2:public:items": [],
      },
    });

    useSchemaStore.getState().clearSchema("conn1");

    const state = useSchemaStore.getState();
    expect(state.tableColumnsCache["conn1:public:users"]).toBeUndefined();
    expect(state.tableColumnsCache["conn1:public:orders"]).toBeUndefined();
    // Other connection preserved
    expect(state.tableColumnsCache["conn2:public:items"]).toBeDefined();
  });

  it("delegates queryTableData", async () => {
    const { queryTableData } = await import("@lib/tauri");
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
    const { getTableIndexes } = await import("@lib/tauri");
    const indexes = await useSchemaStore
      .getState()
      .getTableIndexes("conn1", "users", "public");

    expect(getTableIndexes).toHaveBeenCalledWith("conn1", "users", "public");
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.name).toBe("users_pkey");
    expect(indexes[0]!.is_primary).toBe(true);
  });

  it("delegates getTableConstraints", async () => {
    const { getTableConstraints } = await import("@lib/tauri");
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
    const { queryTableData } = await import("@lib/tauri");
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
    const { queryTableData } = await import("@lib/tauri");

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

  it("[AC-191-01] evictSchemaForName drops tables/views/functions for one (conn, schema)", async () => {
    // Sprint 191 (AC-191-01) — single-schema cache eviction action that
    // replaces the SchemaTree:603 direct setState. Asserts (a) the
    // targeted (conn, schemaName) entries are removed across all three
    // caches and (b) sibling entries (other schemaName, other conn) stay
    // intact so a refresh-this-schema action doesn't blow the rest of the
    // cache. date 2026-05-02.
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 1 }],
        "conn1:private": [{ name: "secrets", schema: "private", row_count: 5 }],
        "conn2:public": [{ name: "orders", schema: "public", row_count: 10 }],
      },
      views: {
        "conn1:public": [
          { name: "v_users", schema: "public", definition: null },
        ],
        "conn1:private": [
          { name: "v_secrets", schema: "private", definition: null },
        ],
      },
      functions: {
        "conn1:public": [
          {
            name: "fn_one",
            schema: "public",
            arguments: null,
            returnType: null,
            language: null,
            source: null,
            kind: "function",
          },
        ],
      },
    });

    useSchemaStore.getState().evictSchemaForName("conn1", "public");

    const state = useSchemaStore.getState();
    expect(state.tables["conn1:public"]).toBeUndefined();
    expect(state.views["conn1:public"]).toBeUndefined();
    expect(state.functions["conn1:public"]).toBeUndefined();
    // Sibling schema and other connection are preserved.
    expect(state.tables["conn1:private"]).toHaveLength(1);
    expect(state.views["conn1:private"]).toHaveLength(1);
    expect(state.tables["conn2:public"]).toHaveLength(1);
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

  it("delegates executeQuery", async () => {
    const { executeQuery } = await import("@lib/tauri");
    (executeQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      columns: [{ name: "id", data_type: "integer" }],
      rows: [[1]],
      total_count: 1,
      execution_time_ms: 3,
      query_type: "select",
    });

    const result = await useSchemaStore
      .getState()
      .executeQuery("conn1", "SELECT 1", "q1");

    expect(executeQuery).toHaveBeenCalledWith("conn1", "SELECT 1", "q1");
    expect(result.total_count).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it("dropTable refreshes table list on success", async () => {
    const { dropTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: 10 },
          { name: "orders", schema: "public", row_count: 5 },
        ],
      },
    });

    (listTables as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "orders", schema: "public", row_count: 5 },
    ]);

    await useSchemaStore.getState().dropTable("conn1", "users", "public");

    expect(dropTable).toHaveBeenCalledWith("conn1", "users", "public");
    expect(listTables).toHaveBeenCalledWith("conn1", "public");
    const state = useSchemaStore.getState();
    expect(state.tables["conn1:public"]).toHaveLength(1);
    expect(state.tables["conn1:public"]![0]!.name).toBe("orders");
  });

  it("dropTable removes table optimistically when refresh fails", async () => {
    const { dropTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: 10 },
          { name: "orders", schema: "public", row_count: 5 },
        ],
      },
    });

    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Refresh failed"),
    );

    await useSchemaStore.getState().dropTable("conn1", "users", "public");

    expect(dropTable).toHaveBeenCalledWith("conn1", "users", "public");
    const state = useSchemaStore.getState();
    // Optimistically removed from cache
    expect(state.tables["conn1:public"]).toHaveLength(1);
    expect(state.tables["conn1:public"]![0]!.name).toBe("orders");
  });

  it("dropTable handles missing cache key gracefully", async () => {
    const { dropTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({ tables: {} });

    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Refresh failed"),
    );

    await useSchemaStore.getState().dropTable("conn1", "users", "public");

    expect(dropTable).toHaveBeenCalledWith("conn1", "users", "public");
    const state = useSchemaStore.getState();
    // No crash, table list stays empty for this key
    expect(state.tables["conn1:public"]).toHaveLength(0);
  });

  it("renameTable refreshes table list on success", async () => {
    const { renameTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 10 }],
      },
    });

    (listTables as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "people", schema: "public", row_count: 10 },
    ]);

    await useSchemaStore
      .getState()
      .renameTable("conn1", "users", "public", "people");

    expect(renameTable).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
    expect(listTables).toHaveBeenCalledWith("conn1", "public");
    const state = useSchemaStore.getState();
    expect(state.tables["conn1:public"]![0]!.name).toBe("people");
  });

  it("renameTable updates table name optimistically when refresh fails", async () => {
    const { renameTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 10 }],
      },
    });

    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Refresh failed"),
    );

    await useSchemaStore
      .getState()
      .renameTable("conn1", "users", "public", "people");

    expect(renameTable).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
    const state = useSchemaStore.getState();
    expect(state.tables["conn1:public"]![0]!.name).toBe("people");
  });

  it("renameTable handles missing cache key gracefully", async () => {
    const { renameTable, listTables } = await import("@lib/tauri");

    useSchemaStore.setState({ tables: {} });

    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Refresh failed"),
    );

    await useSchemaStore
      .getState()
      .renameTable("conn1", "users", "public", "people");

    expect(renameTable).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
    );
    const state = useSchemaStore.getState();
    // No crash, empty array mapped to empty array
    expect(state.tables["conn1:public"]).toHaveLength(0);
  });

  it("handles loadTables error", async () => {
    const { listTables } = await import("@lib/tauri");
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Schema not found"),
    );

    await useSchemaStore.getState().loadTables("conn1", "missing");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Schema not found");
  });

  it("transitions loading state during loadSchemas", async () => {
    let resolveLoad: (value: unknown) => void;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockReturnValueOnce(loadPromise);

    // Start loading
    const call = useSchemaStore.getState().loadSchemas("conn1");
    expect(useSchemaStore.getState().loading).toBe(true);

    // Resolve
    resolveLoad!([{ name: "public" }]);
    await call;
    expect(useSchemaStore.getState().loading).toBe(false);
  });

  it("resets loading to false on loadSchemas error", async () => {
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("fail"),
    );

    await useSchemaStore.getState().loadSchemas("conn1");
    expect(useSchemaStore.getState().loading).toBe(false);
    expect(useSchemaStore.getState().error).toContain("fail");
  });

  it("transitions loading state during loadTables", async () => {
    let resolveLoad: (value: unknown) => void;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const { listTables } = await import("@lib/tauri");
    (listTables as ReturnType<typeof vi.fn>).mockReturnValueOnce(loadPromise);

    const call = useSchemaStore.getState().loadTables("conn1", "public");
    expect(useSchemaStore.getState().loading).toBe(true);

    resolveLoad!([{ name: "users", schema: "public", row_count: 1 }]);
    await call;
    expect(useSchemaStore.getState().loading).toBe(false);
  });

  it("loads views for schema", async () => {
    await useSchemaStore.getState().loadViews("conn1", "public");
    const state = useSchemaStore.getState();
    const key = "conn1:public";
    expect(state.views[key]).toHaveLength(1);
    expect(state.views[key]![0]!.name).toBe("active_users");
    expect(state.views[key]![0]!.definition).toBe(
      "SELECT * FROM users WHERE active = true",
    );
  });

  it("loads functions for schema", async () => {
    await useSchemaStore.getState().loadFunctions("conn1", "public");
    const state = useSchemaStore.getState();
    const key = "conn1:public";
    expect(state.functions[key]).toHaveLength(2);
    expect(state.functions[key]![0]!.name).toBe("calculate_total");
    expect(state.functions[key]![0]!.kind).toBe("function");
    expect(state.functions[key]![1]!.name).toBe("do_migration");
    expect(state.functions[key]![1]!.kind).toBe("procedure");
  });

  it("handles loadViews error", async () => {
    const { listViews } = await import("@lib/tauri");
    (listViews as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Views not accessible"),
    );

    await useSchemaStore.getState().loadViews("conn1", "public");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Views not accessible");
  });

  it("handles loadFunctions error", async () => {
    const { listFunctions } = await import("@lib/tauri");
    (listFunctions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Functions not accessible"),
    );

    await useSchemaStore.getState().loadFunctions("conn1", "public");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Functions not accessible");
  });

  it("clearSchema removes views and functions for connection", async () => {
    useSchemaStore.setState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 1 }],
      },
      views: {
        "conn1:public": [
          { name: "active_users", schema: "public", definition: "SELECT 1" },
        ],
      },
      functions: {
        "conn1:public": [
          {
            name: "calc",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: "SELECT 1",
            kind: "function",
          },
        ],
      },
    });

    useSchemaStore.getState().clearSchema("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toBeUndefined();
    expect(state.tables["conn1:public"]).toBeUndefined();
    expect(state.views["conn1:public"]).toBeUndefined();
    expect(state.functions["conn1:public"]).toBeUndefined();
  });

  it("delegates getViewColumns", async () => {
    const { getViewColumns } = await import("@lib/tauri");
    const columns = await useSchemaStore
      .getState()
      .getViewColumns("conn1", "public", "active_users");

    expect(getViewColumns).toHaveBeenCalledWith(
      "conn1",
      "public",
      "active_users",
    );
    expect(columns).toHaveLength(2);
    expect(columns[0]!.name).toBe("id");
    expect(columns[0]!.is_primary_key).toBe(false);
    expect(columns[1]!.comment).toBe("display name");
  });

  it("delegates getViewDefinition", async () => {
    const { getViewDefinition } = await import("@lib/tauri");
    const sql = await useSchemaStore
      .getState()
      .getViewDefinition("conn1", "public", "active_users");

    expect(getViewDefinition).toHaveBeenCalledWith(
      "conn1",
      "public",
      "active_users",
    );
    expect(sql).toContain("SELECT id, name FROM users");
  });

  it("propagates getViewColumns errors", async () => {
    const { getViewColumns } = await import("@lib/tauri");
    (getViewColumns as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("View does not exist"),
    );

    await expect(
      useSchemaStore
        .getState()
        .getViewColumns("conn1", "public", "missing_view"),
    ).rejects.toThrow("View does not exist");
  });

  it("clearSchema only removes matching connection views/functions", async () => {
    useSchemaStore.setState({
      views: {
        "conn1:public": [{ name: "v1", schema: "public", definition: null }],
        "conn2:public": [{ name: "v2", schema: "public", definition: null }],
      },
      functions: {
        "conn1:public": [
          {
            name: "f1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: null,
            kind: "function",
          },
        ],
        "conn2:public": [
          {
            name: "f2",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: null,
            kind: "function",
          },
        ],
      },
    });

    useSchemaStore.getState().clearSchema("conn1");

    const state = useSchemaStore.getState();
    expect(state.views["conn1:public"]).toBeUndefined();
    expect(state.views["conn2:public"]).toHaveLength(1);
    expect(state.functions["conn1:public"]).toBeUndefined();
    expect(state.functions["conn2:public"]).toHaveLength(1);
  });

  // -- Sprint 130 — clearForConnection (DB switch path) --

  it("clearForConnection drops every cached entry for the connection", () => {
    useSchemaStore.setState({
      schemas: {
        conn1: [{ name: "public" }],
        conn2: [{ name: "public" }],
      },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: null }],
        "conn1:reporting": [
          { name: "orders", schema: "reporting", row_count: null },
        ],
        "conn2:public": [{ name: "users", schema: "public", row_count: null }],
      },
      views: {
        "conn1:public": [
          {
            name: "v1",
            schema: "public",
            definition: null,
          },
        ],
      },
      functions: {
        "conn1:public": [
          {
            name: "fn1",
            schema: "public",
            arguments: null,
            returnType: null,
            language: "sql",
            source: null,
            kind: "function",
          },
        ],
      },
      tableColumnsCache: {
        "conn1:public:users": [],
        "conn2:public:users": [],
      },
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toBeUndefined();
    expect(state.schemas["conn2"]).toHaveLength(1);
    expect(state.tables["conn1:public"]).toBeUndefined();
    expect(state.tables["conn1:reporting"]).toBeUndefined();
    expect(state.tables["conn2:public"]).toHaveLength(1);
    expect(state.views["conn1:public"]).toBeUndefined();
    expect(state.functions["conn1:public"]).toBeUndefined();
    expect(state.tableColumnsCache["conn1:public:users"]).toBeUndefined();
    expect(state.tableColumnsCache["conn2:public:users"]).toEqual([]);
  });

  it("clearForConnection is a no-op when the connection has no cached entries", () => {
    useSchemaStore.setState({
      schemas: { conn2: [{ name: "public" }] },
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
    });
    useSchemaStore.getState().clearForConnection("conn1");
    const state = useSchemaStore.getState();
    expect(state.schemas["conn2"]).toHaveLength(1);
  });
});
