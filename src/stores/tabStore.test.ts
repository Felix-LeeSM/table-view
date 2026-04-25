import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useTabStore,
  type TableTab,
  type QueryTab,
  type Tab,
} from "./tabStore";
import type { QueryState } from "@/types/query";
import type { SortInfo } from "@/types/schema";

function makeTableTab(
  overrides: Partial<Omit<TableTab, "id">> & { id: string },
): Omit<TableTab, "id"> {
  return {
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records" as const,
    ...overrides,
  };
}

function getTableTab(state: { tabs: Tab[] }, index: number): TableTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

function getQueryTab(state: { tabs: Tab[] }, index: number): QueryTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "query") throw new Error("Expected QueryTab");
  return tab;
}

describe("tabStore", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
    });
  });

  it("adds a tab", () => {
    const tab = makeTableTab({ id: "ignored-by-store" });
    useTabStore.getState().addTab(tab);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.connectionId).toBe("conn1");
    expect(state.tabs[0]!.type).toBe("table");
    expect(state.activeTabId).not.toBeNull();
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("activates existing tab for same connection+table", () => {
    const tab1 = makeTableTab({
      id: "t1",
      connectionId: "conn1",
      table: "users",
    });
    const tab2 = makeTableTab({
      id: "t2",
      connectionId: "conn2",
      table: "orders",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    // Now try to add tab1 again (same connection+table)
    const tab1_dup = makeTableTab({
      id: "t3",
      connectionId: "conn1",
      table: "users",
    });
    useTabStore.getState().addTab(tab1_dup);

    const state = useTabStore.getState();
    // Should still have only 2 tabs (no new tab created)
    expect(state.tabs).toHaveLength(2);
    // Active tab should be the first tab's id
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("removes a tab", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    expect(stateBefore.tabs).toHaveLength(2);

    // Remove the second tab
    useTabStore.getState().removeTab(stateBefore.tabs[1]!.id);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab(state, 0).table).toBe("users");
  });

  it("sets active tab to previous on remove", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });
    const tab3 = makeTableTab({
      id: "t3",
      table: "products",
      connectionId: "conn3",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);
    useTabStore.getState().addTab(tab3);

    const stateBefore = useTabStore.getState();
    const lastTabId = stateBefore.tabs[2]!.id;
    expect(stateBefore.activeTabId).toBe(lastTabId);

    // Remove the last (active) tab — should activate the previous one
    useTabStore.getState().removeTab(lastTabId);

    const state = useTabStore.getState();
    expect(state.activeTabId).toBe(state.tabs[1]!.id);
  });

  it("sets active tab", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    const firstTabId = stateBefore.tabs[0]!.id;

    // Switch to first tab
    useTabStore.getState().setActiveTab(firstTabId);

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });

  it("changes subView on a tab", () => {
    const tab = makeTableTab({ id: "t1", table: "users", subView: "records" });
    useTabStore.getState().addTab(tab);

    const stateBefore = useTabStore.getState();
    expect(getTableTab(stateBefore, 0).subView).toBe("records");

    useTabStore.getState().setSubView(stateBefore.tabs[0]!.id, "structure");

    const state = useTabStore.getState();
    expect(getTableTab(state, 0).subView).toBe("structure");
  });

  it("subView persists when switching between tabs", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      subView: "records",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      subView: "records",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    // Change subView on first tab to structure
    useTabStore.getState().setSubView(stateBefore.tabs[0]!.id, "structure");

    // Switch to second tab
    useTabStore.getState().setActiveTab(stateBefore.tabs[1]!.id);

    // Switch back to first tab
    useTabStore.getState().setActiveTab(stateBefore.tabs[0]!.id);

    const state = useTabStore.getState();
    // First tab should still have "structure" subView
    expect(getTableTab(state, 0).subView).toBe("structure");
    // Second tab should still have "records" subView
    expect(getTableTab(state, 1).subView).toBe("records");
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

  // -- Sprint 29: Preview Tab System ----------------------------------------

  describe("preview tab system", () => {
    it("new table tab is preview by default", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).isPreview).toBe(true);
    });

    it("promoteTab sets isPreview to false", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      const tabId = state.tabs[0]!.id;

      useTabStore.getState().promoteTab(tabId);

      const updated = useTabStore.getState();
      expect(getTableTab(updated, 0).isPreview).toBe(false);
    });

    it("clicking another table replaces preview tab", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const state1 = useTabStore.getState();
      const firstTabId = state1.tabs[0]!.id;
      expect(state1.tabs).toHaveLength(1);

      // Add a different table for the same connection — should replace the preview tab
      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state2 = useTabStore.getState();
      // Still 1 tab (the preview was replaced)
      expect(state2.tabs).toHaveLength(1);
      // It should be the new table
      expect(getTableTab(state2, 0).table).toBe("orders");
      // Old tab should be gone
      expect(state2.tabs.find((t) => t.id === firstTabId)).toBeUndefined();
    });

    it("permanent tab is not replaced by new preview", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const state1 = useTabStore.getState();
      const tabId = state1.tabs[0]!.id;
      // Promote to permanent
      useTabStore.getState().promoteTab(tabId);

      // Add a different table — should NOT replace the permanent tab
      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state2 = useTabStore.getState();
      expect(state2.tabs).toHaveLength(2);
      expect(getTableTab(state2, 0).table).toBe("users");
      expect(getTableTab(state2, 1).table).toBe("orders");
    });

    it("preview tabs from different connections do not replace each other", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn2",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
    });

    it("promoteTab on non-existent tab is a no-op", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      // Should not throw
      useTabStore.getState().promoteTab("non-existent-id");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
    });
  });

  // -- Sprint 38: Tab State Persistence --

  describe("tab state persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      vi.useFakeTimers();
      vi.stubGlobal("localStorage", {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete storage[key];
        }),
        clear: vi.fn(() => {
          storage = {};
        }),
        get length() {
          return Object.keys(storage).length;
        },
        key: vi.fn(() => null),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("persists tabs to localStorage on change", () => {
      useTabStore.getState().addQueryTab("conn1");

      // Advance past debounce timer
      vi.advanceTimersByTime(300);

      // The store should have called setItem
      const setItemCalls = (localStorage.setItem as ReturnType<typeof vi.fn>)
        .mock.calls;
      const lastCall = setItemCalls[setItemCalls.length - 1];
      expect(lastCall).toBeDefined();
      if (lastCall) {
        expect(lastCall[0]).toBe("table-view-tabs");
        const parsed = JSON.parse(lastCall[1]);
        expect(parsed.tabs).toHaveLength(1);
      }
    });

    it("loads persisted tabs on initialization", () => {
      const persistedState = {
        tabs: [
          {
            type: "query",
            id: "query-1",
            title: "Query 1",
            connectionId: "conn1",
            closable: true,
            sql: "SELECT 1",
            queryState: { status: "idle" },
          },
        ],
        activeTabId: "query-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe("query-1");
    });

    it("resets query state to idle when loading persisted tabs", () => {
      const persistedState = {
        tabs: [
          {
            type: "query",
            id: "query-1",
            title: "Query 1",
            connectionId: "conn1",
            closable: true,
            sql: "SELECT 1",
            queryState: { status: "running", queryId: "old-qid" },
          },
        ],
        activeTabId: "query-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const qt = state.tabs[0];
      if (qt && qt.type === "query") {
        expect(qt.queryState).toEqual({ status: "idle" });
      }
    });

    it("handles corrupted localStorage gracefully", () => {
      storage["table-view-tabs"] = "not valid json{{{";

      // Should not throw
      expect(() => useTabStore.getState().loadPersistedTabs()).not.toThrow();

      const state = useTabStore.getState();
      expect(state.tabs).toEqual([]);
      expect(state.activeTabId).toBeNull();
    });

    it("migrates legacy TableTabs without paradigm to rdb", () => {
      // Sprint 66: the `paradigm` field didn't exist on TableTab before this
      // sprint. All legacy persisted tabs targeted an RDB connection, so the
      // migration must default them to "rdb" instead of leaving `undefined`.
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      expect(tt?.type).toBe("table");
      if (tt && tt.type === "table") {
        expect(tt.paradigm).toBe("rdb");
        expect(tt.isPreview).toBe(false);
      }
    });

    it("preserves a persisted paradigm=document TableTab on load", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "table_view_test.users",
            connectionId: "conn-mongo",
            closable: true,
            schema: "table_view_test",
            table: "users",
            subView: "records",
            paradigm: "document",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      if (tt && tt.type === "table") {
        expect(tt.paradigm).toBe("document");
      }
    });
  });

  // -- Tab drag reorder --

  describe("moveTab", () => {
    beforeEach(() => {
      useTabStore.setState({ tabs: [], activeTabId: null });
    });

    it("inserts BEFORE the target when position='before'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      expect(before).toHaveLength(3);

      useTabStore.getState().moveTab(before[0]!, before[2]!, "before");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t0 inserts before t2 → [t1, t0, t2]
      expect(after).toEqual([before[1], before[0], before[2]]);
    });

    it("inserts AFTER the target when position='after'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);

      useTabStore.getState().moveTab(before[0]!, before[2]!, "after");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t0 inserts after t2 → [t1, t2, t0]
      expect(after).toEqual([before[1], before[2], before[0]]);
    });

    it("inserts BEFORE when dragging right-to-left with position='before'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);

      useTabStore.getState().moveTab(before[2]!, before[0]!, "before");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t2 inserts before t0 → [t2, t0, t1]
      expect(after).toEqual([before[2], before[0], before[1]]);
    });

    it("is a no-op when fromId === toId", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      useTabStore.getState().moveTab(before[0]!, before[0]!);

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
    });

    it("is a no-op when an id does not exist", () => {
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      useTabStore.getState().moveTab(before[0]!, "ghost-id");

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
    });

    it("does not change activeTabId", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const { activeTabId, tabs } = useTabStore.getState();
      useTabStore.getState().moveTab(tabs[0]!.id, tabs[1]!.id);

      expect(useTabStore.getState().activeTabId).toBe(activeTabId);
    });
  });

  // -- Sprint 45: Reopen last closed tab --

  describe("reopen last closed tab", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
    });

    it("removes tab and saves it to closedTabHistory", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      const tabId = state.tabs[0]!.id;

      useTabStore.getState().removeTab(tabId);

      const afterRemove = useTabStore.getState();
      expect(afterRemove.tabs).toHaveLength(0);
      expect(afterRemove.closedTabHistory).toHaveLength(1);
      expect(afterRemove.closedTabHistory[0]!.type).toBe("table");
    });

    it("reopens last closed tab", () => {
      useTabStore.getState().addQueryTab("conn1");
      const state1 = useTabStore.getState();
      const queryTabId = state1.tabs[0]!.id;

      // Update the SQL so we can verify it's restored
      useTabStore.getState().updateQuerySql(queryTabId, "SELECT 1");

      // Close it
      useTabStore.getState().removeTab(queryTabId);

      expect(useTabStore.getState().tabs).toHaveLength(0);

      // Reopen
      useTabStore.getState().reopenLastClosedTab();

      const afterReopen = useTabStore.getState();
      expect(afterReopen.tabs).toHaveLength(1);
      expect(afterReopen.activeTabId).toBe(afterReopen.tabs[0]!.id);
      // SQL content should be preserved (query state is reset to idle)
      const reopened = getQueryTab(afterReopen, 0);
      expect(reopened.sql).toBe("SELECT 1");
      // History should be cleared
      expect(afterReopen.closedTabHistory).toHaveLength(0);
    });

    it("reopenLastClosedTab is a no-op when history is empty", () => {
      useTabStore.getState().reopenLastClosedTab();

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
    });

    it("limits closedTabHistory to 20 entries", () => {
      // Add and remove 25 tabs
      for (let i = 0; i < 25; i++) {
        useTabStore.getState().addQueryTab("conn1");
        const state = useTabStore.getState();
        const lastTabId = state.tabs[state.tabs.length - 1]!.id;
        useTabStore.getState().removeTab(lastTabId);
      }

      const state = useTabStore.getState();
      expect(state.closedTabHistory.length).toBe(20);
    });
  });

  // -- Sprint 76: Per-tab sort state --

  describe("per-tab sort state", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
    });

    // AC-01 — new tab starts with sorts undefined (optional field, no
    // surprise value). Consumers that need an array read `tab.sorts ?? []`.
    it("addTab does not pre-seed sorts; new tab's sorts is undefined", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));

      const state = useTabStore.getState();
      expect(getTableTab(state, 0).sorts).toBeUndefined();
    });

    it("addTab preserves sorts when the caller provides them", () => {
      const sorts: SortInfo[] = [{ column: "id", direction: "ASC" }];
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts,
      });

      const state = useTabStore.getState();
      expect(getTableTab(state, 0).sorts).toEqual(sorts);
    });

    // AC-02 — updateTabSorts writes into one tab only.
    it("updateTabSorts writes the target tab's sorts", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;

      const next: SortInfo[] = [{ column: "id", direction: "DESC" }];
      useTabStore.getState().updateTabSorts(tabId, next);

      const updated = useTabStore.getState();
      expect(getTableTab(updated, 0).sorts).toEqual(next);
    });

    it("updateTabSorts leaves sibling tabs untouched (per-tab isolation)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t1",
          connectionId: "conn1",
          table: "users",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t2",
          connectionId: "conn2",
          table: "orders",
        }),
      );

      const [first, second] = useTabStore.getState().tabs;
      useTabStore
        .getState()
        .updateTabSorts(first!.id, [{ column: "id", direction: "ASC" }]);

      const state = useTabStore.getState();
      const tabA = state.tabs.find((t) => t.id === first!.id) as TableTab;
      const tabB = state.tabs.find((t) => t.id === second!.id) as TableTab;
      expect(tabA.sorts).toEqual([{ column: "id", direction: "ASC" }]);
      expect(tabB.sorts).toBeUndefined();
    });

    it("updateTabSorts on a non-existent tab is a no-op", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const before = useTabStore.getState().tabs[0]!;

      useTabStore
        .getState()
        .updateTabSorts("ghost-id", [{ column: "name", direction: "DESC" }]);

      const after = useTabStore.getState().tabs[0]! as TableTab;
      expect(after).toEqual(before);
    });

    it("updateTabSorts does not touch query tabs even if the ids collide", () => {
      useTabStore.getState().addQueryTab("conn1");
      const qtId = useTabStore.getState().tabs[0]!.id;

      useTabStore
        .getState()
        .updateTabSorts(qtId, [{ column: "id", direction: "ASC" }]);

      const qt = getQueryTab(useTabStore.getState(), 0);
      // QueryTab should never grow a `sorts` field.
      expect((qt as unknown as { sorts?: SortInfo[] }).sorts).toBeUndefined();
    });

    it("tab A's sort survives switching to tab B and back", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t1",
          connectionId: "conn1",
          table: "users",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t2",
          connectionId: "conn2",
          table: "orders",
        }),
      );
      const [first, second] = useTabStore.getState().tabs;
      useTabStore
        .getState()
        .updateTabSorts(first!.id, [{ column: "id", direction: "DESC" }]);

      useTabStore.getState().setActiveTab(second!.id);
      useTabStore.getState().setActiveTab(first!.id);

      const state = useTabStore.getState();
      const tabA = state.tabs.find((t) => t.id === first!.id) as TableTab;
      expect(tabA.sorts).toEqual([{ column: "id", direction: "DESC" }]);
    });

    it("supports 5+ multi-column sort entries", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      const sorts: SortInfo[] = [
        { column: "a", direction: "ASC" },
        { column: "b", direction: "DESC" },
        { column: "c", direction: "ASC" },
        { column: "d", direction: "DESC" },
        { column: "e", direction: "ASC" },
      ];

      useTabStore.getState().updateTabSorts(tabId, sorts);

      expect(getTableTab(useTabStore.getState(), 0).sorts).toEqual(sorts);
    });

    it("accepts an empty sorts array (clears sort on the tab)", () => {
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts: [{ column: "id", direction: "ASC" }],
      });
      const tabId = useTabStore.getState().tabs[0]!.id;

      useTabStore.getState().updateTabSorts(tabId, []);

      expect(getTableTab(useTabStore.getState(), 0).sorts).toEqual([]);
    });
  });

  // -- Sprint 76: sort persistence + legacy migration --

  describe("per-tab sort persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      storage = {};
      vi.useFakeTimers();
      vi.stubGlobal("localStorage", {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete storage[key];
        }),
        clear: vi.fn(() => {
          storage = {};
        }),
        get length() {
          return Object.keys(storage).length;
        },
        key: vi.fn(() => null),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // AC-04 — legacy persisted tab missing `sorts` migrates to `[]`
    // without throwing so the app still boots on prior data.
    it("loadPersistedTabs normalises legacy TableTab (missing sorts) to []", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            paradigm: "rdb",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      expect(() => useTabStore.getState().loadPersistedTabs()).not.toThrow();

      const tt = useTabStore.getState().tabs[0]!;
      expect(tt.type).toBe("table");
      if (tt.type === "table") {
        expect(tt.sorts).toEqual([]);
      }
    });

    it("loadPersistedTabs preserves persisted sorts on a TableTab", () => {
      const persistedSorts: SortInfo[] = [
        { column: "id", direction: "DESC" },
        { column: "name", direction: "ASC" },
      ];
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            paradigm: "rdb",
            sorts: persistedSorts,
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const tt = useTabStore.getState().tabs[0]!;
      if (tt.type === "table") {
        expect(tt.sorts).toEqual(persistedSorts);
      }
    });

    // Round-trip: write → read restores sort on the same tab id.
    it("persists sort updates and restores them on reload", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      const sorts: SortInfo[] = [{ column: "id", direction: "ASC" }];
      useTabStore.getState().updateTabSorts(tabId, sorts);

      // Flush debounce timer to commit persistence.
      vi.advanceTimersByTime(300);

      // Reset in-memory state, then reload from storage.
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      useTabStore.getState().loadPersistedTabs();

      const loaded = useTabStore.getState().tabs[0]!;
      if (loaded.type === "table") {
        expect(loaded.sorts).toEqual(sorts);
      }
    });

    it("reopenLastClosedTab restores the tab's sorts", () => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts: [{ column: "created_at", direction: "DESC" }],
      });
      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().removeTab(tabId);

      useTabStore.getState().reopenLastClosedTab();

      const reopened = useTabStore.getState().tabs[0]!;
      expect(reopened.type).toBe("table");
      if (reopened.type === "table") {
        expect(reopened.sorts).toEqual([
          { column: "created_at", direction: "DESC" },
        ]);
      }
    });
  });

  // -- Sprint 97: dirty tab tracking ----------------------------------------

  describe("setTabDirty / dirtyTabIds", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
        dirtyTabIds: new Set<string>(),
      });
    });

    it("starts empty", () => {
      expect(useTabStore.getState().dirtyTabIds.size).toBe(0);
    });

    it("adds the id when setTabDirty(id, true)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.size).toBe(1);
    });

    it("removes the id when setTabDirty(id, false)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);

      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(false);
    });

    it("is a no-op when membership already matches the requested value", () => {
      // Idempotent dirty=true → keeps Set referential equality so subscriber
      // selectors don't re-render on every keystroke during editing.
      useTabStore.getState().setTabDirty("tab-1", true);
      const before = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("tab-1", true);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after).toBe(before);

      // Idempotent dirty=false on a non-member tab also preserves identity.
      const cleanBefore = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("never-dirty", false);
      const cleanAfter = useTabStore.getState().dirtyTabIds;
      expect(cleanAfter).toBe(cleanBefore);
    });

    it("tracks multiple dirty tabs independently", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      useTabStore.getState().setTabDirty("tab-2", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.has("tab-2")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after.has("tab-1")).toBe(false);
      expect(after.has("tab-2")).toBe(true);
    });

    it("removeTab also drops the dirty marker", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().setTabDirty(tabId, true);
      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(true);

      useTabStore.getState().removeTab(tabId);

      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(false);
    });
  });
});
