import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";
import type { QueryState } from "@/types/query";
import { makeTableTab, getQueryTab } from "./__tests__/tabStoreTestHelpers";

describe("tabStore — query tab actions + loadQueryIntoTab", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
    });
  });

  // -- Query tab tests -------------------------------------------------------

  describe("query tab actions", () => {
    it("adds a query tab", () => {
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      const qt = getQueryTab(state, 0);
      expect(qt.type).toBe("query");
      expect(qt.connectionId).toBe("conn1");
      expect(qt.sql).toBe("");
      expect(qt.queryState).toEqual({ status: "idle" });
      expect(qt.closable).toBe(true);
      expect(state.activeTabId).toBe(qt.id);
    });

    it("does not deduplicate query tabs", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
    });

    it("updates query SQL", () => {
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tabId = stateBefore.tabs[0]!.id;

      useTabStore.getState().updateQuerySql(tabId, "SELECT 1");

      const state = useTabStore.getState();
      expect(getQueryTab(state, 0).sql).toBe("SELECT 1");
    });

    it("updates query state", () => {
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tabId = stateBefore.tabs[0]!.id;

      const newState: QueryState = {
        status: "completed",
        result: {
          columns: [],
          rows: [],
          total_count: 0,
          execution_time_ms: 5,
          query_type: "ddl",
        },
      };
      useTabStore.getState().updateQueryState(tabId, newState);

      const state = useTabStore.getState();
      expect(getQueryTab(state, 0).queryState.status).toBe("completed");
    });

    it("updateQuerySql only affects query tabs", () => {
      const tableTab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tableTab);
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tableTabId = stateBefore.tabs[0]!.id;

      // This should be a no-op for table tabs
      useTabStore.getState().updateQuerySql(tableTabId, "SELECT 1");

      const state = useTabStore.getState();
      expect(state.tabs[0]!.type).toBe("table");
      // Table tab should not have sql property modified
    });

    // -- Sprint 73: paradigm + queryMode fields ------------------------------

    it("addQueryTab without opts defaults to paradigm=rdb + queryMode=sql", () => {
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
      // database/collection must be undefined for rdb tabs.
      expect(qt.database).toBeUndefined();
      expect(qt.collection).toBeUndefined();
    });

    it("addQueryTab with document + aggregate preserves the opts", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("document");
      expect(qt.queryMode).toBe("aggregate");
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });

    it("addQueryTab with paradigm=document defaults queryMode to find", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("document");
      expect(qt.queryMode).toBe("find");
    });

    it("addQueryTab with paradigm=rdb forces queryMode to sql even if caller asks otherwise", () => {
      useTabStore.getState().addQueryTab("conn1", {
        paradigm: "rdb",
        // Nonsensical combination — the store must normalize to "sql" so the
        // UI can't wedge itself into an unreachable state.
        queryMode: "aggregate",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode toggles between find and aggregate on document tabs", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "db",
        collection: "users",
      });

      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().setQueryMode(tabId, "aggregate");

      let qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("aggregate");

      useTabStore.getState().setQueryMode(tabId, "find");
      qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("find");
    });

    it("setQueryMode on an rdb tab rejects non-sql modes", () => {
      useTabStore.getState().addQueryTab("conn1");
      const tabId = useTabStore.getState().tabs[0]!.id;

      useTabStore.getState().setQueryMode(tabId, "aggregate");

      const qt = getQueryTab(useTabStore.getState(), 0);
      // Must stay "sql" — the store guards against paradigm/mode drift.
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode on a non-existent tab is a no-op", () => {
      useTabStore.getState().addQueryTab("conn1");
      // Should not throw.
      useTabStore.getState().setQueryMode("ghost-id", "aggregate");

      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode is a no-op when mode already matches current value", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
      });
      const snapshotBefore = useTabStore.getState().tabs[0];

      useTabStore.getState().setQueryMode(snapshotBefore!.id, "find");

      // Referential equality — the tab object is not replaced when unchanged.
      const snapshotAfter = useTabStore.getState().tabs[0];
      expect(snapshotAfter).toBe(snapshotBefore);
    });
  });

  // -- Sprint 84: loadQueryIntoTab helper -----------------------------------
  // AC-06..AC-10 map to the branches below. The helper is paradigm-aware:
  // it spawns a new tab when the entry targets a different paradigm or
  // connection, and updates in place when the active tab is compatible.

  describe("loadQueryIntoTab", () => {
    // AC-07 branch: no active tab → spawn new query tab.
    it("spawns a new query tab when there is no active tab", () => {
      expect(useTabStore.getState().tabs).toHaveLength(0);

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 1",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      const qt = getQueryTab(state, 0);
      expect(qt.connectionId).toBe("conn1");
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
      expect(qt.sql).toBe("SELECT 1");
      expect(state.activeTabId).toBe(qt.id);
    });

    // AC-07 branch: active tab is a table tab → spawn new query tab so the
    // table context is preserved.
    it("spawns a new query tab when the active tab is a table tab", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tableTabId = useTabStore.getState().tabs[0]!.id;
      expect(useTabStore.getState().activeTabId).toBe(tableTabId);

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 1",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      // The original table tab stays put, the new tab is a query tab.
      expect(state.tabs[0]!.type).toBe("table");
      expect(state.tabs[1]!.type).toBe("query");
      expect(state.activeTabId).toBe(state.tabs[1]!.id);
      expect(getQueryTab(state, 1).sql).toBe("SELECT 1");
    });

    // AC-06 branch: same paradigm + same connection → in-place update.
    it("updates in place when the active query tab shares paradigm + connection (AC-06)", () => {
      useTabStore.getState().addQueryTab("conn1");
      const tabId = useTabStore.getState().activeTabId!;
      const tabsBefore = useTabStore.getState().tabs;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 42",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(tabsBefore.length);
      expect(state.activeTabId).toBe(tabId);
      const qt = getQueryTab(state, 0);
      expect(qt.id).toBe(tabId);
      expect(qt.sql).toBe("SELECT 42");
      expect(qt.queryMode).toBe("sql");
    });

    // AC-07 branch: different paradigm than the active tab → spawn new tab.
    it("spawns a new tab when paradigms differ and leaves the original untouched (AC-07, AC-10)", () => {
      // Start with an RDB query tab.
      useTabStore.getState().addQueryTab("conn1");
      const rdbTabId = useTabStore.getState().activeTabId!;
      useTabStore.getState().updateQuerySql(rdbTabId, "SELECT 1");

      // Load a document paradigm entry — new tab expected.
      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
        sql: '[{"$match":{"active":true}}]',
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      const originalTab = state.tabs.find((t) => t.id === rdbTabId);
      // AC-10 — the RDB tab's sql + paradigm stay unchanged.
      expect(originalTab).toBeDefined();
      if (originalTab && originalTab.type === "query") {
        expect(originalTab.sql).toBe("SELECT 1");
        expect(originalTab.paradigm).toBe("rdb");
        expect(originalTab.queryMode).toBe("sql");
      }
      const newTabId = state.activeTabId!;
      expect(newTabId).not.toBe(rdbTabId);
      const newTab = state.tabs.find((t) => t.id === newTabId);
      expect(newTab?.type).toBe("query");
      if (newTab && newTab.type === "query") {
        expect(newTab.paradigm).toBe("document");
        expect(newTab.queryMode).toBe("aggregate");
        // AC-08 — database/collection propagate onto the new tab.
        expect(newTab.database).toBe("table_view_test");
        expect(newTab.collection).toBe("users");
        expect(newTab.sql).toBe('[{"$match":{"active":true}}]');
      }
    });

    // AC-07 branch: different connectionId, same paradigm → still spawn new tab.
    it("spawns a new tab when paradigms match but connectionId differs", () => {
      useTabStore.getState().addQueryTab("conn1");
      const firstTabId = useTabStore.getState().activeTabId!;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-other",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT other",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.activeTabId).not.toBe(firstTabId);
      const newTab = state.tabs.find((t) => t.id === state.activeTabId);
      if (newTab && newTab.type === "query") {
        expect(newTab.connectionId).toBe("conn-other");
        expect(newTab.sql).toBe("SELECT other");
      }
    });

    // Document mode: find → aggregate within the same tab should flip
    // queryMode while preserving database / collection already on the tab.
    it("flips queryMode from find to aggregate in place on a document tab (AC-08)", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
      const docTabId = useTabStore.getState().activeTabId!;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
        sql: '[{"$match":{"active":true}}]',
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe(docTabId);
      const qt = getQueryTab(state, 0);
      expect(qt.queryMode).toBe("aggregate");
      expect(qt.sql).toBe('[{"$match":{"active":true}}]');
      // AC-08 — database/collection on the tab are preserved.
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });

    // Execution-brief assumption: when loading into an existing document
    // tab the user's collection context should NOT be overwritten by the
    // entry's collection. Document/document spawns a tab only on paradigm
    // or connectionId mismatch.
    it("preserves the active tab's database/collection when loading a document entry in place", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
      const docTabId = useTabStore.getState().activeTabId!;

      // Entry points at a different collection within the same connection.
      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "orders",
        sql: '{"status":"open"}',
      });

      const state = useTabStore.getState();
      // Still a single tab — in-place update.
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe(docTabId);
      const qt = getQueryTab(state, 0);
      // Editor updated with the entry's SQL, but the tab's collection
      // context stays pinned to what the user was looking at.
      expect(qt.sql).toBe('{"status":"open"}');
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });
  });
});
