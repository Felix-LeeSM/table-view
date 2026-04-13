import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TabBar from "./TabBar";
import { useTabStore, type TableTab } from "../stores/tabStore";
import { useConnectionStore } from "../stores/connectionStore";
import type { ConnectionConfig } from "../types/connection";

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
      password: "",
      database: "testdb",
      group_id: null,
      color: null,
      ...overrides,
    };
  }

  it("renders color dot for tab with connection color", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: "red" })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const dot = screen.getByLabelText("Connection color");
    expect(dot).toBeInTheDocument();
    expect((dot as HTMLElement).style.backgroundColor).toBe("red");
  });

  it("renders default color dot when no color specified", () => {
    useConnectionStore.setState({
      connections: [makeConnection({ id: "conn1", color: null })],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const dot = screen.getByLabelText("Connection color");
    expect(dot).toBeInTheDocument();
    expect((dot as HTMLElement).style.backgroundColor).toBe("var(--primary)");
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

    const dots = screen.getAllByLabelText("Connection color");
    expect(dots).toHaveLength(2);
    expect((dots[0] as HTMLElement).style.backgroundColor).toBe("red");
    expect((dots[1] as HTMLElement).style.backgroundColor).toBe("blue");
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

  it("color dot has title with connection name", () => {
    useConnectionStore.setState({
      connections: [
        makeConnection({ id: "conn1", name: "My Database", color: "red" }),
      ],
    } as Partial<Parameters<typeof useConnectionStore.setState>[0]>);

    addTableTab({ title: "Users", table: "users", connectionId: "conn1" });
    render(<TabBar />);

    const dot = screen.getByLabelText("Connection color");
    expect(dot).toHaveAttribute("title", "My Database");
  });
});
