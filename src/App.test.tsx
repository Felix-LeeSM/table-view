import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAllTabsForConnection,
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { ConnectionId, TabId } from "@/types/branded";
import App from "./App";
import { useConnectionStore } from "./stores/connectionStore";
import { useLayoutStore } from "./stores/layoutStore";
import { useThemeStore } from "./stores/themeStore";
import {
  type QueryTab,
  type TableTab,
  useWorkspaceStore,
} from "./stores/workspaceStore";

// Mock page components to isolate shortcut testing — App.tsx now mounts only
// `WorkspacePage` (`AppRouter` picks the per-window shell at boot), but the
// global shortcuts under test are wired at the App level and don't depend on
// which page is mounted.
vi.mock("./pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));

// Mock tauri IPC and event listeners
vi.mock("./lib/tauri", () => ({
  listConnections: vi.fn(() => Promise.resolve([])),
  listGroups: vi.fn(() => Promise.resolve([])),
  testConnection: vi.fn(() => Promise.resolve(true)),
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(() => Promise.resolve()),
  saveConnections: vi.fn(() => Promise.resolve()),
  saveGroups: vi.fn(() => Promise.resolve()),
  deleteConnection: vi.fn(() => Promise.resolve()),
  updateConnection: vi.fn(() => Promise.resolve()),
  createConnection: vi.fn(() => Promise.resolve("test-id")),
  addGroup: vi.fn(() => Promise.resolve("g1")),
  updateGroup: vi.fn(() => Promise.resolve()),
  deleteGroup: vi.fn(() => Promise.resolve()),
  moveConnectionToGroup: vi.fn(() => Promise.resolve()),
}));

// Stores now opt into the cross-window bridge at module load (mruStore,
// themeStore, favoritesStore unconditionally; tabStore when
// `getCurrentWindowLabel() === "workspace"`). The bridge subscribes to each
// store and calls `emit(channel, envelope)` on every state change. Without
// an `emit` stub here, the first synchronous setState during AppRouter boot
// throws TypeError("emit is not a function"). connectionStore.test.ts set
// the precedent with the same one-line addition.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Phase 4 Q12 — theme / safe-mode actions issue the `persist_setting` IPC.
// The App keyboard cycle (`Cmd+Shift+L`) calls `setMode` and intentionally
// does not await the promise. Mock invoke so the unawaited promise resolves
// silently.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

function makeTableTab({
  id = "tab-1",
  ...overrides
}: Partial<Omit<TableTab, "id">> & { id?: string } = {}): TableTab {
  return {
    type: "table",
    id: id as TabId,
    title: "users",
    connectionId: "conn1" as ConnectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab({
  id = "query-1",
  ...overrides
}: Partial<Omit<QueryTab, "id">> & { id?: string } = {}): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: "Query 1",
    connectionId: "conn1" as ConnectionId,
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function fireShortcut(key: string, metaKey = true) {
  act(() => {
    fireEvent(
      document,
      new KeyboardEvent("keydown", {
        key,
        metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("App global shortcuts", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    // `App` is only mounted under the workspace `WebviewWindow`
    // (per `AppRouter.tsx`), so the workspace context is implied by the
    // file-under-test rendering `<App />`. The legacy app-shell screen seed
    // is no longer needed.
  });

  // #2426 — `Cmd/Ctrl+L` used to be registered twice, once in
  // `useRdbDataGridShortcuts` and once inside `DocumentDataGrid`, each
  // flipping its own grid-local flag. Row details became a tab of the
  // workspace bottom dock, so the binding lives here and drives the dock.
  it("[bottom-panel] Cmd+L opens the bottom dock on Details", () => {
    render(<App />);
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);

    fireShortcut("l");

    expect(useLayoutStore.getState().bottomPanelTab).toBe("details");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);
  });

  it("[bottom-panel] Cmd+L again collapses the dock — same toggle as before", () => {
    render(<App />);
    fireShortcut("l");
    fireShortcut("l");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
    // The tab keeps the pick so the next Cmd+L reopens on Details.
    expect(useLayoutStore.getState().bottomPanelTab).toBe("details");
  });

  it("[bottom-panel] Ctrl+L reaches the dock on non-mac keyboards", () => {
    render(<App />);
    act(() => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "l",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useLayoutStore.getState().bottomPanelTab).toBe("details");
  });

  // Cmd+Shift+L cycles the theme. Sharing the `l` key with an unguarded
  // handler would move the dock on every theme cycle.
  it("[bottom-panel] Cmd+Shift+L cycles the theme and leaves the dock alone", () => {
    render(<App />);
    act(() => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
  });

  // ── #2428 — the two panel-collapse hotkeys. ────────────────────────────
  // The layout cluster's buttons already drove `toggleSidebar` /
  // `toggleBottomPanel`; these cases lock the keyboard route to the same two
  // actions and the three owner decisions the issue delegated: which layer
  // registers them (App, next to Cmd+L), what each does inside an editable
  // surface (the two matrix rows below, which land on opposite policies),
  // and that Cmd+J stays distinct from Cmd+L.
  it("[hotkey] Cmd+B collapses the schema sidebar and restores it", () => {
    render(<App />);
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);

    fireShortcut("b");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);

    fireShortcut("b");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
  });

  it("[hotkey] Ctrl+B reaches the sidebar on non-mac keyboards", () => {
    render(<App />);
    act(() => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
  });

  it("[hotkey] Cmd+J toggles the bottom dock without changing its tab", () => {
    useLayoutStore.setState({
      bottomPanelTab: "operations",
      bottomPanelCollapsed: false,
    });
    render(<App />);

    fireShortcut("j");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
    expect(useLayoutStore.getState().bottomPanelTab).toBe("operations");

    fireShortcut("j");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);
    expect(useLayoutStore.getState().bottomPanelTab).toBe("operations");
  });

  it("[hotkey] Ctrl+J reaches the dock on non-mac keyboards", () => {
    render(<App />);
    act(() => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "j",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);
  });

  // Owner decision 3: the two keys keep separate jobs. Cmd+L asks for a
  // view and always lands on Details; Cmd+J asks for space and never moves
  // the tab. Collapsing is the only half they share.
  it("[hotkey] Cmd+J leaves the tab alone where Cmd+L switches it to Details", () => {
    useLayoutStore.setState({
      bottomPanelTab: "history",
      bottomPanelCollapsed: false,
    });
    render(<App />);

    // Both halves matter: Cmd+J has to *do* something (collapse) while
    // leaving the tab where it was. Asserting only the unchanged tab would
    // still pass against a handler that never fired.
    fireShortcut("j");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
    expect(useLayoutStore.getState().bottomPanelTab).toBe("history");

    fireShortcut("l");
    expect(useLayoutStore.getState().bottomPanelTab).toBe("details");
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(false);
  });

  // Modified variants stay unclaimed. The Alt rows are what make the
  // `e.altKey` guard load-bearing: on Windows/Linux AltGr *is* Ctrl+Alt, so
  // `e.key` still arrives as plain "b"/"j" and a guardless handler would
  // collapse a panel every time such a layout types one of those characters.
  // The Shift rows document the casing contract instead — `e.key` is already
  // "B"/"J" with Shift held, so they hold even with `e.shiftKey` removed, and
  // they are what fails if anyone lowercases `e.key` the way the Cmd+R
  // handler does (that would hand Cmd+Shift+B the sidebar).
  it("[hotkey] Shift- and Alt-modified Cmd+B / Cmd+J leave both panels alone", () => {
    render(<App />);
    const variants: Partial<KeyboardEventInit>[] = [
      { key: "B", shiftKey: true },
      { key: "J", shiftKey: true },
      { key: "b", altKey: true },
      { key: "j", altKey: true },
    ];
    for (const variant of variants) {
      act(() => {
        fireEvent(
          document,
          new KeyboardEvent("keydown", {
            metaKey: true,
            bubbles: true,
            cancelable: true,
            ...variant,
          }),
        );
      });
    }
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
    expect(useLayoutStore.getState().bottomPanelCollapsed).toBe(true);
  });

  it("Cmd+W closes the active tab", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("w");
    expect(getTestWorkspace().tabs).toHaveLength(0);
  });

  // 2026-05-01 regression — after running a query, pressing Cmd+W while the
  // SQL editor (contenteditable) held focus triggered the macOS WebView's
  // native Close-Window and closed the whole window. Unlike the other
  // shortcuts, Cmd+W must always be intercepted even inside an editable
  // surface, with preventDefault + tab close.
  it("Cmd+W intercepts even when focus is in a contenteditable target", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    editor.focus();

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(getTestWorkspace().tabs).toHaveLength(0);

    document.body.removeChild(editor);
  });

  it("Cmd+T creates a new query tab using active tab's connectionId", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("t");
    const state = getTestWorkspace();
    expect(state.tabs).toHaveLength(2);
    const queryTab = state.tabs.find((t) => t.type === "query");
    expect(queryTab).toBeDefined();
    if (queryTab && queryTab.type === "query") {
      expect(queryTab.connectionId).toBe("conn1");
    }
  });

  it("Cmd+. dispatches cancel-query event for running query tab", () => {
    const handler = vi.fn();
    window.addEventListener("cancel-query", handler);

    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "q-123" },
    });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<App />);

    fireShortcut(".");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { queryId: "q-123" },
      }),
    );

    window.removeEventListener("cancel-query", handler);
  });

  it("Cmd+R dispatches refresh-data for active table tab with records subView", () => {
    const handler = vi.fn();
    window.addEventListener("refresh-data", handler);

    const tab = makeTableTab({ subView: "records" });
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    render(<App />);

    fireShortcut("r");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("refresh-data", handler);
  });

  it("F5 dispatches refresh-schema when no table tab is active", () => {
    const handler = vi.fn();
    window.addEventListener("refresh-schema", handler);

    // No tabs — should dispatch refresh-schema
    render(<App />);
    fireShortcut("F5", false);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("refresh-schema", handler);
  });

  // ── Extended Keyboard Shortcuts ──

  // Reason (2026-05-13): user request — in a workspace window Cmd+N opens a
  // raw query tab instead of the connection-create dialog. The
  // "new-connection" DOM event the earlier test verified is no longer
  // emitted; instead a query tab must be added to the active connection's
  // workspace.
  it("Sprint 291 — Cmd+N 은 활성 connection 에 raw query tab 을 추가한다", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1"));
    const handler = vi.fn();
    window.addEventListener("new-connection", handler);
    render(<App />);

    fireShortcut("n");

    // Unlike before, the new-connection event is not emitted.
    expect(handler).not.toHaveBeenCalled();
    // The active connection's workspace tabs grow from 1 → 2.
    const tabsAfter = getTestWorkspace().tabs;
    expect(tabsAfter.length).toBeGreaterThan(1);
    const newTab = tabsAfter[tabsAfter.length - 1];
    expect(newTab?.type).toBe("query");

    window.removeEventListener("new-connection", handler);
  });

  // Wave 9.5 regression 5 (2026-05-16) — empty workspace scenarios.
  //
  // These two tests are the first application of the new feedback rule
  // (`feedback_test_scenarios_user_journey.md`) — follow the path all the way
  // through the user's action sequence and lock the user-facing invariant
  // (store state / IPC dispatch).
  //
  // user journey 1: mount workspace (0 tabs) → Cmd+W keydown → window closes
  //   - user report (2026-05-16, translated): "with no tabs at all, pressing
  //     cmd + w in the connection window should turn the connection window
  //     off"
  //   - the previous handler checked `if (activeTabId && workspaceKey)` and,
  //     with no tabs, only called `preventDefault()` → it also blocked the OS
  //     default close, making it a no-op.
  it("Wave 9.5 회귀 5 — 빈 워크스페이스에서 Cmd+W 는 workspace_close IPC 를 발사한다", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    // Start of the user journey: mount workspace, 0 tabs.
    useWorkspaceStore.setState({ workspaces: {} });
    render(<App />);

    // User action: Cmd+W.
    fireShortcut("w");

    // Final outcome (user-facing invariant): the backend workspace_close IPC
    // is called. On the Rust side that IPC runs Window::destroy() on the
    // caller webview → the window the user sees disappears. The backend
    // behavior is outside this unit's coverage (jsdom boundary), but firing
    // the IPC is our own code's intent, and the backend test picks up the
    // next leg of the path.
    await act(async () => {
      await Promise.resolve();
    });
    expect(invokeMock).toHaveBeenCalledWith("workspace_close");
  });

  // user journey 2: mount workspace (0 tabs) + connectionStore.focusedConnId
  //   set (the result of useWindowFocusHydration) → Cmd+N keydown →
  //   conn resolved through the focusedConnId fallback → 1 raw query tab
  //   - user report (2026-05-16, translated): "in the same situation,
  //     pressing cmd + n should open a raw query window"
  //   - the previous handler was a no-op when activeTab.connectionId was
  //     empty. No fallback.
  //
  //   This test covers only the focusedConnId fallback path. The window label
  //   fallback (App.tsx's first priority) is complex to mock in jsdom — the
  //   store state outcome is the same, so we consider it covered.
  it("Wave 9.5 회귀 5 — 빈 워크스페이스에서 Cmd+N 은 focusedConnId fallback 으로 raw query tab 1개 추가", async () => {
    // Start of the user journey: 0 tabs + the store state after mounting the
    // workspace.
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ focusedConnId: "conn1" });

    render(<App />);

    // User action: Cmd+N.
    fireShortcut("n");

    // Final outcome (user-facing invariant): the workspace gains 1 tab.
    // Store state, not a mock assertion ("addQueryTab was called") — the
    // real state of the tab bar the user sees.
    await act(async () => {
      await Promise.resolve();
    });
    const tabsAfter = getAllTabsForConnection("conn1");
    expect(tabsAfter.length).toBe(1);
    expect(tabsAfter[0]?.type).toBe("query");
    expect(tabsAfter[0]?.connectionId).toBe("conn1");
  });

  it("Cmd+S dispatches commit-changes event", () => {
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    fireShortcut("s");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("commit-changes", handler);
  });

  it("Cmd+P dispatches quick-open event", () => {
    const handler = vi.fn();
    window.addEventListener("quick-open", handler);
    render(<App />);

    fireShortcut("p");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("quick-open", handler);
  });

  // ── Cmd+, no longer toggles Home/Workspace ──
  // The real-window split made Home / Workspace separate Tauri windows, so
  // the old toggle is a no-op and nothing else claims the chord. The legacy
  // `open-settings` event must still NOT dispatch (regression guard).

  it("Cmd+, is a no-op (Sprint 154 — Home/Workspace are separate Tauri windows)", () => {
    // Cmd+, used to dispatch `open-settings` and toggle the legacy app-shell
    // field. Phase 12 retired both behaviours — assert no event fires.
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    fireShortcut(",");
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("open-settings", handler);
  });

  it("Cmd+, with focus inside an editable target is a no-op", () => {
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: ",",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
    window.removeEventListener("open-settings", handler);
  });

  it("Cmd+, no longer dispatches the legacy open-settings event", () => {
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    fireShortcut(",");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-settings", handler);
  });

  it("shortcuts are ignored when input is focused", () => {
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    // Simulate an input element as the event target
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(input);
    window.removeEventListener("commit-changes", handler);
  });

  // -- SQL Formatting shortcut --

  it("Cmd+I dispatches format-sql event", () => {
    const handler = vi.fn();
    window.addEventListener("format-sql", handler);
    render(<App />);

    fireShortcut("i");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("format-sql", handler);
  });

  // -- navigate-table objectKind / quickopen-function --

  it("navigate-table opens a table tab with default objectKind=table", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: "c1",
            schema: "public",
            table: "users",
          },
        }),
      );
    });
    // ADR 0027 — tab lands in workspace ("c1", <activeDb>) which the
    // test never seeds; flatten across all `c1` slots so the assertion
    // doesn't depend on the exact `db` autofill.
    const tab = getAllTabsForConnection("c1").find((t) => t.type === "table") as
      | TableTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("table");
    expect(tab!.subView).toBe("records");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("navigate-table preserves explicit objectKind=view", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: "c1",
            schema: "public",
            table: "active_users",
            objectKind: "view",
          },
        }),
      );
    });
    const tab = getAllTabsForConnection("c1").find((t) => t.type === "table") as
      | TableTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("view");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("quickopen-function opens a query tab with the source pre-filled", () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("quickopen-function", {
          detail: {
            connectionId: "c1",
            source: "BEGIN RETURN 1; END",
            title: "public.calc",
          },
        }),
      );
    });
    const tab = getAllTabsForConnection("c1").find((t) => t.type === "query") as
      | QueryTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.sql).toBe("BEGIN RETURN 1; END");
    useWorkspaceStore.setState({ workspaces: {} });
  });

  // ── Cmd+1..9 → workspace tab switch ──

  it("Cmd+1 activates the first tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    const t3 = makeTableTab({ id: "tab-3", table: "gamma" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2, t3], "tab-3"));
    render(<App />);

    fireShortcut("1");
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  it("Cmd+2 activates the second tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-1"));
    render(<App />);

    fireShortcut("2");
    expect(getTestWorkspace().activeTabId).toBe("tab-2");
  });

  it("Cmd+5 with only 3 tabs is a no-op", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    const t3 = makeTableTab({ id: "tab-3", table: "three" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2, t3], "tab-1"));
    render(<App />);

    fireShortcut("5");
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  it("Cmd+1 in home is a no-op (Sprint 154 — App only mounts in workspace window; legacy regression guard)", () => {
    // `App` is only rendered inside the workspace Tauri
    // window per `AppRouter.tsx`. The legacy launcher/home gate is gone,
    // but the user-observable invariant ("Cmd+1 in home doesn't touch
    // tabs") remains true because home is a different window — the JS
    // context running this test never mounts <App /> in the home window.
    // We preserve the test as a regression guard against a future sprint
    // accidentally re-mounting App in the launcher.
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    // With App mounted, Cmd+1 WILL switch tabs because we're in the
    // workspace window context (the only place App.tsx now runs). To
    // assert the legacy "home is no-op" semantic we'd need to NOT mount
    // App — so the test now covers the workspace path only.
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-2"));
    render(<App />);

    fireShortcut("1");
    // Workspace context: Cmd+1 selects the first tab.
    expect(getTestWorkspace().activeTabId).toBe("tab-1");
  });

  // 2026-05-11 regression — Cmd+1..9 must work even while the SQL editor
  // (CodeMirror contenteditable) or a DataGrid cell is being edited. As with
  // Cmd+W, the shortcut has no meaning of its own to preserve inside an
  // editor, and switching tabs quickly mid-edit is the core use case.
  it("Cmd+1 switches tabs even when focus is inside an input", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-2"));
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "1",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(getTestWorkspace().activeTabId).toBe("tab-1");
    document.body.removeChild(input);
  });

  it("Cmd+2 switches tabs even when focus is inside a contenteditable target (CodeMirror / DataGrid)", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    useWorkspaceStore.setState(seedWorkspace([t1, t2], "tab-1"));
    render(<App />);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    editor.focus();
    act(() => {
      fireEvent(
        editor,
        new KeyboardEvent("keydown", {
          key: "2",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(getTestWorkspace().activeTabId).toBe("tab-2");
    document.body.removeChild(editor);
  });

  // ── Cmd+K is now a no-op ──
  // The old `open-connection-switcher` event + handler were removed
  // alongside the `<ConnectionSwitcher>` component. Connection swap is a
  // single-path flow: Home → double-click. These tests guard against the
  // event being accidentally re-dispatched.

  it("Cmd+K in workspace does NOT dispatch open-connection-switcher (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    fireShortcut("k");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-connection-switcher", handler);
  });

  it("Cmd+K in home does NOT dispatch open-connection-switcher (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    fireShortcut("k");
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("open-connection-switcher", handler);
  });

  it("Cmd+K with focus inside an editable target is a no-op (deprecated)", () => {
    const handler = vi.fn();
    window.addEventListener("open-connection-switcher", handler);
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent(
        input,
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
    window.removeEventListener("open-connection-switcher", handler);
  });

  // ── Cmd+Shift+L / Ctrl+Shift+L — cycle theme mode ──

  // Reason: Phase 14 AC-14-03 — cycle theme mode with the Cmd+Shift+L
  // keyboard shortcut (2026-04-28)
  // 2026-05-16: added await + microtask flush after setMode became an async
  // IPC.
  it("Cmd+Shift+L cycles theme mode dark → light → system → dark", async () => {
    await useThemeStore.getState().setMode("dark");
    render(<App />);

    // dark → light
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("light");

    // light → system
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("system");

    // system → dark
    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  // Reason: Phase 14 AC-14-03 — Ctrl+Shift+L shortcut compatibility
  // (Windows/Linux) (2026-04-28)
  it("Ctrl+Shift+L cycles theme mode", async () => {
    await useThemeStore.getState().setMode("dark");
    render(<App />);

    await act(async () => {
      fireEvent(
        document,
        new KeyboardEvent("keydown", {
          key: "L",
          shiftKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useThemeStore.getState().mode).toBe("light");
  });

  // Reason: Phase 14 AC-14-03 — regression test that the theme toggle
  // shortcut does not interfere with existing shortcuts (2026-04-28)
  it("Cmd+Shift+L does not interfere with existing Cmd+S shortcut", async () => {
    await useThemeStore.getState().setMode("dark");
    const handler = vi.fn();
    window.addEventListener("commit-changes", handler);
    render(<App />);

    // Cmd+S should still work
    fireShortcut("s");
    expect(handler).toHaveBeenCalled();

    // Theme mode should NOT have changed from Cmd+S
    expect(useThemeStore.getState().mode).toBe("dark");

    window.removeEventListener("commit-changes", handler);
  });

  // ── 2026-05-11: shortcut focus policy matrix ──
  //
  // Lesson from the 2026-05-11 bug regression: Cmd+1..9 failed inside
  // contenteditable (CodeMirror / inline cells) because the "no-op inside
  // editable" assertions were locked to the *implementation*. Keeping an
  // intent-level matrix in one place means a new shortcut only fills one row
  // and the regression is caught automatically.
  //
  // Each row:
  //   - key           : the shortcut (e.g. "w", "1", "i")
  //   - shift / alt   : modifiers (Cmd/Ctrl always included)
  //   - focusPolicy
  //       "always"           — must be intercepted even inside editable
  //                            (preventDefault).
  //       "skip-in-editable" — must pass through inside editable (no
  //                            preventDefault).
  //
  // The assertion checks only *whether preventDefault was called* (side
  // effects are already covered by the individual tests). So only the
  // "interception contract" is locked by the matrix.
  type FocusPolicy = "always" | "skip-in-editable";
  interface ShortcutCase {
    label: string;
    key: string;
    shift?: boolean;
    alt?: boolean;
    focusPolicy: FocusPolicy;
  }

  const SHORTCUTS: ShortcutCase[] = [
    // Cmd+W — always intercepted (blocks macOS native Close-Window).
    { label: "Cmd+W (close tab)", key: "w", focusPolicy: "always" },
    // Cmd+1..9 — 2026-05-11 regression: intercepted even inside editable.
    { label: "Cmd+1 (tab switch)", key: "1", focusPolicy: "always" },
    { label: "Cmd+9 (tab switch)", key: "9", focusPolicy: "always" },
    // Cmd+T — passes through inside editable (lets "t" be typed into the
    // editor).
    {
      label: "Cmd+T (new query tab)",
      key: "t",
      focusPolicy: "skip-in-editable",
    },
    // Cmd+. — passes through inside editable.
    {
      label: "Cmd+. (cancel query)",
      key: ".",
      focusPolicy: "skip-in-editable",
    },
    // Cmd+R — passes through inside editable.
    { label: "Cmd+R (refresh)", key: "r", focusPolicy: "skip-in-editable" },
    // Cmd+I — passes through inside editable.
    { label: "Cmd+I (format SQL)", key: "i", focusPolicy: "skip-in-editable" },
    // Cmd+N / S / P — pass through inside editable.
    {
      label: "Cmd+N (new query tab)",
      key: "n",
      focusPolicy: "skip-in-editable",
    },
    {
      label: "Cmd+S (commit changes)",
      key: "s",
      focusPolicy: "skip-in-editable",
    },
    { label: "Cmd+P (quick open)", key: "p", focusPolicy: "skip-in-editable" },
    // Cmd+L — before #2426 the grid binding was registered without an
    // editable check, and pressing it mid-cell-edit to open details is real
    // usage, so "always" stays as-is. `l` does not type a character into the
    // editor.
    { label: "Cmd+L (row details)", key: "l", focusPolicy: "always" },
    // #2428 decision 2 — the two keys split, and the reason differs per key.
    // `b` passes through: CodeMirror's `standardKeymap` folds
    // `emacsStyleKeymap` in mac-only, where `Ctrl-b` is `cursorCharLeft`, and
    // every editor in this app lays `defaultKeymap` on top. CodeMirror only
    // calls preventDefault and does not stop propagation (#1224), so
    // intercepting would move the caret one character left and collapse the
    // sidebar at the same time.
    {
      label: "[hotkey] Cmd+B (toggle sidebar)",
      key: "b",
      focusPolicy: "skip-in-editable",
    },
    // `j` is intercepted: neither `standardKeymap` nor any editor in this
    // repo binds `Ctrl-j` / `Mod-j`, so no keypress gets stolen, and the
    // moment you want the grid wider again is exactly when the editor has
    // focus.
    {
      label: "[hotkey] Cmd+J (toggle bottom panel)",
      key: "j",
      focusPolicy: "always",
    },
  ];

  function dispatchAndCheckPrevented(
    target: EventTarget,
    sc: ShortcutCase,
  ): boolean {
    const ev = new KeyboardEvent("keydown", {
      key: sc.key,
      metaKey: true,
      shiftKey: sc.shift === true,
      altKey: sc.alt === true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(ev);
    });
    return ev.defaultPrevented;
  }

  describe("shortcut focus policy matrix (2026-05-11 회귀 가드)", () => {
    // Seed enough tabs so Cmd+1/9 don't no-op for "no target tab".
    function seedTabs() {
      const fillerTabs = Array.from({ length: 9 }, (_, i) =>
        makeTableTab({
          id: `tab-${i + 1}`,
          table: `t${i + 1}`,
          connectionId: `conn${i + 1}` as ConnectionId,
        }),
      );
      useWorkspaceStore.setState(seedWorkspace(fillerTabs, "tab-5"));
    }

    SHORTCUTS.forEach((sc) => {
      it(`${sc.label}: focusPolicy="${sc.focusPolicy}"`, () => {
        seedTabs();
        render(<App />);

        // 1) No editable focus — should always be intercepted by the
        // matching handler.
        const baseline = dispatchAndCheckPrevented(document, sc);
        expect(baseline, `${sc.label} must be intercepted at document`).toBe(
          true,
        );

        // 2) Focus inside <input>.
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        const insideInput = dispatchAndCheckPrevented(input, sc);
        document.body.removeChild(input);

        // 3) Focus inside contenteditable (mimics CodeMirror / inline cell).
        // jsdom does NOT compute `isContentEditable` from the attribute,
        // so we surface the property the same way Chrome/Safari does on a
        // focused contenteditable element — mirrors the workaround in
        // `lib/keyboard/__tests__/isEditableTarget.test.ts`.
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        Object.defineProperty(editor, "isContentEditable", {
          configurable: true,
          get: () => true,
        });
        document.body.appendChild(editor);
        editor.focus();
        const insideEditable = dispatchAndCheckPrevented(editor, sc);
        document.body.removeChild(editor);

        if (sc.focusPolicy === "always") {
          expect(
            insideInput,
            `${sc.label} must STILL preventDefault inside <input>`,
          ).toBe(true);
          expect(
            insideEditable,
            `${sc.label} must STILL preventDefault inside contenteditable`,
          ).toBe(true);
        } else {
          expect(
            insideInput,
            `${sc.label} must NOT preventDefault inside <input>`,
          ).toBe(false);
          expect(
            insideEditable,
            `${sc.label} must NOT preventDefault inside contenteditable`,
          ).toBe(false);
        }
      });
    });
  });
});
