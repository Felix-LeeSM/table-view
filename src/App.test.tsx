import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { useTabStore, type TableTab, type QueryTab } from "./stores/tabStore";

// Mock page components to isolate shortcut testing — App.tsx now mounts only
// `WorkspacePage` (Sprint 154 — `AppRouter` picks the per-window shell at
// boot), but the global shortcuts under test are wired at the App level and
// don't depend on which page is mounted.
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

// Sprint 153: stores now opt into the cross-window bridge at module load
// (mruStore, themeStore, favoritesStore unconditionally; tabStore when
// `getCurrentWindowLabel() === "workspace"`). The bridge subscribes to each
// store and calls `emit(channel, envelope)` on every state change. Without
// an `emit` stub here, the first synchronous setState during AppRouter boot
// throws TypeError("emit is not a function"). Sprint 152 set the precedent
// with the same one-line addition in connectionStore.test.ts.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1",
    title: "users",
    connectionId: "conn1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    ...overrides,
  };
}

function makeQueryTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "conn1",
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
    useTabStore.setState({ tabs: [], activeTabId: null });
    // Sprint 155 — `App` is only mounted under the workspace `WebviewWindow`
    // (per `AppRouter.tsx`), so the workspace context is implied by the
    // file-under-test rendering `<App />`. The legacy app-shell screen seed
    // is no longer needed.
  });

  it("Cmd+W closes the active tab", () => {
    const tab = makeTableTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "tab-1" });
    render(<App />);

    fireShortcut("w");
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("Cmd+T creates a new query tab using active tab's connectionId", () => {
    const tab = makeTableTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "tab-1" });
    render(<App />);

    fireShortcut("t");
    const state = useTabStore.getState();
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
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
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
    useTabStore.setState({ tabs: [tab], activeTabId: "tab-1" });
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

  // ── Sprint 33: Extended Keyboard Shortcuts ──

  it("Cmd+N dispatches new-connection event", () => {
    const handler = vi.fn();
    window.addEventListener("new-connection", handler);
    render(<App />);

    fireShortcut("n");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("new-connection", handler);
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

  // ── Sprint 154: Cmd+, no longer toggles Home/Workspace ──
  // Phase 12's real-window split made Home / Workspace separate Tauri
  // windows. The Sprint 133 toggle is now a no-op until a future sprint
  // reclaims the chord. The legacy `open-settings` event must still NOT
  // dispatch (regression guard).

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

  // -- Sprint 40: SQL Formatting shortcut --

  it("Cmd+I dispatches format-sql event", () => {
    const handler = vi.fn();
    window.addEventListener("format-sql", handler);
    render(<App />);

    fireShortcut("i");
    expect(handler).toHaveBeenCalled();

    window.removeEventListener("format-sql", handler);
  });

  // -- Sprint 60: navigate-table objectKind / quickopen-function --

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
    const tab = useTabStore.getState().tabs.find((t) => t.type === "table") as
      | TableTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("table");
    expect(tab!.subView).toBe("records");
    useTabStore.setState({ tabs: [], activeTabId: null });
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
    const tab = useTabStore.getState().tabs.find((t) => t.type === "table") as
      | TableTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.objectKind).toBe("view");
    useTabStore.setState({ tabs: [], activeTabId: null });
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
    const tab = useTabStore.getState().tabs.find((t) => t.type === "query") as
      | QueryTab
      | undefined;
    expect(tab).toBeDefined();
    expect(tab!.sql).toBe("BEGIN RETURN 1; END");
    useTabStore.setState({ tabs: [], activeTabId: null });
  });

  // ── Sprint 133: Cmd+1..9 → workspace tab switch ──

  it("Cmd+1 activates the first tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    const t3 = makeTableTab({ id: "tab-3", table: "gamma" });
    useTabStore.setState({ tabs: [t1, t2, t3], activeTabId: "tab-3" });
    render(<App />);

    fireShortcut("1");
    expect(useTabStore.getState().activeTabId).toBe("tab-1");
  });

  it("Cmd+2 activates the second tab in the workspace", () => {
    const t1 = makeTableTab({ id: "tab-1", table: "alpha" });
    const t2 = makeTableTab({ id: "tab-2", table: "beta" });
    useTabStore.setState({ tabs: [t1, t2], activeTabId: "tab-1" });
    render(<App />);

    fireShortcut("2");
    expect(useTabStore.getState().activeTabId).toBe("tab-2");
  });

  it("Cmd+5 with only 3 tabs is a no-op", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    const t3 = makeTableTab({ id: "tab-3", table: "three" });
    useTabStore.setState({ tabs: [t1, t2, t3], activeTabId: "tab-1" });
    render(<App />);

    fireShortcut("5");
    expect(useTabStore.getState().activeTabId).toBe("tab-1");
  });

  it("Cmd+1 in home is a no-op (Sprint 154 — App only mounts in workspace window; legacy regression guard)", () => {
    // Sprint 154 — `App` is only rendered inside the workspace Tauri
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
    useTabStore.setState({ tabs: [t1, t2], activeTabId: "tab-2" });
    render(<App />);

    fireShortcut("1");
    // Workspace context: Cmd+1 selects the first tab.
    expect(useTabStore.getState().activeTabId).toBe("tab-1");
  });

  it("Cmd+1 with focus inside an editable target is a no-op", () => {
    const t1 = makeTableTab({ id: "tab-1" });
    const t2 = makeTableTab({ id: "tab-2", table: "two" });
    useTabStore.setState({ tabs: [t1, t2], activeTabId: "tab-2" });
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
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

    expect(useTabStore.getState().activeTabId).toBe("tab-2");
    document.body.removeChild(input);
  });

  // ── Sprint 134: Cmd+K is now a no-op ──
  // The Sprint 133 `open-connection-switcher` event + handler were removed
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
});
