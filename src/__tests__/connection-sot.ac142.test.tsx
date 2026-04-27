/**
 * Sprint 148 — AC-142-* (Connection SoT cleanup + Disconnect) regression tests.
 *
 * Sprint 134 already removed the Workspace connection picker / Cmd+K picker
 * and shipped a `DisconnectButton` with `aria-label="Disconnect"`; this file
 * locks the four AC-142-* invariants so a future change cannot silently
 * resurrect a Workspace connection switcher, drop the Disconnect button,
 * leak cross-connection tabs on swap, or break post-disconnect reconnect.
 *
 * Each `it(...)` name embeds the AC label (AC-142-N) for grep-ability.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import WorkspaceToolbar from "@components/workspace/WorkspaceToolbar";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { useAppShellStore } from "@stores/appShellStore";
import * as windowControls from "@lib/window-controls";
import type { ConnectionConfig } from "@/types/connection";

vi.mock("@lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...actual,
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue([]),
  };
});

// Sprint 154 — `@lib/window-controls` is the new lifecycle seam. HomePage's
// activation handler routes through it instead of the legacy
// `appShellStore.setScreen` toggle. These tests previously asserted on
// `appShellStore.screen` after activation; they now assert on the seam call
// shape, which is the same user-observable invariant (workspace becomes the
// active surface) but expressed in the post-Sprint-154 architecture.
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

function makeConn(id: string): ConnectionConfig {
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

beforeEach(() => {
  vi.clearAllMocks();
  // Pristine store baselines per test.
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
  // Sprint 154 — `appShellStore.screen` is vestigial post-multi-window
  // split. Keep the reset so existing protected tests that read it still
  // observe a deterministic baseline.
  useAppShellStore.setState({ screen: "home" });
  vi.mocked(windowControls.showWindow).mockClear();
  vi.mocked(windowControls.hideWindow).mockClear();
  vi.mocked(windowControls.focusWindow).mockClear();
});

describe("AC-142-*: Connection SoT + Disconnect regression locks", () => {
  it("AC-142-1: HomePage exposes only its own connection-management buttons; no Workspace-style 'Switch connection' picker UI is mounted", () => {
    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2")],
    });
    render(<HomePage />);

    // No element should advertise itself as a connection switcher / picker.
    expect(
      screen.queryByRole("button", { name: /switch connection/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /switch connection/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: /switch connection/i }),
    ).toBeNull();
    // No "Open command palette" / "Quick connection" affordance either.
    expect(screen.queryByText(/connection picker/i)).toBeNull();
    expect(screen.queryByText(/cmd\+k/i)).toBeNull();
  });

  it("AC-142-1: WorkspaceToolbar contains DbSwitcher + Disconnect only — no connection-level switcher button", () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      focusedConnId: "c1",
      activeStatuses: { c1: { type: "connected" } },
    });
    render(<WorkspaceToolbar />);

    const toolbar = screen.getByRole("toolbar", { name: /workspace toolbar/i });
    // Disconnect must be present.
    expect(
      within(toolbar).getByRole("button", { name: /^disconnect$/i }),
    ).toBeInTheDocument();
    // No connection switcher: scan the toolbar for any button whose
    // accessible name advertises connection switching.
    const buttons = within(toolbar).getAllByRole("button");
    const offenders = buttons.filter((b) =>
      /switch connection|change connection|connection picker/i.test(
        b.getAttribute("aria-label") ?? b.textContent ?? "",
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("AC-142-2: activating a different connection from Home closes the previous connection's tabs (clean-close swap)", async () => {
    const { connectToDatabase } = await import("@lib/tauri");
    const connectMock = connectToDatabase as ReturnType<typeof vi.fn>;
    connectMock.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2")],
      focusedConnId: "c1",
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "disconnected" },
      },
    });
    // Pre-populate two tabs owned by c1.
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "users",
          connectionId: "c1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
          paradigm: "rdb",
        },
        {
          type: "query",
          id: "query-1",
          title: "Query 1",
          connectionId: "c1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "idle" },
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
      activeTabId: "tab-1",
      closedTabHistory: [],
      dirtyTabIds: new Set<string>(),
    });

    render(<HomePage />);

    // Double-click "c2 DB" in the connection list to activate it.
    const c2Item = screen.getByText(/^c2 DB$/);
    await act(async () => {
      fireEvent.doubleClick(c2Item);
    });

    // Stale c1 tabs are closed. Active tab is null (c2 has no tabs yet).
    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(0);
    expect(useTabStore.getState().activeTabId).toBeNull();
    // Workspace becomes the active surface (focused on c2). Sprint 154
    // moved the surface activation from `appShellStore.setScreen` to the
    // `@lib/window-controls` seam — the user-observable invariant ("the
    // workspace shows up after activation") is now expressed as the
    // `showWindow("workspace")` seam call.
    expect(useConnectionStore.getState().focusedConnId).toBe("c2");
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  it("AC-142-2: re-activating the same connection preserves its tabs (idempotent reactivation)", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      focusedConnId: "c1",
      activeStatuses: { c1: { type: "connected" } },
    });
    useTabStore.setState({
      tabs: [
        {
          type: "query",
          id: "query-1",
          title: "Query 1",
          connectionId: "c1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "idle" },
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
      activeTabId: "query-1",
      closedTabHistory: [],
      dirtyTabIds: new Set<string>(),
    });

    render(<HomePage />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    // Same-id activation must not blow away its own tabs.
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().activeTabId).toBe("query-1");
    // Sprint 154 — workspace surface activation expressed via seam call.
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
  });

  it("AC-142-3: DisconnectButton has [aria-label='Disconnect'] and clicking it invokes disconnectFromDatabase for the focused connection", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as ReturnType<typeof vi.fn>;
    disconnectMock.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      focusedConnId: "c1",
      activeStatuses: { c1: { type: "connected" } },
    });
    render(<WorkspaceToolbar />);

    const button = screen.getByRole("button", { name: /^disconnect$/i });
    expect(button).toHaveAttribute("aria-label", "Disconnect");
    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(disconnectMock).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
  });

  it("AC-142-4: after disconnect, reactivating the same connection re-invokes the backend connect command and lands in 'connected'", async () => {
    const { connectToDatabase, disconnectFromDatabase } =
      await import("@lib/tauri");
    const connectMock = connectToDatabase as ReturnType<typeof vi.fn>;
    const disconnectMock = disconnectFromDatabase as ReturnType<typeof vi.fn>;
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      focusedConnId: "c1",
      activeStatuses: { c1: { type: "connected" } },
    });

    // Disconnect first via store action (mirrors DisconnectButton path).
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    // Re-invoke connect (the launcher double-click path uses this same store action).
    await act(async () => {
      await useConnectionStore.getState().connectToDatabase("c1");
    });
    expect(connectMock).toHaveBeenCalledWith("c1");
    expect(connectMock).toHaveBeenCalledTimes(1);
    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
  });
});
