// Sprint 263 (2026-05-12) — schemaStore 의 `(connId, db)` per-workspace
// 캐시 격리. AC-263-01 의 7 TDD 케이스를 트레이서 불릿 → 증분 순서로
// 실행해 store 자료구조와 액션 시그니처를 잠근다.
//
// 본 파일은 신규 db-aware 동작에만 집중. 기존 schemaStore.test.ts 는 같은
// 인덱싱 컨벤션 (connId-only → (connId, db) 네스트) 마이그레이션 후
// 동등한 케이스가 그곳에서 다시 검증된다.

import { describe, it, expect, vi, beforeEach } from "vitest";
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
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
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
    // db2 자리는 lazy — 미생성.
    expect(state.schemas.conn1?.db2).toBeUndefined();
  });

  // -- Multi-DB isolation ---------------------------------------------------

  it("loadSchemas on (conn1, db1) and (conn1, db2) keeps two independent slots", async () => {
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    await useSchemaStore.getState().loadSchemas("conn1", "db2");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toEqual([{ name: "public" }]);
    expect(state.schemas.conn1?.db2).toEqual([{ name: "public" }]);
    // 두 자리는 서로 다른 reference (격리 보증).
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
    });

    useSchemaStore.getState().clearForWorkspace("conn1", "db1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toBeUndefined();
    expect(state.schemas.conn1?.db2).toEqual([{ name: "public" }]);
    expect(state.tables.conn1?.db1).toBeUndefined();
    expect(state.tables.conn1?.db2?.public).toBeDefined();
    expect(state.postgresExtensions.conn1?.db1).toBeUndefined();
    expect(state.postgresExtensions.conn1?.db2).toEqual([]);
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
    });

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.schemas.conn1).toBeUndefined();
    expect(state.schemas.conn2?.db1).toEqual([{ name: "public" }]);
    expect(state.postgresExtensions.conn1).toBeUndefined();
    expect(state.postgresExtensions.conn2?.db1).toEqual([]);
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
    // Sprint 263 의 raison d'être — DbSwitcher 가 더 이상
    // clearForConnection 을 호출하지 않을 때, db1 → db2 → db1 round-trip
    // 후 db1 캐시가 손실 없이 그대로여야 한다.
    await useSchemaStore.getState().loadSchemas("conn1", "db1");
    const db1Snap = useSchemaStore.getState().schemas.conn1!.db1;

    await useSchemaStore.getState().loadSchemas("conn1", "db2");

    // db1 자리는 reference 동일 — toggle 이 캐시를 잃지 않았다.
    expect(useSchemaStore.getState().schemas.conn1!.db1).toBe(db1Snap);
  });
});
