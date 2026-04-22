import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useTabStore,
  type TableTab,
  type QueryTab,
  type Tab,
} from "./tabStore";
import type { QueryState } from "@/types/query";

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
    useTabStore.setState({ tabs: [], activeTabId: null });
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
  });

  // -- Tab drag reorder --

  describe("moveTab", () => {
    beforeEach(() => {
      useTabStore.setState({ tabs: [], activeTabId: null });
    });

    it("moves a tab to a different position", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      expect(before).toHaveLength(3);

      // Move the first tab to where the third is
      useTabStore.getState().moveTab(before[0]!, before[2]!);

      const after = useTabStore.getState().tabs.map((t) => t.id);
      expect(after).toEqual([before[1], before[2], before[0]]);
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
});
