import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";
import { makeTableTab, getTableTab } from "./__tests__/tabStoreTestHelpers";

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
});
