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
import { useWorkspaceStore } from "@stores/workspaceStore";
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
  useWorkspaceStore.setState({ workspaces: {} });
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
  // AC-141-2 (revised for sprint-361/363 + Wave 9.5 회귀 1, 2026-05-16)
  //
  // 이전 contract: HomePage 가 직접 `showWindow("workspace")` →
  // `focusWindow("workspace")` → `hideWindow("launcher")` 호출. 이는
  // sprint-175 의 single-workspace label `"workspace"` 모델.
  //
  // sprint-361 이후 workspace 윈도우는 `workspace-{conn_id}` per-conn.
  // ConnectionList 의 `openWorkspaceWindow(id)` 가 build/focus 책임.
  // HomePage 의 handleActivate 는 store side (focusedConn / stale cleanup)
  // + `hideWindow("launcher")` 만. `showWindow("workspace")` 가 호출되면
  // sprint-175 의 옛 single-workspace 윈도우가 추가 생성되어 사용자가 본
  // 두 창 visible 회귀 발생.
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

    // 사용자 desired UX (2026-05-16): launcher 는 항상 visible.
    // HomePage handleActivate 책임은 store side (focusedConn) 만.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-141-3 (revised for Wave 9.5, 2026-05-16): Back → focusWindow('launcher')
  // → destroyCurrentWindow; pool stays alive.
  // ---------------------------------------------------------------------------
  it("AC-141-3 (revised): 'Back to connections' emits focusWindow('launcher') → destroyCurrentWindow and does NOT call disconnectFromDatabase", async () => {
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

    expect(focusWindowMock).toHaveBeenCalledWith("launcher");
    expect(destroyCurrentWindowMock).toHaveBeenCalled();

    // focus before close — focus IPC 가 close 후 destroyed process 와 race
    // 하지 않게.
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const closeOrder = destroyCurrentWindowMock.mock.invocationCallOrder[0]!;
    expect(focusOrder).toBeLessThan(closeOrder);

    // Pool MUST be preserved — Back is not Disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  // ---------------------------------------------------------------------------
  // AC-141-4 (sprint-363 update): launcher close → hide (NOT exit);
  // workspace close behaves like Back (preventDefault + hide+show,
  // no disconnect).
  //
  // Sprint 363 (Phase 3, Q13 / strategy line 773) replaced the launcher's
  // close-exits-app behavior with close-hides-launcher. Open workspaces
  // (`workspace-{conn_id}`) stay alive; the launcher can be resurfaced
  // via the macOS dock icon or 2nd-launch single-instance callback.
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

    // Sprint 363: launcher is hidden, not exited.
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    expect(exitAppMock).not.toHaveBeenCalled();
    // Workspace must NOT be touched by the launcher-close path.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalledWith("workspace");

    // 2. Workspace close path — Wave 9.5 회귀 4 (2026-05-16): listener 자체
    //    제거. OS-level close 는 default destroy 만으로 desired UX (launcher
    //    이미 visible 이라 자동 활성) 가 성립. listener 를 두면
    //    회귀 history: 이전 `closeCurrentWindow()` (= `win.close()`) 가
    //    close-requested 발사 → preventDefault
    //    + handler 재진입 → 무한 루프 trap (실제 회귀 증상).
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    render(<WorkspacePage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCurrentWindowCloseRequestedMock).not.toHaveBeenCalled();
    // Workspace 마운트 자체가 disconnect 를 트리거하지 않는다.
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

    // Stage 2: activate — double-click. Wave 9.5 (2026-05-16): launcher 는
    // 항상 visible — handleActivate 는 store side 만 책임. per-conn workspace
    // 윈도우 build 는 ConnectionList 의 `openWorkspaceWindow(id)` 책임.
    const { unmount } = render(<HomePage />);
    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    unmount();

    // Stage 3 (Wave 9.5): back — pool kept; focusWindow('launcher') → destroyCurrentWindow.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    focusWindowMock.mockClear();
    destroyCurrentWindowMock.mockClear();
    render(<WorkspacePage />);
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

  // Wave 9.5 회귀 4 (2026-05-16) — 본 테스트의 이전 contract 는 sprint-154
  // 의 launcher-hidden 시대 가정 (OS-level close 가 발생하면 process 가
  // 죽은 듯 보여, close-requested 를 가로채고 launcher 를 show 해야 했음).
  // Wave 9.5 에서 launcher 가 항상 visible 인 desired UX 로 바뀌면서 그
  // listener 자체가 dead code 가 됐고, 게다가 `destroyCurrentWindow()` 가
  // 다시 close-requested 를 발사 → 같은 리스너가 preventDefault + 재호출
  // → 무한 루프 + 창이 안 닫히는 회귀 증상의 root cause 였다.
  //
  // 새 contract: WorkspacePage 는 close-requested listener 를 **등록하지
  // 않는다**. OS-level close 는 default destroy 만으로 desired UX 가 성립
  // (workspace 사라지면 launcher 가 이미 visible 이라 자동 활성).
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
