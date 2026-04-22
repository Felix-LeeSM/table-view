import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

function addTableTab(overrides: Partial<Omit<TableTab, "id">> = {}) {
  useTabStore.getState().addTab({
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  });
}

function fireAuxClick(element: Element, button: number) {
  fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }),
  );
}

describe("TabBar", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      loading: false,
      error: null,
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);
  });

  it("renders nothing when no tabs", () => {
    const { container } = render(<TabBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tabs with titles", () => {
    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });

    render(<TabBar />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
  });

  it("closes tab on middle-click (auxclick button 1)", () => {
    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });

    render(<TabBar />);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);

    const ordersTab = screen.getByText("Orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 1);

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
  });

  it("does not close tab on right-click (auxclick button 2)", () => {
    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });

    render(<TabBar />);

    const ordersTab = screen.getByText("Orders").closest("[role='tab']")!;
    fireAuxClick(ordersTab, 2);

    expect(useTabStore.getState().tabs).toHaveLength(2);
  });

  it("activates tab on click", () => {
    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });

    render(<TabBar />);

    const state = useTabStore.getState();
    const firstTabId = state.tabs[0]!.id;

    // Click the first tab (second tab is currently active)
    const usersTab = screen.getByText("Users").closest("[role='tab']")!;
    act(() => {
      fireEvent.click(usersTab);
    });

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });

  it("closes tab via close button", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const closeBtn = screen.getByLabelText("Close Users");
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("shows + button for new query tab when connection is active", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    expect(screen.getByLabelText("New Query Tab")).toBeInTheDocument();
  });

  it("adds query tab on + button click", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const addBtn = screen.getByLabelText("New Query Tab");
    act(() => {
      fireEvent.click(addBtn);
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]!.type).toBe("query");
    expect(state.activeTabId).toBe(state.tabs[1]!.id);
  });

  it("renders query tab with correct icon", () => {
    addTableTab({ title: "Users", table: "users" });
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    // Second tab should be the query tab
    const queryTab = tabs[1]!;
    expect(queryTab).toHaveAttribute("aria-selected", "true");
  });

  it("has select-none class on root element to prevent text selection", () => {
    addTableTab({ title: "Users", table: "users" });

    render(<TabBar />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("select-none");
  });

  // ── Sprint 28: Tab Connection Color Display ──

  function makeConnection(
    overrides: Partial<ConnectionConfig> = {},
  ): ConnectionConfig {
    return {
      id: "conn1",
      name: "Test DB",
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      user: "postgres",
      has_password: false,
      database: "testdb",
      group_id: null,
      color: null,
      ...overrides,
    };
  }

  it("renders color stripe for tab with connection color", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: "red" })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toBeInTheDocument();
    expect((stripe as HTMLElement).style.backgroundColor).toBe("red");
  });

  it("still renders a stripe when no color is set (uses derived palette color)", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: null })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toBeInTheDocument();
    // A non-empty color is applied (palette-derived), even without user input.
    expect((stripe as HTMLElement).style.backgroundColor).not.toBe("");
  });

  it("does not render a stripe when the tab's connection has been removed", () => {
    useConnectionStore.setState({
      connections: [],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Orphan", table: "orphan", connectionId: "missing" });
    render(<TabBar />);

    expect(screen.queryByLabelText("Connection color")).toBeNull();
  });

  it("renders different colors for different connections", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", color: "red" }),
        makeConnection({ id: "conn2", color: "blue" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    addTableTab({ title: "Orders", table: "orders", connectionId: "conn2" });
    render(<TabBar />);

    const stripes = screen.getAllByLabelText("Connection color");
    expect(stripes).toHaveLength(2);
    expect((stripes[0] as HTMLElement).style.backgroundColor).toBe("red");
    expect((stripes[1] as HTMLElement).style.backgroundColor).toBe("blue");
  });

  // ── Sprint 29: Preview Tab Display ──

  it("preview tab has italic title", () => {
    addTableTab({ title: "Users", table: "users" });
    // New tabs are preview by default

    render(<TabBar />);
    const titleEl = screen.getByText("Users");
    expect(titleEl.className).toContain("italic");
  });

  it("permanent tab does not have italic title", () => {
    addTableTab({ title: "Users", table: "users" });

    // Promote the tab to permanent
    const state = useTabStore.getState();
    const tabId = state.tabs[0]!.id;
    useTabStore.getState().promoteTab(tabId);

    render(<TabBar />);
    const titleEl = screen.getByText("Users");
    expect(titleEl.className).not.toContain("italic");
  });

  // ── Sprint 43: Double-click tab promotion ──

  it("promotes preview tab on double-click", () => {
    addTableTab({ title: "Users", table: "users" });
    // New tab is preview by default
    const state = useTabStore.getState();
    expect((state.tabs[0] as TableTab).isPreview).toBe(true);

    render(<TabBar />);
    const tab = screen.getByText("Users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = useTabStore.getState().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not change permanent tab on double-click", () => {
    addTableTab({ title: "Users", table: "users" });
    const state = useTabStore.getState();
    const tabId = state.tabs[0]!.id;
    useTabStore.getState().promoteTab(tabId);

    render(<TabBar />);
    const tab = screen.getByText("Users").closest("[role='tab']")!;
    act(() => {
      fireEvent.doubleClick(tab);
    });

    const updatedTab = useTabStore.getState().tabs[0] as TableTab;
    expect(updatedTab.isPreview).toBe(false);
  });

  it("does not call promoteTab on query tab double-click", () => {
    addTableTab({ title: "Users", table: "users" });
    useTabStore.getState().addQueryTab("conn1");

    render(<TabBar />);
    const tabs = screen.getAllByRole("tab");
    const queryTab = tabs[1]!;

    act(() => {
      fireEvent.doubleClick(queryTab);
    });

    // Query tab should still exist and be active
    expect(useTabStore.getState().tabs[1]!.type).toBe("query");
  });

  // ── Sprint 45: Tab color dot tooltip ──

  it("color stripe has title with connection name", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", name: "My Database", color: "red" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const stripe = screen.getByLabelText("Connection color");
    expect(stripe).toHaveAttribute("title", "My Database");
  });

  // ── Drag-and-drop reorder ──

  // Helper: set tabs directly in the store to bypass the preview-replacement
  // logic in addTab (which collapses multiple same-connection tabs into one).
  function setThreeTabs() {
    useTabStore.setState({
      tabs: [
        {
          id: "t1",
          type: "table",
          title: "users",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "users",
        },
        {
          id: "t2",
          type: "table",
          title: "orders",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "orders",
        },
        {
          id: "t3",
          type: "table",
          title: "products",
          connectionId: "conn1",
          closable: true,
          subView: "records" as const,
          isPreview: false,
          schema: "public",
          table: "products",
        },
      ],
      activeTabId: "t1",
      closedTabHistory: [],
    });
  }

  it("reorders tabs when dragging first tab onto third", () => {
    setThreeTabs();
    render(<TabBar />);

    const before = useTabStore.getState().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 }); // dx=10 > 4 → isDragging
      fireEvent.mouseEnter(tabs[2]!);
      fireEvent.mouseUp(tabs[2]!);
    });

    const after = useTabStore.getState().tabs.map((t) => t.id);
    // t1 moves to where t3 was → [t2, t3, t1]
    expect(after).toEqual([before[1], before[2], before[0]]);
  });

  it("does not reorder when dropping a tab onto itself", () => {
    setThreeTabs();
    render(<TabBar />);

    const before = useTabStore.getState().tabs.map((t) => t.id);
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 }); // isDragging = true
      fireEvent.mouseUp(tabs[0]!); // same tab → no reorder
    });

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });

  it("activeTabId is unchanged after drag reorder", () => {
    setThreeTabs();
    render(<TabBar />);

    const { activeTabId } = useTabStore.getState();
    const tabs = screen.getAllByRole("tab");

    act(() => {
      fireEvent.mouseDown(tabs[0]!, { button: 0, clientX: 0 });
      fireEvent.mouseMove(document, { clientX: 10 });
      fireEvent.mouseEnter(tabs[2]!);
      fireEvent.mouseUp(tabs[2]!);
    });

    expect(useTabStore.getState().activeTabId).toBe(activeTabId);
  });
});
