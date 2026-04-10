import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import App from "./App";
import { useTabStore, type TableTab, type QueryTab } from "./stores/tabStore";

// Mock child components to isolate shortcut testing
vi.mock("./components/Sidebar", () => ({
  default: () => <div data-testid="sidebar" />,
}));

vi.mock("./components/MainArea", () => ({
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
    ...overrides,
  };
}

function fireShortcut(key: string, metaKey = true) {
  fireEvent(
    document,
    new KeyboardEvent("keydown", {
      key,
      metaKey,
      bubbles: true,
      cancelable: true,
    }),
  );
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
});
