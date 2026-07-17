import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { render, fireEvent, act, screen } from "@testing-library/react";
import App from "./App";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import {
  useWorkspaceStore,
  type QueryTab,
  type TableTab,
} from "./stores/workspaceStore";

// #1101 — the unsaved-changes ("dirty tab") guard used to live only on the
// TabBar X button. Cmd+W (JS fallback) and the native window-close signal
// (macOS menu Cmd+W + window X, delivered as `window:close-requested`)
// discarded pending grid edits / uncommitted SQL with no confirmation.
// These lock the same ConfirmDialog UX ("Discard and close") onto both
// close paths App owns.

// Mirror App.test.tsx's module mocks — App wires the shortcuts + the native
// close listener regardless of which page is mounted.
vi.mock("./pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));

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
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// #1580 — test-setup globally mocks `@lib/tauri/workspaces` (no-op resolve) so
// stray background persists don't toast. The F1 close-flush test below asserts
// the REAL `flushPersistWorkspaces` → `persist_workspace` invoke, so opt back
// into the actual `persistWorkspace` and let it drive the mocked core invoke.
vi.unmock("@lib/tauri/workspaces");

function makeTableTab(overrides: Partial<TableTab> = {}): TableTab {
  return {
    type: "table",
    id: "tab-1" as TabId,
    title: "users",
    connectionId: "conn1" as ConnectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
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

/** Capture the App-registered `window:close-requested` listener callback. */
async function captureCloseHandler(): Promise<() => (() => void) | null> {
  const { listen } = await import("@tauri-apps/api/event");
  let closeHandler: (() => void) | null = null;
  vi.mocked(listen).mockImplementation((event, handler) => {
    if (event === "window:close-requested") {
      closeHandler = handler as unknown as () => void;
    }
    return Promise.resolve(() => {});
  });
  return () => closeHandler;
}

describe("App close-path unsaved-changes guard (#1101)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  });

  it("Cmd+W on a dirty active tab confirms instead of discarding it", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    fireShortcut("w");

    // The tab must survive — the close is gated behind confirmation.
    expect(getTestWorkspace().tabs).toHaveLength(1);
    // Same ConfirmDialog UX as the TabBar X button.
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
  });

  it("Cmd+W discard confirmation actually closes the dirty tab", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    fireShortcut("w");
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Discard and close" }),
      );
    });

    expect(getTestWorkspace().tabs).toHaveLength(0);
  });

  it("Cmd+W on a clean active tab closes it with no confirmation", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1", "conn1", "db1"));
    render(<App />);

    fireShortcut("w");

    expect(getTestWorkspace().tabs).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Discard and close" }),
    ).not.toBeInTheDocument();
  });

  it("native window:close-requested with a dirty tab confirms before destroying the window", async () => {
    const getHandler = await captureCloseHandler();
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as ReturnType<typeof vi.fn>;

    const tab = makeTableTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    invokeMock.mockClear();

    const closeHandler = getHandler();
    expect(closeHandler).toBeTypeOf("function");
    await act(async () => {
      closeHandler?.();
      await Promise.resolve();
    });

    // Window is NOT destroyed until the user confirms.
    expect(invokeMock).not.toHaveBeenCalledWith("workspace_close");
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
  });

  it("native window:close-requested with no dirty tabs destroys the window immediately", async () => {
    const getHandler = await captureCloseHandler();
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as ReturnType<typeof vi.fn>;

    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1", "conn1", "db1"));
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    invokeMock.mockClear();

    const closeHandler = getHandler();
    expect(closeHandler).toBeTypeOf("function");
    await act(async () => {
      closeHandler?.();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("workspace_close");
  });

  // #1580 F1 — SQL edits go through `updateQuerySql` and never set a dirty
  // marker, so a SQL-only window took the no-confirm branch above and destroyed
  // immediately. With a pure trailing 200ms debounce, an edit made within that
  // window was lost. The close handler now flushes the pending persist before
  // destroying, so the just-typed SQL reaches `persist_workspace`.
  it("native window:close-requested flushes the latest SQL edit before destroying the window", async () => {
    const getHandler = await captureCloseHandler();
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as ReturnType<typeof vi.fn>;

    const tab: QueryTab = {
      type: "query",
      id: "q-1" as TabId,
      title: "Query 1",
      connectionId: "conn1" as ConnectionId,
      closable: true,
      sql: "",
      queryState: { status: "idle" },
      paradigm: "rdb",
      queryMode: "sql",
      database: "db1",
    };
    useWorkspaceStore.setState(seedWorkspace([tab], "q-1", "conn1", "db1"));
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });

    // Paste SQL — fires within the 200ms debounce window (no timer advance),
    // so the trailing persist has NOT run yet.
    act(() => {
      useWorkspaceStore
        .getState()
        .updateQuerySql("conn1", "db1", "q-1", "SELECT pasted_sql");
    });
    invokeMock.mockClear();

    const closeHandler = getHandler();
    await act(async () => {
      closeHandler?.();
    });
    // The window is destroyed only after the flush settles.
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("workspace_close");
    });

    const persistCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "persist_workspace",
    );
    expect(persistCall).toBeDefined();
    const req = (persistCall![1] as { req: { tabsJson: string } }).req;
    expect(req.tabsJson).toContain("SELECT pasted_sql");
  });
});
