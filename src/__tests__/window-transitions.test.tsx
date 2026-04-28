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
import { useTabStore } from "@stores/tabStore";
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
  onCurrentWindowCloseRequestedMock.mockResolvedValue(() => {});
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

describe("AC-154-*: Window lifecycle wiring", () => {
  // ---------------------------------------------------------------------------
  // AC-154-01: Activate (launcher → workspace)
  // ---------------------------------------------------------------------------
  it("AC-154-01: activating a connection from the launcher calls workspace.show() → setFocus() → launcher.hide() in order", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // All three seam calls must fire on the activation path.
    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).toHaveBeenCalledWith("launcher");

    // Strict ordering: show comes before focus, focus comes before hide.
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    const focusOrder = focusWindowMock.mock.invocationCallOrder[0]!;
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    expect(showOrder).toBeLessThan(focusOrder);
    expect(focusOrder).toBeLessThan(hideOrder);

    // The focused connection must follow the activation.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // ---------------------------------------------------------------------------
  // AC-154-02: Back to connections (workspace → launcher) preserves pool
  // ---------------------------------------------------------------------------
  it("AC-154-02: 'Back to connections' calls workspace.hide() then launcher.show() and does NOT call disconnectFromDatabase", async () => {
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
    // doesn't see two windows at once.
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    expect(hideOrder).toBeLessThan(showOrder);

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
  // AC-154-04: Launcher close → app exit
  // ---------------------------------------------------------------------------
  it("AC-154-04: closing the launcher window (tauri://close-requested) invokes exitApp()", async () => {
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

    // Mount the launcher chrome via main entry path. We render LauncherPage
    // alone — the close-requested registration must live in a module that
    // owns the launcher window's mount lifecycle. Sprint 154 puts it in
    // `main.tsx` boot, so we exercise that by importing the boot helper.
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

    expect(exitAppMock).toHaveBeenCalledTimes(1);

    // The contract demands the workspace must NOT be visible during exit —
    // i.e. nothing on the launcher-close path tries to show the workspace.
    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
  });

  // ---------------------------------------------------------------------------
  // AC-154-05: Workspace close = Back semantics + preventDefault
  // ---------------------------------------------------------------------------
  it("AC-154-05: closing the workspace window (tauri://close-requested) is treated as Back — workspace.hide() then launcher.show(), NO disconnect", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as Mock;

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    let capturedHandler: (() => void | Promise<void>) | null = null;
    onCurrentWindowCloseRequestedMock.mockImplementation(
      async (handler: () => void | Promise<void>) => {
        capturedHandler = handler;
        return () => {};
      },
    );

    render(<WorkspacePage />);

    // Wait one microtask for the registration effect to settle.
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCurrentWindowCloseRequestedMock).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(capturedHandler).toBeTruthy();

    // Reset the show/hide observers so we only watch the close-driven calls.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();

    await act(async () => {
      await capturedHandler!();
    });

    expect(hideWindowMock).toHaveBeenCalledWith("workspace");
    expect(showWindowMock).toHaveBeenCalledWith("launcher");
    const hideOrder = hideWindowMock.mock.invocationCallOrder[0]!;
    const showOrder = showWindowMock.mock.invocationCallOrder[0]!;
    expect(hideOrder).toBeLessThan(showOrder);

    // Identical to Back: the pool stays alive.
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Error path: workspace.show() rejects on activation. Locked recovery:
  // launcher must remain visible (i.e. `hideWindow('launcher')` MUST NOT
  // fire). The user can retry; no second window-state mutation happens.
  // ---------------------------------------------------------------------------
  it("AC-154-01 error path: when workspace.show() rejects on activation, launcher.hide() is NOT called (launcher remains visible for retry)", async () => {
    showWindowMock.mockImplementation(async (label: string) => {
      if (label === "workspace") {
        throw new Error("workspace.show failed (simulated)");
      }
    });

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).toHaveBeenCalledWith("workspace");
    // The recovery: launcher MUST stay visible. Sprint 154 contract pins
    // this exact branch.
    expect(hideWindowMock).not.toHaveBeenCalledWith("launcher");
    // focusWindow is also gated on the show success.
    expect(focusWindowMock).not.toHaveBeenCalled();
  });
});
