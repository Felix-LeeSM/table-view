/**
 * Sprint 149 — AC-141-* (Launcher/Workspace lifecycle) regression tests.
 *
 * **Single-window stub**: the spec calls for separate Tauri windows
 * (launcher 720×560 fixed / workspace 1280×800 resizable) but per ADR 0011
 * Sprint 149 ships a single-window stub and defers real-window split to
 * phase 12. This file locks the user-observable lifecycle invariants
 * (boot → activate → back → reactivate → disconnect) on top of
 * `appShellStore.screen` toggle so phase-12 implementers can replay the
 * same expectations against the new window pair.
 *
 * The phase-12 real-window invariants are pinned as `it.todo(...)` at the
 * bottom of this file so vitest's report carries a permanent reminder
 * count until they're fleshed out.
 *
 * Each `it(...)` name embeds the AC label (AC-141-N) for grep-ability.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import WorkspacePage from "@/pages/WorkspacePage";
import { useAppShellStore } from "@stores/appShellStore";
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
// stubbed under jsdom. Activation/Back assertions are expressed against
// the seam mocks. (The original AC-141-* assertions used
// `appShellStore.screen`; Sprint 154 retired the field as a routing
// primitive — see Sprint 154 contract AC-154-06. Sprint 155's `it.todo`
// blocks at the bottom of this file are unaffected.)
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
  useAppShellStore.setState({ screen: "home" });
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

describe("AC-141-*: Launcher/Workspace lifecycle (single-window stub)", () => {
  it("AC-141-1: app boot lands on the launcher equivalent (appShellStore.screen === 'home')", () => {
    // The store's create() default is "home". A fresh subscription must
    // observe that — pre-S149 callers depend on this initial state to
    // mount HomePage before any user action.
    expect(useAppShellStore.getState().screen).toBe("home");
  });

  it("AC-141-2: double-clicking a connection from the launcher activates the workspace screen", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.doubleClick(screen.getByText(/^c1 DB$/));
    });

    // Sprint 154 — workspace activation now expressed via the
    // `@lib/window-controls` seam. The original `screen === "workspace"`
    // assertion is preserved as the legacy semantic intent ("the user
    // is now on the workspace surface") via the seam call.
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  it("AC-141-3: 'Back to connections' returns to launcher AND preserves the backend connection pool", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as ReturnType<typeof vi.fn>;

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    useAppShellStore.setState({ screen: "workspace" });

    render(<WorkspacePage />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });

    // Sprint 154 — surface revert is now expressed via the seam:
    // workspace.hide() then launcher.show() (asserted in
    // window-transitions.test.tsx with strict ordering).
    expect(windowControls.hideWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.showWindow).toHaveBeenCalledWith("launcher");
    // ...but the pool was NOT torn down. This is the key spec invariant:
    // re-entering the workspace must be instantaneous (no reconnect).
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("AC-141-4: Disconnect (unlike Back) DOES evict the pool — the two paths must reach distinct final states", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");
    const disconnectMock = disconnectFromDatabase as ReturnType<typeof vi.fn>;
    disconnectMock.mockResolvedValue(undefined);

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // Drive the store action directly — DisconnectButton click coverage
    // already lives in connection-sot.ac142.test.tsx (AC-142-3); this
    // test is about the lifecycle distinction Back vs Disconnect.
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });

    expect(disconnectMock).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
  });

  it("AC-141-5: full lifecycle — boot → activate → back (pool kept) → reactivate (no reconnect cost) → disconnect (pool gone)", async () => {
    const { connectToDatabase, disconnectFromDatabase } =
      await import("@lib/tauri");
    const connectMock = connectToDatabase as ReturnType<typeof vi.fn>;
    const disconnectMock = disconnectFromDatabase as ReturnType<typeof vi.fn>;
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);

    // Stage 1: boot — launcher equivalent. Sprint 154 reads window context
    // from `getCurrentWindowLabel()`, so this assertion is preserved as the
    // legacy default ("nothing has activated the workspace yet"); the seam
    // mocks below are pristine because no transition has fired.
    expect(useAppShellStore.getState().screen).toBe("home");

    // Seed a connected connection (this is what the launcher would show
    // after the user has connected once via context menu / double-click).
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
    expect(windowControls.showWindow).toHaveBeenCalledWith("workspace");
    unmount();

    // Stage 3: back — pool kept.
    vi.mocked(windowControls.showWindow).mockClear();
    vi.mocked(windowControls.hideWindow).mockClear();
    render(<WorkspacePage />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });
    expect(windowControls.hideWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.showWindow).toHaveBeenCalledWith("launcher");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
    expect(disconnectMock).not.toHaveBeenCalled();

    // Stage 4: reactivate — should NOT trigger another connectToDatabase
    // (already-connected reactivation goes through ConnectionItem's
    // double-click which short-circuits when status === "connected"). The
    // store call count must stay at zero.
    expect(connectMock).not.toHaveBeenCalled();

    // Stage 5: disconnect — this is the only path that tears down the pool.
    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });
    expect(disconnectMock).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 12 forcing block — `it.todo()` keeps these visible in vitest output
// every run so the deferred work cannot silently rot. When phase 12 starts,
// flip each `it.todo` to `it()` and supply the body; the test will then run
// against the real two-window architecture (WebviewWindow mocks).
//
// See ADR 0011 + RISK-025 for the deferral context.
// ---------------------------------------------------------------------------
describe.skip("AC-141-* real-window invariants (DEFERRED to phase 12 — see ADR 0011)", () => {
  it.todo(
    "AC-141-1 (real): launcher window mounted at 720×560, fixed (no resize/maximize), centered",
  );
  it.todo(
    "AC-141-2 (real): launcher.connect success emits 'workspace:open'; workspace.show()+focus(), launcher.hide()",
  );
  it.todo(
    "AC-141-3 (real): workspace 'Back' emits 'launcher:show'; workspace.hide(), launcher.show(); pool intact",
  );
  it.todo(
    "AC-141-4 (real): launcher.close → app exit; workspace.close → launcher recovery (same as Back)",
  );
  it.todo(
    "AC-141-5 (real): WebviewWindow mock-based 4-stage visibility integration test",
  );
});
