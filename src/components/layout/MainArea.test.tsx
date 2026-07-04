import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import MainArea from "./MainArea";
import {
  useWorkspaceStore,
  type TableTab,
  type QueryTab as QueryTabType,
} from "@stores/workspaceStore";
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

vi.mock("@features/catalog", () => ({
  StructurePanel: ({
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
  ViewStructurePanel: ({
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
  SchemaErdPanel: ({
    connectionId,
    database,
  }: {
    connectionId: string;
    database: string;
  }) => (
    <div
      data-testid="mock-erd"
      data-connection={connectionId}
      data-database={database}
    />
  ),
}));

vi.mock("@components/query/QueryTab", () => ({
  default: ({ tab }: { tab: unknown }) => (
    <div data-testid="mock-querytab" data-tab={JSON.stringify(tab)} />
  ),
}));

vi.mock("@components/search/SearchIndexDetailPanel", () => ({
  default: ({
    connectionId,
    index,
  }: {
    connectionId: string;
    index: string;
  }) => (
    <div
      data-testid="mock-search-index-detail"
      data-connection={connectionId}
      data-index={index}
    />
  ),
}));

// Sprint 350 (2026-05-15) — Mongo document-paradigm branch now renders a
// Records/Structure sub-tab bar that mounts `DocumentDataGrid` (Records)
// or `MongoStructurePanel` (Structure). Both are mocked so this suite
// focuses on the routing logic in `MainArea`, not the panels' bodies.
vi.mock("@components/document/DocumentDataGrid", () => ({
  default: ({
    connectionId,
    database,
    collection,
  }: {
    connectionId: string;
    database: string;
    collection: string;
  }) => (
    <div
      data-testid="mock-document-datagrid"
      data-connection={connectionId}
      data-database={database}
      data-collection={collection}
    />
  ),
}));

// Sprint 350 (2026-05-15) — the mock renders the controlled `active` prop
// and exposes a button that calls `onActiveChange`. AC-350-02 requires the
// inner Indexes/Validator pick to survive an outer Records ↔ Structure
// remount, so the mock must let the test (a) read whatever value the
// parent passes down and (b) drive a change without depending on the real
// `MongoIndexesPanel` body.
type MockMongoStructurePanelProps = {
  connectionId: string;
  database: string;
  collection: string;
  active?: "indexes" | "validator";
  onActiveChange?: (next: "indexes" | "validator") => void;
};
vi.mock("@components/document/MongoStructurePanel", () => ({
  MongoStructurePanel: ({
    connectionId,
    database,
    collection,
    active,
    onActiveChange,
  }: MockMongoStructurePanelProps) => (
    <div
      data-testid="mock-mongo-structure"
      data-connection={connectionId}
      data-database={database}
      data-collection={collection}
      data-active={active}
    >
      <button
        type="button"
        data-testid="mock-mongo-structure-select-validator"
        onClick={() => onActiveChange?.("validator")}
      >
        select-validator
      </button>
      <button
        type="button"
        data-testid="mock-mongo-structure-select-indexes"
        onClick={() => onActiveChange?.("indexes")}
      >
        select-indexes
      </button>
    </div>
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

// Sprint 350 (2026-05-15) — document-paradigm tab fixture. The document
// branch keys on `database` / `collection` (mongo names) rather than
// `schema` / `table`.
function makeDocumentTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "doc-tab-1",
    title: "users",
    connectionId: "mongo1",
    closable: true,
    database: "app",
    collection: "users",
    subView: "records",
    paradigm: "document",
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
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function setConnections(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  // Sprint 270 — defaults to `true` because every legacy test in this file
  // asserts post-hydrate behaviour (EmptyState, DataGrid, sub-tab routing).
  // The pre-hydrate skeleton path is exercised explicitly in
  // `firstPaintSkeleton.test.tsx` with `hasLoadedOnce: false`.
  hasLoadedOnce?: boolean;
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    // ADR 0027 — `useCurrentWorkspaceKey()` needs `activeDb`. Default
    // each connected status to `db1` so `addQueryTab` lands in a
    // resolvable workspace slot.
    statuses[c.id] = active.has(c.id)
      ? { type: "connected", activeDb: "db1" }
      : { type: "disconnected" };
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    hasLoadedOnce: opts.hasLoadedOnce ?? true,
  });
}

describe("MainArea", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
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

  // #1134 — the primary work surface must be a <main> landmark so screen
  // readers can jump straight to the content column.
  it("exposes the primary work surface as a <main> landmark (a11y #1134)", () => {
    render(<MainArea />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Sprint 270 — first-paint skeleton (AC-270-02, post-hydrate parity)
  // ------------------------------------------------------------------

  // Sprint 270 (2026-05-13)
  // AC-270-02 — pre-hydrate the main area must show the welcome-shaped
  // skeleton, not the `EmptyState`. Same rationale as sidebar: avoid the
  // empty-state flash during the IPC round-trip.
  it("AC-270-02 — renders MainAreaSkeleton when no active tab AND hasLoadedOnce is false", () => {
    setConnections({ hasLoadedOnce: false });

    render(<MainArea />);

    const skeleton = screen.getByTestId("main-area-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    // The post-hydrate logo wordmark + welcome copy must NOT be visible.
    expect(screen.queryByAltText("Table View")).toBeNull();
    expect(
      screen.queryByText(
        /select a connection from the sidebar to get started/i,
      ),
    ).toBeNull();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-04 (post-hydrate parity) — once hasLoadedOnce flips to true, the
  // skeleton stays unmounted and the legacy `EmptyState` renders even on a
  // remount (e.g. user navigates between layouts).
  it("AC-270-04 — renders EmptyState (not skeleton) when no active tab AND hasLoadedOnce is true", () => {
    setConnections({ hasLoadedOnce: true });

    const { unmount } = render(<MainArea />);
    expect(screen.queryByTestId("main-area-skeleton")).toBeNull();
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
    unmount();

    // Remount with the same flag — skeleton must still not re-render.
    render(<MainArea />);
    expect(screen.queryByTestId("main-area-skeleton")).toBeNull();
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  it("shows logo wordmark in empty state", () => {
    render(<MainArea />);

    const wordmark = screen.getByAltText("Table View");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark).toHaveAttribute("src", "/logo-wordmark.svg");
  });

  it("shows empty state when tabs exist but none are active", () => {
    const tab = makeTableTab({ id: "tab-1" });
    useWorkspaceStore.setState(seedWorkspace([tab], null));

    render(<MainArea />);

    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  // AC-06: table tab renders DataGrid + sub-tabs
  it("renders DataGrid for a table tab with records subView", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

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
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    expect(screen.getByTestId("mock-structure")).toBeInTheDocument();
    expect(screen.getByTestId("mock-structure")).toHaveAttribute(
      "data-table",
      "users",
    );
  });

  it("renders SearchIndexDetailPanel for search index tabs", () => {
    const tab = makeTableTab({
      id: "search-tab-1",
      title: "logs-elastic-2026.05.24",
      connectionId: "search-1",
      database: "_search",
      schema: "_search",
      table: "logs-elastic-2026.05.24",
      subView: "structure",
      paradigm: "search",
    });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    expect(screen.getByTestId("mock-search-index-detail")).toHaveAttribute(
      "data-connection",
      "search-1",
    );
    expect(screen.getByTestId("mock-search-index-detail")).toHaveAttribute(
      "data-index",
      "logs-elastic-2026.05.24",
    );
    expect(screen.queryByTestId("mock-datagrid")).toBeNull();
    expect(
      screen.queryByRole("tablist", { name: "Table view" }),
    ).not.toBeInTheDocument();
  });

  it("renders sub-tab bar with Records, Structure, and ERD tabs for table tab", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    // The sub-tab list
    const tablist = screen.getByRole("tablist", { name: "Table view" });
    expect(tablist).toBeInTheDocument();

    // Get tabs within the sub-tab list specifically (TabBar also has tabs)
    const tabs = tablist.querySelectorAll("[role='tab']");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("Records");
    expect(tabs[1]).toHaveTextContent("Structure");
    expect(tabs[2]).toHaveTextContent("ERD");
  });

  it("marks Records tab as selected when subView is records", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    const structureTab = screen.getByRole("tab", { name: "Structure" });
    const erdTab = screen.getByRole("tab", { name: "ERD" });
    expect(recordsTab).toHaveAttribute("aria-selected", "true");
    expect(structureTab).toHaveAttribute("aria-selected", "false");
    expect(erdTab).toHaveAttribute("aria-selected", "false");
  });

  it("marks Structure tab as selected when subView is structure", () => {
    const tab = makeTableTab({ subView: "structure" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    const structureTab = screen.getByRole("tab", { name: "Structure" });
    const erdTab = screen.getByRole("tab", { name: "ERD" });
    expect(recordsTab).toHaveAttribute("aria-selected", "false");
    expect(structureTab).toHaveAttribute("aria-selected", "true");
    expect(erdTab).toHaveAttribute("aria-selected", "false");
  });

  it("renders SchemaErdPanel for a table tab with erd subView", () => {
    const tab = makeTableTab({ subView: "erd", database: "app" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    expect(screen.getByTestId("mock-erd")).toHaveAttribute(
      "data-connection",
      "conn1",
    );
    expect(screen.getByTestId("mock-erd")).toHaveAttribute(
      "data-database",
      "app",
    );
  });

  it("switches to erd subView when ERD tab is clicked", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const erdTab = screen.getByRole("tab", { name: "ERD" });
    act(() => {
      fireEvent.click(erdTab);
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    expect(updatedTab).toBeDefined();
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("erd");
    }
  });

  // #1131 — ArrowRight roving reaches the ERD sub-tab (previously the ERD
  // tab's ArrowRight always jumped back to Records, so it was keyboard-
  // unreachable). Records → Structure → ERD, one step per key.
  it("#1131 ArrowRight roves Records → Structure → ERD (ERD keyboard-reachable)", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const tablist = screen.getByRole("tablist", { name: "Table view" });
    const subView = () => {
      const s = getTestWorkspace().tabs.find((t) => t.id === tab.id);
      return s && s.type === "table" ? s.subView : undefined;
    };

    act(() => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(subView()).toBe("structure");

    act(() => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(subView()).toBe("erd");
    expect(screen.getByRole("tab", { name: "ERD" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Home jumps back to Records — exactly one tab stop rolls.
    act(() => {
      fireEvent.keyDown(tablist, { key: "Home" });
    });
    expect(subView()).toBe("records");
    const stops = Array.from(tablist.querySelectorAll("[role='tab']")).filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("Records");
  });

  it("switches to structure subView when Structure tab is clicked", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const structureTab = screen.getByRole("tab", { name: "Structure" });
    act(() => {
      fireEvent.click(structureTab);
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    expect(updatedTab).toBeDefined();
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("structure");
    }
  });

  it("switches to records subView when Records tab is clicked", () => {
    const tab = makeTableTab({ subView: "structure" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    act(() => {
      fireEvent.click(recordsTab);
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    expect(updatedTab).toBeDefined();
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("records");
    }
  });

  it("toggles subView with ArrowRight key on Records tab", () => {
    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const recordsTab = screen.getByRole("tab", { name: "Records" });
    act(() => {
      fireEvent.keyDown(recordsTab, { key: "ArrowRight" });
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("structure");
    }
  });

  it("toggles subView with ArrowLeft key on Structure tab", () => {
    const tab = makeTableTab({ subView: "structure" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    const structureTab = screen.getByRole("tab", { name: "Structure" });
    act(() => {
      fireEvent.keyDown(structureTab, { key: "ArrowLeft" });
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === tab.id);
    if (updatedTab && updatedTab.type === "table") {
      expect(updatedTab.subView).toBe("records");
    }
  });

  // AC-07: query tab renders QueryTab
  it("renders QueryTab for a query tab", () => {
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    expect(screen.getByTestId("mock-querytab")).toBeInTheDocument();
  });

  it("passes correct tab data to QueryTab", () => {
    const tab = makeQueryTab({ sql: "SELECT * FROM users" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

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
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    // TabBar should render the tab items
    const tabBar = screen.getByRole("tablist", { name: "Open connections" });
    expect(tabBar).toBeInTheDocument();
  });

  it("does not render table content when table tab has no table name", () => {
    const tab = makeTableTab({ table: undefined });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    // Without table name, it should show empty state (falls through)
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  it("does not render table content when table tab has no schema", () => {
    const tab = makeTableTab({ schema: undefined });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

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
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

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
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

    render(<MainArea />);

    expect(screen.getByTestId("mock-datagrid")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-view-structure")).toBeNull();
  });

  it("falls back to StructurePanel when objectKind is omitted (legacy tab)", () => {
    const tab = makeTableTab({ subView: "structure" });
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

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
      useWorkspaceStore.setState(seedWorkspace([tabA, tabB], tabA.id));

      render(<MainArea />);

      expect(datagridMountLog).toEqual([
        { connectionId: "conn1", table: "users" },
      ]);

      act(() => {
        useWorkspaceStore.setState((state) => ({
          workspaces: {
            ...state.workspaces,
            conn1: {
              ...state.workspaces.conn1,
              db1: {
                ...(state.workspaces.conn1?.db1 ?? {
                  tabs: [],
                  activeTabId: null,
                  closedTabHistory: [],
                  dirtyTabIds: [],
                  sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
                }),
                activeTabId: tabB.id,
              },
            },
          },
        }));
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
      useWorkspaceStore.setState(seedWorkspace([tabA, tabB], tabA.id));

      // Simulate the state the buggy code would produce: tab A is dirty
      // because its useDataGridEdit effect ran with `activeTabId === A`.
      act(() => {
        useWorkspaceStore.getState().setTabDirty("conn1", "db1", tabA.id, true);
      });

      render(<MainArea />);

      // Sanity — A is dirty.
      expect(getTestWorkspace().dirtyTabIds.includes(tabA.id)).toBe(true);
      expect(getTestWorkspace().dirtyTabIds.includes(tabB.id)).toBe(false);

      // Swap to B. After the fix, A's grid unmounts and its effect
      // cleanup clears A. B mounts fresh with empty pendingEdits and
      // never sets B dirty. The contract is "B does not get marked
      // dirty" — A's marker may or may not survive (the cleanup clears
      // it). The user-visible bug is resolved either way.
      act(() => {
        useWorkspaceStore.setState((state) => ({
          workspaces: {
            ...state.workspaces,
            conn1: {
              ...state.workspaces.conn1,
              db1: {
                ...(state.workspaces.conn1?.db1 ?? {
                  tabs: [],
                  activeTabId: null,
                  closedTabHistory: [],
                  dirtyTabIds: [],
                  sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
                }),
                activeTabId: tabB.id,
              },
            },
          },
        }));
      });

      expect(getTestWorkspace().dirtyTabIds.includes(tabB.id)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // WAI-ARIA tabpanel wiring (a11y): tab ↔ panel association.
  // ------------------------------------------------------------------
  // 작성 이유: 커스텀 tablist 5곳의 tabpanel gap 을 닫는 additive ARIA
  // 배선. 여기서는 (a) main editor tab (TabItem) 이 MainArea content
  // panel 과 id 로 연결되는지, (b) RDB Records/Structure 서브탭이 각
  // panel 과 연결되고 서브탭 전환 시 id 가 갱신되는지 (link 검증) 를 가드.
  describe("tabpanel ARIA wiring", () => {
    it("wires the active editor tab to the MainArea content panel", () => {
      const tab = makeTableTab({ id: "tab-77", subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      // Active editor tab lives in the TabBar tablist ("Open connections").
      const tabBar = screen.getByRole("tablist", { name: "Open connections" });
      const editorTab = tabBar.querySelector('[role="tab"]')!;
      expect(editorTab.getAttribute("id")).toBe("tab-tab-77");

      const panel = document.getElementById("tabpanel-tab-77")!;
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", "tab-tab-77");
      expect(editorTab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel).toHaveAttribute("tabindex", "0");
    });

    it("wires the RDB Records sub-tab to its panel and re-wires on switch to Structure", () => {
      const tab = makeTableTab({ subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      const recordsTab = screen.getByRole("tab", { name: "Records" });
      const recordsPanel = document.getElementById("tabpanel-rdb-records")!;
      expect(recordsPanel).toHaveAttribute("role", "tabpanel");
      expect(recordsPanel).toHaveAttribute("aria-labelledby", recordsTab.id);
      expect(recordsTab.getAttribute("aria-controls")).toBe(recordsPanel.id);
      // The mocked DataGrid is the panel's body.
      expect(recordsPanel).toContainElement(
        screen.getByTestId("mock-datagrid"),
      );

      // Switch to Structure — the active panel now points at the Structure tab.
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: "Structure" }));
      });

      const structureTab = screen.getByRole("tab", { name: "Structure" });
      const structurePanel = document.getElementById("tabpanel-rdb-structure")!;
      expect(structurePanel).toHaveAttribute(
        "aria-labelledby",
        structureTab.id,
      );
      expect(structureTab.getAttribute("aria-controls")).toBe(
        structurePanel.id,
      );
      expect(document.getElementById("tabpanel-rdb-records")).toBeNull();
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

    it("describes the Redis empty-state CTA as command-oriented, not SQL", () => {
      const redisConnection: ConnectionConfig = {
        ...makeConnection("redis-1"),
        name: "Local Redis",
        dbType: "redis",
        database: "2",
        paradigm: "kv",
      };
      setConnections({
        connections: [redisConnection],
        active: ["redis-1"],
      });
      useConnectionStore.setState({
        activeStatuses: { "redis-1": { type: "connected", activeDb: "2" } },
      });

      render(<MainArea />);

      expect(
        screen.getByText(/start writing Redis commands against/i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/start writing SQL against/i)).toBeNull();
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

      // ADR 0027 — tab lands in workspace ("c1", db1).
      const state = getTestWorkspace("c1", "db1");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.type).toBe("query");
      expect(state.tabs[0]!.connectionId).toBe("c1");
    });

    it("clicking New Query on Mongo uses the configured database when activeDb is not selected", () => {
      const mongoConnection: ConnectionConfig = {
        ...makeConnection("m1"),
        dbType: "mongodb",
        database: "analytics",
        paradigm: "document",
      };
      setConnections({
        connections: [mongoConnection],
        active: ["m1"],
      });
      useConnectionStore.setState({
        activeStatuses: { m1: { type: "connected" } },
      });

      render(<MainArea />);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /new query/i }));
      });

      const state = getTestWorkspace("m1", "analytics");
      expect(state.tabs).toHaveLength(1);
      const tab = state.tabs[0]!;
      expect(tab.type).toBe("query");
      if (tab.type === "query") {
        expect(tab.paradigm).toBe("document");
        expect(tab.queryLanguage).toBe("mongosh");
        expect(tab.database).toBe("analytics");
      }
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

      const state = getTestWorkspace("c2", "db1");
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

      const state = getTestWorkspace("c3", "db1");
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

  // ------------------------------------------------------------------
  // Sprint 350 (2026-05-15) — Mongo Records/Structure sub-tab bar.
  // ------------------------------------------------------------------
  // 작성 이유: 본 sprint 가 document-paradigm tab 의 "render
  // DocumentDataGrid directly" 패턴을 Records/Structure sub-tab bar 로
  // 교체한다. AC-350-01 (sub-tab bar shape + Records 기본 선택),
  // AC-350-02 (Structure 활성화 시 MongoStructurePanel 마운트), 그리고
  // AC-350-05 (RDB regression guard — mongo testids 가 RDB tab 에서
  // 노출되지 않음) 을 한 describe 에 묶어 가드한다.
  describe("Sprint 350 — Mongo Records/Structure sub-tab bar", () => {
    it("AC-350-01 — renders Records/Structure sub-tab bar with Records selected by default for document paradigm", () => {
      const tab = makeDocumentTab({ subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      const tablist = screen.getByTestId("mongo-table-subtab-bar");
      expect(tablist).toHaveAttribute("role", "tablist");
      const recordsTab = screen.getByRole("tab", { name: "Records" });
      const structureTab = screen.getByRole("tab", { name: "Structure" });
      expect(recordsTab).toHaveAttribute("aria-selected", "true");
      expect(structureTab).toHaveAttribute("aria-selected", "false");

      // Records pane mounts DocumentDataGrid; MongoStructurePanel stays
      // unmounted while Records is selected.
      expect(screen.getByTestId("mock-document-datagrid")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-mongo-structure")).toBeNull();
    });

    it("AC-350-02 — switching to Structure mounts MongoStructurePanel and unmounts DocumentDataGrid", () => {
      const tab = makeDocumentTab({ subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: "Structure" }));
      });

      // Underlying store flips subView.
      const state = getTestWorkspace("mongo1", "app");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated && updated.type === "table" ? updated.subView : "").toBe(
        "structure",
      );

      // MongoStructurePanel mounts in the Structure slot.
      const panel = screen.getByTestId("mock-mongo-structure");
      expect(panel).toHaveAttribute("data-connection", "mongo1");
      expect(panel).toHaveAttribute("data-database", "app");
      expect(panel).toHaveAttribute("data-collection", "users");
      expect(screen.queryByTestId("mock-document-datagrid")).toBeNull();
    });

    it("AC-350-02 — ArrowRight on Records toggles to Structure (keyboard navigation parity with RDB)", () => {
      const tab = makeDocumentTab({ subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      const recordsTab = screen.getByRole("tab", { name: "Records" });
      act(() => {
        fireEvent.keyDown(recordsTab, { key: "ArrowRight" });
      });

      const state = getTestWorkspace("mongo1", "app");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated && updated.type === "table" ? updated.subView : "").toBe(
        "structure",
      );
    });

    // Sprint 350 (2026-05-15) — AC-350-02 literal wording: "the inner
    // selection survives Structure-tab re-activation". Toggling outer
    // Records → Structure → Records → Structure must NOT reset the
    // user's Indexes/Validator pick. Owned by `TableTabView` so the
    // state outlives the conditional remount of `MongoStructurePanel`.
    it("AC-350-02 — inner selection survives outer Records → Structure → Records → Structure cycle", () => {
      const tab = makeDocumentTab({ subView: "structure" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      // Initial render: Structure pane, inner pick defaults to "indexes".
      const initialPanel = screen.getByTestId("mock-mongo-structure");
      expect(initialPanel).toHaveAttribute("data-active", "indexes");

      // User picks Validator inside Structure.
      act(() => {
        fireEvent.click(
          screen.getByTestId("mock-mongo-structure-select-validator"),
        );
      });
      expect(screen.getByTestId("mock-mongo-structure")).toHaveAttribute(
        "data-active",
        "validator",
      );

      // Outer cycle: Structure → Records (unmounts MongoStructurePanel).
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: "Records" }));
      });
      expect(screen.queryByTestId("mock-mongo-structure")).toBeNull();
      expect(screen.getByTestId("mock-document-datagrid")).toBeInTheDocument();

      // Outer cycle: Records → Structure (re-mounts MongoStructurePanel).
      act(() => {
        fireEvent.click(screen.getByRole("tab", { name: "Structure" }));
      });

      // The inner pick must still be "validator", not the default
      // "indexes". This is the survival contract that AC-350-02 asks for.
      const remountedPanel = screen.getByTestId("mock-mongo-structure");
      expect(remountedPanel).toHaveAttribute("data-active", "validator");
    });

    it("AC-350-05 — RDB regression guard: rdb tab still renders the existing 'Table view' tab bar and mongo testids stay absent", () => {
      const tab = makeTableTab({ subView: "records" });
      useWorkspaceStore.setState(seedWorkspace([tab], tab.id));

      render(<MainArea />);

      // The RDB branch keeps its `aria-label="Table view"` tablist.
      expect(
        screen.getByRole("tablist", { name: "Table view" }),
      ).toBeInTheDocument();
      // Document-paradigm testids are NOT present.
      expect(screen.queryByTestId("mongo-table-subtab-bar")).toBeNull();
      expect(screen.queryByTestId("mock-mongo-structure")).toBeNull();
      expect(screen.queryByTestId("mock-document-datagrid")).toBeNull();
      // RDB grid still mounts via its mocked stand-in.
      expect(screen.getByTestId("mock-datagrid")).toBeInTheDocument();
    });
  });
});
