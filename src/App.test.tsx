import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { useTabStore, type TableTab, type QueryTab } from "./stores/tabStore";

// Mock child components to isolate shortcut testing
vi.mock("./components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock("./components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area" />,
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
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

  it("Cmd+, dispatches open-settings event", () => {
    const handler = vi.fn();
    window.addEventListener("open-settings", handler);
    render(<App />);

    fireShortcut(",");
    expect(handler).toHaveBeenCalled();

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
});
