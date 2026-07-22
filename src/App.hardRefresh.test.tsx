import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore, type TableTab } from "./stores/workspaceStore";
import App from "./App";

// #1719 (Part of #1717) — Stage 2 hard refresh (Cmd+Shift+R). The key
// (previously `reset-column-widths`, now moved to the grid header context
// menu) triggers `hardRefreshConnection` for the active connection, gated
// behind the same shared discard-confirm the soft records refresh uses.

vi.mock("./pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const { hardRefreshSpy } = vi.hoisted(() => ({ hardRefreshSpy: vi.fn() }));
vi.mock("./lib/runtime/connection/hardRefresh", () => ({
  useHardRefresh: () => hardRefreshSpy,
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

/** Fire the Cmd+Shift+R hard-refresh shortcut against a non-editable target. */
function fireCmdShiftR() {
  act(() => {
    fireEvent(
      document,
      new KeyboardEvent("keydown", {
        key: "R",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("App hard refresh (Cmd+Shift+R) (#1719)", () => {
  let resetWidthsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    hardRefreshSpy.mockReset();
    resetWidthsSpy = vi.fn();
    window.addEventListener(
      "reset-column-widths",
      resetWidthsSpy as EventListener,
    );
  });

  afterEach(() => {
    window.removeEventListener(
      "reset-column-widths",
      resetWidthsSpy as EventListener,
    );
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("triggers a hard refresh for the active connection when the window is clean", () => {
    useWorkspaceStore.setState(seedWorkspace([makeRecordsTab()], "tab-1"));
    render(<App />);

    fireCmdShiftR();

    expect(hardRefreshSpy).toHaveBeenCalledTimes(1);
    expect(hardRefreshSpy).toHaveBeenCalledWith("conn1");
  });

  it("no longer broadcasts reset-column-widths (moved to the grid header menu)", () => {
    useWorkspaceStore.setState(seedWorkspace([makeRecordsTab()], "tab-1"));
    render(<App />);

    fireCmdShiftR();

    expect(resetWidthsSpy).not.toHaveBeenCalled();
  });

  it("gates the hard refresh behind the discard confirm while a pending edit is dirty", () => {
    useWorkspaceStore.setState(
      seedWorkspace([makeRecordsTab()], "tab-1", "conn1", "db1", {
        dirtyTabIds: ["tab-1"],
      }),
    );
    render(<App />);

    fireCmdShiftR();

    // Dirty window → the shared "Discard and close" confirm, and the reconnect
    // is withheld until the user confirms.
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
    expect(hardRefreshSpy).not.toHaveBeenCalled();
  });

  it("runs the hard refresh after the user confirms the discard", () => {
    useWorkspaceStore.setState(
      seedWorkspace([makeRecordsTab()], "tab-1", "conn1", "db1", {
        dirtyTabIds: ["tab-1"],
      }),
    );
    render(<App />);

    fireCmdShiftR();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Discard and close" }),
      );
    });

    expect(hardRefreshSpy).toHaveBeenCalledWith("conn1");
  });
});
