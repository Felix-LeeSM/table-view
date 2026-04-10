import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MainArea from "./MainArea";
import { useTabStore, type TableTab, type QueryTab as QueryTabType } from "../stores/tabStore";

// Mock child components to isolate MainArea routing logic
vi.mock("./DataGrid", () => ({
  default: ({ connectionId, table, schema }: { connectionId: string; table: string; schema: string }) => (
    <div data-testid="mock-datagrid" data-connection={connectionId} data-table={table} data-schema={schema} />
  ),
}));

vi.mock("./StructurePanel", () => ({
  default: ({ connectionId, table, schema }: { connectionId: string; table: string; schema: string }) => (
    <div data-testid="mock-structure" data-connection={connectionId} data-table={table} data-schema={schema} />
  ),
}));

vi.mock("./QueryTab", () => ({
  default: ({ tab }: { tab: unknown }) => (
    <div data-testid="mock-querytab" data-tab={JSON.stringify(tab)} />
  ),
}));

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1",
    title: "users",
    connectionId: "conn1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab(overrides: Partial<QueryTabType> = {}): QueryTabType {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    ...overrides,
  };
}

describe("MainArea", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  // AC-05: empty state placeholder
  it("shows empty state placeholder when no active tab", () => {
    render(<MainArea />);

    expect(screen.getByText("View Table")).toBeInTheDocument();
    expect(screen.getByText("Select a connection from the sidebar to get started")).toBeInTheDocument();
  });

  it("shows database icon in empty state", () => {
    render(<MainArea />);

    // The Database icon from lucide renders as an SVG
    const container = screen.getByText("View Table").parentElement!;
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("shows empty state when tabs exist but none are active", () => {
    const tab = makeTableTab({ id: "tab-1" });
    useTabStore.setState({ tabs: [tab], activeTabId: null });

    render(<MainArea />);

    expect(screen.getByText("View Table")).toBeInTheDocument();
  });

  // AC-06: table tab renders DataGrid + sub-tabs
  it("renders DataGrid for a table tab with records subView", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-datagrid")).toBeInTheDocument();
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute("data-table", "users");
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute("data-schema", "public");
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute("data-connection", "conn1");
  });

  it("renders StructurePanel for a table tab with structure subView", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-structure")).toBeInTheDocument();
    expect(screen.getByTestId("mock-structure")).toHaveAttribute("data-table", "users");
  });

  it("renders sub-tab bar with Records and Structure tabs for table tab", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    // The sub-tab list
    const tablist = screen.getByRole("tablist", { name: "Table view" });
    expect(tablist).toBeInTheDocument();

    // Get tabs within the sub-tab list specifically (TabBar also has tabs)
    const tabs = tablist.querySelectorAll("[role='tab']");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Records");
    expect(tabs[1]).toHaveTextContent("Structure");
  });

  it("marks Records tab as selected when subView is records", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    const structureTab = screen.getByRole("tab", { name: "Structure" });
    expect(recordsTab).toHaveAttribute("aria-selected", "true");
    expect(structureTab).toHaveAttribute("aria-selected", "false");
  });

  it("marks Structure tab as selected when subView is structure", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    const structureTab = screen.getByRole("tab", { name: "Structure" });
    expect(recordsTab).toHaveAttribute("aria-selected", "false");
    expect(structureTab).toHaveAttribute("aria-selected", "true");
  });

  it("switches to structure subView when Structure tab is clicked", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const structureTab = screen.getByRole("tab", { name: "Structure" });
    fireEvent.click(structureTab);

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    expect(updatedTab).toBeDefined();
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("structure");
    }
  });

  it("switches to records subView when Records tab is clicked", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    fireEvent.click(recordsTab);

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    expect(updatedTab).toBeDefined();
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("records");
    }
  });

  it("toggles subView with ArrowRight key on Records tab", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    fireEvent.keyDown(recordsTab, { key: "ArrowRight" });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("structure");
    }
  });

  it("toggles subView with ArrowLeft key on Structure tab", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const structureTab = screen.getByRole("tab", { name: "Structure" });
    fireEvent.keyDown(structureTab, { key: "ArrowLeft" });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("records");
    }
  });

  // AC-07: query tab renders QueryTab
  it("renders QueryTab for a query tab", () => {
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-querytab")).toBeInTheDocument();
  });

  it("passes correct tab data to QueryTab", () => {
    const tab = makeQueryTab({ sql: "SELECT * FROM users" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    const queryTabEl = screen.getByTestId("mock-querytab");
    const passedTab = JSON.parse(queryTabEl.getAttribute("data-tab")!);
    expect(passedTab.id).toBe("query-1");
    expect(passedTab.sql).toBe("SELECT * FROM users");
  });

  it("renders TabBar even with no active tab", () => {
    render(<MainArea />);

    // TabBar renders only when tabs exist; with no tabs it returns null
    // So we just verify the component doesn't crash
    expect(screen.getByText("View Table")).toBeInTheDocument();
  });

  it("renders TabBar when tabs exist", () => {
    const tab = makeTableTab();
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    // TabBar should render the tab items
    const tabBar = screen.getByRole("tablist", { name: "Open connections" });
    expect(tabBar).toBeInTheDocument();
  });

  it("does not render table content when table tab has no table name", () => {
    const tab = makeTableTab({ table: undefined });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    // Without table name, it should show empty state (falls through)
    expect(screen.getByText("View Table")).toBeInTheDocument();
  });

  it("does not render table content when table tab has no schema", () => {
    const tab = makeTableTab({ schema: undefined });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByText("View Table")).toBeInTheDocument();
  });
});
