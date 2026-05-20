// Sprint 222 — `editing` axis split from `DataGrid.test.tsx` (P11
// step 5, last). Covers Sprint 30 inline cell editing (5) + Sprint 31
// commit & SQL preview (5) + Sprint 32 row operations (5) + Sprint 43
// promoteTab triggers (4) + Sprint 44 Data Grid UX (3) + Sprint 50
// multi-row selection (5) + [AC-186-06] warn+production+dangerous
// ConfirmDestructiveDialog. (AC-185-06 env color stripe removed in
// Sprint 256.)
// Cases are byte-equivalent to the originals — no behaviour change.
//
// Inline `vi.spyOn(sqlGen, "generateSqlWithKeys")` survives in the
// last case verbatim — helper integration would break the spy
// install/restore lifecycle. Dynamic `await import(...)` calls in
// the last two cases stay inline (vi.mock-avoidance is intentional).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { screen, fireEvent, act } from "@testing-library/react";
import type { SortInfo, TableData } from "@/types/schema";
import {
  MOCK_DATA,
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

// Mock FilterBar — test DataGrid in isolation
vi.mock("./FilterBar", () => ({
  default: () => <div data-testid="filter-bar">FilterBar</div>,
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      queryTableData: mockQueryTableData,
      executeQuery: mockExecuteQuery,
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
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  });
});

// Sprint 76 — a minimal reactive mock that mirrors zustand's hook + getState
// shape. The component subscribes through the selector; `updateTabSorts`
// mutates the tab entry and bumps `version` so every selector re-runs on
// the next render. `forceRerender` via `useTabStoreBump` keeps React in
// sync without dragging the real zustand library into the mock.
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
mockUpdateTabSorts.mockImplementation(
  (_connId: string, _db: string, tabId: string, next: SortInfo[]) => {
    const tab = mockTabStoreState.tabs.find((t) => t.id === tabId);
    if (tab) tab.sorts = next;
    notify();
  },
);
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

describe("DataGrid", () => {
  beforeEach(() => {
    resetDataGridMocks();
    resetMockTabStore();
  });

  // ── Sprint 30: Inline Cell Editing ──

  // 35. Double-clicking a cell enters edit mode
  it("double-clicking a cell enters edit mode", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice" cell (row 0, col 1)

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    // An input should appear inside the cell
    const input = nameCell.querySelector("input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("Alice");
  });

  // 36. Enter saves edit and shows pending indicator
  it("Enter saves edit and shows pending indicator", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Input should be gone
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();

    // Cell should show the new value with highlight background indicator
    expect(nameCell.textContent).toContain("Bob");
    expect(nameCell.className).toContain("bg-highlight/20");

    // Pending edit count should be shown
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
  });

  // 37. Escape cancels edit
  it("Escape cancels edit", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    // Input should be gone
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();

    // Cell should still show original value
    expect(nameCell.textContent).toContain("Alice");

    // No yellow bg
    expect(nameCell.className).not.toContain("bg-highlight/20");
  });

  // 38. Shows pending edit count in toolbar
  it("shows pending edit count in toolbar", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // No pending edits initially
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;

    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Changed" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Should show edit count
    expect(screen.getByText(/1 edit/)).toBeInTheDocument();
  });

  // 39. Clicking another cell while editing saves current edit
  it("clicking another cell while editing saves current edit", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"

    // Start editing
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });

    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
    });

    // Click on another cell
    const otherCell = cells[2]!; // meta column
    await act(async () => {
      fireEvent.click(otherCell);
    });

    // First cell should have saved the edit
    expect(nameCell.querySelector("input")).not.toBeInTheDocument();
    expect(nameCell.textContent).toContain("Bob");
    expect(nameCell.className).toContain("bg-highlight/20");
  });

  // ── Sprint 31: Commit & SQL Preview ──

  // Helper: make a pending edit
  async function makePendingEdit() {
    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!; // "Alice"
    await act(async () => {
      fireEvent.dblClick(nameCell);
    });
    const input = nameCell.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
  }

  // 40. Shows Commit button when there are pending edits
  it("shows Commit button when there are pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // No commit button initially
    expect(screen.queryByLabelText("Commit changes")).not.toBeInTheDocument();

    await makePendingEdit();

    expect(screen.getByLabelText("Commit changes")).toBeInTheDocument();
  });

  // 41. Shows Discard button when there are pending edits
  it("shows Discard button when there are pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    expect(screen.queryByLabelText("Discard changes")).not.toBeInTheDocument();

    await makePendingEdit();

    expect(screen.getByLabelText("Discard changes")).toBeInTheDocument();
  });

  // 42. Discard clears all pending edits
  it("Discard clears all pending edits", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    const discardBtn = screen.getByLabelText("Discard changes");
    await act(async () => {
      fireEvent.click(discardBtn);
    });

    // Pending edits should be cleared
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
    // Yellow bg should be gone
    const cells = screen.getAllByRole("gridcell");
    expect(cells[1]!.className).not.toContain("bg-highlight/20");
  });

  // 43. Commit shows SQL preview modal
  it("Commit shows SQL preview modal", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    const commitBtn = screen.getByLabelText("Commit changes");
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // SQL preview modal should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Should contain UPDATE SQL
    expect(screen.getByText(/UPDATE/i)).toBeInTheDocument();
  });

  // 44. Commit executes SQL and refreshes data
  // Sprint 183 — assertion updated from `mockExecuteQuery` to
  // `mockExecuteQueryBatch` because the commit pipeline now wraps the
  // pending edits in a single transaction batch. 2026-05-01.
  it("Commit executes SQL and refreshes data", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    await makePendingEdit();

    const commitBtn = screen.getByLabelText("Commit changes");
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // Find the execute/confirm button in the modal
    const executeBtn = screen.getByLabelText("Execute SQL");
    await act(async () => {
      fireEvent.click(executeBtn);
    });

    // executeQueryBatch should have been called once with the pending UPDATE.
    expect(mockExecuteQueryBatch).toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    // Pending edits should be cleared after commit
    expect(screen.queryByText(/edit/)).not.toBeInTheDocument();
  });

  // ── Sprint 32: Row Operations (Add/Delete) ──

  // 45. Add Row button adds an empty row at the bottom
  it("Add Row button adds an empty row at the bottom", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const addRowBtn = screen.getByLabelText("Add row");
    await act(async () => {
      fireEvent.click(addRowBtn);
    });

    // There should now be a 4th row (the new empty row)
    const rows = screen.getAllByRole("row");
    // Header row + 3 data rows + 1 new empty row = 5 rows (4 data + 1 header)
    expect(rows.length).toBe(5); // including header row
  });

  // 46. clicking a row selects it
  it("clicking a row selects it", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    // Click on first cell of first data row
    const firstRowCell = cells[0]!;
    await act(async () => {
      fireEvent.click(firstRowCell);
    });

    // The row should have a selected indicator
    const row = firstRowCell.closest('[role="row"]')!;
    expect(row.className).toContain("bg-accent/20");
  });

  // 47. Delete Row button marks selected row for deletion
  it("Delete Row button marks selected row for deletion", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Select a row first
    const cells = screen.getAllByRole("gridcell");
    const firstRowCell = cells[0]!;
    await act(async () => {
      fireEvent.click(firstRowCell);
    });

    // Click delete
    const deleteRowBtn = screen.getByLabelText("Delete row");
    await act(async () => {
      fireEvent.click(deleteRowBtn);
    });

    // The row should have strikethrough style
    const row = firstRowCell.closest('[role="row"]')!;
    expect(row.className).toContain("line-through");
  });

  // 48. deleted row has strikethrough style
  it("deleted row has strikethrough style", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Select and delete the first row
    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // All cells in that row should show strikethrough
    const row = cells[0]!.closest('[role="row"]')!;
    expect(row.className).toContain("line-through");
  });

  // 49. Discard clears pending row operations
  it("Discard clears pending row operations", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    // Add a row
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });

    // Delete a row
    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // Discard
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Discard changes"));
    });

    // Should be back to original state - 3 data rows + header
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(4); // header + 3 data rows
    // No strikethrough
    const dataRows = rows.slice(1);
    for (const row of dataRows) {
      expect(row.className).not.toContain("line-through");
    }
  });

  // ── Sprint 43: promoteTab triggers ──

  // Reason: sorting no longer promotes preview tabs — the promoteTab
  // useEffect was removed from DataGrid so that preview tabs stay as
  // previews until an explicit user action (double-click, edit, TabBar
  // click) promotes them. (2026-04-29)
  it("does NOT call promoteTab when sorting changes", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Sort by id"));
    });
    await screen.findByText("▲");

    expect(mockPromoteTab).not.toHaveBeenCalled();
  });

  // 51. Inline edit (double-click) triggers promoteTab
  it("calls promoteTab when inline editing starts", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.dblClick(cells[1]!);
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("conn1", "db1", "tab-1");
  });

  // 52. Add row triggers promoteTab
  it("calls promoteTab when adding a row", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add row"));
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("conn1", "db1", "tab-1");
  });

  // 53. Delete row triggers promoteTab
  it("calls promoteTab when deleting a row", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");
    mockPromoteTab.mockClear();

    const cells = screen.getAllByRole("gridcell");
    await act(async () => {
      fireEvent.click(cells[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    expect(mockPromoteTab).toHaveBeenCalledWith("conn1", "db1", "tab-1");
  });

  // ── Sprint 44: Data Grid UX (Sprint 238 으로 char-truncate 폐기) ──

  // 54. Sprint 238 — long cell 은 full text 를 DOM 에 보존, CSS ellipsis 로
  // 시각적 cap 처리. char-truncate(200) 와 line-clamp-3 모두 제거 (AC-238-05/06).
  it("preserves full cell text in DOM and exposes via title (CSS ellipsis handles overflow)", async () => {
    const longText = "A".repeat(250);
    mockQueryTableData.mockResolvedValue({
      ...MOCK_DATA,
      total_count: 1,
      rows: [[1, longText, null]],
    });
    renderDataGrid();
    await screen.findByText("1 rows");

    const cells = screen.getAllByRole("gridcell");
    const nameCell = cells[1]!;
    // Full text in DOM (browser CSS hides overflow visually).
    expect(nameCell.textContent).toContain(longText);
    // Title still carries full value for hover.
    expect(nameCell).toHaveAttribute("title", longText);
    // line-clamp-3 마커 부재 — Sprint 238 로 폐기됨.
    expect(nameCell.querySelector(".line-clamp-3")).toBeNull();
  });

  // 55. Data type header has truncate class
  it("applies truncate class to data type header", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const typeElements = screen.getAllByText("integer");
    expect(typeElements[0]!.classList.contains("truncate")).toBe(true);
  });

  // 56. Date column renders datetime-local input when editing
  it("renders datetime-local input for timestamp column editing", async () => {
    const dateData: TableData = {
      ...MOCK_DATA,
      columns: [
        ...MOCK_DATA.columns,
        {
          name: "created_at",
          data_type: "timestamp",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
      rows: [[1, "Alice", null, "2024-01-15T10:30:00"]],
    };
    mockQueryTableData.mockResolvedValue(dateData);
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const dateCell = cells[3]!; // created_at column

    await act(async () => {
      fireEvent.dblClick(dateCell);
    });

    const input = dateCell.querySelector("input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).type).toBe("datetime-local");
  });

  // ── Sprint 50: Multi-row Selection ──

  // 57. Cmd+Click toggles row selection
  it("toggles row selection with Cmd+Click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest('[role="row"]')!,
      cells[3]!.closest('[role="row"]')!,
      cells[6]!.closest('[role="row"]')!,
    ];

    // Click first row normally (selects it)
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    expect(rows[0]!.className).toContain("bg-accent/20");

    // Cmd+Click second row (adds to selection)
    await act(async () => {
      fireEvent.click(cells[3]!, { metaKey: true });
    });
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
  });

  // 58. Shift+Click selects range
  it("selects range of rows with Shift+Click", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest('[role="row"]')!,
      cells[3]!.closest('[role="row"]')!,
      cells[6]!.closest('[role="row"]')!,
    ];

    // Click first row (sets anchor)
    await act(async () => {
      fireEvent.click(cells[0]!);
    });

    // Shift+Click third row (selects range 0-2)
    await act(async () => {
      fireEvent.click(cells[6]!, { shiftKey: true });
    });

    // All three rows should be selected
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).toContain("bg-accent/20");
  });

  // 59. Delete button deletes multiple selected rows
  it("deletes multiple selected rows via Delete button", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest('[role="row"]')!,
      cells[3]!.closest('[role="row"]')!,
      cells[6]!.closest('[role="row"]')!,
    ];

    // Select first row
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    // Cmd+Click third row
    await act(async () => {
      fireEvent.click(cells[6]!, { metaKey: true });
    });

    // Click delete
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete row"));
    });

    // First and third rows should have strikethrough
    expect(rows[0]!.className).toContain("line-through");
    expect(rows[1]!.className).not.toContain("line-through");
    expect(rows[2]!.className).toContain("line-through");
  });

  // 60. Shows selection count when multiple rows selected
  it("shows selection count when multiple rows are selected", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");

    // Select first row
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    // Cmd+Click second row
    await act(async () => {
      fireEvent.click(cells[3]!, { metaKey: true });
    });

    // Should show "2 selected"
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  // 61. Normal click after multi-select resets to single selection
  it("resets to single selection on normal click after multi-select", async () => {
    renderDataGrid();
    await screen.findByText("3 rows");

    const cells = screen.getAllByRole("gridcell");
    const rows = [
      cells[0]!.closest('[role="row"]')!,
      cells[3]!.closest('[role="row"]')!,
      cells[6]!.closest('[role="row"]')!,
    ];

    // Multi-select first and third
    await act(async () => {
      fireEvent.click(cells[0]!);
    });
    await act(async () => {
      fireEvent.click(cells[6]!, { metaKey: true });
    });
    expect(rows[0]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).toContain("bg-accent/20");

    // Normal click on second row
    await act(async () => {
      fireEvent.click(cells[3]!);
    });

    // Only second row should be selected
    expect(rows[0]!.className).not.toContain("bg-accent/20");
    expect(rows[1]!.className).toContain("bg-accent/20");
    expect(rows[2]!.className).not.toContain("bg-accent/20");
  });

  // Sprint 256 (2026-05-09): the AC-185-06 1px env color stripe above the
  // DataGrid Preview Dialog header was removed per user feedback
  // ("datagrid 에서 수정할 때 SQL preview 뜨는 것 상단에 한줄 그어놓은
  // 것도 ... 그냥 제거해"). The env signal flows through the footer
  // ExecuteButton's color × env matrix and the ConfirmDestructiveDialog
  // header tokens instead. The regression guard for the stripe is
  // intentionally dropped.

  it("[AC-186-06] warn + production + dangerous → ConfirmDestructiveDialog rendered with reason", async () => {
    // AC-186-06 — Sprint 186 mounts ConfirmDestructiveDialog when the
    // useDataGridEdit hook surfaces pendingConfirm. The generator is
    // PK-bounded so it never emits a WHERE-less DELETE on its own; we
    // mock generateSqlWithKeys to inject a danger shape and verify the
    // warn handoff renders the dialog with the analyzer's reason text.
    // date 2026-05-01.
    const { useConnectionStore } = await import("@stores/connectionStore");
    const { useSafeModeStore } = await import("@stores/safeModeStore");
    const sqlGen = await import("@components/datagrid/sqlGenerator");
    const spy = vi
      .spyOn(sqlGen, "generateSqlWithKeys")
      .mockReturnValue([{ sql: "DELETE FROM users", key: "row-1-0" }]);

    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "prod-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "warn" });

    try {
      renderDataGrid();
      await screen.findByText("3 rows");
      // Edit a cell so the toolbar Commit button has something to commit.
      // Sprint 343 — `meta` (index 2) is now a JSONB sentinel and no
      // longer responds to double-click; switch to `name` (index 1).
      const tds = document.querySelectorAll(
        '[role="row"][aria-rowindex="2"] [role="gridcell"]',
      );
      act(() => {
        fireEvent.doubleClick(tds[1]!);
      });
      const input = document.querySelector(
        '[role="row"][aria-rowindex="2"] input',
      ) as HTMLInputElement;
      act(() => {
        fireEvent.change(input, { target: { value: "Alicia" } });
      });
      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      // Open the SQL preview, then click Execute. The mocked generator
      // returns the WHERE-less DELETE; warn mode + production should
      // surface the ConfirmDestructiveDialog.
      act(() => {
        window.dispatchEvent(new Event("commit-changes"));
      });
      await screen.findByLabelText("Execute SQL");
      act(() => {
        screen.getByLabelText("Execute SQL").click();
      });
      await screen.findByText("PRODUCTION DATABASE");
      const dialogContent = document.querySelector(
        '[data-slot="alert-dialog-content"]',
      );
      expect(dialogContent).not.toBeNull();
      expect(dialogContent?.textContent).toMatch(/DELETE without WHERE clause/);
    } finally {
      spy.mockRestore();
      useConnectionStore.setState({ connections: [] });
      useSafeModeStore.setState({ mode: "strict" });
    }
  });
});
