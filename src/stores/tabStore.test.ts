import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, type TableTab, type QueryTab, type Tab } from "./tabStore";
import type { QueryState } from "../types/query";

function makeTableTab(overrides: Partial<Omit<TableTab, "id">> & { id: string }): Omit<TableTab, "id"> {
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
      connectionId: "conn1",
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
    const tab1 = makeTableTab({ id: "t1", table: "users" });
    const tab2 = makeTableTab({ id: "t2", table: "orders" });

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
    const tab1 = makeTableTab({ id: "t1", table: "users" });
    const tab2 = makeTableTab({ id: "t2", table: "orders" });
    const tab3 = makeTableTab({ id: "t3", table: "products" });

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
    const tab1 = makeTableTab({ id: "t1", table: "users" });
    const tab2 = makeTableTab({ id: "t2", table: "orders" });

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
    const tab1 = makeTableTab({ id: "t1", table: "users", subView: "records" });
    const tab2 = makeTableTab({ id: "t2", table: "orders", subView: "records" });

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

      const newState: QueryState = { status: "completed", result: { columns: [], rows: [], total_count: 0, execution_time_ms: 5, query_type: "ddl" } };
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
});
