import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

// Mock DataTransfer for drag events (jsdom does not provide it)
class MockDataTransfer {
  effectAllowed: string = "none";
  data: Record<string, string> = {};
  setData(format: string, data: string) {
    this.data[format] = data;
  }
  getData(format: string): string {
    return this.data[format] ?? "";
  }
}

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
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const defaultProps = {
  data: MOCK_DATA,
  loading: false,
  sorts: [],
  columnWidths: {} as Record<string, number>,
  columnOrder: [0, 1, 2] as number[],
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

/** Get column header cells (th elements) */
function getColumnHeaders(): HTMLElement[] {
  const headerRow = screen.getAllByRole("row")[0]!;
  return Array.from(headerRow.querySelectorAll("th"));
}

/** Fire a dragStart event with a mock DataTransfer */
function fireDragStart(element: HTMLElement) {
  const dataTransfer = new MockDataTransfer();
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientX", { value: 50 });
  Object.defineProperty(event, "currentTarget", { value: element });
  element.dispatchEvent(event);
  return dataTransfer;
}

/** Fire a dragOver event with a mock DataTransfer */
function fireDragOver(element: HTMLElement, clientX: number) {
  const dataTransfer = new MockDataTransfer();
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "currentTarget", { value: element });
  element.dispatchEvent(event);
  return dataTransfer;
}

/** Fire a dragEnd event */
function fireDragEnd(element: HTMLElement) {
  const dataTransfer = new MockDataTransfer();
  const event = new Event("dragend", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
}

describe("DataGridTable — Column Drag Reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-03: Default column order renders columns in original order
  it("renders columns in default order when columnOrder is identity", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();
    expect(headers[0]).toHaveTextContent("id");
    expect(headers[1]).toHaveTextContent("name");
    expect(headers[2]).toHaveTextContent("email");
  });

  // AC-03: Reordered column order renders columns in specified order
  it("renders columns in reordered order when columnOrder is changed", () => {
    // Move "email" (index 2) to first position
    renderTable({ columnOrder: [2, 0, 1] });
    const headers = getColumnHeaders();
    expect(headers[0]).toHaveTextContent("email");
    expect(headers[1]).toHaveTextContent("id");
    expect(headers[2]).toHaveTextContent("name");
  });

  // AC-03: Cells in body follow the same column order
  it("renders body cells in the reordered column order", () => {
    renderTable({ columnOrder: [2, 0, 1] });
    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1]!; // skip header
    const cells = firstDataRow.querySelectorAll("td");
    // email=alice@example.com, id=1, name=Alice
    expect(cells[0]).toHaveTextContent("alice@example.com");
    expect(cells[1]).toHaveTextContent("1");
    expect(cells[2]).toHaveTextContent("Alice");
  });

  // AC-03: Single column reorder
  it("renders correctly when only two columns are swapped", () => {
    // Swap "id" and "name": [1, 0, 2]
    renderTable({ columnOrder: [1, 0, 2] });
    const headers = getColumnHeaders();
    expect(headers[0]).toHaveTextContent("name");
    expect(headers[1]).toHaveTextContent("id");
    expect(headers[2]).toHaveTextContent("email");
  });

  // Drag end triggers onReorderColumns with correct new order
  it("calls onReorderColumns when drag ends on a valid drop target", () => {
    const onReorderColumns = vi.fn();
    renderTable({ columnOrder: [0, 1, 2], onReorderColumns });
    const headers = getColumnHeaders();

    // Verify the th elements have the expected attributes
    expect(headers[0]!.getAttribute("draggable")).toBe("true");
    expect(headers[1]!.getAttribute("draggable")).toBe("true");

    // Mock getBoundingClientRect for the target header
    const origRect = headers[1]!.getBoundingClientRect.bind(headers[1]);
    headers[1]!.getBoundingClientRect = () =>
      ({ left: 100, right: 300, width: 200 }) as DOMRect;

    // Simulate drag from column 0 to right half of column 1
    act(() => {
      fireDragStart(headers[0]!);
      // clientX past midpoint (midpoint = 200), so dropTargetIdx = 2
      fireDragOver(headers[1]!, 250);
    });

    // Re-query headers after state updates
    const updatedHeaders = getColumnHeaders();

    act(() => {
      fireDragEnd(updatedHeaders[0]!);
    });

    // Moving col 0 → position 2: splice 0 out, insert at 1 → [1, 0, 2]
    expect(onReorderColumns).toHaveBeenCalledWith([1, 0, 2]);

    headers[1]!.getBoundingClientRect = origRect;
  });

  // Drag to left half sets drop before
  it("calls onReorderColumns when dragging to left half of a column", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();

    const origRect = headers[0]!.getBoundingClientRect.bind(headers[0]);
    headers[0]!.getBoundingClientRect = () =>
      ({ left: 100, right: 300, width: 200 }) as DOMRect;

    // Drag from column 2 to left half of column 0
    act(() => {
      fireDragStart(headers[2]!);
      // clientX before midpoint (midpoint = 200), so dropTargetIdx = 0
      fireDragOver(headers[0]!, 50);
    });

    act(() => {
      fireDragEnd(headers[2]!);
    });

    // Moving col 2 → position 0: splice 2 out, insert at 0 → [2, 0, 1]
    expect(defaultProps.onReorderColumns).toHaveBeenCalledWith([2, 0, 1]);

    headers[0]!.getBoundingClientRect = origRect;
  });

  // Drag without valid drop target does not call onReorderColumns
  it("does not call onReorderColumns when drag ends without drop target", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();

    act(() => {
      fireDragStart(headers[0]!);
      fireDragEnd(headers[0]!);
    });

    expect(defaultProps.onReorderColumns).not.toHaveBeenCalled();
  });

  // Dropping on self does not call onReorderColumns
  it("does not call onReorderColumns when dropping on same position", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();

    const origRect = headers[0]!.getBoundingClientRect.bind(headers[0]);
    headers[0]!.getBoundingClientRect = () =>
      ({ left: 0, right: 200, width: 200 }) as DOMRect;

    act(() => {
      fireDragStart(headers[0]!);
      // Left half of self → targetIdx = 0, which === dragColIdx, so no-op
      fireDragOver(headers[0]!, 50);
    });

    act(() => {
      fireDragEnd(headers[0]!);
    });

    expect(defaultProps.onReorderColumns).not.toHaveBeenCalled();

    headers[0]!.getBoundingClientRect = origRect;
  });

  // AC-06: Sorting uses the correct data column name after reorder
  it("calls onSort with the correct column name after reorder", () => {
    renderTable({ columnOrder: [2, 0, 1] });
    const headers = getColumnHeaders();

    // Click on the first visual column header (which is "email" after reorder)
    fireEvent.click(headers[0]!);

    expect(defaultProps.onSort).toHaveBeenCalledWith("email", false);
  });

  // AC-07: Double-clicking to edit uses the correct data column index after reorder
  it("calls onStartEdit with correct data column index after reorder", () => {
    renderTable({ columnOrder: [2, 0, 1] });
    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1]!;
    const cells = firstDataRow.querySelectorAll("td");

    // Double-click on first visual column (data col 2 = "email")
    fireEvent.doubleClick(cells[0]!);

    // Should call onStartEdit with data column index 2
    expect(defaultProps.onStartEdit).toHaveBeenCalledWith(
      0,
      2,
      "alice@example.com",
    );
  });

  // Empty columnOrder falls back to identity mapping
  it("renders default order when columnOrder is empty", () => {
    renderTable({ columnOrder: [] });
    const headers = getColumnHeaders();
    expect(headers[0]).toHaveTextContent("id");
    expect(headers[1]).toHaveTextContent("name");
    expect(headers[2]).toHaveTextContent("email");
  });

  // AC-04: Dragged column has reduced opacity
  it("applies opacity-50 class to dragged column header", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();

    // Start dragging first column
    act(() => {
      fireDragStart(headers[0]!);
    });

    // Re-query after state update
    const updatedHeaders = getColumnHeaders();
    // After dragStart, the first column should have opacity-50
    expect(updatedHeaders[0]).toHaveClass("opacity-50");
  });

  // AC-05: Drop indicator appears as a vertical line
  it("renders drop indicator element when dragging over a column", () => {
    renderTable({ columnOrder: [0, 1, 2] });
    const headers = getColumnHeaders();

    // Mock getBoundingClientRect for column 2 (visual index 2)
    // We drag from col 0 to the right half of col 2 → targetIdx = 3
    const origRect = headers[2]!.getBoundingClientRect.bind(headers[2]);
    headers[2]!.getBoundingClientRect = () =>
      ({
        left: 300,
        right: 500,
        width: 200,
        top: 0,
        bottom: 30,
        height: 30,
        x: 300,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      fireDragStart(headers[0]!);
      // Right half of column 2 → targetIdx = 3 (after col 2)
      fireDragOver(headers[2]!, 450);
    });

    // Re-query DOM after state update
    const updatedHeaders = getColumnHeaders();

    // There should be a drop indicator div with bg-primary class inside column 2
    const indicators = updatedHeaders[2]!.querySelectorAll("div.bg-primary");
    expect(indicators.length).toBeGreaterThanOrEqual(1);

    updatedHeaders[2]!.getBoundingClientRect = origRect;
  });
});

describe("DataGridTable — Column Reorder with Editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-07: Editing cell with correct data index after reorder
  it("identifies correct editing cell after column reorder", () => {
    const pendingEdits = new Map<string, string>();
    pendingEdits.set("0-1", "EditedName"); // row 0, data col 1

    renderTable({
      columnOrder: [1, 0, 2],
      pendingEdits,
    });

    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1]!;
    const cells = firstDataRow.querySelectorAll("td");

    // Visual position 0 = data col 1 = "name"
    // With pending edit at row 0, col 1 → should show "EditedName"
    expect(cells[0]).toHaveTextContent("EditedName");
    expect(cells[0]).toHaveClass("bg-yellow-500/20");
  });

  // Pending new rows follow column order
  it("renders pending new rows in reordered column order", () => {
    renderTable({
      columnOrder: [2, 0, 1],
      pendingNewRows: [["new-id", "new-name", "new-email"]],
    });

    const rows = screen.getAllByRole("row");
    // Find the new row (last row)
    const newRow = rows[rows.length - 1]!;
    const cells = newRow.querySelectorAll("td");

    // Visual order: [2, 0, 1] → email, id, name
    expect(cells[0]).toHaveTextContent("new-email");
    expect(cells[1]).toHaveTextContent("new-id");
    expect(cells[2]).toHaveTextContent("new-name");
  });
});
