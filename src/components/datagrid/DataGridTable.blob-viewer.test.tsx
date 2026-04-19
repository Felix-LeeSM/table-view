import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

// Mock clipboard API
const mockWriteText = vi.fn(() => Promise.resolve());
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

const BLOB_DATA: TableData = {
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
      name: "data",
      data_type: "bytea",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "binary data here"],
    [2, null],
    [3, { key: "value" }],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM test_table",
};

const BLOB_VARIANTS_DATA: TableData = {
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
      name: "blob_col",
      data_type: "blob",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "binary_col",
      data_type: "binary",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, "blob data", "binary data"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM test_table",
};

const defaultProps = {
  data: BLOB_DATA,
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
  table: "test_table",
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

describe("DataGridTable — BLOB viewer", () => {
  beforeEach(() => {
    mockWriteText.mockReset();
    vi.clearAllMocks();
  });

  it("renders BLOB icon and label for non-null BLOB cells", () => {
    renderTable();

    // Rows 1 and 3 have non-null BLOB data — should show (BLOB) buttons
    const blobButtons = screen.getAllByLabelText(/View BLOB data for data/);
    expect(blobButtons).toHaveLength(2); // Row 0 and Row 2 have non-null data
    expect(blobButtons[0]).toHaveTextContent("(BLOB)");
    expect(blobButtons[1]).toHaveTextContent("(BLOB)");
  });

  it("shows NULL for null BLOB cells", () => {
    renderTable();

    // Row 2 has null data — should show italic NULL
    const rows = screen.getAllByRole("row");
    const row2 = rows[2]!; // Row index 2 (header is 0, row 0 is 1, row 1 is 2)
    const nullCell = row2.querySelector(".italic");
    expect(nullCell).toHaveTextContent("NULL");
  });

  it("opens BLOB viewer dialog on BLOB cell click", () => {
    renderTable();

    // Click the first BLOB button
    const blobButtons = screen.getAllByLabelText(/View BLOB data for data/);
    act(() => {
      fireEvent.click(blobButtons[0]!);
    });

    // Dialog should open with column name in heading
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(/BLOB Viewer/);
    expect(heading).toHaveTextContent("data");
  });

  it("closes BLOB viewer dialog when onOpenChange(false) is triggered", () => {
    renderTable();

    // Open the dialog
    const blobButtons = screen.getAllByLabelText(/View BLOB data for data/);
    act(() => {
      fireEvent.click(blobButtons[0]!);
    });

    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();

    // Close it via the close button
    const allButtons = screen.getAllByRole("button");
    const closeBtn = allButtons.find(
      (btn) => btn.querySelector("svg") && btn.textContent?.includes("Close"),
    );
    expect(closeBtn).toBeTruthy();
    act(() => {
      fireEvent.click(closeBtn!);
    });

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("detects various BLOB column types", () => {
    renderTable({ data: BLOB_VARIANTS_DATA, columnOrder: [0, 1, 2] });

    // Both blob_col and binary_col should render as BLOB
    const blobButtons = screen.getAllByText("(BLOB)");
    expect(blobButtons).toHaveLength(2);
  });

  it("does not show BLOB button for non-BLOB columns", () => {
    renderTable();

    // The id column (integer) should NOT have a BLOB button
    expect(
      screen.queryByLabelText(/View BLOB data for id/),
    ).not.toBeInTheDocument();
  });

  it("handles object data in BLOB column", () => {
    renderTable();

    // Row 3 has object data — should still show BLOB button
    const rows = screen.getAllByRole("row");
    const row3 = rows[3]!; // header=0, row0=1, row1=2, row2=3
    const blobButton = row3.querySelector("button");
    expect(blobButton).toBeTruthy();
    expect(blobButton).toHaveTextContent("(BLOB)");
  });
});
