import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
    {
      name: "email",
      data_type: "varchar",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
    [3, "Carol", "carol@example.com"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnWidths: {},
    columnOrder: [0, 1, 2],
    editingCell: { row: 1, col: 1 } as { row: number; col: number } | null,
    editValue: "Bob",
    pendingEdits: new Map<string, string>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "users",
    onSetEditValue: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onColumnWidthsChange: vi.fn(),
    onReorderColumns: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

function getActiveInput(): HTMLInputElement {
  return screen
    .getAllByDisplayValue(/.*/)
    .find((el) => el.tagName === "INPUT") as HTMLInputElement;
}

describe("DataGridTable cell navigation (S60-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Tab moves to the next visual column (same row)", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });

    // From row 1 / col 1 (name) → row 1 / col 2 (email)
    expect(onStartEdit).toHaveBeenCalledWith(1, 2, "bob@example.com");
  });

  it("Shift+Tab moves to the previous visual column", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    });

    // From row 1 / col 1 (name) → row 1 / col 0 (id)
    expect(onStartEdit).toHaveBeenCalledWith(1, 0, "2");
  });

  it("Enter moves to the next row (same column)", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // From row 1 / col 1 (Bob) → row 2 / col 1 (Carol)
    expect(onStartEdit).toHaveBeenCalledWith(2, 1, "Carol");
  });

  it("Shift+Enter moves to the previous row", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });

    // From row 1 / col 1 (Bob) → row 0 / col 1 (Alice)
    expect(onStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
  });

  it("Tab on the last visual column wraps to the next row, first column", () => {
    const onStartEdit = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 2 },
          editValue: "alice@example.com",
          onStartEdit,
        })}
      />,
    );

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });

    expect(onStartEdit).toHaveBeenCalledWith(1, 0, "2");
  });

  it("Shift+Tab on the first visual column wraps to the prev row, last column", () => {
    const onStartEdit = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 1, col: 0 },
          editValue: "2",
          onStartEdit,
        })}
      />,
    );

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    });

    expect(onStartEdit).toHaveBeenCalledWith(0, 2, "alice@example.com");
  });

  it("Enter on the last row saves and stops (no further movement)", () => {
    const onStartEdit = vi.fn();
    const onSaveCurrentEdit = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 2, col: 1 },
          editValue: "Carol",
          onStartEdit,
          onSaveCurrentEdit,
        })}
      />,
    );

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onSaveCurrentEdit).toHaveBeenCalled();
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("Shift+Enter on the first row saves and stops", () => {
    const onStartEdit = vi.fn();
    const onSaveCurrentEdit = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
          onStartEdit,
          onSaveCurrentEdit,
        })}
      />,
    );

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    });

    expect(onSaveCurrentEdit).toHaveBeenCalled();
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("uses pendingEdits value as the starting value when navigating onto a pending cell", () => {
    const pendingEdits = new Map([["2-1", "PendingCarol"]]);
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ pendingEdits, onStartEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onStartEdit).toHaveBeenCalledWith(2, 1, "PendingCarol");
  });

  it("Tab respects custom column order (visual)", () => {
    const onStartEdit = vi.fn();
    // Visual order: email (2), id (0), name (1)
    render(
      <DataGridTable
        {...makeProps({
          columnOrder: [2, 0, 1],
          editingCell: { row: 0, col: 0 }, // dataIdx=0 (id) is at visualIdx=1
          editValue: "1",
          onStartEdit,
        })}
      />,
    );

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });

    // visualIdx 1 → visualIdx 2 → dataIdx 1 (name = "Alice")
    expect(onStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
  });

  it("Escape still cancels the edit (preserves prior behavior)", () => {
    const onCancelEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onCancelEdit })} />);

    const input = getActiveInput();
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(onCancelEdit).toHaveBeenCalled();
  });
});
