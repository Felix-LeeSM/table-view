import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { render, act } from "@testing-library/react";
import App from "./App";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore, type TableTab } from "./stores/workspaceStore";

// Issue #1705 — the backend intercepts the OS window *close* (prevent_close →
// `window:close-requested` → discard confirm), but a webview *reload* (Cmd+R /
// F5 while a grid cell editor holds focus, or a menu / right-click reload) is
// never intercepted. Because the pending-edit stores (`dataGridEditStore` /
// `rawQueryGridEditStore`) are window-local and non-persisted, that reload
// silently wiped every uncommitted edit. `beforeunload` is the native guard for
// that path: while the window holds dirty tabs the event must be cancelled so
// the webview shows its unsaved-changes confirm before discarding.

// Mirror App.closeGuard.test.tsx's module mocks — App wires its window
// lifecycle listeners regardless of which page is mounted.
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

/** Dispatch a cancelable `beforeunload` and report whether it was gated. */
function fireBeforeUnload(): boolean {
  const evt = new Event("beforeunload", { cancelable: true });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt.defaultPrevented;
}

describe("App reload-path unsaved-changes guard (#1705)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("cancels a reload (beforeunload) while a dirty tab holds pending edits", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    // Dirty window → the reload must be gated, not silently discard edits.
    expect(fireBeforeUnload()).toBe(true);
  });

  it("lets a reload (beforeunload) proceed when nothing is dirty", () => {
    const tab = makeTableTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1", "conn1", "db1"));
    render(<App />);

    // Clean window → no guard, reload proceeds without a confirm.
    expect(fireBeforeUnload()).toBe(false);
  });
});
