import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, type Tab } from "./tabStore";

function makeTab(overrides: Partial<Tab> & { id: string }): Tab {
  return {
    title: "Test Tab",
    connectionId: "conn1",
    type: "data",
    closable: true,
    schema: "public",
    table: "users",
    ...overrides,
  };
}

describe("tabStore", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  it("adds a tab", () => {
    const tab = makeTab({ id: "ignored-by-store" });
    useTabStore.getState().addTab(tab);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.connectionId).toBe("conn1");
    expect(state.tabs[0]!.type).toBe("data");
    expect(state.activeTabId).not.toBeNull();
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("activates existing tab for same connection+type+table", () => {
    const tab1 = makeTab({
      id: "t1",
      connectionId: "conn1",
      type: "data",
      table: "users",
    });
    const tab2 = makeTab({
      id: "t2",
      connectionId: "conn1",
      type: "data",
      table: "orders",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    // Now try to add tab1 again (same connection+type+table)
    const tab1_dup = makeTab({
      id: "t3",
      connectionId: "conn1",
      type: "data",
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
    const tab1 = makeTab({ id: "t1", table: "users" });
    const tab2 = makeTab({ id: "t2", table: "orders" });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    expect(stateBefore.tabs).toHaveLength(2);

    // Remove the second tab
    useTabStore.getState().removeTab(stateBefore.tabs[1]!.id);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.table).toBe("users");
  });

  it("sets active tab to previous on remove", () => {
    const tab1 = makeTab({ id: "t1", table: "users" });
    const tab2 = makeTab({ id: "t2", table: "orders" });
    const tab3 = makeTab({ id: "t3", table: "products" });

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
    const tab1 = makeTab({ id: "t1", table: "users" });
    const tab2 = makeTab({ id: "t2", table: "orders" });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    const firstTabId = stateBefore.tabs[0]!.id;

    // Switch to first tab
    useTabStore.getState().setActiveTab(firstTabId);

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });
});
