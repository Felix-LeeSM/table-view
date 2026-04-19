import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Mock stores
const mockExecuteQuery = vi.fn(() =>
  Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  }),
);
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      executeQuery: mockExecuteQuery,
    }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTabId: "tab-1",
      promoteTab: vi.fn(),
    }),
}));

const MOCK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
    [3, "Charlie"],
    [4, "Diana"],
    [5, "Eve"],
  ],
  total_count: 5,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook(overrides: { page?: number } = {}) {
  return renderHook(
    ({ page }: { page: number }) =>
      useDataGridEdit({
        data: MOCK_DATA,
        schema: "public",
        table: "users",
        connectionId: "conn1",
        page,
        fetchData: mockFetchData,
      }),
    { initialProps: { page: overrides.page ?? 1 } },
  );
}

describe("useDataGridEdit — multi-row selection", () => {
  beforeEach(() => {
    mockExecuteQuery.mockReset();
    mockExecuteQuery.mockResolvedValue({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 5,
      query_type: "dml",
    });
    mockFetchData.mockReset();
  });

  // AC-01: Normal click → single selection
  it("selects only the clicked row on normal click", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });

    expect(result.current.selectedRowIds).toEqual(new Set([0]));
    expect(result.current.anchorRowIdx).toBe(0);
    expect(result.current.selectedRowIdx).toBe(0);
  });

  it("replaces selection on normal click when another row is selected", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });

    expect(result.current.selectedRowIds).toEqual(new Set([2]));
    expect(result.current.anchorRowIdx).toBe(2);
    expect(result.current.selectedRowIdx).toBe(2);
  });

  // AC-02: Cmd/Ctrl+Click → toggle individual rows
  it("adds a row to selection with Cmd+Click", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false); // metaKey
    });

    expect(result.current.selectedRowIds).toEqual(new Set([0, 2]));
    // anchor should stay at first selected row
    expect(result.current.anchorRowIdx).toBe(0);
  });

  it("removes a row from selection with Cmd+Click", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(0, true, false); // toggle off
    });

    expect(result.current.selectedRowIds).toEqual(new Set([2]));
    expect(result.current.anchorRowIdx).toBe(0);
  });

  it("sets anchor on first Cmd+Click when no selection exists", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(3, true, false);
    });

    expect(result.current.selectedRowIds).toEqual(new Set([3]));
    expect(result.current.anchorRowIdx).toBe(3);
  });

  // AC-03: Shift+Click → range selection
  it("selects range from anchor to clicked row with Shift+Click", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(1, false, false); // anchor at 1
    });
    act(() => {
      result.current.handleSelectRow(4, false, true); // shiftKey
    });

    expect(result.current.selectedRowIds).toEqual(new Set([1, 2, 3, 4]));
  });

  it("selects range in reverse direction (click before anchor)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(3, false, false); // anchor at 3
    });
    act(() => {
      result.current.handleSelectRow(0, false, true); // shiftKey, before anchor
    });

    expect(result.current.selectedRowIds).toEqual(new Set([0, 1, 2, 3]));
  });

  // AC-07: Shift+Click without anchor → fallback to single selection
  it("falls back to single selection on Shift+Click without anchor", () => {
    const { result } = renderEditHook();

    // No prior selection — Shift+Click should behave like normal click
    act(() => {
      result.current.handleSelectRow(2, false, true);
    });

    expect(result.current.selectedRowIds).toEqual(new Set([2]));
    expect(result.current.anchorRowIdx).toBe(2);
  });

  // AC-05: Multi-select + Delete → all selected rows in pendingDeletedRowKeys
  it("deletes all selected rows on handleDeleteRow", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(4, true, false);
    });

    expect(result.current.selectedRowIds.size).toBe(3);

    act(() => {
      result.current.handleDeleteRow();
    });

    // All 3 rows should be in pendingDeletedRowKeys (page=1)
    expect(result.current.pendingDeletedRowKeys).toEqual(
      new Set(["row-1-0", "row-1-2", "row-1-4"]),
    );
    // Selection should be cleared
    expect(result.current.selectedRowIds.size).toBe(0);
    expect(result.current.anchorRowIdx).toBeNull();
  });

  it("does nothing when no rows are selected and handleDeleteRow is called", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleDeleteRow();
    });

    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
  });

  // AC-06: Page change resets selection
  it("resets selection state when page changes", () => {
    const { result, rerender } = renderEditHook({ page: 1 });

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });

    expect(result.current.selectedRowIds.size).toBe(2);

    // Simulate page change by rerendering with different page
    rerender({ page: 2 });

    expect(result.current.selectedRowIds.size).toBe(0);
    expect(result.current.anchorRowIdx).toBeNull();
  });

  // selectedRowIdx derived value
  it("returns null for selectedRowIdx when multiple rows are selected", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });

    expect(result.current.selectedRowIdx).toBeNull();
  });

  it("returns the row index for selectedRowIdx when exactly one row is selected", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(3, false, false);
    });

    expect(result.current.selectedRowIdx).toBe(3);
  });

  it("returns null for selectedRowIdx when no rows are selected", () => {
    const { result } = renderEditHook();

    expect(result.current.selectedRowIdx).toBeNull();
  });

  // Edge case: Cmd+Click toggling all rows off
  it("clears selection when toggling off the last selected row via Cmd+Click", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(1, true, false);
    });
    act(() => {
      result.current.handleSelectRow(1, true, false); // toggle off
    });

    expect(result.current.selectedRowIds.size).toBe(0);
  });

  // Shift+Click replaces multi-selection with range
  it("Shift+Click replaces Cmd+Click multi-selection with range", () => {
    const { result } = renderEditHook();

    // Cmd+Click to select rows 0 and 3
    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(3, true, false);
    });
    expect(result.current.selectedRowIds).toEqual(new Set([0, 3]));

    // Shift+Click from anchor (0) to 2 should replace with range [0,1,2]
    act(() => {
      result.current.handleSelectRow(2, false, true);
    });
    expect(result.current.selectedRowIds).toEqual(new Set([0, 1, 2]));
  });

  // ── Duplicate Row ──────────────────────────────────────────────────────

  it("duplicates a single selected row into pendingNewRows", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(1, false, false);
    });

    act(() => {
      result.current.handleDuplicateRow();
    });

    expect(result.current.pendingNewRows).toHaveLength(1);
    expect(result.current.pendingNewRows[0]).toEqual([2, "Bob"]);
    // Selection should be cleared
    expect(result.current.selectedRowIds.size).toBe(0);
  });

  it("duplicates multiple selected rows into pendingNewRows", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleSelectRow(2, true, false);
    });
    act(() => {
      result.current.handleSelectRow(4, true, false);
    });

    act(() => {
      result.current.handleDuplicateRow();
    });

    expect(result.current.pendingNewRows).toHaveLength(3);
    expect(result.current.pendingNewRows[0]).toEqual([1, "Alice"]);
    expect(result.current.pendingNewRows[1]).toEqual([3, "Charlie"]);
    expect(result.current.pendingNewRows[2]).toEqual([5, "Eve"]);
  });

  it("does nothing when no rows are selected", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleDuplicateRow();
    });

    expect(result.current.pendingNewRows).toHaveLength(0);
  });

  it("preserves existing pendingNewRows when duplicating", () => {
    const { result } = renderEditHook();

    // Add a new row first
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows).toHaveLength(1);

    // Select and duplicate a row
    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });

    expect(result.current.pendingNewRows).toHaveLength(2);
  });

  it("duplicated rows are independent copies (not references)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });

    // Modify original data shouldn't affect duplicated row
    const duplicatedRow = result.current.pendingNewRows[0] as unknown[];
    expect(duplicatedRow).toEqual([1, "Alice"]);
    // They should not be the same reference
    expect(duplicatedRow).not.toBe(MOCK_DATA.rows[0]);
  });
});
