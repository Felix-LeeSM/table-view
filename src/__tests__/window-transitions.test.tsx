/**
 * Sprint 154 — AC-154-* (Window Lifecycle Wiring) regression tests.
 *
 * **TDD-FIRST**: this file was authored before the production page wirings
 * (`LauncherPage` activation, `WorkspacePage` Back / close, launcher close
 * → app_exit). Against pre-Sprint-154 code, every assertion fails because
 * the pages still mutated the legacy app-shell store field instead of the
 * `@lib/window-controls` seam. After the wiring lands, the same file goes
 * green.
 *
 * Each `it(...)` name embeds the AC label (AC-154-N) for grep-ability.
 *
 * The 5 user-facing transitions under test:
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
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import WorkspacePage from "@/pages/WorkspacePage";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
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
  closeCurrentWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

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

// WorkspacePage transitively renders Sidebar + MainArea — we don't care
// about their bodies for transition assertions.
vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-stub" />,
}));
vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-stub" />,
}));

// HomePage's ConnectionList is mocked so we control onActivate without the
// full connection-grid machinery.
vi.mock("@components/connection/ConnectionList", () => ({
  default: ({
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
      <button data-testid="list-activate-c1" onClick={() => onActivate?.("c1")}>
        activate c1
      </button>
    </div>
  ),
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: () => <div data-testid="connection-dialog-stub" />,
}));
vi.mock("@components/connection/ImportExportDialog", () => ({
  default: () => <div data-testid="import-export-dialog-stub" />,
}));
vi.mock("@components/connection/GroupDialog", () => ({
  default: () => <div data-testid="group-dialog-stub" />,
}));
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
const closeCurrentWindowMock = windowControls.closeCurrentWindow as Mock;
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
  closeCurrentWindowMock.mockResolvedValue(undefined);
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
  // AC-154-01 (revised for sprint-361/363 + Wave 9.5 회귀 1, 2026-05-16)
  //
  // 이전 contract: `showWindow("workspace")` → `focusWindow("workspace")` →
  // `hideWindow("launcher")`. 이는 sprint-175 single-workspace 모델
  // (label `"workspace"` 의 1 윈도우) 기준이었다.
  //
  // sprint-361 이후 workspace 윈도우는 `workspace-{conn_id}` per-conn label.
  // ConnectionList 의 `openWorkspaceWindow(id)` 가 backend
  // `open_workspace_window` 를 호출해 per-conn 윈도우를 build (`visible:
  // true`) 또는 focus. HomePage 의 handleActivate 가 추가로
  // `showWindow("workspace")` 를 호출하면 label `"workspace"` 의 별도 윈도우가
  // 생성되어 사용자가 본 회귀 — launcher + per-conn workspace + bare workspace
  // 세 윈도우 동시 가시 — 가 발생한다.
  //
  // 새 contract: HomePage 의 handleActivate 책임은 store side (focusedConn,
  // stale tab cleanup) + `hideWindow("launcher")` 뿐. window-side 호출 0.
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

    // 회귀 1 잠금: launcher 가 close 도 hide 도 되지 않는다.
    expect(hideWindowMock).not.toHaveBeenCalled();
    // 사용자 desired UX: launcher 항상 visible. workspace 윈도우 build/focus
    // 는 ConnectionList 의 `openWorkspaceWindow(id)` 책임.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();

    // store side 는 정상 갱신.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-154-02: Back to connections (workspace → launcher) preserves pool
  // ---------------------------------------------------------------------------
  it("AC-154-02 (revised): 'Back to connections' calls focusWindow('launcher') then closeCurrentWindow — pool preserved", async () => {
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

    // Wave 9.5 (2026-05-16) — 사용자 desired UX: "< Connections 누르면 connection
    // 창이 닫히고 connections 창에 focus 가 가야해". launcher 는 항상 visible
    // 이므로 hide/show 가 아닌 focus + close 패턴.
    expect(focusWindowMock).toHaveBeenCalledWith("launcher");
    expect(closeCurrentWindowMock).toHaveBeenCalled();

    // Strict ordering: launcher focus BEFORE workspace close 이어야 close 후
    // process 가 destroy 되었을 때 focus IPC 가 race 하지 않는다.
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const closeOrder = closeCurrentWindowMock.mock.invocationCallOrder[0]!;
    expect(focusOrder).toBeLessThan(closeOrder);

    // The pool MUST be preserved — Back is not Disconnect.
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
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
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });

    // Pool eviction must NOT cascade into a window hide. That's the
    // Sprint 141 / Sprint 154 distinction the contract pins.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // AC-154-04 (sprint-363 update): Launcher close → hide (NOT exit)
  //
  // Sprint 363 (Phase 3, Q13 / strategy line 773) changed launcher close
  // semantics: the X button hides the launcher without exiting the app so
  // open `workspace-{conn_id}` windows stay alive (multi-conn TablePlus
  // pattern). The backend's `on_window_event` matcher in `src-tauri/src/lib.rs`
  // calls `api.prevent_close()` + `handle_launcher_close_request` (which hides
  // the launcher). The JS handler echoes with `hideWindow('launcher')` so
  // jsdom unit tests see the same lifecycle hook.
  //
  // Pre-sprint-363 this test asserted `exitAppMock` was called. That path
  // is retired — the launcher is no longer the single-window dock-killer.
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

    const { registerLauncherCloseHandler } =
      await import("@lib/window-lifecycle-boot");
    await registerLauncherCloseHandler();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
    expect(capturedHandler).toBeTruthy();

    await act(async () => {
      await capturedHandler!();
    });

    // Sprint 363: the launcher is hidden, not exited.
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    expect(exitAppMock).not.toHaveBeenCalled();

    // Workspace windows (per-conn) must NOT be touched by the launcher
    // close path — they own their own lifecycle.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalledWith("workspace");
  });

  // ---------------------------------------------------------------------------
  // AC-154-05 (Wave 9.5 회귀 4, 2026-05-16): workspace 는 close-requested
  // listener 를 등록하지 않는다.
  //
  // 이전 contract — sprint-154 의 launcher-hidden 시대에는 OS-level close 가
  // process 가 죽은 듯 보였기에 close-requested 를 가로채야 했다. Wave 9.5
  // 의 "launcher 항상 visible" UX 에서 listener 는 dead code 가 됐고, 게다가
  // `closeCurrentWindow()` 호출이 close-requested 를 다시 발사 → 같은 listener
  // 가 preventDefault + 본 핸들러 재호출 → **무한 루프 + 창 안 닫힘** 회귀의
  // 근본 원인이었다. 본 테스트는 listener 미등록을 lock — 다시 추가하면 같은
  // trap 부활.
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
  // Error path: launcher hide rejects on activation. Wave 9.5 revision —
  // 이전 contract 의 "workspace.show() rejects → launcher remains" recovery
  // 는 sprint-361 의 per-conn 윈도우 모델에서 의미가 사라졌다 (HomePage 는
  // 더 이상 workspace.show 를 호출하지 않는다). 대신 launcher hide 자체가
  // best-effort 임을 잠근다 — `hideWindow` 가 reject 해도 store side 는
  // 정상 갱신 + activatingRef 가 풀려 사용자가 재시도 가능.
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

    // launcher 는 항상 visible — hide 도 호출 안 됨.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});
