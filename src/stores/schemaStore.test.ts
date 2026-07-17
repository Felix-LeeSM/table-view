import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";
import { useSchemaStore } from "./schemaStore";
beforeEach(() => {
  setupTauriMock({
    listDatabases: vi.fn(() =>
      Promise.resolve([{ name: "app" }, { name: "archive" }]),
    ),
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
    listPostgresExtensions: vi.fn(() =>
      Promise.resolve([
        {
          name: "pgcrypto",
          schema: "public",
          version: "1.3",
          comment: "cryptographic functions",
        },
      ]),
    ),
    listSqliteCapabilities: vi.fn(() =>
      Promise.resolve({ json1: true, fts5: false, rtree: true }),
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
    // Sprint 272 — trigger IPC mock. Default resolves with a single
    // canonical fixture; individual tests override per-call as needed.
    listTriggers: vi.fn(() =>
      Promise.resolve([
        {
          name: "audit_users_insert",
          schema: "public",
          table: "users",
          timing: "BEFORE",
          events: ["INSERT"],
          orientation: "ROW",
          functionSchema: "audit",
          functionName: "log_insert",
          arguments: null,
          whenExpression: null,
          definition:
            "CREATE TRIGGER audit_users_insert BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION audit.log_insert()",
        },
      ]),
    ),
    getTriggerSource: vi.fn(() =>
      Promise.resolve(
        "CREATE TRIGGER audit_users_insert BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION audit.log_insert()",
      ),
    ),
  });
});

describe("schemaStore", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      databases: {},
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
      sqliteCapabilities: {},
      tableColumnsCache: {},
      // Sprint 272 — reset the triggers slice between tests so cache
      // residue from a prior `getTableTriggers` doesn't leak into the
      // next test's "first call should hit IPC" expectation.
      triggers: {},
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it("loads database inventory with a connection-scoped cache", async () => {
    const { listDatabases } = await import("@lib/tauri");

    const first = await useSchemaStore.getState().loadDatabases("conn1");
    const second = await useSchemaStore.getState().loadDatabases("conn1");

    expect(first).toEqual([{ name: "app" }, { name: "archive" }]);
    expect(second).toEqual(first);
    expect(useSchemaStore.getState().databases.conn1).toEqual(first);
    expect(listDatabases).toHaveBeenCalledWith("conn1");
    expect(listDatabases).toHaveBeenCalledTimes(1);
  });

  it("keeps background database inventory failures non-throwing", async () => {
    const { listDatabases } = await import("@lib/tauri");
    (listDatabases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("metadata denied"),
    );

    const result = await useSchemaStore.getState().loadDatabases("conn1");

    expect(result).toEqual([]);
    expect(useSchemaStore.getState().databases.conn1).toBeUndefined();
    expect(useSchemaStore.getState().error).toBeNull();
  });

  it("loads schemas from backend", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toHaveLength(2);
    expect(state.schemas.conn1?.db1![0]!.name).toBe("public");
    expect(state.schemas.conn1?.db1![1]!.name).toBe("test_schema");
  });

  it("loads tables for schema", async () => {
    await useSchemaStore.getState().loadTables("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    const list = state.tables.conn1?.db1?.public;
    expect(list).toHaveLength(2);
    expect(list![0]!.name).toBe("users");
    expect(list![0]!.row_count).toBe(42);
  });

  it("handles load error", async () => {
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Connection refused");
  });

  it("delegates getTableColumns", async () => {
    const { getTableColumns } = await import("@lib/tauri");
    const columns = await useSchemaStore
      .getState()
      .getTableColumns(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );

    // Sprint 271a — forwards `db` as expectedDatabase (4th positional).
    expect(getTableColumns).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(columns).toHaveLength(1);
    expect(columns[0]!.name).toBe("id");
    expect(columns[0]!.is_primary_key).toBe(true);
  });

  it("getTableColumns populates tableColumnsCache for autocomplete", async () => {
    await useSchemaStore
      .getState()
      .getTableColumns(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    const state = useSchemaStore.getState();
    expect(state.tableColumnsCache.conn1?.db1?.public?.users).toBeDefined();
    expect(state.tableColumnsCache.conn1?.db1?.public?.users).toHaveLength(1);
    expect(state.tableColumnsCache.conn1?.db1?.public?.users![0]!.name).toBe(
      "id",
    );
  });

  it("loadPostgresExtensions caches installed extensions by connection and database", async () => {
    const { listPostgresExtensions } = await import("@lib/tauri");
    const first = await useSchemaStore
      .getState()
      .loadPostgresExtensions("conn1", "db1");
    const second = await useSchemaStore
      .getState()
      .loadPostgresExtensions("conn1", "db1");

    expect(listPostgresExtensions).toHaveBeenCalledWith("conn1", "db1");
    expect(listPostgresExtensions).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(useSchemaStore.getState().postgresExtensions.conn1?.db1).toEqual(
      first,
    );
  });

  it("loadSqliteCapabilities caches inventory by connection and database", async () => {
    const { listSqliteCapabilities } = await import("@lib/tauri");
    const first = await useSchemaStore
      .getState()
      .loadSqliteCapabilities("conn1", "db1");
    const second = await useSchemaStore
      .getState()
      .loadSqliteCapabilities("conn1", "db1");

    expect(listSqliteCapabilities).toHaveBeenCalledWith("conn1", "db1");
    expect(listSqliteCapabilities).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(useSchemaStore.getState().sqliteCapabilities.conn1?.db1).toEqual(
      first,
    );
  });

  // 작성 이유 (2026-05-13, Sprint 272 attempt 2): Evaluator P2b —
  // `clearForConnection` is the connection-scope eviction. Until Sprint
  // 272 added the `triggers` slice, this test was implicit; pin it now
  // so a future refactor that forgets to update the eviction spread
  // can't leak stale triggers across connection rebinds.
  it("clearForConnection removes triggers for the connection and preserves siblings", async () => {
    useSchemaStore.setState({
      triggers: {
        conn1: {
          db1: {
            public: {
              users: [
                {
                  name: "audit_users_insert",
                  schema: "public",
                  table: "users",
                  timing: "BEFORE",
                  events: ["INSERT"],
                  orientation: "ROW",
                  functionSchema: "audit",
                  functionName: "log_insert",
                  arguments: null,
                  whenExpression: null,
                  definition: "CREATE TRIGGER ...",
                },
              ],
            },
          },
        },
        conn2: {
          db1: {
            public: {
              items: [],
            },
          },
        },
      },
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    // Targeted connection: triggers slice cleared.
    expect(state.triggers.conn1).toBeUndefined();
    // Sibling connection: untouched.
    expect(state.triggers.conn2?.db1?.public?.items).toEqual([]);
  });

  // Sprint 354 (L2 fix) — `queryTableData` removed from schemaStore;
  // direct tauri.queryTableData calls now live in `DataGrid.tsx`. The
  // delegate-shape assertions belonged to a thin pass-through that no
  // longer exists.

  it("delegates getTableIndexes", async () => {
    const { getTableIndexes } = await import("@lib/tauri");
    const indexes = await useSchemaStore
      .getState()
      .getTableIndexes(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );

    // Sprint 271a — forwards `db` as expectedDatabase (4th positional).
    expect(getTableIndexes).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.name).toBe("users_pkey");
    expect(indexes[0]!.is_primary).toBe(true);
  });

  it("delegates getTableConstraints", async () => {
    const { getTableConstraints } = await import("@lib/tauri");
    const constraints = await useSchemaStore
      .getState()
      .getTableConstraints(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );

    // Sprint 271a — forwards `db` as expectedDatabase (4th positional).
    expect(getTableConstraints).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.constraint_type).toBe("PRIMARY KEY");
  });

  // Sprint 354 (L2 fix) — `queryTableData` filter / rawWhere delegate
  // tests removed alongside the action; the same arg-passing assertions
  // now belong to the DataGrid-level integration tests since the store
  // no longer owns this surface.

  it("[AC-191-01] evictSchemaForName drops tables/views/functions for one (conn, schema)", async () => {
    // Sprint 191 (AC-191-01) — single-schema cache eviction action that
    // replaces the SchemaTree:603 direct setState. Asserts (a) the
    // targeted (conn, schemaName) entries are removed across all three
    // caches and (b) sibling entries (other schemaName, other conn) stay
    // intact so a refresh-this-schema action doesn't blow the rest of the
    // cache. date 2026-05-02.
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
            private: [{ name: "secrets", schema: "private", row_count: 5 }],
          },
        },
        conn2: {
          db1: {
            public: [{ name: "orders", schema: "public", row_count: 10 }],
          },
        },
      },
      views: {
        conn1: {
          db1: {
            public: [{ name: "v_users", schema: "public", definition: null }],
            private: [
              { name: "v_secrets", schema: "private", definition: null },
            ],
          },
        },
      },
      functions: {
        conn1: {
          db1: {
            public: [
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
        },
      },
    });

    useSchemaStore.getState().evictSchemaForName("conn1", "db1", "public");

    const state = useSchemaStore.getState();
    expect(state.tables.conn1?.db1?.public).toBeUndefined();
    expect(state.views.conn1?.db1?.public).toBeUndefined();
    expect(state.functions.conn1?.db1?.public).toBeUndefined();
    // Sibling schema and other connection are preserved.
    expect(state.tables.conn1?.db1?.private).toHaveLength(1);
    expect(state.views.conn1?.db1?.private).toHaveLength(1);
    expect(state.tables.conn2?.db1?.public).toHaveLength(1);
  });

  // Sprint 354 (L2 fix) — `executeQuery` removed from schemaStore;
  // direct tauri.executeQuery calls already lived in
  // `useQueryExecution.ts`, so this delegate test no longer fits.

  it("recordTablesReloaded replaces one schema table cache and preserves siblings", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
            audit: [{ name: "events", schema: "audit", row_count: 2 }],
          },
        },
      },
    });

    useSchemaStore
      .getState()
      .recordTablesReloaded("conn1", "db1", "public", [
        { name: "orders", schema: "public", row_count: 3 },
      ]);

    const state = useSchemaStore.getState();
    expect(state.tables.conn1?.db1?.public).toEqual([
      { name: "orders", schema: "public", row_count: 3 },
    ]);
    expect(state.tables.conn1?.db1?.audit).toEqual([
      { name: "events", schema: "audit", row_count: 2 },
    ]);
  });

  it("recordTableDropped removes the table from cache fallback", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [
              { name: "users", schema: "public", row_count: 1 },
              { name: "orders", schema: "public", row_count: 2 },
            ],
          },
        },
      },
    });

    useSchemaStore
      .getState()
      .recordTableDropped("conn1", "db1", "public", "users");

    expect(useSchemaStore.getState().tables.conn1?.db1?.public).toEqual([
      { name: "orders", schema: "public", row_count: 2 },
    ]);
  });

  it("recordTableRenamed updates cache fallback and handles cache miss", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
    });

    useSchemaStore
      .getState()
      .recordTableRenamed("conn1", "db1", "public", "users", "people");
    useSchemaStore
      .getState()
      .recordTableRenamed("conn1", "db1", "missing", "ghost", "shadow");

    const state = useSchemaStore.getState();
    expect(state.tables.conn1?.db1?.public).toEqual([
      { name: "people", schema: "public", row_count: 1 },
    ]);
    expect(state.tables.conn1?.db1?.missing).toEqual([]);
  });

  it("handles loadTables error", async () => {
    const { listTables } = await import("@lib/tauri");
    (listTables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Schema not found"),
    );

    await useSchemaStore.getState().loadTables("conn1", "db1", "missing");
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
    const call = useSchemaStore.getState().loadSchemas("conn1", "db1");
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

    await useSchemaStore.getState().loadSchemas("conn1", "db1");
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

    const call = useSchemaStore.getState().loadTables("conn1", "db1", "public");
    expect(useSchemaStore.getState().loading).toBe(true);

    resolveLoad!([{ name: "users", schema: "public", row_count: 1 }]);
    await call;
    expect(useSchemaStore.getState().loading).toBe(false);
  });

  it("loads views for schema", async () => {
    await useSchemaStore.getState().loadViews("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    const list = state.views.conn1?.db1?.public;
    expect(list).toHaveLength(1);
    expect(list![0]!.name).toBe("active_users");
    expect(list![0]!.definition).toBe(
      "SELECT * FROM users WHERE active = true",
    );
  });

  it("loads functions for schema", async () => {
    await useSchemaStore.getState().loadFunctions("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    const list = state.functions.conn1?.db1?.public;
    expect(list).toHaveLength(2);
    expect(list![0]!.name).toBe("calculate_total");
    expect(list![0]!.kind).toBe("function");
    expect(list![1]!.name).toBe("do_migration");
    expect(list![1]!.kind).toBe("procedure");
  });

  it("handles loadViews error", async () => {
    const { listViews } = await import("@lib/tauri");
    (listViews as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Views not accessible"),
    );

    await useSchemaStore.getState().loadViews("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Views not accessible");
  });

  it("handles loadFunctions error", async () => {
    const { listFunctions } = await import("@lib/tauri");
    (listFunctions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Functions not accessible"),
    );

    await useSchemaStore.getState().loadFunctions("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    expect(state.error).toContain("Functions not accessible");
  });

  it("delegates getViewColumns", async () => {
    const { getViewColumns } = await import("@lib/tauri");
    const columns = await useSchemaStore
      .getState()
      .getViewColumns("conn1", "db1", "public", "active_users");

    // Sprint 271a — forwards `db` as expectedDatabase (4th positional).
    expect(getViewColumns).toHaveBeenCalledWith(
      "conn1",
      "public",
      "active_users",
      "db1",
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
      .getViewDefinition("conn1", "db1", "public", "active_users");

    // Sprint 271a — forwards `db` as expectedDatabase (4th positional).
    expect(getViewDefinition).toHaveBeenCalledWith(
      "conn1",
      "public",
      "active_users",
      "db1",
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
        .getViewColumns("conn1", "db1", "public", "missing_view"),
    ).rejects.toThrow("View does not exist");
  });

  it("clearForConnection only removes matching connection views/functions", async () => {
    useSchemaStore.setState({
      views: {
        conn1: {
          db1: {
            public: [{ name: "v1", schema: "public", definition: null }],
          },
        },
        conn2: {
          db1: {
            public: [{ name: "v2", schema: "public", definition: null }],
          },
        },
      },
      functions: {
        conn1: {
          db1: {
            public: [
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
          },
        },
        conn2: {
          db1: {
            public: [
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
        },
      },
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.views.conn1?.db1?.public).toBeUndefined();
    expect(state.views.conn2?.db1?.public).toHaveLength(1);
    expect(state.functions.conn1?.db1?.public).toBeUndefined();
    expect(state.functions.conn2?.db1?.public).toHaveLength(1);
  });

  // -- Sprint 130 — clearForConnection (DB switch path) --

  it("clearForConnection drops every cached entry for the connection", () => {
    useSchemaStore.setState({
      schemas: {
        conn1: { db1: [{ name: "public" }] },
        conn2: { db1: [{ name: "public" }] },
      },
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
            reporting: [
              { name: "orders", schema: "reporting", row_count: null },
            ],
          },
        },
        conn2: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: null }],
          },
        },
      },
      views: {
        conn1: {
          db1: {
            public: [
              {
                name: "v1",
                schema: "public",
                definition: null,
              },
            ],
          },
        },
      },
      functions: {
        conn1: {
          db1: {
            public: [
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
        },
      },
      postgresExtensions: {
        conn1: {
          db1: [
            {
              name: "pgcrypto",
              schema: "public",
              version: "1.3",
              comment: null,
            },
          ],
        },
        conn2: {
          db1: [],
        },
      },
      sqliteCapabilities: {
        conn1: { db1: { json1: true, fts5: false, rtree: true } },
        conn2: { db1: { json1: false, fts5: false, rtree: false } },
      },
      tableColumnsCache: {
        conn1: { db1: { public: { users: [] } } },
        conn2: { db1: { public: { users: [] } } },
      },
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toBeUndefined();
    expect(state.schemas.conn2?.db1).toHaveLength(1);
    expect(state.tables.conn1?.db1?.public).toBeUndefined();
    expect(state.tables.conn1?.db1?.reporting).toBeUndefined();
    expect(state.tables.conn2?.db1?.public).toHaveLength(1);
    expect(state.views.conn1?.db1?.public).toBeUndefined();
    expect(state.functions.conn1?.db1?.public).toBeUndefined();
    expect(state.postgresExtensions.conn1?.db1).toBeUndefined();
    expect(state.sqliteCapabilities.conn1?.db1).toBeUndefined();
    expect(state.postgresExtensions.conn2?.db1).toEqual([]);
    expect(state.sqliteCapabilities.conn2?.db1).toEqual({
      json1: false,
      fts5: false,
      rtree: false,
    });
    expect(state.tableColumnsCache.conn1?.db1?.public?.users).toBeUndefined();
    expect(state.tableColumnsCache.conn2?.db1?.public?.users).toEqual([]);
  });

  it("clearForConnection is a no-op when the connection has no cached entries", () => {
    useSchemaStore.setState({
      schemas: { conn2: { db1: [{ name: "public" }] } },
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
    });
    useSchemaStore.getState().clearForConnection("conn1");
    const state = useSchemaStore.getState();
    expect(state.schemas.conn2?.db1).toHaveLength(1);
  });

  // ── Sprint 272 — getTableTriggers cache + eviction ─────────────────────
  //
  // 작성 이유 (2026-05-13, Sprint 272): contract AC-272-05 + AC-272-08
  // — 두 번째 호출이 IPC mock 을 재호출하지 않고 캐시 hit 으로 풀려야
  // 함. eviction 3 사이트 (clearForConnection / clearForWorkspace /
  // evictSchemaForName) 가 triggers 슬라이스를 비우면서 인접 캐시
  // (tables / tableColumnsCache) 는 건드리지 않는 것까지 검증.

  it("getTableTriggers calls the IPC on first miss and caches the result", async () => {
    const { listTriggers } = await import("@lib/tauri");
    const first = await useSchemaStore
      .getState()
      .getTableTriggers(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    expect(first).toHaveLength(1);
    expect(first[0]!.name).toBe("audit_users_insert");
    // Sprint 271a — `db` is forwarded as `expectedDatabase` (the 4th
    // positional argument to the tauri wrapper).
    expect(listTriggers).toHaveBeenCalledWith(
      "conn1",
      "public",
      "users",
      "db1",
    );
    expect(listTriggers).toHaveBeenCalledTimes(1);

    // Cache hit — second call with identical key MUST NOT re-invoke IPC.
    const second = await useSchemaStore
      .getState()
      .getTableTriggers(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    expect(second).toEqual(first);
    expect(listTriggers).toHaveBeenCalledTimes(1);

    const state = useSchemaStore.getState();
    expect(state.triggers.conn1?.db1?.public?.users).toEqual(first);
  });

  it("getTableTriggers re-invokes IPC for a different (db, schema, table) key", async () => {
    const { listTriggers } = await import("@lib/tauri");
    await useSchemaStore
      .getState()
      .getTableTriggers(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    await useSchemaStore
      .getState()
      .getTableTriggers(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "orders" as TableName,
      );
    expect(listTriggers).toHaveBeenCalledTimes(2);
  });

  it("clearForWorkspace evicts only the triggers slice for that (connId, db)", async () => {
    // Seed two workspaces with cached triggers + a sibling tables cache.
    useSchemaStore.setState({
      tables: { conn1: { db1: { public: [] }, db2: { public: [] } } },
      triggers: {
        conn1: {
          db1: { public: { users: [] } },
          db2: { public: { users: [] } },
        },
      },
    });
    useSchemaStore.getState().clearForWorkspace("conn1", "db1");
    const state = useSchemaStore.getState();
    // Targeted workspace: cleared.
    expect(state.triggers.conn1?.db1).toBeUndefined();
    // Sibling workspace: untouched.
    expect(state.triggers.conn1?.db2?.public?.users).toEqual([]);
    // Sibling cache shapes (tables) on the same workspace are still
    // cleared by clearForWorkspace as before — assert byte-equivalence.
    expect(state.tables.conn1?.db1).toBeUndefined();
    expect(state.tables.conn1?.db2?.public).toEqual([]);
  });

  it("evictSchemaForName drops triggers for one (connId, db, schema) without disturbing other caches", () => {
    useSchemaStore.setState({
      tableColumnsCache: {
        conn1: { db1: { public: { users: [] } } },
      },
      triggers: {
        conn1: {
          db1: {
            public: { users: [] },
            audit: { events: [] },
          },
        },
      },
    });
    useSchemaStore.getState().evictSchemaForName("conn1", "db1", "public");
    const state = useSchemaStore.getState();
    expect(state.triggers.conn1?.db1?.public).toBeUndefined();
    expect(state.triggers.conn1?.db1?.audit?.events).toEqual([]);
    // evictSchemaForName intentionally leaves tableColumnsCache alone
    // (pre-Sprint-272 invariant — see store source for rationale).
    expect(state.tableColumnsCache.conn1?.db1?.public?.users).toEqual([]);
  });

  it("getTableTriggers triggers silent syncMismatchedActiveDb on DbMismatch (no toast)", async () => {
    const { listTriggers } = await import("@lib/tauri");
    (listTriggers as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Database mismatch: expected 'db1', but found 'other_db'"),
    );
    await expect(
      useSchemaStore
        .getState()
        .getTableTriggers(
          "conn1",
          "db1" as DatabaseName,
          "public" as SchemaName,
          "users" as TableName,
        ),
    ).rejects.toThrow(/Database mismatch/);
    // The store's mismatch handler is silent for background paths. The
    // registered verifyActiveDb / setActiveDb side-effects are covered by
    // schemaStore.dbMismatch.test.
    const state = useSchemaStore.getState();
    expect(state.triggers.conn1?.db1?.public?.users).toBeUndefined();
  });
});
