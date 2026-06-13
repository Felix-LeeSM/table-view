// 작성 2026-05-16 (Phase 2 sprint-360).
//
// 사유: Q23 self-window schemaCache invalidate — DDL 후 사이드바가 100ms 안에
// `foo` 를 표시하려면 `clearForConnection(connId)` 가 그 conn 의 **모든** 캐시
// 슬롯(databases / schemas / tables / views / functions / postgresExtensions /
// sqliteCapabilities / tableColumnsCache / tableIndexesCache /
// tableConstraintsCache / triggers)을
// 한 번에 비워 wide drop 을 보장해야 한다. Sprint 130/263 의 기존 행동을
// sprint-360 의 contract 어휘 (AC-360-01 / AC-360-05) 로 다시 고정한다.

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
    listTriggers: vi.fn(() => Promise.resolve([])),
    getTableColumns: vi.fn(() => Promise.resolve([])),
    listSchemaColumns: vi.fn(() => Promise.resolve({})),
  });
});

const SEEDED_CACHE = {
  databases: {
    conn1: [{ name: "db1" }],
    conn2: [{ name: "db1" }],
  },
  schemas: {
    conn1: { db1: [{ name: "public" }] },
    conn2: { db1: [{ name: "public" }] },
  },
  tables: {
    conn1: {
      db1: {
        public: [{ name: "users", schema: "public", row_count: null }],
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
      db1: { public: [{ name: "v1", schema: "public", definition: null }] },
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
            kind: "function" as const,
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
    conn2: { db1: [] },
  },
  sqliteCapabilities: {
    conn1: { db1: { json1: true, fts5: false, rtree: true } },
    conn2: { db1: { json1: false, fts5: false, rtree: false } },
  },
  tableColumnsCache: {
    conn1: { db1: { public: { users: [] } } },
    conn2: { db1: { public: { users: [] } } },
  },
  tableIndexesCache: {
    conn1: { db1: { public: { users: [] } } },
    conn2: { db1: { public: { users: [] } } },
  },
  tableConstraintsCache: {
    conn1: { db1: { public: { users: [] } } },
    conn2: { db1: { public: { users: [] } } },
  },
  triggers: {
    conn1: {
      db1: {
        public: {
          users: [
            {
              name: "trg",
              schema: "public",
              table: "users",
              timing: "BEFORE",
              events: ["INSERT"],
              orientation: "ROW",
              functionSchema: "audit",
              functionName: "log",
              arguments: null,
              whenExpression: null,
              definition: "",
            },
          ],
        },
      },
    },
  },
  loading: false,
  error: null,
};

describe("schemaStore.clearForConnection (sprint-360 Phase 2 Q23)", () => {
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
      tableIndexesCache: {},
      tableConstraintsCache: {},
      triggers: {},
      loading: false,
      error: null,
    });
  });

  // AC-360-01 — `clearForConnection(connId)` 호출 후 그 conn 의 모든 캐시
  // 슬롯이 완전히 비워진다 (`byConnection[connId]` 전체 빈 상태).
  it("AC-360-01: drops every cached slot for the connection (wide)", () => {
    useSchemaStore.setState(SEEDED_CACHE);

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.databases.conn1).toBeUndefined();
    expect(state.schemas.conn1).toBeUndefined();
    expect(state.tables.conn1).toBeUndefined();
    expect(state.views.conn1).toBeUndefined();
    expect(state.functions.conn1).toBeUndefined();
    expect(state.postgresExtensions.conn1).toBeUndefined();
    expect(state.sqliteCapabilities.conn1).toBeUndefined();
    expect(state.tableColumnsCache.conn1).toBeUndefined();
    expect(state.tableIndexesCache.conn1).toBeUndefined();
    expect(state.tableConstraintsCache.conn1).toBeUndefined();
    expect(state.triggers.conn1).toBeUndefined();
  });

  // AC-360-05 — narrow drop 안 함. `foo` table 만 추가했어도 views /
  // functions / triggers / tableColumnsCache 등 전부 wide drop 후 mount
  // 시점에 refetch 한다. 다른 conn 은 손대지 않는다.
  it("AC-360-05: leaves other connections' caches intact (no narrow scope)", () => {
    useSchemaStore.setState(SEEDED_CACHE);

    useSchemaStore.getState().clearForConnection("conn1");

    const state = useSchemaStore.getState();
    expect(state.databases.conn2).toEqual([{ name: "db1" }]);
    expect(state.schemas.conn2?.db1).toHaveLength(1);
    expect(state.tables.conn2?.db1?.public).toHaveLength(1);
    expect(state.postgresExtensions.conn2?.db1).toEqual([]);
    expect(state.sqliteCapabilities.conn2?.db1).toEqual({
      json1: false,
      fts5: false,
      rtree: false,
    });
    expect(state.tableColumnsCache.conn2?.db1?.public?.users).toEqual([]);
    expect(state.tableIndexesCache.conn2?.db1?.public?.users).toEqual([]);
    expect(state.tableConstraintsCache.conn2?.db1?.public?.users).toEqual([]);
  });
});
