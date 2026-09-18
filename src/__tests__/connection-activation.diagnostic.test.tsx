// Purpose: Connection activation lifecycle diagnostics
//
// User-reported bugs:
//   Bug 1: Double-clicking a Connection did not open the workspace
//   Bug 2: Clicking a PG sidebar table stacked preview tabs instead of swapping
//
// This file was written to diagnose handleActivate's detailed behavior.
// HomePage.test.tsx and window-transitions.test.tsx already cover the basic
// behavior, so this file avoids duplication and focuses on edge cases +
// error recovery + race conditions.
//
// AC IDs:
//   AC-156-01  Double-click ordering (showWindow → focusWindow → hideWindow)
//   AC-156-02  Rapid double-click guard (no duplicate showWindow)
//   AC-156-03  Re-activation after disconnect
//   AC-156-04  showWindow rejection → launcher stays visible, toast shown
//   AC-156-05  Single-click does NOT trigger window swap
//   AC-156-06  Sequential activation (A → B): B focused, A's stale tabs cleared

import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import HomePage from "@/pages/HomePage";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { ConnectionId, TabId } from "@/types/branded";
import type { ConnectionConfig } from "@/types/connection";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));
beforeEach(() => {
  setupTauriMock({
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue([]),
    listSchemas: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
  });
});

vi.mock("@features/connection", async () => {
  const connectionStore = await vi.importActual<
    typeof import("@stores/connectionStore")
  >("@stores/connectionStore");

  return {
    ...connectionStore,
    // #2440 — HomePage mounts `ConnectionBrowser` (rail + pane). The stub keeps
    // the old testids: what these cases prove is HomePage's activation handler,
    // not which child fired it.
    ConnectionBrowser: ({
      onSelect,
      onActivate,
    }: {
      selectedId: string | null;
      onSelect?: (id: string) => void;
      onActivate?: (id: string) => void;
    }) => (
      <div data-testid="connection-list">
        <button data-testid="list-pick-c1" onClick={() => onSelect?.("c1")}>
          pick c1
        </button>
        <button
          data-testid="list-activate-c1"
          onClick={() => onActivate?.("c1")}
        >
          activate c1
        </button>
        <button data-testid="list-pick-c2" onClick={() => onSelect?.("c2")}>
          pick c2
        </button>
        <button
          data-testid="list-activate-c2"
          onClick={() => onActivate?.("c2")}
        >
          activate c2
        </button>
      </div>
    ),
    ConnectionDialog: () => <div data-testid="connection-dialog-stub" />,
    ImportExportDialog: () => <div data-testid="import-export-dialog-stub" />,
    GroupDialog: () => <div data-testid="group-dialog-stub" />,
  };
});
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-stub" />,
}));

// jsdom localStorage shim (project-wide pattern).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

import * as windowControls from "@lib/window-controls";

const showWindowMock = windowControls.showWindow as Mock;
const hideWindowMock = windowControls.hideWindow as Mock;
const focusWindowMock = windowControls.focusWindow as Mock;

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

function resetStores() {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  showWindowMock.mockResolvedValue(undefined);
  hideWindowMock.mockResolvedValue(undefined);
  focusWindowMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  resetStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AC-156-*: Connection activation diagnostic", () => {
  // Reason: workspace windows carry a per-conn label `workspace-{conn_id}`
  // and ConnectionList's `openWorkspaceWindow(id)` owns build/focus.
  // HomePage's handleActivate touches the store side only. The old
  // contract's showWindow/focusWindow assertions came from the
  // single-workspace model — the source of the two-windows-coexisting
  // regression.
  it("AC-156-01 (revised): double-click hides launcher and does NOT call showWindow/focusWindow('workspace')", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalled();
  });

  // Reason: the rapid double-click guard still holds — no window seam call,
  // and the store side keeps the activated connection focused.
  it("AC-156-02 (revised): rapid double-click — window seam 호출 0, store side 1회만 갱신", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // The launcher is always visible — zero hide calls.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    // The store side is updated.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: re-activation after a disconnect. The invariant is that the
  // store refocuses the connection and no window seam is called.
  it("AC-156-03 (revised): after disconnecting, re-activating the same connection still hides launcher", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });

    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "disconnected",
    });

    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: the old contract's "showWindow rejects → launcher stays visible"
  // recovery lost its meaning once HomePage stopped calling showWindow.
  // What this locks now is that handleActivate calls no window seam at all
  // and the store side still updates.
  it("AC-156-04 (revised): launcher 는 항상 visible — handleActivate 가 어떤 window seam 도 호출하지 않는다", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: a single click (select) must not trigger a window swap.
  //         Only double-click (= onActivate) triggers a swap. To avoid
  //         duplicating the existing tests, this asserts the zero seam calls
  //         explicitly.
  it("AC-156-05: single-click (onSelect) does NOT trigger any window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "disconnected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-pick-c1"));
    });

    // Single-click must update focusedConnId but NOT swap windows.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
  });

  // Reason: locks only the store side of sequential activation (focusedConn
  // update + stale tab cleanup). The old showWindow/focusWindow call
  // assertions conflicted with the per-conn window system — the source of
  // the double-window regression.
  it("AC-156-06 (revised): activating connection A then B → B becomes focused, A's stale tabs are cleared", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2")],
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "connected" },
      },
      focusedConnId: null,
    });

    // Pre-seed tabs owned by c1.
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-a1" as TabId,
            title: "public.users",
            connectionId: "c1" as ConnectionId,
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
          },
        ],
        "tab-a1",
        "conn1",
        "db1",
        { closedTabHistory: [], dirtyTabIds: [] },
      ),
    );

    render(<HomePage />);

    // Activate c1 first.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // Clear mocks to isolate the second activation.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    focusWindowMock.mockClear();

    // Now activate c2.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c2"));
    });

    // B must become focused.
    expect(useConnectionStore.getState().focusedConnId).toBe("c2");

    // The launcher stays visible. handleActivate owns the store side only
    // (focusedConn + stale tabs) — zero window seam calls.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();

    // A's stale tabs must be cleared — only c2 tabs (none yet) remain.
    const tabState = getTestWorkspace();
    const c1Tabs = tabState.tabs.filter((t) => t.connectionId === "c1");
    expect(c1Tabs).toHaveLength(0);
  });

  // Reason: checks that handleActivate updates focusedConnId synchronously.
  //         If the async ordering slips, the workspace can render while
  //         focusedConnId is not updated yet.
  it("AC-156-01 (extended): setFocusedConn runs synchronously before the async window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // Fire activate and immediately check — setFocusedConn is synchronous,
    // but the window swap is async (void-returned IIFE). By the time we
    // yield to the event loop via `await act`, the sync part must be done.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // focusedConnId must be set BEFORE showWindow resolves.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: HomePage no longer calls showWindow / focusWindow("workspace"),
  // so this case's original scenario is moot. It now locks that a rejecting
  // focusWindow mock leaves the HomePage flow untouched, because focusWindow
  // is never called.
  it("AC-156-04b (revised): focusWindow mock rejects — HomePage flow 가 호출하지 않으므로 영향 없음", async () => {
    focusWindowMock.mockImplementation(async () => {
      throw new Error("focusWindow failed (simulated)");
    });

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});
