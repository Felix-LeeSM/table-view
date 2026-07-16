/**
 * Sprint 309 (Phase 28 Slice A3) — store axis for Find/Aggregate toggle
 * removal. Two RED tests authored 2026-05-14 to lock the backward-compat
 * contract:
 *
 *   1. `addQueryTab` on a document paradigm tab MUST leave `queryMode`
 *      undefined. Pre-sprint-309 the store defaulted to `"find"` so the
 *      toggle had something to read; post-sprint-309 the toggle is gone
 *      and the dispatch path in `useQueryExecution` tolerates undefined
 *      (falls through the legacy `=== "aggregate"` check into find).
 *      A5 (sprint-311) will replace the dispatch branch entirely.
 *
 *   2. Loading a persisted localStorage payload that still carries
 *      `queryMode: "find" | "aggregate"` on a document tab must NOT
 *      throw and must NOT discard the field — it survives the migration
 *      so the legacy dispatch branch remains observable until A5. New
 *      tabs created after the rehydrate continue to land without the
 *      field.
 *
 * These tests live in their own file (not piggy-backed on the existing
 * lifecycle / persistence suites) so the contract is greppable by sprint
 * label and so deleting the deprecation in a later sprint is a single
 * file delete instead of a scatter-edit.
 */
/* eslint-disable @typescript-eslint/no-deprecated -- #1403: this whole suite exercises the deliberately-deprecated QueryTab.queryMode contract; it is deleted wholesale when sprint-311 A5 lands */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import {
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";

describe("workspaceStore — Sprint 309 queryMode backward-compat", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it("addQueryTab on a document paradigm leaves queryMode undefined (Sprint 309)", () => {
    useWorkspaceStore.getState().addQueryTab("conn-mongo", "appdb", {
      paradigm: "document",
      database: "appdb",
      collection: "users",
    });

    const ws = useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"];
    expect(ws).toBeDefined();
    const tab = ws!.tabs[0]!;
    expect(tab.type).toBe("query");
    if (tab.type === "query") {
      // Pre-sprint-309 this would have been `"find"`. Post-A3 the field
      // is deliberately absent on new document tabs — the editor surface
      // no longer carries a Find/Aggregate toggle, and A5 will replace
      // the legacy dispatch branch keyed on `=== "aggregate"`. `undefined`
      // is the intended "default to find dispatch" path during the
      // interim.
      expect(tab.queryMode).toBeUndefined();
      expect(tab.paradigm).toBe("document");
    }
  });

  it("addQueryTab on an rdb paradigm still sets queryMode to 'sql'", () => {
    // Regression guard: the sql tab path is unchanged. SQL is the only
    // remaining queryMode that production code actively consumes (RDB
    // history filtering + execute pipeline both still read it).
    useWorkspaceStore.getState().addQueryTab("conn-pg", "appdb", {
      paradigm: "rdb",
    });

    const ws = useWorkspaceStore.getState().workspaces["conn-pg"]?.["appdb"];
    const tab = ws!.tabs[0]!;
    if (tab.type === "query") {
      expect(tab.queryMode).toBe("sql");
      expect(tab.paradigm).toBe("rdb");
    }
  });

  it("loadPersistedWorkspaces tolerates a legacy document tab with queryMode='aggregate' (Sprint 309)", () => {
    // Synthesise a localStorage payload that mirrors what a user upgrading
    // from a pre-sprint-309 build will have on disk: a document query tab
    // that was last used in Aggregate mode. The migration path must keep
    // the field (so the legacy dispatch branch keeps routing aggregate
    // text to `aggregateDocuments` until A5 replaces the dispatch) and
    // MUST NOT throw at load time.
    const legacyPayload = {
      workspaces: {
        "conn-mongo": {
          appdb: {
            tabs: [
              {
                type: "query",
                id: "query-legacy-1",
                title: "Query 1",
                connectionId: "conn-mongo",
                closable: true,
                sql: '[{"$match":{"active":true}}]',
                queryState: { status: "idle" },
                paradigm: "document",
                queryMode: "aggregate",
                database: "appdb",
                collection: "users",
              },
            ],
            activeTabId: "query-legacy-1",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    };
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify(legacyPayload),
    );

    expect(() =>
      useWorkspaceStore.getState().loadPersistedWorkspaces(),
    ).not.toThrow();

    const ws = useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    const tab = ws!.tabs[0]!;
    expect(tab.type).toBe("query");
    if (tab.type === "query") {
      // Backward-compat: the field survives the rehydrate so the legacy
      // `useQueryExecution` dispatch branch continues to route aggregate
      // text to `aggregateDocuments` (sprint-311 A5 replaces this with
      // parser-driven dispatch).
      expect(tab.queryMode).toBe("aggregate");
      expect(tab.paradigm).toBe("document");
      expect(tab.sql).toBe('[{"$match":{"active":true}}]');
    }
  });

  it("loadPersistedWorkspaces tolerates a legacy document tab with queryMode='find' (Sprint 309)", () => {
    // Companion to the aggregate case above. A pre-sprint-309 doc tab
    // that was last used in Find mode must rehydrate cleanly and keep
    // the `"find"` flag — even though it has no observable effect on
    // the editor surface anymore, the legacy dispatch branch still
    // reads it (and returns `false` against `=== "aggregate"`, which
    // is the intended "route to find" path).
    const legacyPayload = {
      workspaces: {
        "conn-mongo": {
          appdb: {
            tabs: [
              {
                type: "query",
                id: "query-legacy-find",
                title: "Query 1",
                connectionId: "conn-mongo",
                closable: true,
                sql: '{"active":true}',
                queryState: { status: "idle" },
                paradigm: "document",
                queryMode: "find",
                database: "appdb",
                collection: "users",
              },
            ],
            activeTabId: "query-legacy-find",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    };
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify(legacyPayload),
    );

    expect(() =>
      useWorkspaceStore.getState().loadPersistedWorkspaces(),
    ).not.toThrow();

    const tab =
      useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"]?.tabs[0];
    if (tab?.type === "query") {
      expect(tab.queryMode).toBe("find");
    }
  });

  it("loadPersistedWorkspaces backfills queryLanguage metadata without changing legacy queryMode", () => {
    const legacyPayload = {
      workspaces: {
        "conn-pg": {
          appdb: {
            tabs: [
              {
                type: "query",
                id: "query-rdb",
                title: "Query 1",
                connectionId: "conn-pg",
                closable: true,
                sql: "SELECT 1",
                queryState: { status: "completed" },
                paradigm: "rdb",
                queryMode: "sql",
                database: "appdb",
              },
            ],
            activeTabId: "query-rdb",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
        "conn-mongo": {
          appdb: {
            tabs: [
              {
                type: "query",
                id: "query-document",
                title: "Query 2",
                connectionId: "conn-mongo",
                closable: true,
                sql: "db.users.find({})",
                queryState: { status: "completed" },
                paradigm: "document",
                queryMode: "find",
                database: "appdb",
                collection: "users",
              },
            ],
            activeTabId: "query-document",
            closedTabHistory: [
              {
                type: "query",
                id: "query-closed-aggregate",
                title: "Query 3",
                connectionId: "conn-mongo",
                closable: true,
                sql: "db.users.aggregate([])",
                queryState: { status: "completed" },
                paradigm: "document",
                queryMode: "aggregate",
                database: "appdb",
                collection: "users",
              },
            ],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    };
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify(legacyPayload),
    );

    useWorkspaceStore.getState().loadPersistedWorkspaces();

    const rdbTab =
      useWorkspaceStore.getState().workspaces["conn-pg"]?.["appdb"]?.tabs[0];
    const documentWs =
      useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"];
    const documentTab = documentWs?.tabs[0];
    const closedDocumentTab = documentWs?.closedTabHistory[0];

    if (rdbTab?.type !== "query") throw new Error("Expected RDB query tab");
    if (documentTab?.type !== "query") {
      throw new Error("Expected document query tab");
    }
    if (closedDocumentTab?.type !== "query") {
      throw new Error("Expected closed document query tab");
    }

    expect(rdbTab.queryMode).toBe("sql");
    expect(rdbTab.queryLanguage).toBe("sql");
    expect(documentTab.queryMode).toBe("find");
    expect(documentTab.queryLanguage).toBe("mongosh");
    expect(closedDocumentTab.queryMode).toBe("aggregate");
    expect(closedDocumentTab.queryLanguage).toBe("mongosh");
  });

  it.each([
    ["findOne", undefined],
    ["countDocuments", undefined],
    ["deleteMany", undefined],
    ["find", "find"],
    ["aggregate", "aggregate"],
  ] as const)(
    "loadPersistedWorkspaces keeps only legacy document tab queryMode '%s' as workspace compat '%s'",
    (rawQueryMode, expectedQueryMode) => {
      const persistedPayload = {
        workspaces: {
          "conn-mongo": {
            appdb: {
              tabs: [
                {
                  type: "query",
                  id: `query-${rawQueryMode}`,
                  title: "Query 1",
                  connectionId: "conn-mongo",
                  closable: true,
                  sql: "db.users.find({})",
                  queryState: { status: "idle" },
                  paradigm: "document",
                  queryMode: rawQueryMode,
                  database: "appdb",
                  collection: "users",
                },
              ],
              activeTabId: `query-${rawQueryMode}`,
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      };
      window.localStorage.setItem(
        "table-view-workspaces",
        JSON.stringify(persistedPayload),
      );

      useWorkspaceStore.getState().loadPersistedWorkspaces();

      const tab =
        useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"]
          ?.tabs[0];
      if (tab?.type !== "query") throw new Error("Expected query tab");
      expect(tab.queryMode).toBe(expectedQueryMode);
    },
  );

  it("loadPersistedWorkspaces sanitizes raw rdb queryMode to sql", () => {
    const persistedPayload = {
      workspaces: {
        "conn-pg": {
          appdb: {
            tabs: [
              {
                type: "query",
                id: "query-rdb-raw-mode",
                title: "Query 1",
                connectionId: "conn-pg",
                closable: true,
                sql: "SELECT 1",
                queryState: { status: "idle" },
                paradigm: "rdb",
                queryMode: "deleteMany",
                database: "appdb",
              },
            ],
            activeTabId: "query-rdb-raw-mode",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    };
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify(persistedPayload),
    );

    useWorkspaceStore.getState().loadPersistedWorkspaces();

    const tab =
      useWorkspaceStore.getState().workspaces["conn-pg"]?.["appdb"]?.tabs[0];
    if (tab?.type !== "query") throw new Error("Expected query tab");
    expect(tab.queryMode).toBe("sql");
  });

  it.each([["findOne"], ["count"], ["insertOne"], ["aggregate"]] as const)(
    "loadQueryIntoTab routes Mongo history queryMode '%s' through queryLanguage only",
    (historyQueryMode) => {
      useWorkspaceStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: historyQueryMode,
        database: "appdb",
        collection: "users",
        sql: "db.users.find({})",
      });

      const tab =
        useWorkspaceStore.getState().workspaces["conn-mongo"]?.["appdb"]
          ?.tabs[0];
      if (tab?.type !== "query") throw new Error("Expected query tab");
      expect(tab.queryMode).toBeUndefined();
      expect(tab.queryLanguage).toBe("mongosh");
      expect(tab.sql).toBe("db.users.find({})");
    },
  );
});
