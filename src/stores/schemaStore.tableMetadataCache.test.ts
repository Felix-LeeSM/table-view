import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";
import { useSchemaStore } from "./schemaStore";

const INDEXES = [
  {
    name: "users_email_idx",
    columns: ["email"],
    index_type: "btree",
    is_unique: true,
    is_primary: false,
  },
];

const CONSTRAINTS = [
  {
    name: "users_email_key",
    constraint_type: "UNIQUE",
    columns: ["email"],
    reference_table: null,
    reference_columns: null,
  },
];

describe("schemaStore table metadata caches", () => {
  beforeEach(() => {
    setupTauriMock({
      getTableIndexes: vi.fn(() => Promise.resolve(INDEXES)),
      getTableConstraints: vi.fn(() => Promise.resolve(CONSTRAINTS)),
    });
    useSchemaStore.setState({
      databases: {},
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
      sqliteCapabilities: {},
      tableColumnsCache: {},
      tableIndexesCache: {},
      tableConstraintsCache: {},
      triggers: {},
      loading: false,
      error: null,
    });
  });

  it("refreshes table indexes and constraints while caching the latest result", async () => {
    const tauri = await import("@lib/tauri");

    const firstIndexes = await useSchemaStore
      .getState()
      .getTableIndexes(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    const firstConstraints = await useSchemaStore
      .getState()
      .getTableConstraints(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );

    expect(firstIndexes).toEqual(INDEXES);
    expect(firstConstraints).toEqual(CONSTRAINTS);
    expect(tauri.getTableIndexes).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(tauri.getTableConstraints).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );

    await useSchemaStore
      .getState()
      .getTableIndexes(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );
    await useSchemaStore
      .getState()
      .getTableConstraints(
        "conn1",
        "db1" as DatabaseName,
        "public" as SchemaName,
        "users" as TableName,
      );

    expect(tauri.getTableIndexes).toHaveBeenCalledTimes(2);
    expect(tauri.getTableConstraints).toHaveBeenCalledTimes(2);
    expect(
      useSchemaStore.getState().tableIndexesCache.conn1?.db1?.public?.users,
    ).toEqual(INDEXES);
    expect(
      useSchemaStore.getState().tableConstraintsCache.conn1?.db1?.public?.users,
    ).toEqual(CONSTRAINTS);
  });

  it("clears table metadata caches on connection, workspace, and schema eviction", () => {
    seedMetadataCaches();

    useSchemaStore.getState().clearForWorkspace("conn1", "db1");

    let state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1?.db1).toBeUndefined();
    expect(state.tableConstraintsCache.conn1?.db1).toBeUndefined();
    expect(state.tableIndexesCache.conn1?.db2?.public?.users).toEqual([]);
    expect(state.tableConstraintsCache.conn2?.db1?.public?.users).toEqual([]);

    seedMetadataCaches();
    useSchemaStore.getState().evictSchemaForName("conn1", "db1", "public");

    state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1?.db1?.public).toBeUndefined();
    expect(state.tableConstraintsCache.conn1?.db1?.public).toBeUndefined();
    expect(state.tableIndexesCache.conn1?.db1?.audit?.events).toEqual([]);
    expect(state.tableConstraintsCache.conn1?.db1?.audit?.events).toEqual([]);

    seedMetadataCaches();
    useSchemaStore.getState().clearForConnection("conn1");

    state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1).toBeUndefined();
    expect(state.tableConstraintsCache.conn1).toBeUndefined();
    expect(state.tableIndexesCache.conn2?.db1?.public?.users).toEqual([]);
    expect(state.tableConstraintsCache.conn2?.db1?.public?.users).toEqual([]);
  });

  it("drops, rekeys, and prunes table metadata cache entries with table cache mutations", () => {
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [
              { name: "users", schema: "public", row_count: 1 },
              { name: "orders", schema: "public", row_count: 2 },
              { name: "logs", schema: "public", row_count: 3 },
            ],
          },
        },
      },
      tableIndexesCache: {
        conn1: { db1: { public: { users: INDEXES, orders: [], logs: [] } } },
      },
      tableConstraintsCache: {
        conn1: {
          db1: { public: { users: CONSTRAINTS, orders: [], logs: [] } },
        },
      },
    });

    useSchemaStore
      .getState()
      .recordTableDropped("conn1", "db1", "public", "users");

    let state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1?.db1?.public?.users).toBeUndefined();
    expect(
      state.tableConstraintsCache.conn1?.db1?.public?.users,
    ).toBeUndefined();
    expect(state.tableIndexesCache.conn1?.db1?.public?.orders).toEqual([]);

    useSchemaStore
      .getState()
      .recordTableRenamed("conn1", "db1", "public", "orders", "purchases");

    state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1?.db1?.public?.orders).toBeUndefined();
    expect(
      state.tableConstraintsCache.conn1?.db1?.public?.orders,
    ).toBeUndefined();
    expect(state.tableIndexesCache.conn1?.db1?.public?.purchases).toEqual([]);
    expect(state.tableConstraintsCache.conn1?.db1?.public?.purchases).toEqual(
      [],
    );

    useSchemaStore
      .getState()
      .recordTablesReloaded("conn1", "db1", "public", [
        { name: "purchases", schema: "public", row_count: 2 },
      ]);

    state = useSchemaStore.getState();
    expect(state.tableIndexesCache.conn1?.db1?.public?.logs).toBeUndefined();
    expect(
      state.tableConstraintsCache.conn1?.db1?.public?.logs,
    ).toBeUndefined();
    expect(state.tableIndexesCache.conn1?.db1?.public?.purchases).toEqual([]);
  });
});

function seedMetadataCaches(): void {
  useSchemaStore.setState({
    tableIndexesCache: {
      conn1: {
        db1: { public: { users: [] }, audit: { events: [] } },
        db2: { public: { users: [] } },
      },
      conn2: { db1: { public: { users: [] } } },
    },
    tableConstraintsCache: {
      conn1: {
        db1: { public: { users: [] }, audit: { events: [] } },
        db2: { public: { users: [] } },
      },
      conn2: { db1: { public: { users: [] } } },
    },
  });
}
