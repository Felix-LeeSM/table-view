// Written 2026-05-16 (state-management-strategy Phase 2).
//
// Reason: Q23 self-window schemaCache invalidate — for the sidebar to show
// `foo` within 100ms after a DDL, `clearForConnection(connId)` must empty
// **every** cache slot of that conn (databases / schemas / tables / views /
// functions / postgresExtensions / sqliteCapabilities / tableColumnsCache /
// tableIndexesCache / tableConstraintsCache / triggers /
// fileAnalyticsSources) in one go to guarantee a wide drop. This file
// re-pins the existing behavior in the contract terms AC-360-01 / AC-360-05.
//
// SOT consolidation (2026-07-22, issue #1631 test-audit): the remaining
// clearForConnection cases scattered across schemaStore.test.ts
// (triggers/views/functions siblings, drops-every, no-op) moved into this
// canonical 11-slot suite. schemaStore.test.ts keeps no clearForConnection
// case.

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
    conn2: {
      db1: { public: [{ name: "v2", schema: "public", definition: null }] },
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
    conn2: {
      db1: {
        public: [
          {
            name: "fn2",
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
    conn2: {
      db1: {
        public: {
          items: [],
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

  // AC-360-01 — after `clearForConnection(connId)`, every cache slot of that
  // conn is fully emptied (`byConnection[connId]` entirely empty).
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

  // AC-360-05 — no narrow drop. Even when only the `foo` table was added,
  // views / functions / triggers / tableColumnsCache and the rest all get the
  // wide drop and are refetched at mount time. Other conns are left untouched.
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
    // views / functions / triggers sibling preservation — moved here by
    // issue #1631 (absorbs into this SOT the conn2 sibling assertions that
    // were at schemaStore.test.ts:741,354).
    expect(state.views.conn2?.db1?.public).toHaveLength(1);
    expect(state.functions.conn2?.db1?.public).toHaveLength(1);
    expect(state.triggers.conn2?.db1?.public?.items).toEqual([]);
  });

  // no-op edge — even when the target conn has no cache at all,
  // clearForConnection does not throw and leaves the sibling conn as is.
  // Moved from schemaStore.test.ts:898 (SOT consolidation, issue #1631).
  it("is a no-op when the connection has no cached entries", () => {
    useSchemaStore.setState({
      schemas: { conn2: { db1: [{ name: "public" }] } },
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
    });

    useSchemaStore.getState().clearForConnection("conn1");

    expect(useSchemaStore.getState().schemas.conn2?.db1).toHaveLength(1);
  });
});
