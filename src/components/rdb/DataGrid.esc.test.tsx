// Sprint 250 — DataGrid window Esc keydown listener (modal-aware
// pending discard). Maps to AC-250-02 / AC-250-03 / AC-250-04 from
// `docs/sprints/sprint-250/contract.md`. Date 2026-05-09.
//
// Asserted scenarios (component layer):
// - AC-250-02 (superseded → gated): Esc on document.body now opens the
//   shared discard-confirm gate (PR #1013 parity) instead of discarding
//   immediately; the four pending slices survive until the user confirms
//   in the dialog. The no-pending case stays a harmless no-op.
// - AC-250-03: Esc while a `[role="dialog"]` (Radix SQL Preview) is
//   present is NOT consumed by the grid's window listener — the grid's
//   pending state survives. The Radix dialog closes via its own native
//   Esc-handler (we just verify the grid did not discard).
// - AC-250-04: Esc dispatched while editingCell !== null routes through
//   the cell-local cancelEdit (no grid-wide discard); other pending
//   edits remain intact.
//
// We share the helper-mocked schema/tab stores from
// `__tests__/dataGridTestHelpers.tsx`, mirroring `DataGrid.undo.test.tsx`
// so the renderDataGrid pipeline matches the existing editing-axis tests
// verbatim.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { screen, fireEvent, act, within } from "@testing-library/react";
import type { SortInfo } from "@/types/schema";
import {
  mockQueryTableData,
  mockExecuteQuery,
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
beforeEach(() => {
  setupTauriMock({
    get queryTableData() {
      return mockQueryTableData;
    },
    get executeQuery() {
      return mockExecuteQuery;
    },
    get executeQueryBatch() {
      return mockExecuteQueryBatch;
    },
  });
});

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

describe("DataGrid — Sprint 250 modal-aware Esc discard (AC-250-02..04)", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  it("[AC-250-02→gated] Esc on body opens the discard-confirm gate; pending survives until confirmed", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Build pending state: add a row + a cell edit.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });
    expect(screen.getAllByRole("row").length).toBe(5);

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input")!;
    // Use blur (not Enter) to commit so editingCell drops to null —
    // Enter triggers `next-row` navigation which would re-open the next
    // cell's editor and trip the Esc handler's `editingCell !== null`
    // guard. blur is the Sprint 250 onBlur path under test.
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.blur(input);
    });
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    // Dispatch Esc on the window (focus on body — no dialog is mounted,
    // no editor is active because blur dismissed it above). Esc now routes
    // through the SAME confirm gate as the Discard button (unrecoverable →
    // confirm first) rather than discarding immediately.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // Gate is open; pending state SURVIVES (nothing discarded yet). The open
    // modal marks the grid `aria-hidden`, so count rows with `hidden: true` —
    // the added row is still present (5), proving Esc gated instead of the
    // old immediate discard (which would show no dialog and 4 rows).
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole("row", { hidden: true }).length).toBe(5);

    // Confirming in the gate performs the (now-explicit) discard.
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Discard changes" }),
      );
    });

    // All pending state cleared — back to 3 data rows + header, no edit
    // count, the previously-pending cell loses its highlight bg.
    expect(screen.getAllByRole("row").length).toBe(4);
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
    const cellsAfter = screen.getAllByRole("gridcell");
    expect(cellsAfter[1]!.className).not.toContain("bg-highlight/20");
  });

  it("[AC-250-03] Esc while SQL Preview dialog is open does NOT discard pending state", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Build a pending edit, then open SQL Preview via toolbar Commit.
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

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Commit changes"));
    });
    // Radix Dialog is mounted with role="dialog".
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Dispatch window Esc. The grid's listener must SHORT-CIRCUIT because
    // a `[role="dialog"]` is present in the DOM. Radix Dialog handles its
    // own Esc-close internally; we only assert that the grid did not run
    // its discard handler — i.e. the pending edit and edit count survive.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // The pending edit count survives: the grid's discard did NOT fire.
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
  });

  it("[AC-250-04] Esc inside an active cell editor cancels only that editor (other pending preserved)", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Establish a pre-existing pending edit on row 2 (Charlie → Chuck).
    // Row 1 has a null name cell which would render the NULL chip, not
    // an <input>, so we pick a row with a real string value instead.
    const initialCells = screen.getAllByRole("gridcell");
    const charlieCell = initialCells[7]!; // row 2 col 1 = "Charlie"
    await act(async () => {
      fireEvent.dblClick(charlieCell);
    });
    {
      const input = charlieCell.querySelector("input")!;
      await act(async () => {
        fireEvent.change(input, { target: { value: "Chuck" } });
        fireEvent.keyDown(input, { key: "Enter" });
      });
    }
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    // Open a second cell (row 0 col 1, "Alice"), type something, then
    // press Esc INSIDE the input. Editor-local Esc must call cancelEdit
    // (not grid-wide discard).
    const cells = screen.getAllByRole("gridcell");
    const aliceCell = cells[1]!;
    await act(async () => {
      fireEvent.dblClick(aliceCell);
    });
    const aliceInput = aliceCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(aliceInput, { target: { value: "Alicia" } });
      fireEvent.keyDown(aliceInput, { key: "Escape" });
    });

    // Editor closed, in-flight typed value discarded — but the prior
    // pending edit (row 1 col 1 = Bobby) survives. Grid-wide discard did
    // NOT fire.
    expect(aliceCell.querySelector("input")).not.toBeInTheDocument();
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
    expect(aliceCell.className).not.toContain("bg-highlight/20");
  });

  it("[AC-250-02] Esc on body with no pending changes is a harmless no-op", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // No pending state, no editor.
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();

    // Dispatch Esc — must not throw, must not corrupt state.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.getAllByRole("row").length).toBe(4);
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
  });
});
