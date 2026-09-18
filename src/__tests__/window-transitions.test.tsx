/**
 * AC-154-* (Window Lifecycle Wiring) regression tests.
 *
 * **TDD-FIRST**: this file was authored before the production page wirings
 * (`LauncherPage` activation, `WorkspacePage` Back / close, launcher close
 * → app_exit). Against the pre-wiring code, every assertion fails because
 * the pages still mutated the legacy app-shell store field instead of the
 * `@lib/window-controls` seam. After the wiring lands, the same file goes
 * green.
 *
 * Each `it(...)` name embeds the AC label (AC-154-N) for grep-ability.
 *
 * The user-facing transitions under test:
 *
 *   AC-154-01  Activate    workspace.show() → setFocus() → launcher.hide()
 *   AC-154-02  Back        workspace.hide() → launcher.show(); NO disconnect
 *   AC-154-03  Disconnect  disconnectFromDatabase(focusedConnId); NO hide
 *   AC-154-04  LauncherX   tauri://close-requested → exitApp()
 *   AC-154-05  WorkspaceX  tauri://close-requested = Back semantics
 *
 * Plus one error-path locking the activation recovery when
 * `workspace.show()` rejects (AC-154 contract Test Requirements).
 */

// #2431 — the Back control moved out of `WorkspacePage` into the toolbar, and
// `MainArea` (which mounts the toolbar) is stubbed below. AC-154-02's subject
// is Back, so it renders the button; AC-154-05's subject is the page's own
// mount behaviour, so that one still renders the page.
import { BackToConnectionsButton, WorkspacePage } from "@features/workspace";
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
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { ConnectionConfig } from "@/types/connection";

// -----------------------------------------------------------------------------
// Mocks — the seam is the test boundary. Tests assert ordering via
// vi.fn().mock.invocationCallOrder so handler-internal sequencing is locked.
// -----------------------------------------------------------------------------

vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
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

// WorkspacePage transitively renders Sidebar + MainArea — we don't care
// about their bodies for transition assertions.
vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-stub" />,
}));
vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-stub" />,
}));

// HomePage's connection feature API is mocked so we control onActivate without
// the full connection-grid machinery.
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

// jsdom shim for localStorage (mirrors HomePage.test.tsx).
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
const destroyCurrentWindowMock = windowControls.destroyCurrentWindow as Mock;
const exitAppMock = windowControls.exitApp as Mock;
const onCloseRequestedMock = windowControls.onCloseRequested as Mock;
const onCurrentWindowCloseRequestedMock =
  windowControls.onCurrentWindowCloseRequested as Mock;

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
  showWindowMock.mockResolvedValue(undefined);
  hideWindowMock.mockResolvedValue(undefined);
  focusWindowMock.mockResolvedValue(undefined);
  destroyCurrentWindowMock.mockResolvedValue(undefined);
  exitAppMock.mockResolvedValue(undefined);
  onCloseRequestedMock.mockResolvedValue(() => {});
  onCurrentWindowCloseRequestedMock.mockResolvedValue(() => {});
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC-154-*: Window lifecycle wiring", () => {
  // ---------------------------------------------------------------------------
  // AC-154-01
  //
  // Old contract: `showWindow("workspace")` → `focusWindow("workspace")` →
  // `hideWindow("launcher")`, on the single-workspace model (one window
  // under the `"workspace"` label).
  //
  // Workspace windows now carry a per-conn `workspace-{conn_id}` label.
  // ConnectionList's `openWorkspaceWindow(id)` calls the backend
  // `open_workspace_window` to build (`visible: true`) or focus the per-conn
  // window. If HomePage's handleActivate also called
  // `showWindow("workspace")`, a separate window under the `"workspace"`
  // label would appear — the regression the user saw, with the launcher, the
  // per-conn workspace and the bare workspace all visible at once.
  //
  // New contract: HomePage's handleActivate owns the store side only
  // (focusedConn, stale tab cleanup). Zero window-side calls.
  // ---------------------------------------------------------------------------
  it("AC-154-01 (revised): activating a connection does NOT hide launcher and does NOT call showWindow/focusWindow — launcher 는 항상 visible (사용자 desired UX)", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // Locks the regression: the launcher is neither closed nor hidden.
    expect(hideWindowMock).not.toHaveBeenCalled();
    // Desired UX: the launcher stays visible. ConnectionList's
    // `openWorkspaceWindow(id)` owns the workspace window build/focus.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();

    // The store side updates normally.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-154-02: Back to connections (workspace → launcher) preserves pool
  // ---------------------------------------------------------------------------
  it("AC-154-02 (revised): 'Back to connections' calls focusWindow('launcher') then destroyCurrentWindow — pool preserved", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as Mock;

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<BackToConnectionsButton />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });

    // Desired UX: "pressing < Connections should close the connection window
    // and move focus to the connections window". The launcher is always
    // visible, so the pattern is focus + close, not hide/show.
    expect(focusWindowMock).toHaveBeenCalledWith("launcher");
    expect(destroyCurrentWindowMock).toHaveBeenCalled();

    // Strict ordering: launcher focus BEFORE workspace close, so the focus
    // IPC does not race the process destroyed by the close.
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const closeOrder = destroyCurrentWindowMock.mock.invocationCallOrder[0]!;
    expect(focusOrder).toBeLessThan(closeOrder);

    // The pool MUST be preserved — Back is not Disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "connected",
    });
  });

  // ---------------------------------------------------------------------------
  // AC-154-03: Disconnect evicts pool, leaves window visible
  // ---------------------------------------------------------------------------
  it("AC-154-03: Disconnect calls disconnectFromDatabase(focusedConnId) and does NOT hide the workspace window as a side effect", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as Mock;
    disconnectMock.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // The user signal we're locking is the store action itself (the
    // DisconnectButton click coverage already lives in
    // connection-sot.ac142.test.tsx). The crucial AC-154-03 contract is
    // that `disconnectFromDatabase` does NOT trigger any window-control
    // seam call.
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });

    expect(disconnectMock).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "disconnected",
    });

    // Pool eviction must NOT cascade into a window hide. That's the
    // distinction the contract pins.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // AC-154-04: Launcher close → hide (NOT exit)
  //
  // Q13 changed launcher close semantics: the X button hides the launcher
  // without exiting the app so open `workspace-{conn_id}` windows stay alive
  // (multi-conn TablePlus pattern). The backend's `on_window_event` matcher
  // in `src-tauri/src/lib.rs` calls `api.prevent_close()` +
  // `handle_launcher_close_request` (which hides the launcher). The JS
  // handler echoes with `hideWindow('launcher')` so jsdom unit tests see the
  // same lifecycle hook.
  //
  // This test used to assert `exitAppMock` was called. That path is retired
  // — the launcher is no longer the single-window dock-killer.
  // ---------------------------------------------------------------------------
  it("AC-154-04 (sprint-363): closing the launcher window (tauri://close-requested) hides launcher, does NOT exit the app", async () => {
    // Capture the close-requested handler the LauncherShell registers via
    // the seam, then invoke it manually to simulate the OS close gesture.
    let capturedHandler: (() => void | Promise<void>) | null = null;
    onCloseRequestedMock.mockImplementation(
      async (label: string, handler: () => void | Promise<void>) => {
        if (label === "launcher") {
          capturedHandler = handler;
        }
        return () => {};
      },
    );

    const { registerLauncherCloseHandler } = await import(
      "@lib/window-lifecycle-boot"
    );
    await registerLauncherCloseHandler();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
    expect(capturedHandler).toBeTruthy();

    await act(async () => {
      await capturedHandler!();
    });

    // The launcher is hidden, not exited.
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    expect(exitAppMock).not.toHaveBeenCalled();

    // Workspace windows (per-conn) must NOT be touched by the launcher
    // close path — they own their own lifecycle.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalledWith("workspace");
  });

  // ---------------------------------------------------------------------------
  // AC-154-05: the workspace registers no close-requested listener.
  //
  // Old contract — in the launcher-hidden era an OS-level close made the
  // process look dead, so close-requested had to be intercepted. Under the
  // "launcher always visible" UX that listener became dead code, and worse,
  // the old `closeCurrentWindow()` (= `win.close()`) fired close-requested →
  // the same listener ran preventDefault and re-invoked this handler → the
  // root cause of the **infinite loop with a window that would not close**.
  // This test locks the listener's absence — adding it back revives the trap.
  // ---------------------------------------------------------------------------
  it("AC-154-05 (Wave 9.5 회귀 4): WorkspacePage does NOT register a close-requested listener — listener was the infinite loop trap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    render(<WorkspacePage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onCurrentWindowCloseRequestedMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Error path: the old contract's "workspace.show() rejects → launcher
  // remains" recovery lost its meaning under the per-conn window model
  // (HomePage no longer calls workspace.show). What is left to lock is that
  // activation reaches no window seam at all and the store side still
  // updates.
  // ---------------------------------------------------------------------------
  it("AC-154-01 error path (revised): window seam 호출 0 + store side 정상 — launcher 가 항상 visible 이므로 hideWindow 도 호출 안 함", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // The launcher stays visible — hide is not called either.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});
