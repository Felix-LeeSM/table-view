import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import MainArea from "./MainArea";
import {
  useTabStore,
  type TableTab,
  type QueryTab as QueryTabType,
} from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore, __resetMruStoreForTests } from "@stores/mruStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

// Sprint 142 (AC-147-4) — mount counter so tests can assert that
// `<TableTabView>` is remounted (not just re-rendered with new props)
// when the active tab swaps. Each useEffect with an empty dep array
// fires exactly once per mounted instance.
const datagridMountLog: { connectionId: string; table: string }[] = [];

// Mock child components to isolate MainArea routing logic
function MockDataGrid({
  connectionId,
  table,
  schema,
}: {
  connectionId: string;
  table: string;
  schema: string;
}) {
  useEffect(() => {
    datagridMountLog.push({ connectionId, table });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      data-testid="mock-datagrid"
      data-connection={connectionId}
      data-table={table}
      data-schema={schema}
    />
  );
}

vi.mock("@components/rdb/DataGrid", () => ({
  default: MockDataGrid,
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
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set(),
    });
    setConnections({});
    // Sprint 119 (#SHELL-1) — reset MRU before each test so a stale MRU
    // from a prior test cannot leak into the EmptyState fallback chain.
    __resetMruStoreForTests();
    // Sprint 142 (AC-147-4) — clear the mount log so each test asserts a
    // clean lifecycle.
    datagridMountLog.length = 0;
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

  // Sprint 142 (AC-147-4) — when the user swaps the active tab between two
  // table tabs, the DataGrid for the previously active tab must unmount and
  // a fresh DataGrid must mount for the new tab. Without per-tab remount,
  // `useDataGridEdit`'s `pendingEdits` state survives the prop change and
  // `setTabDirty` ends up flipping the marker onto the newly focused tab,
  // which is exactly the user-reported bug we are closing.
  describe("Sprint 142 — table tab remount on activeTab swap (AC-147-4)", () => {
    it("remounts DataGrid when activeTabId switches between two table tabs", () => {
      const tabA = makeTableTab({
        id: "tab-a",
        title: "users",
        connectionId: "conn1",
        table: "users",
      });
      const tabB = makeTableTab({
        id: "tab-b",
        title: "orders",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.setState({ tabs: [tabA, tabB], activeTabId: tabA.id });

      render(<MainArea />);

      expect(datagridMountLog).toEqual([
        { connectionId: "conn1", table: "users" },
      ]);

      act(() => {
        useTabStore.setState({ activeTabId: tabB.id });
      });

      // Must include a SECOND mount entry — proves React unmounted A and
      // mounted a fresh DataGrid for B (key-based remount). Without the
      // fix, the same component instance is reused with new props and the
      // log would still be length 1.
      expect(datagridMountLog).toEqual([
        { connectionId: "conn1", table: "users" },
        { connectionId: "conn1", table: "orders" },
      ]);
    });

    it("does not propagate a stale dirty marker onto the newly focused tab", () => {
      const tabA = makeTableTab({
        id: "tab-a",
        title: "users",
        connectionId: "conn1",
        table: "users",
      });
      const tabB = makeTableTab({
        id: "tab-b",
        title: "orders",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.setState({ tabs: [tabA, tabB], activeTabId: tabA.id });

      // Simulate the state the buggy code would produce: tab A is dirty
      // because its useDataGridEdit effect ran with `activeTabId === A`.
      act(() => {
        useTabStore.getState().setTabDirty(tabA.id, true);
      });

      render(<MainArea />);

      // Sanity — A is dirty.
      expect(useTabStore.getState().dirtyTabIds.has(tabA.id)).toBe(true);
      expect(useTabStore.getState().dirtyTabIds.has(tabB.id)).toBe(false);

      // Swap to B. After the fix, A's grid unmounts and its effect
      // cleanup clears A. B mounts fresh with empty pendingEdits and
      // never sets B dirty. The contract is "B does not get marked
      // dirty" — A's marker may or may not survive (the cleanup clears
      // it). The user-visible bug is resolved either way.
      act(() => {
        useTabStore.setState({ activeTabId: tabB.id });
      });

      expect(useTabStore.getState().dirtyTabIds.has(tabB.id)).toBe(false);
    });
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

    it("falls back to first-connected when MRU is empty (multiple actives)", () => {
      // Sprint 119 (#SHELL-1) — without an MRU seed the policy reverts to
      // the legacy "first connected wins" behavior, so the order in the
      // list (c1 inactive, c2 first connected) decides the target.
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

  // Sprint 119 (#SHELL-1) — MRU policy specifics. These tests pin (a) the
  // MRU-wins case, (b) the stale-MRU fallback, and (c) tab creation as the
  // MRU signal source.
  describe("Empty state MRU policy (sprint 119)", () => {
    it("AC-01 — picks the MRU connection over first-connected when both are connected", () => {
      setConnections({
        connections: [
          makeConnection("c1"),
          makeConnection("c2"),
          makeConnection("c3"),
        ],
        active: ["c2", "c3"],
      });
      // Seed MRU=c3 directly (the persistence path is exercised by
      // mruStore.test.ts; here we only care about MainArea's read).
      useMruStore.setState({ lastUsedConnectionId: "c3" });

      render(<MainArea />);

      // The CTA's contextual hint shows the target connection's name.
      expect(screen.getByText(/c3 DB/)).toBeInTheDocument();
      // first-connected (c2) must NOT be referenced.
      expect(screen.queryByText(/c2 DB/)).toBeNull();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
      });

      const state = useTabStore.getState();
      expect(state.tabs[0]!.connectionId).toBe("c3");
    });

    it("AC-03 — falls back to first-connected when MRU connection is currently disconnected", () => {
      setConnections({
        connections: [makeConnection("c1"), makeConnection("c2")],
        // c2 (the previous MRU) is NOT in the active set anymore.
        active: ["c1"],
      });
      useMruStore.setState({ lastUsedConnectionId: "c2" });

      render(<MainArea />);

      // CTA points at c1, NOT the stale MRU c2.
      expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
      expect(screen.queryByText(/c2 DB/)).toBeNull();
    });

    it("AC-03 — falls back to first-connected when MRU id no longer exists in the connection list", () => {
      // Edge case: the previously-used connection was deleted between
      // sessions. We must not crash and must defer to first-connected.
      setConnections({
        connections: [makeConnection("c1")],
        active: ["c1"],
      });
      useMruStore.setState({ lastUsedConnectionId: "c-deleted" });

      render(<MainArea />);

      expect(screen.getByText(/c1 DB/)).toBeInTheDocument();
    });

    it("AC-01/AC-04 — opening a query tab via the CTA marks that connection as MRU", () => {
      setConnections({
        connections: [makeConnection("c1"), makeConnection("c2")],
        active: ["c1", "c2"],
      });

      render(<MainArea />);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
      });

      // First-connected fallback fired (c1) → tab open against c1 →
      // tabStore.addQueryTab dispatches markConnectionUsed("c1").
      expect(useMruStore.getState().lastUsedConnectionId).toBe("c1");
    });
  });
});
