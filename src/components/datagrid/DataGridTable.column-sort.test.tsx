import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

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
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM users",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnWidths: {} as Record<string, number>,
    columnOrder: [0, 1] as number[],
    editingCell: null as { row: number; col: number } | null,
    editValue: "",
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "users",
    onSetEditValue: vi.fn(),
    onSetEditNull: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onColumnWidthsChange: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

function getColumnHeaders(): HTMLElement[] {
  return Array.from(document.querySelectorAll("thead th")) as HTMLElement[];
}

describe("DataGridTable — column sort vs drag discrimination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onSort when clicking a column header without moving the mouse", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const [idTh] = getColumnHeaders();
    expect(idTh).toBeDefined();

    act(() => {
      // Simulate click: mousedown and click at the same position
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 50, clientY: 10 });
    });

    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("id", false);
  });

  it("passes shiftKey=true to onSort on shift-click", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const [idTh] = getColumnHeaders();

    act(() => {
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 50, clientY: 10, shiftKey: true });
    });

    expect(onSort).toHaveBeenCalledWith("id", true);
  });

  it("suppresses onSort when the header is dragged (movement > 4px)", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const [idTh] = getColumnHeaders();

    act(() => {
      // Press at x=50, release (click) at x=60 → delta = 10px > 4px
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 60, clientY: 10 });
    });

    expect(onSort).not.toHaveBeenCalled();
  });

  it("still calls onSort when movement is ≤ 4px (micro-jitter tolerance)", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const [idTh] = getColumnHeaders();

    act(() => {
      // Press at x=50, release at x=53 → delta = 3px ≤ 4px
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 53, clientY: 10 });
    });

    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("id", false);
  });

  it("suppresses onSort when vertical drag exceeds 4px", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const [idTh] = getColumnHeaders();

    act(() => {
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 50, clientY: 20 }); // dy=10 > 4
    });

    expect(onSort).not.toHaveBeenCalled();
  });

  it("sorts second column header independently", () => {
    const onSort = vi.fn();
    render(<DataGridTable {...makeProps({ onSort })} />);

    const headers = getColumnHeaders();
    const nameTh = headers[1]!;

    act(() => {
      fireEvent.mouseDown(nameTh, { clientX: 100, clientY: 10 });
      fireEvent.click(nameTh, { clientX: 100, clientY: 10 });
    });

    expect(onSort).toHaveBeenCalledWith("name", false);
  });

  it("renders sort indicator for sorted column", () => {
    render(
      <DataGridTable
        {...makeProps({
          sorts: [{ column: "id", direction: "ASC" }],
        })}
      />,
    );

    const idTh = getColumnHeaders()[0]!;
    expect(idTh.textContent).toContain("▲");
  });
});

describe("DataGridTable — save edit on sort (Issue 004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onSaveCurrentEdit before onSort when a cell is being edited", () => {
    const onSort = vi.fn();
    const onSaveCurrentEdit = vi.fn();

    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice edited",
          onSort,
          onSaveCurrentEdit,
        })}
      />,
    );

    const [idTh] = getColumnHeaders();

    act(() => {
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 50, clientY: 10 });
    });

    expect(onSaveCurrentEdit).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("does not call onSaveCurrentEdit when no cell is editing", () => {
    const onSaveCurrentEdit = vi.fn();

    render(
      <DataGridTable
        {...makeProps({
          editingCell: null,
          onSaveCurrentEdit,
        })}
      />,
    );

    const [idTh] = getColumnHeaders();

    act(() => {
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 50, clientY: 10 });
    });

    expect(onSaveCurrentEdit).not.toHaveBeenCalled();
  });

  it("does not call onSaveCurrentEdit when drag suppresses the sort", () => {
    const onSaveCurrentEdit = vi.fn();
    const onSort = vi.fn();

    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 0 },
          editValue: "1",
          onSaveCurrentEdit,
          onSort,
        })}
      />,
    );

    const [idTh] = getColumnHeaders();

    act(() => {
      fireEvent.mouseDown(idTh!, { clientX: 50, clientY: 10 });
      fireEvent.click(idTh!, { clientX: 60, clientY: 10 }); // drag > 4px
    });

    expect(onSaveCurrentEdit).not.toHaveBeenCalled();
    expect(onSort).not.toHaveBeenCalled();
  });
});
