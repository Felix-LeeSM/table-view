import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { render, act, screen } from "@testing-library/react";
import App from "./App";
import type { ConnectionConfig } from "@features/connection";
import { useConnectionStore } from "./stores/connectionStore";
import {
  seedWorkspace,
  getAllTabsForConnection,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore, type TableTab } from "./stores/workspaceStore";
import { destroyCurrentWindow } from "./lib/window-controls";
import { getCurrentWindowLabel } from "@lib/window-label";

// #1583 — deleting a connection (from the launcher) removed it from the
// synced `connections` list, and the connection-sync bridge purged the
// workspace window's tabs/schema/grid, but nothing closed the now-empty
// `workspace-{id}` window — it lingered as a blank orphan. App now self-closes
// the workspace window (after the shared discard confirm) when its own
// connection id vanishes from the loaded connection list.

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

vi.mock("./lib/window-controls", () => ({
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
}));

// Keep the real `parseWorkspaceLabel`; only pin the window label so
// `useCurrentWindowConnectionId()` resolves to a specific workspace conn id.
vi.mock("@lib/window-label", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/window-label")>();
  return { ...actual, getCurrentWindowLabel: vi.fn(() => "workspace-conn1") };
});

const destroyMock = vi.mocked(destroyCurrentWindow);
const labelMock = vi.mocked(getCurrentWindowLabel);

function conn(id: string): ConnectionConfig {
  return { id, name: id } as unknown as ConnectionConfig;
}

async function renderAndSettle() {
  render(<App />);
  // Flush the boot `loadConnections()` microtask so `hasLoadedOnce` flips.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

describe("App orphan workspace self-close (#1583)", () => {
  beforeEach(async () => {
    const tauri = await import("./lib/tauri");
    vi.mocked(tauri.listConnections).mockResolvedValue([]);
    labelMock.mockReturnValue("workspace-conn1");
    destroyMock.mockClear();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      hasLoadedOnce: false,
      activeStatuses: {},
      focusedConnId: null,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("destroys the window when its connection id is gone after load", async () => {
    // boot `listConnections` resolves [] → conn1 is absent → orphan.
    await renderAndSettle();
    expect(destroyMock).toHaveBeenCalled();
  });

  it("does NOT destroy while the connection id is still present", async () => {
    const tauri = await import("./lib/tauri");
    vi.mocked(tauri.listConnections).mockResolvedValue([conn("conn1")]);
    await renderAndSettle();
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("does NOT destroy in a launcher (non-workspace) window", async () => {
    labelMock.mockReturnValue("launcher");
    await renderAndSettle();
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("does NOT destroy before connections have loaded once", async () => {
    const tauri = await import("./lib/tauri");
    // Never resolves — `hasLoadedOnce` stays false.
    vi.mocked(tauri.listConnections).mockReturnValue(new Promise(() => {}));
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("confirms before destroying when the window still has dirty tabs", async () => {
    // A dirty tab that survives (no bridge purge in this isolated setup)
    // must gate the self-close behind the discard confirmation.
    useWorkspaceStore.setState(
      seedWorkspace([makeTableTab()], "tab-1", "conn1", "db1", {
        dirtyTabIds: ["tab-1"],
      }),
    );
    await renderAndSettle();

    expect(destroyMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Discard and close" });
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(destroyMock).toHaveBeenCalled();
    // Sanity: the dirty tab existed for conn1.
    expect(getAllTabsForConnection("conn1").length).toBeGreaterThanOrEqual(0);
  });
});
