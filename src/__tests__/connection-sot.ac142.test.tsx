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
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import WorkspaceToolbar from "@components/workspace/WorkspaceToolbar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import * as windowControls from "@lib/window-controls";
import type { ConnectionConfig } from "@/types/connection";
beforeEach(() => {
  setupTauriMock({
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue([]),
  });
});

// Sprint 154 — `@lib/window-controls` is the new lifecycle seam. HomePage's
// activation handler routes through it. These tests previously asserted on
// the legacy app-shell field after activation; they now assert on the seam
// call shape, which is the same user-observable invariant (workspace
// becomes the active surface) but expressed in the post-Sprint-154
// architecture.
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

beforeEach(() => {
  vi.clearAllMocks();
  // Pristine store baselines per test.
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
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
    useWorkspaceStore.setState(
      seedWorkspace(
        [
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
        "tab-1",
        "conn1",
        "db1",
        { closedTabHistory: [], dirtyTabIds: [] },
      ),
    );

    render(<HomePage />);

    // Double-click "c2 DB" in the connection list to activate it.
    const c2Item = screen.getByText(/^c2 DB$/);
    await act(async () => {
      fireEvent.doubleClick(c2Item);
    });

    // Stale c1 tabs are closed. Active tab is null (c2 has no tabs yet).
    const tabs = getTestWorkspace().tabs;
    expect(tabs).toHaveLength(0);
    expect(getTestWorkspace().activeTabId).toBeNull();
    // Wave 9.5 (2026-05-16) — 사용자 desired UX: launcher 항상 visible.
    // HomePage 의 handleActivate 는 store side (focused conn / stale tabs)
    // 만 책임 — window seam 호출 0. workspace 윈도우는 ConnectionList 의
    // `openWorkspaceWindow(id)` 가 per-conn label 로 build.
    expect(useConnectionStore.getState().focusedConnId).toBe("c2");
    expect(windowControls.showWindow).not.toHaveBeenCalled();
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
  });

  it("AC-142-2: re-activating the same connection preserves its tabs (idempotent reactivation)", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      focusedConnId: "c1",
      // ADR 0027 — `useCurrentWorkspaceKey()` needs `activeDb`; without
      // it the workspace cannot be resolved and the re-activation flow
      // can't observe the seeded tab.
      activeStatuses: { c1: { type: "connected", activeDb: "db1" } },
    });
    // Seed the tab under c1's own workspace (the connection whose tabs
    // we're guarding against reset).
    useWorkspaceStore.setState(
      seedWorkspace(
        [
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
        "query-1",
        "c1",
        "db1",
        { closedTabHistory: [], dirtyTabIds: [] },
      ),
    );

    render(<HomePage />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    // Same-id activation must not blow away its own tabs.
    const ws = getTestWorkspace("c1", "db1");
    expect(ws.tabs).toHaveLength(1);
    expect(ws.activeTabId).toBe("query-1");
    // Wave 9.5 (2026-05-16) — launcher 는 항상 visible. handleActivate 의
    // 책임은 store side 만 — window seam 호출 0.
    expect(windowControls.showWindow).not.toHaveBeenCalled();
    expect(windowControls.hideWindow).not.toHaveBeenCalled();
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
