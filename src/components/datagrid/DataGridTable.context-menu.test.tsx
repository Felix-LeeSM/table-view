import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "../../types/schema";

// Mock clipboard API
const mockWriteText = vi.fn(() => Promise.resolve());
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

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
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const defaultProps = {
  data: MOCK_DATA,
  loading: false,
  sorts: [],
  columnWidths: {} as Record<string, number>,
  columnOrder: [0, 1] as number[],
  editingCell: null as { row: number; col: number } | null,
  editValue: "",
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
};

function renderTable(overrides: Partial<typeof defaultProps> = {}) {
  return render(<DataGridTable {...defaultProps} {...overrides} />);
}

/** Get the first data row (index 1 = header + first data row). */
function getFirstDataRow(): HTMLElement {
  const rows = screen.getAllByRole("row");
  return rows[1]!;
}

/** Right-click on the first data row. */
function contextClickFirstDataRow(x = 100, y = 200): void {
  fireEvent.contextMenu(getFirstDataRow(), { clientX: x, clientY: y });
}

/** Get the first argument of the last clipboard writeText call. */
function getClipboardText(): string {
  const calls = mockWriteText.mock.calls as unknown as string[][];
  return calls[calls.length - 1]![0]!;
}

describe("DataGridTable — context menu", () => {
  beforeEach(() => {
    mockWriteText.mockReset();
    vi.clearAllMocks();
  });

  // AC-01: Right-click on data row shows context menu at row position
  it("shows context menu on right-click", () => {
    renderTable();

    act(() => {
      contextClickFirstDataRow();
    });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveAttribute(
      "aria-label",
      "Context menu",
    );
  });

  // AC-02: Menu items are present
  it("renders all expected menu items", () => {
    renderTable();

    contextClickFirstDataRow();

    expect(
      screen.getByRole("menuitem", { name: "Show Cell Details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Edit Cell" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete Row" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate Row" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy as Plain Text" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy as JSON" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy as CSV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy as SQL Insert" }),
    ).toBeInTheDocument();
  });

  // AC-11: External click closes the menu
  it("closes context menu on outside click", () => {
    renderTable();

    contextClickFirstDataRow();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // AC-11: Escape closes the menu
  it("closes context menu on Escape key", () => {
    renderTable();

    contextClickFirstDataRow();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // AC-03: Edit Cell triggers onStartEdit
  it("calls onStartEdit when Edit Cell is clicked", () => {
    renderTable();

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit Cell" }));
    });

    expect(defaultProps.onStartEdit).toHaveBeenCalledWith(0, 0, "1");
  });

  // AC-04: Delete Row triggers onDeleteRow
  it("calls onDeleteRow when Delete Row is clicked", () => {
    renderTable();

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete Row" }));
    });

    expect(defaultProps.onDeleteRow).toHaveBeenCalled();
  });

  // AC-05: Duplicate Row triggers onDuplicateRow
  it("calls onDuplicateRow when Duplicate Row is clicked", () => {
    renderTable();

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Row" }));
    });

    expect(defaultProps.onDuplicateRow).toHaveBeenCalled();
  });

  // AC-06: Copy as Plain Text
  it("copies plain text to clipboard when Copy as Plain Text is clicked", () => {
    renderTable({
      selectedRowIds: new Set([0]),
    });

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Copy as Plain Text" }),
      );
    });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = getClipboardText();
    expect(text).toContain("id\tname");
    expect(text).toContain("1\tAlice");
  });

  // AC-07: Copy as JSON
  it("copies JSON to clipboard when Copy as JSON is clicked", () => {
    renderTable({
      selectedRowIds: new Set([0]),
    });

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy as JSON" }));
    });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = getClipboardText();
    const parsed = JSON.parse(text);
    expect(parsed).toEqual([{ id: 1, name: "Alice" }]);
  });

  // AC-08: Copy as CSV
  it("copies CSV to clipboard when Copy as CSV is clicked", () => {
    renderTable({
      selectedRowIds: new Set([0]),
    });

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy as CSV" }));
    });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = getClipboardText();
    expect(text).toContain("id,name");
    expect(text).toContain("1,Alice");
  });

  // AC-09: Copy as SQL Insert
  it("copies SQL INSERT to clipboard when Copy as SQL Insert is clicked", () => {
    renderTable({
      selectedRowIds: new Set([0]),
    });

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Copy as SQL Insert" }),
      );
    });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = getClipboardText();
    expect(text).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, 'Alice');",
    );
  });

  // AC-10: Multi-row selection includes all selected rows
  it("copies all selected rows when multiple rows are selected", () => {
    renderTable({
      selectedRowIds: new Set([0, 2]),
    });

    contextClickFirstDataRow();

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy as JSON" }));
    });

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = getClipboardText();
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 1, name: "Alice" });
    expect(parsed[1]).toEqual({ id: 3, name: "Charlie" });
  });

  // AC-12: Empty data does not show context menu
  it("does not show context menu on empty data", () => {
    const emptyData: TableData = {
      ...MOCK_DATA,
      rows: [],
      total_count: 0,
    };
    renderTable({ data: emptyData });

    // With no data rows, there should be a "No data" cell but no context menu
    expect(screen.getByText("No data")).toBeInTheDocument();

    // Try right-clicking the "No data" row — no menu should appear
    const noDataRow = screen.getByText("No data").closest("tr");
    if (noDataRow) {
      fireEvent.contextMenu(noDataRow, { clientX: 100, clientY: 200 });
    }

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // When right-clicking an unselected row, it should select it first
  it("selects the right-clicked row if not already selected", () => {
    renderTable({
      selectedRowIds: new Set([1]), // row 1 is selected
    });

    // Right-click on row 0 (which is not selected)
    contextClickFirstDataRow();

    // onSelectRow should be called for row 0 (since it wasn't selected)
    expect(defaultProps.onSelectRow).toHaveBeenCalledWith(0, false, false);
  });

  // Separator is rendered
  it("renders a separator between action items and copy items", () => {
    renderTable();

    contextClickFirstDataRow();

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  // S61-4: Show Cell Details opens the dialog with the right cell
  it("opens cell detail dialog when Show Cell Details is clicked", () => {
    renderTable();
    // Right-click directly on the second cell of row 0 ("Alice"), not the row.
    const tds = document.querySelectorAll("tbody tr:first-child td");
    fireEvent.contextMenu(tds[1]!, { clientX: 50, clientY: 50 });

    act(() => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Show Cell Details" }),
      );
    });

    // Scope to the dialog so we don't collide with the table header that
    // also reads "name".
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("name");
    expect(dialog.textContent).toContain("(text)");
    expect(dialog.textContent).toContain("Alice");
  });
});
