import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import WorkspaceSidebar from "./WorkspaceSidebar";
import MainArea from "@/components/layout/MainArea";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { __resetMruStoreForTests } from "@stores/mruStore";

// Sprint 270 (2026-05-13) — AC-270-03 swap-order regression.
//
// Goal: assert the user never sees the post-hydrate empty surfaces
// ("No connections yet" sidebar card, `EmptyState` welcome card) flash
// between the first-paint skeleton and the actual final render. With a
// delayed-resolve `listConnections` mock we drive the store through its
// real timeline:
//
//   t=0   → connections=[], hasLoadedOnce=false → skeleton mounted
//   t=t1  → loadConnections resolves → hasLoadedOnce=true →
//           skeleton unmounts and the post-hydrate surface (empty card or
//           connection list, depending on the mocked payload) mounts.
//
// Both branches must transition WITHOUT mounting the wrong card in between.

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/scopedLocalStorage", () => ({
  persistFocusedConnId: vi.fn(),
  persistActiveStatuses: vi.fn(),
  readConnectionSession: () => ({
    focusedConnId: null,
    activeStatuses: null,
  }),
}));

vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", async () => {
  // sprint-366 (2026-05-16) — the hook + selector now import
  // parseWorkspaceLabel/formatWorkspaceLabel from the same module, so the
  // mock must surface them (use the real ones — they're pure string ops).
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: () => "test",
  };
});

// Manual-resolve handle so each test controls the IPC timing precisely.
const listConnectionsMock = vi.fn();

vi.mock("@lib/tauri", () => ({
  listConnections: (...args: unknown[]) => listConnectionsMock(...args),
  listGroups: vi.fn(() => Promise.resolve([])),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
  testConnection: vi.fn(),
  connectToDatabase: vi.fn(),
  disconnectFromDatabase: vi.fn(),
  saveGroup: vi.fn(),
  deleteGroup: vi.fn(),
  moveConnectionToGroup: vi.fn(),
}));

// The heavy paradigm trees aren't needed for swap-order assertions — the
// sidebar's pre-hydrate branch returns before pickSidebar runs.
vi.mock("@components/schema/SchemaTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="schema-tree">{connectionId}</div>
  ),
}));

vi.mock("@components/schema/DocumentDatabaseTree", () => ({
  default: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="document-database-tree">{connectionId}</div>
  ),
}));

// MainArea's grids/panels are heavy and irrelevant to the no-active-tab
// fallback we're asserting against here.
vi.mock("@components/rdb/DataGrid", () => ({
  default: () => <div data-testid="mock-datagrid" />,
}));
vi.mock("@components/schema/StructurePanel", () => ({
  default: () => <div data-testid="mock-structure" />,
}));
vi.mock("@components/schema/ViewStructurePanel", () => ({
  default: () => <div data-testid="mock-view-structure" />,
}));
vi.mock("@components/query/QueryTab", () => ({
  default: () => <div data-testid="mock-querytab" />,
}));

describe("First-paint skeleton swap-order (Sprint 270, AC-270-03)", () => {
  beforeEach(() => {
    listConnectionsMock.mockReset();
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      focusedConnId: null,
      loading: false,
      hasLoadedOnce: false,
      error: null,
    });
    useWorkspaceStore.setState({ workspaces: {} });
    __resetMruStoreForTests();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-03 happy-path: delayed-resolve `listConnections` returning [].
  // At t=0 the sidebar skeleton must be present and the post-hydrate empty
  // card must be absent. After resolve, exact opposite: skeleton gone,
  // "No connections yet" card present. No intermediate state.
  it("sidebar: skeleton at t=0, empty card after resolve — no flash of empty card pre-resolve", async () => {
    let resolveList: (value: unknown[]) => void = () => {};
    listConnectionsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    // Kick off the load (do NOT await it). At this point the store is
    // pre-hydrate: connections=[], hasLoadedOnce=false.
    const loadPromise = useConnectionStore.getState().loadConnections();

    render(<WorkspaceSidebar selectedId={null} />);

    // t=0 — skeleton visible, empty card not.
    expect(
      screen.getByTestId("workspace-sidebar-skeleton"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no connections yet/i)).toBeNull();

    // Now resolve the IPC with an empty list and let React flush.
    await act(async () => {
      resolveList([]);
      await loadPromise;
    });

    // Skeleton unmounted, empty card present.
    expect(screen.queryByTestId("workspace-sidebar-skeleton")).toBeNull();
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-03 happy-path: main area equivalent. At t=0 the welcome-shaped
  // skeleton; after resolve the legacy `EmptyState` (logo wordmark).
  it("main area: skeleton at t=0, EmptyState after resolve — no flash of EmptyState pre-resolve", async () => {
    let resolveList: (value: unknown[]) => void = () => {};
    listConnectionsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const loadPromise = useConnectionStore.getState().loadConnections();

    render(<MainArea />);

    // t=0 — skeleton mounted, EmptyState NOT mounted.
    expect(screen.getByTestId("main-area-skeleton")).toBeInTheDocument();
    expect(screen.queryByAltText("Table View")).toBeNull();
    expect(
      screen.queryByText(
        /select a connection from the sidebar to get started/i,
      ),
    ).toBeNull();

    await act(async () => {
      resolveList([]);
      await loadPromise;
    });

    expect(screen.queryByTestId("main-area-skeleton")).toBeNull();
    expect(screen.getByAltText("Table View")).toBeInTheDocument();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-03 error branch — `loadConnections` rejecting still flips
  // `hasLoadedOnce`, so the skeleton must unmount. The post-hydrate
  // surface in this case is the same "No connections yet" empty card
  // (the store records the error separately; the sidebar's branch keys
  // off connections.length only).
  it("sidebar: skeleton at t=0, empty card after rejection — skeleton does not stay stuck", async () => {
    let rejectList: (reason: unknown) => void = () => {};
    listConnectionsMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectList = reject;
        }),
    );

    const loadPromise = useConnectionStore.getState().loadConnections();

    render(<WorkspaceSidebar selectedId={null} />);

    expect(
      screen.getByTestId("workspace-sidebar-skeleton"),
    ).toBeInTheDocument();

    await act(async () => {
      rejectList(new Error("network down"));
      await loadPromise;
    });

    expect(useConnectionStore.getState().hasLoadedOnce).toBe(true);
    expect(useConnectionStore.getState().error).toContain("network down");
    expect(screen.queryByTestId("workspace-sidebar-skeleton")).toBeNull();
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });
});
