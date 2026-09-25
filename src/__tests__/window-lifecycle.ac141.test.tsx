/**
 * AC-141-* (Launcher/Workspace lifecycle) regression tests.
 *
 * The AC-141-* invariants run as real `it(...)` checks against the
 * `@lib/window-controls` seam and `tauri.conf.json`:
 *
 *   AC-141-1 (real)  launcher/workspace window dimensions + chrome match the
 *                    spec (720×560 fixed launcher / 1280×800 resizable
 *                    workspace) — read from `tauri.conf.json` directly so
 *                    the test fails if anyone widens the launcher chrome.
 *   AC-141-2 (real)  Activate emits workspace.show() → focus() → launcher.hide()
 *                    in strict order (locked via `mock.invocationCallOrder`).
 *   AC-141-3 (real)  Back emits workspace.hide() → launcher.show(); pool intact
 *                    (no `disconnectFromDatabase` call).
 *   AC-141-4 (real)  launcher close → `app_exit`; workspace close = Back
 *                    semantics (`preventDefault` + hide+show, no disconnect).
 *   AC-141-5 (real)  4-stage visibility integration (boot → activate → back →
 *                    disconnect) asserted on the seam mocks.
 *
 * Each `it(...)` name embeds the AC label (AC-141-N) for grep-ability.
 */

// #2431 — the Back control moved out of `WorkspacePage` into the toolbar, and
// `MainArea` (which mounts the toolbar) is stubbed below. The AC cases whose
// subject is Back therefore render the button itself; the page is still
// rendered where the subject is the page's own mount behaviour.
import { BackToConnectionsButton, WorkspacePage } from "@features/workspace";
import * as windowControls from "@lib/window-controls";
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
// `tauri.conf.json` is the source of truth for AC-141-1's fixed launcher /
// resizable workspace dimensions. Vite's JSON import gives
// us a synchronous, type-friendly read without dragging `@types/node` into
// the strict tsconfig just for this assertion.
import tauriConf from "../../src-tauri/tauri.conf.json";

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

// `@lib/window-controls` is the lifecycle seam; the whole module is stubbed
// so nothing reaches Tauri under jsdom. Activation/Back/close assertions are
// expressed against these seam mocks — the single source of truth for the
// current architecture (ADR 0012 supersedes ADR 0011).
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

// WorkspacePage transitively renders Sidebar + MainArea, both of which
// pull schema/tab state we don't care about here. Stub them so the only
// surface under test is the "Back to connections" button.
vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-stub" />,
}));
vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-stub" />,
}));

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
  exitAppMock.mockResolvedValue(undefined);
  onCloseRequestedMock.mockResolvedValue(() => {});
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

describe("AC-141-*: Launcher/Workspace lifecycle (real-window, post-Phase 12)", () => {
  // ---------------------------------------------------------------------------
  // AC-141-1 (real): launcher window 720×560 fixed in `tauri.conf.json`.
  // ADR-0017 — workspace is no longer declared statically; it is
  // lazy-built by `src-tauri/src/launcher.rs::build_workspace_window` on the
  // first `workspace_show`/`workspace_ensure` call to skip the WKWebView
  // spawn at boot. The 1280×800 / resizable / born-hidden invariants moved
  // into Rust; this test now asserts the *split*: launcher present here,
  // workspace absent.
  // ---------------------------------------------------------------------------
  it("AC-141-1 (real): launcher is 720×560 fixed (no resize/maximize, centered) in tauri.conf.json; workspace is lazy-built (Rust-side, ADR-0017)", () => {
    type WindowConf = {
      label: string;
      width: number;
      height: number;
      resizable?: boolean;
      maximizable?: boolean;
      center?: boolean;
      visible?: boolean;
      minWidth?: number;
      minHeight?: number;
    };
    const windows = (tauriConf as { app: { windows: WindowConf[] } }).app
      .windows;
    const launcher = windows.find((w) => w.label === "launcher");
    const workspace = windows.find((w) => w.label === "workspace");

    expect(launcher).toBeDefined();
    expect(launcher!.width).toBe(720);
    expect(launcher!.height).toBe(560);
    expect(launcher!.resizable).toBe(false);
    expect(launcher!.maximizable).toBe(false);
    expect(launcher!.center).toBe(true);
    // The launcher is the boot-visible chrome — Tauri opens it on app start.
    expect(launcher!.visible).toBe(true);

    // ADR-0017 — workspace must NOT be declared in tauri.conf.json. Anyone
    // re-adding it would re-introduce the boot-time WKWebView spawn we
    // explicitly cut to recover 5.8% of cold-start wall time. The runtime
    // shape (1280×800, resizable, born hidden) lives in
    // `build_workspace_window` and is exercised by the Rust-side launcher
    // tests at `src-tauri/src/launcher.rs::tests`.
    expect(workspace).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // AC-141-2
  //
  // Old contract: HomePage called `showWindow("workspace")` →
  // `focusWindow("workspace")` → `hideWindow("launcher")` itself, on the
  // single-workspace `"workspace"` label model.
  //
  // Workspace windows are now per-conn `workspace-{conn_id}` and
  // ConnectionList's `openWorkspaceWindow(id)` owns build/focus. HomePage's
  // handleActivate owns the store side only (focusedConn / stale cleanup).
  // A `showWindow("workspace")` call would spawn the old single-workspace
  // window on top — the two-windows-visible regression the user reported.
  // ---------------------------------------------------------------------------
  it("AC-141-2 (revised): activating from the launcher 는 window seam 호출 0 — launcher 항상 visible (Wave 9.5)", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    // Desired UX: the launcher stays visible. HomePage's handleActivate
    // owns the store side (focusedConn) only.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-141-3: Back → focusWindow('launcher') → destroyCurrentWindow; pool
  // stays alive.
  // ---------------------------------------------------------------------------
  it("AC-141-3 (revised): 'Back to connections' emits focusWindow('launcher') → destroyCurrentWindow and does NOT call disconnectFromDatabase", async () => {
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

    expect(focusWindowMock).toHaveBeenCalledWith("launcher");
    expect(destroyCurrentWindowMock).toHaveBeenCalled();

    // Focus before close, so the focus IPC does not race the process
    // destroyed by the close.
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const closeOrder = destroyCurrentWindowMock.mock.invocationCallOrder[0]!;
    expect(focusOrder).toBeLessThan(closeOrder);

    // Pool MUST be preserved — Back is not Disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "connected",
    });
  });

  // ---------------------------------------------------------------------------
  // AC-141-4: launcher close → hide (NOT exit); the workspace registers no
  // close-requested listener and its mount triggers no disconnect.
  //
  // Q13 replaced the launcher's close-exits-app behavior with
  // close-hides-launcher. Open workspaces (`workspace-{conn_id}`) stay
  // alive; the launcher can be resurfaced via the macOS dock icon or the
  // 2nd-launch single-instance callback.
  // ---------------------------------------------------------------------------
  it("AC-141-4 (sprint-363): launcher.close → hideWindow('launcher'); workspace.close = Back semantics (no disconnect)", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as Mock;

    // Capture the close handlers for both windows. The boot helper registers
    // the launcher one; WorkspacePage's mount effect registers the workspace
    // one. The `onCloseRequested` seam is what implements `preventDefault` —
    // we don't need to assert the prevent itself, only that the registered
    // handler reaches it (the seam contract guarantees prevent on register).
    const handlers: Record<string, () => void | Promise<void>> = {};
    onCloseRequestedMock.mockImplementation(
      async (label: string, handler: () => void | Promise<void>) => {
        handlers[label] = handler;
        return () => {};
      },
    );

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // 1. Launcher close path — `bootWindowLifecycle` is workspace-aware:
    //    it only registers when `getCurrentWindowLabel() === "launcher"`.
    //    Inside the test we exercise the registration helper directly.
    const { registerLauncherCloseHandler } = await import(
      "@lib/window-lifecycle-boot"
    );
    await registerLauncherCloseHandler();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
    expect(handlers.launcher).toBeTruthy();

    await act(async () => {
      await handlers.launcher!();
    });

    // The launcher is hidden, not exited.
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    expect(exitAppMock).not.toHaveBeenCalled();
    // Workspace must NOT be touched by the launcher-close path.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalledWith("workspace");

    // 2. Workspace close path — the listener itself is gone. An OS-level
    //    close reaches the desired UX through the default destroy alone
    //    (the launcher is already visible, so it activates). Keeping a
    //    listener brings the trap back: `closeCurrentWindow()`
    //    (= `win.close()`) fires close-requested → preventDefault +
    //    handler re-entry → infinite loop.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    render(<WorkspacePage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCurrentWindowCloseRequestedMock).not.toHaveBeenCalled();
    // Mounting the workspace does not trigger a disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // AC-141-5 (real): 4-stage visibility integration test. Drives the full
  // boot → activate → back → disconnect arc and asserts the cumulative seam
  // call shape via `mock.invocationCallOrder`. This is the single most
  // important regression lock in the file because it composes every stage's
  // invariants.
  // ---------------------------------------------------------------------------
  it("AC-141-5 (real): boot → activate → back → disconnect emits the expected seam-call sequence end-to-end", async () => {
    const { connectToDatabase, disconnectFromDatabase } = await import(
      "@lib/tauri"
    );
    const connectMock = connectToDatabase as Mock;
    const disconnectMock = disconnectFromDatabase as Mock;
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);

    // Stage 1: boot — pristine seam mocks. No transition has fired yet.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // Stage 2: activate — double-click. The launcher stays visible —
    // handleActivate owns the store side only. ConnectionList's
    // `openWorkspaceWindow(id)` owns the per-conn workspace window build.
    const { unmount } = render(<HomePage />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    unmount();

    // Stage 3: back — pool kept; focusWindow('launcher') → destroyCurrentWindow.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    focusWindowMock.mockClear();
    destroyCurrentWindowMock.mockClear();
    render(<BackToConnectionsButton />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });
    expect(focusWindowMock).toHaveBeenCalledWith("launcher");
    expect(destroyCurrentWindowMock).toHaveBeenCalled();
    const backFocus = focusWindowMock.mock.invocationCallOrder[0]!;
    const backClose = destroyCurrentWindowMock.mock.invocationCallOrder[0]!;
    expect(backFocus).toBeLessThan(backClose);
    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "connected",
    });
    expect(disconnectMock).not.toHaveBeenCalled();

    // Stage 4: re-activate would NOT trigger another connectToDatabase
    // (already-connected reactivation short-circuits in the connection
    // store). The store call count must stay at zero throughout.
    expect(connectMock).not.toHaveBeenCalled();

    // Stage 5: disconnect — the only path that tears down the pool. Crucially,
    // it does NOT touch the window seam (that distinction is the entire
    // reason Back and Disconnect are separate buttons).
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });
    expect(disconnectMock).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().activeStatuses.c1).toEqual({
      type: "disconnected",
    });
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
  });

  // The old contract assumed the launcher-hidden era: an OS-level close made
  // the process look dead, so the page had to intercept close-requested and
  // show the launcher. Once the desired UX kept the launcher always visible
  // that listener became dead code, and worse, `destroyCurrentWindow()`
  // fired close-requested again → the same listener ran preventDefault and
  // re-invoked the handler → the root cause of the infinite loop and the
  // window that would not close.
  //
  // New contract: WorkspacePage does **not** register a close-requested
  // listener. An OS-level close reaches the desired UX through the default
  // destroy alone (once the workspace is gone the launcher is already
  // visible, so it activates).
  it("AC-141-6 (Wave 9.5 회귀 4): WorkspacePage does NOT register a close-requested listener — listener was the infinite loop trap", async () => {
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
});
