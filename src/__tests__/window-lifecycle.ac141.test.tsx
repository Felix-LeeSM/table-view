/**
 * Sprint 149/155 — AC-141-* (Launcher/Workspace lifecycle) regression tests.
 *
 * History: this file was authored in Sprint 149 as a single-window stub
 * locking lifecycle invariants on top of a now-retired vestigial store
 * field. Sprint 154 replaced the screen-toggle with the
 * `@lib/window-controls` seam + cross-window IPC sync. Sprint 155 (Phase 12
 * closure) flips the 5 historically-deferred placeholders into live
 * regression tests against the seam + `tauri.conf.json`, retires the legacy
 * field for good, and supersedes ADR 0011 with ADR 0012.
 *
 * The 5 historically-deferred AC-141-* invariants now run as real `it(...)`
 * checks:
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
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
// Sprint 155 — `tauri.conf.json` is the source of truth for AC-141-1's
// fixed launcher / resizable workspace dimensions. Vite's JSON import gives
// us a synchronous, type-friendly read without dragging `@types/node` into
// the strict tsconfig just for this assertion.
import tauriConf from "../../src-tauri/tauri.conf.json";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import WorkspacePage from "@/pages/WorkspacePage";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
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
    listSchemas: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
  };
});

// Sprint 154 — `@lib/window-controls` is the lifecycle seam. WorkspacePage
// registers a `tauri://close-requested` listener at mount that must be
// stubbed under jsdom. Activation/Back/close assertions are expressed
// against the seam mocks — that is the single source of truth for the
// post-Sprint-154 architecture (ADR 0012 supersedes ADR 0011).
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
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
const exitAppMock = windowControls.exitApp as Mock;
const onCloseRequestedMock = windowControls.onCloseRequested as Mock;
const onCurrentWindowCloseRequestedMock =
  windowControls.onCurrentWindowCloseRequested as Mock;

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
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AC-141-*: Launcher/Workspace lifecycle (real-window, post-Phase 12)", () => {
  // ---------------------------------------------------------------------------
  // AC-141-1 (real): launcher window 720×560 fixed in `tauri.conf.json`.
  // Sprint 175 (ADR-0017) — workspace is no longer declared statically; it is
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
  // AC-141-2 (real): Activate → workspace.show() then focus then launcher.hide()
  // in strict order. The user must see the workspace take input focus before
  // the launcher disappears so the visible-window count never hits zero.
  // ---------------------------------------------------------------------------
  it("AC-141-2 (real): activating from the launcher emits workspace.show() → focusWindow('workspace') → hideWindow('launcher') in order", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");

    // Strict ordering — show before focus, focus before hide. This is the
    // user-visible invariant ("workspace becomes the active window before
    // the launcher disappears").
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    expect(showOrder).toBeLessThan(focusOrder);
    expect(focusOrder).toBeLessThan(hideOrder);

    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-141-3 (real): Back → workspace.hide() then launcher.show(); the
  // connection pool stays alive so re-entry is instant.
  // ---------------------------------------------------------------------------
  it("AC-141-3 (real): 'Back to connections' emits workspace.hide() → launcher.show() and does NOT call disconnectFromDatabase", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as Mock;

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<WorkspacePage />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });

    expect(hideWindowMock).toHaveBeenCalledWith("workspace");
    expect(showWindowMock).toHaveBeenCalledWith("launcher");

    // Strict ordering: workspace hides BEFORE launcher shows so the user
    // never sees both windows at once during the swap.
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    expect(hideOrder).toBeLessThan(showOrder);

    // Pool MUST be preserved — Back is not Disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  // ---------------------------------------------------------------------------
  // AC-141-4 (real): launcher close → `app_exit`; workspace close behaves
  // like Back (preventDefault + hide+show, no disconnect).
  // ---------------------------------------------------------------------------
  it("AC-141-4 (real): launcher.close → exitApp(); workspace.close = Back semantics (no disconnect)", async () => {
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
    const { registerLauncherCloseHandler } =
      await import("@lib/window-lifecycle-boot");
    await registerLauncherCloseHandler();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
    expect(handlers["launcher"]).toBeTruthy();

    await act(async () => {
      await handlers["launcher"]!();
    });

    expect(exitAppMock).toHaveBeenCalledTimes(1);
    // Launcher-close path must NOT try to show the workspace mid-exit.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");

    // 2. Workspace close path — registered by WorkspacePage's mount effect
    //    via `onCurrentWindowCloseRequested` (not `onCloseRequested(label)`)
    //    to avoid the unreliable `getByLabel` JS API.
    let workspaceHandler: (() => void | Promise<void>) | null = null;
    onCurrentWindowCloseRequestedMock.mockImplementation(
      async (handler: () => void | Promise<void>) => {
        workspaceHandler = handler;
        return () => {};
      },
    );

    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    render(<WorkspacePage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCurrentWindowCloseRequestedMock).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(workspaceHandler).toBeTruthy();

    await act(async () => {
      await workspaceHandler!();
    });

    // Same final state as the explicit Back button: workspace hides then
    // launcher shows; pool is preserved.
    expect(hideWindowMock).toHaveBeenCalledWith("workspace");
    expect(showWindowMock).toHaveBeenCalledWith("launcher");
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
    const { connectToDatabase, disconnectFromDatabase } =
      await import("@lib/tauri");
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

    // Stage 2: activate — double-click moves to workspace.
    const { unmount } = render(<HomePage />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    const activateShow = showWindowMock.mock.invocationCallOrder[0]!;
    const activateFocus = focusWindowMock.mock.invocationCallOrder[0]!;
    const activateHide = hideWindowMock.mock.invocationCallOrder[0]!;
    expect(activateShow).toBeLessThan(activateFocus);
    expect(activateFocus).toBeLessThan(activateHide);
    unmount();

    // Stage 3: back — pool kept; workspace hides then launcher shows.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    render(<WorkspacePage />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });
    expect(hideWindowMock).toHaveBeenCalledWith("workspace");
    expect(showWindowMock).toHaveBeenCalledWith("launcher");
    const backHide = hideWindowMock.mock.invocationCallOrder[0]!;
    const backShow = showWindowMock.mock.invocationCallOrder[0]!;
    expect(backHide).toBeLessThan(backShow);
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
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
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
  });

  // Reason: workspace close must always show the launcher, even if the close
  // handler registration fails. This is the user's explicit request — when
  // the table window closes, the connection list must appear. (2026-04-28)
  it("AC-141-6 (real): workspace close via onCurrentWindowCloseRequested always shows the launcher", async () => {
    let workspaceHandler: (() => void | Promise<void>) | null = null;
    onCurrentWindowCloseRequestedMock.mockImplementation(
      async (handler: () => void | Promise<void>) => {
        workspaceHandler = handler;
        return () => {};
      },
    );

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    render(<WorkspacePage />);
    await act(async () => {
      await Promise.resolve();
    });

    // The workspace handler must be registered via onCurrentWindowCloseRequested.
    expect(onCurrentWindowCloseRequestedMock).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(workspaceHandler).toBeTruthy();

    // Firing the handler (simulating OS close) must hide workspace and
    // show launcher — identical to the Back button path.
    await act(async () => {
      await workspaceHandler!();
    });

    expect(hideWindowMock).toHaveBeenCalledWith("workspace");
    expect(showWindowMock).toHaveBeenCalledWith("launcher");
  });
});
