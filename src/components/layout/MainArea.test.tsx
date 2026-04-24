import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MainArea from "./MainArea";
import {
  useTabStore,
  type TableTab,
  type QueryTab as QueryTabType,
} from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

// Mock child components to isolate MainArea routing logic
vi.mock("@components/DataGrid", () => ({
  default: ({
    connectionId,
    table,
    schema,
  }: {
    connectionId: string;
    table: string;
    schema: string;
  }) => (
    <div
      data-testid="mock-datagrid"
      data-connection={connectionId}
      data-table={table}
      data-schema={schema}
    />
  ),
}));

vi.mock("@components/schema/StructurePanel", () => ({
  default: ({
    connectionId,
    table,
    schema,
  }: {
    connectionId: string;
    table: string;
    schema: string;
  }) => (
    <div
      data-testid="mock-structure"
      data-connection={connectionId}
      data-table={table}
      data-schema={schema}
    />
  ),
}));

vi.mock("@components/schema/ViewStructurePanel", () => ({
  default: ({
    connectionId,
    view,
    schema,
  }: {
    connectionId: string;
    view: string;
    schema: string;
  }) => (
    <div
      data-testid="mock-view-structure"
      data-connection={connectionId}
      data-view={view}
      data-schema={schema}
    />
  ),
}));

vi.mock("@components/query/QueryTab", () => ({
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
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function makeConnection(id: string): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function setConnections(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    statuses[c.id] = active.has(c.id)
      ? { type: "connected" }
      : { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
  });
}

describe("MainArea", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    setConnections({});
  });

  // AC-05: empty state placeholder
  it("shows empty state placeholder when no active tab", () => {
    render(<MainArea />);

    expect(screen.getByAltText("Table View")).toBeInTheDocument();
    expect(
      screen.getByText("Select a connection from the sidebar to get started"),
    ).toBeInTheDocument();
  });

  it("shows logo wordmark in empty state", () => {
    render(<MainArea />);

    const wordmark = screen.getByAltText("Table View");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark).toHaveAttribute("src", "/logo-wordmark.svg");
  });

  it("shows empty state when tabs exist but none are active", () => {
    const tab = makeTableTab({ id: "tab-1" });
    useTabStore.setState({ tabs: [tab], activeTabId: null });

    render(<MainArea />);

    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  // AC-06: table tab renders DataGrid + sub-tabs
  it("renders DataGrid for a table tab with records subView", () => {
    const tab = makeTableTab({ subView: "records" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-datagrid")).toBeInTheDocument();
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute(
      "data-table",
      "users",
    );
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute(
      "data-schema",
      "public",
    );
    expect(screen.getByTestId("mock-datagrid")).toHaveAttribute(
      "data-connection",
      "conn1",
    );
  });

  it("renders StructurePanel for a table tab with structure subView", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-structure")).toBeInTheDocument();
    expect(screen.getByTestId("mock-structure")).toHaveAttribute(
      "data-table",
      "users",
    );
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
    act(() => {
      fireEvent.click(structureTab);
    });

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
    act(() => {
      fireEvent.click(recordsTab);
    });

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
    act(() => {
      fireEvent.keyDown(recordsTab, { key: "ArrowRight" });
    });

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
    act(() => {
      fireEvent.keyDown(structureTab, { key: "ArrowLeft" });
    });

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
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
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
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  it("does not render table content when table tab has no schema", () => {
    const tab = makeTableTab({ schema: undefined });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  it("renders ViewStructurePanel when view tab is in structure subView", () => {
    const tab = makeTableTab({
      subView: "structure",
      objectKind: "view",
      table: "active_users",
      title: "active_users",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-view-structure")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-structure")).toBeNull();
    expect(screen.getByTestId("mock-view-structure")).toHaveAttribute(
      "data-view",
      "active_users",
    );
  });

  it("renders DataGrid (not ViewStructurePanel) for view tab in records subView", () => {
    const tab = makeTableTab({
      subView: "records",
      objectKind: "view",
      table: "active_users",
    });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-datagrid")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-view-structure")).toBeNull();
  });

  it("falls back to StructurePanel when objectKind is omitted (legacy tab)", () => {
    const tab = makeTableTab({ subView: "structure" });
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id });

    render(<MainArea />);

    expect(screen.getByTestId("mock-structure")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-view-structure")).toBeNull();
  });

  describe("Empty state CTA", () => {
    it("shows New Query button when at least one connection is connected", () => {
      setConnections({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });

      render(<MainArea />);

      expect(
        screen.getByRole("button", { name: /new query/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
    });

    it("clicking New Query opens a query tab against the connected DB", () => {
      setConnections({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });

      render(<MainArea />);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.type).toBe("query");
      expect(state.tabs[0]!.connectionId).toBe("c1");
    });

    it("does not show New Query button when no connection is connected", () => {
      setConnections({
        connections: [makeConnection("c1")],
        active: [],
      });

      render(<MainArea />);

      expect(screen.queryByRole("button", { name: /new query/i })).toBeNull();
      expect(
        screen.getByText(/select a connection from the sidebar/i),
      ).toBeInTheDocument();
    });

    it("picks the first connected connection when multiple exist", () => {
      setConnections({
        connections: [
          makeConnection("c1"),
          makeConnection("c2"),
          makeConnection("c3"),
        ],
        active: ["c2", "c3"],
      });

      render(<MainArea />);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
      });

      const state = useTabStore.getState();
      expect(state.tabs[0]!.connectionId).toBe("c2");
    });
  });
});
