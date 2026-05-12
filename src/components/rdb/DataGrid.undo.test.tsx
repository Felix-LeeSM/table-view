// Sprint 249 (ADR 0022 Phase 5) — DataGrid Cmd+Z / Ctrl+Z keyboard
// binding for pending-edit undo. Maps to AC-249-K1..K5 from
// `docs/sprints/sprint-249/contract.md`. Date 2026-05-09.
//
// Asserted scenarios:
// - K1: Cmd+Z (metaKey) → editState.undo invoked.
// - K2: Ctrl+Z (ctrlKey) → editState.undo invoked.
// - K3: Cmd+Shift+Z (redo slot) → editState.undo NOT invoked.
// - K4: focused INPUT / contenteditable → browser native undo wins.
// - K5: commit success → canUndo flips to false (clearAllPending).
//
// We share the helper-mocked schema/tab stores from
// `__tests__/dataGridTestHelpers.tsx` so the renderDataGrid
// pipeline matches the existing editing-axis tests verbatim.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import type { SortInfo } from "@/types/schema";
import {
  mockQueryTableData,
  mockExecuteQueryBatch,
  mockPromoteTab,
  mockUpdateTabSorts,
  mockSetTabDirty,
  mockAddTab,
  resetDataGridMocks,
  renderDataGrid,
} from "./__tests__/dataGridTestHelpers";

vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
      executeQuery: vi.fn(),
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));

interface MockTabShape {
  id: string;
  type: "table";
  sorts?: SortInfo[];
}
const mockTabStoreState: {
  tabs: MockTabShape[];
  activeTabId: string | null;
} = {
  tabs: [{ id: "tab-1", type: "table" }],
  activeTabId: "tab-1",
};
const subscribers = new Set<() => void>();
function notify() {
  subscribers.forEach((fn) => fn());
}
mockUpdateTabSorts.mockImplementation((tabId: string, next: SortInfo[]) => {
  const tab = mockTabStoreState.tabs.find((t) => t.id === tabId);
  if (tab) tab.sorts = next;
  notify();
});
function resetMockTabStore() {
  mockTabStoreState.tabs = [{ id: "tab-1", type: "table" }];
  mockTabStoreState.activeTabId = "tab-1";
  mockUpdateTabSorts.mockClear();
  subscribers.clear();
}
function mockWorkspaceView() {
  return {
    workspaces: {
      conn1: {
        db1: {
          tabs: mockTabStoreState.tabs,
          activeTabId: mockTabStoreState.activeTabId,
          closedTabHistory: [],
          dirtyTabIds: [],
          sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
        },
      },
    },
    addTab: mockAddTab,
    promoteTab: mockPromoteTab,
    updateTabSorts: mockUpdateTabSorts,
    setTabDirty: mockSetTabDirty,
  };
}
vi.mock("@stores/workspaceStore", async () => {
  const React = await import("react");
  return {
    useActiveTabId: () => mockTabStoreState.activeTabId,
    useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
    useWorkspaceStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) => {
        const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);
        React.useEffect(() => {
          const fn = () => forceRerender();
          subscribers.add(fn);
          return () => {
            subscribers.delete(fn);
          };
        }, []);
        return selector(mockWorkspaceView());
      },
      {
        getState: () => mockWorkspaceView(),
      },
    ),
  };
});

describe("DataGrid — Sprint 249 Cmd+Z / Ctrl+Z undo (AC-249-K1..K5)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  it("[AC-249-K1] Cmd+Z (metaKey) reverts a pending Add row", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add a row → 4 data rows + header.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });

    // The added row is gone — back to 3 data + header.
    expect(screen.getAllByRole("row").length).toBe(4);
  });

  it("[AC-249-K2] Ctrl+Z (ctrlKey) reverts a pending Add row (Win/Linux path)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    await act(async () => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });

    expect(screen.getAllByRole("row").length).toBe(4);
  });

  it("[AC-249-K3] Cmd+Shift+Z does NOT trigger pending undo", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    // Shift held — redo slot, not consumed by our handler.
    await act(async () => {
      fireEvent.keyDown(window, {
        key: "z",
        metaKey: true,
        shiftKey: true,
      });
    });

    // Pending Add row stays — undo did not fire.
    expect(screen.getAllByRole("row").length).toBe(5);
  });

  it("[AC-249-K4] Cmd+Z while focus is on an INPUT defers to browser native undo", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Build pending state: add a row first so undo *would* be available.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    // Open a cell editor — this gives us a real <input> to focus.
    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input") as HTMLInputElement | null;
    expect(input).not.toBeNull();

    // Dispatch Cmd+Z with the input as the event target.
    await act(async () => {
      fireEvent.keyDown(input!, { key: "z", metaKey: true });
    });

    // Pending Add row must remain — our handler skipped because
    // target.tagName === "INPUT".
    expect(screen.getAllByRole("row").length).toBe(5);
  });

  it("[AC-249-K5] commit success → undo no longer reaches pre-commit state", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Build a pending edit that is committable (mockExecuteQueryBatch
    // is wired to resolve in the helper module).
    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    // Commit the edit through the toolbar → preview opens → execute.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Commit changes"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Execute SQL"));
    });

    // Pending state cleared.
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();

    // Cmd+Z must NOT resurrect the pre-commit pending edit — the DB is
    // the new baseline. Dispatching Cmd+Z is a no-op (canUndo=false).
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
  });
});
