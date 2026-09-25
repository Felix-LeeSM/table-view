// schemaStore's `(connId, db)` per-workspace cache isolation (2026-05-12).
// Runs the seven AC-263-01 TDD cases in tracer bullet → increment order to
// lock the store data structure and action signatures.
//
// This file focuses only on the db-aware behavior. schemaStore.test.ts was
// migrated to the same indexing convention (connId-only → (connId, db)
// nesting), and the equivalent cases are verified again there.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { useSchemaStore } from "./schemaStore";

beforeEach(() => {
  setupTauriMock({
    listSchemas: vi.fn(() => Promise.resolve([{ name: "public" }])),
    listTables: vi.fn(() =>
      Promise.resolve([{ name: "users", schema: "public", row_count: null }]),
    ),
    listViews: vi.fn(() => Promise.resolve([])),
    listFunctions: vi.fn(() => Promise.resolve([])),
    listSchemaColumns: vi.fn(() => Promise.resolve({})),
    // Unused in this file but the mock must satisfy import surface.
    getTableColumns: vi.fn(),
    getTableIndexes: vi.fn(),
    getTableConstraints: vi.fn(),
    getViewColumns: vi.fn(),
    getViewDefinition: vi.fn(),
    queryTableData: vi.fn(),
    dropTable: vi.fn(),
    executeQuery: vi.fn(),
    executeQueryBatch: vi.fn(),
    renameTable: vi.fn(),
  });
});

describe("schemaStore — db-aware caching (Sprint 263)", () => {
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
      loading: false,
      error: null,
    });
  });

  // -- Tracer bullet --------------------------------------------------------

  it("loadSchemas writes under workspaces[connId][db]", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toEqual([{ name: "public" }]);
    // The db2 slot is lazy — not created.
    expect(state.schemas.conn1?.db2).toBeUndefined();
  });

  // -- Multi-DB isolation ---------------------------------------------------

  it("loadSchemas on (conn1, db1) and (conn1, db2) keeps two independent slots", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    await useSchemaStore.getState().loadSchemas("conn1", "db2");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toEqual([{ name: "public" }]);
    expect(state.schemas.conn1?.db2).toEqual([{ name: "public" }]);
    // The two slots are different references (isolation guarantee).
    expect(state.schemas.conn1!.db1).not.toBe(state.schemas.conn1!.db2);
  });

  it("loadTables keys under [connId][db][schema]", async () => {
    await useSchemaStore.getState().loadTables("conn1", "db1", "public");

    const state = useSchemaStore.getState();
    expect(state.tables.conn1?.db1?.public).toEqual([
      { name: "users", schema: "public", row_count: null },
    ]);
    expect(state.tables.conn1?.db2).toBeUndefined();
  });

  // -- Eviction --------------------------------------------------------------

  it("clearForWorkspace drops only the targeted (connId, db) — sibling db intact", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    await useSchemaStore.getState().loadSchemas("conn1", "db2");
    await useSchemaStore.getState().loadTables("conn1", "db1", "public");
    await useSchemaStore.getState().loadTables("conn1", "db2", "public");
    useSchemaStore.setState({
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
          db2: [],
        },
      },
      sqliteCapabilities: {
        conn1: {
          db1: { json1: true, fts5: false, rtree: false },
          db2: { json1: false, fts5: false, rtree: false },
        },
      },
    });

    useSchemaStore.getState().clearForWorkspace("conn1", "db1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toBeUndefined();
    expect(state.schemas.conn1?.db2).toEqual([{ name: "public" }]);
    expect(state.tables.conn1?.db1).toBeUndefined();
    expect(state.tables.conn1?.db2?.public).toBeDefined();
    expect(state.postgresExtensions.conn1?.db1).toBeUndefined();
    expect(state.postgresExtensions.conn1?.db2).toEqual([]);
    expect(state.sqliteCapabilities.conn1?.db1).toBeUndefined();
    expect(state.sqliteCapabilities.conn1?.db2).toEqual({
      json1: false,
      fts5: false,
      rtree: false,
    });
  });

  it("clearForConnection drops every db slot for the connection", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    await useSchemaStore.getState().loadSchemas("conn1", "db2");
    await useSchemaStore.getState().loadSchemas("conn2", "db1");
    useSchemaStore.setState({
      postgresExtensions: {
        conn1: { db1: [], db2: [] },
        conn2: { db1: [] },
      },
      sqliteCapabilities: {
        conn1: {
          db1: { json1: true, fts5: false, rtree: false },
          db2: { json1: false, fts5: true, rtree: false },
        },
        conn2: { db1: { json1: false, fts5: false, rtree: true } },
      },
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1).toBeUndefined();
    expect(state.schemas.conn2?.db1).toEqual([{ name: "public" }]);
    expect(state.postgresExtensions.conn1).toBeUndefined();
    expect(state.postgresExtensions.conn2?.db1).toEqual([]);
    expect(state.sqliteCapabilities.conn1).toBeUndefined();
    expect(state.sqliteCapabilities.conn2?.db1).toEqual({
      json1: false,
      fts5: false,
      rtree: true,
    });
  });

  it("evictSchemaForName drops only the (connId, db, schemaName) triple", async () => {
    await useSchemaStore.getState().loadTables("conn1", "db1", "public");
    await useSchemaStore.getState().loadTables("conn1", "db1", "analytics");
    await useSchemaStore.getState().loadTables("conn1", "db2", "public");

    useSchemaStore.getState().evictSchemaForName("conn1", "db1", "public");

    const state = useSchemaStore.getState();
    expect(state.tables.conn1?.db1?.public).toBeUndefined();
    expect(state.tables.conn1?.db1?.analytics).toBeDefined();
    expect(state.tables.conn1?.db2?.public).toBeDefined();
  });

  // -- toggle round-trip cache preservation ---------------------------------

  it("DB toggle round-trip preserves db1 cache when no clearForWorkspace is called", async () => {
    // The reason the cache is split by db — now that DbSwitcher no longer
    // calls clearForConnection, the db1 cache must survive a
    // db1 → db2 → db1 round-trip intact.
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    const db1Snap = useSchemaStore.getState().schemas.conn1!.db1;

    await useSchemaStore.getState().loadSchemas("conn1", "db2");

    // The db1 slot keeps its reference — the toggle did not lose the cache.
    expect(useSchemaStore.getState().schemas.conn1!.db1).toBe(db1Snap);
  });
});
