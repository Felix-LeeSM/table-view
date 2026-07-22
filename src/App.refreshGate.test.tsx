import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { render, fireEvent, act, screen } from "@testing-library/react";
import App from "./App";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore, type TableTab } from "./stores/workspaceStore";

// Issue #1718 (Stage 1, Part of #1717) — a records-grid soft refresh (Cmd+R)
// refetches the active resource AND drops the active cell editor
// (`useRdbDataGridShortcuts` → `onCancelEdit()`). Before this change that
// discard was silent: Cmd+R wiped an in-progress edit with no prompt. The
// fix routes the `refresh-data` dispatch through the shared #1705
// discard-confirm gate (`useConnectionHasDirtyTabs` + `useDiscardConfirm`)
// so refresh is confirmed before it can discard pending edits, and proceeds
// immediately when the window is clean.

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

function makeRecordsTab(overrides: Partial<TableTab> = {}): TableTab {
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

/** Fire the Cmd+R soft-refresh shortcut against a non-editable target. */
function fireCmdR() {
  act(() => {
    fireEvent(
      document,
      new KeyboardEvent("keydown", {
        key: "r",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("App soft-refresh discard gate (#1718)", () => {
  let refreshSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    refreshSpy = vi.fn();
    window.addEventListener("refresh-data", refreshSpy as EventListener);
  });

  afterEach(() => {
    window.removeEventListener("refresh-data", refreshSpy as EventListener);
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("gates the refresh behind the discard confirm while a pending edit is dirty", () => {
    const tab = makeRecordsTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    fireCmdR();

    // Dirty window → the same "Discard and close" ConfirmDialog as the other
    // discard paths, and refresh-data is withheld until the user confirms.
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("keeps the pending edit when the discard confirm is cancelled", () => {
    const tab = makeRecordsTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    fireCmdR();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Cancel → refresh never fired, dirty marker survives (edit preserved).
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(getTestWorkspace().dirtyTabIds).toContain("tab-1");
  });

  it("dispatches refresh-data after the user confirms the discard", () => {
    const tab = makeRecordsTab();
    useWorkspaceStore.setState(
      seedWorkspace([tab], "tab-1", "conn1", "db1", { dirtyTabIds: ["tab-1"] }),
    );
    render(<App />);

    fireCmdR();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Discard and close" }),
      );
    });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately (no confirm) when nothing is dirty", () => {
    const tab = makeRecordsTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "tab-1", "conn1", "db1"));
    render(<App />);

    fireCmdR();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Discard and close" }),
    ).not.toBeInTheDocument();
  });
});
