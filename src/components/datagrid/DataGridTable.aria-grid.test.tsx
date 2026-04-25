import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    editingCell: null as { row: number; col: number } | null,
    editValue: null as string | null,
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

describe("DataGridTable ARIA grid roles & indices (sprint-106)", () => {
  it("the <table> container exposes role=grid with aria-rowcount and aria-colcount", () => {
    render(<DataGridTable {...makeProps()} />);
    const grid = screen.getByRole("grid");
    // 1 header + 3 data + 0 pending = 4 rows
    expect(grid).toHaveAttribute("aria-rowcount", "4");
    expect(grid).toHaveAttribute("aria-colcount", "3");
  });

  it("header <th> cells have role=columnheader and aria-colindex 1..N in visual order", () => {
    render(<DataGridTable {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveAttribute("aria-colindex", "1");
    expect(headers[1]).toHaveAttribute("aria-colindex", "2");
    expect(headers[2]).toHaveAttribute("aria-colindex", "3");
    // Visual order matches data column order under default columnOrder.
    expect(headers[0]).toHaveTextContent("id");
    expect(headers[1]).toHaveTextContent("name");
    expect(headers[2]).toHaveTextContent("email");
  });

  it("body <tr> elements carry role=row and aria-rowindex starting at 2 (header is 1)", () => {
    render(<DataGridTable {...makeProps()} />);
    const rows = screen.getAllByRole("row");
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    expect(rows[2]).toHaveAttribute("aria-rowindex", "3");
    expect(rows[3]).toHaveAttribute("aria-rowindex", "4");
  });

  it("body <td> cells carry role=gridcell and aria-colindex matching visual order", () => {
    render(<DataGridTable {...makeProps()} />);
    const rows = screen.getAllByRole("row");
    // Pull the first data row (skip header at index 0).
    const firstDataRow = rows[1]!;
    const cells = within(firstDataRow).getAllByRole("gridcell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[1]).toHaveAttribute("aria-colindex", "2");
    expect(cells[2]).toHaveAttribute("aria-colindex", "3");
    expect(cells[0]).toHaveTextContent("1");
    expect(cells[1]).toHaveTextContent("Alice");
    expect(cells[2]).toHaveTextContent("alice@example.com");
  });

  it("after column reorder, aria-colindex tracks visual position (not data column index)", () => {
    // Visual order: name (1), id (0), email (2)
    render(<DataGridTable {...makeProps({ columnOrder: [1, 0, 2] })} />);

    const headers = screen.getAllByRole("columnheader");
    // Visual position 1 → "name" column.
    expect(headers[0]).toHaveAttribute("aria-colindex", "1");
    expect(headers[0]).toHaveTextContent("name");
    expect(headers[1]).toHaveAttribute("aria-colindex", "2");
    expect(headers[1]).toHaveTextContent("id");
    expect(headers[2]).toHaveAttribute("aria-colindex", "3");
    expect(headers[2]).toHaveTextContent("email");

    const firstDataRow = screen.getAllByRole("row")[1]!;
    const cells = within(firstDataRow).getAllByRole("gridcell");
    // Visual position 1 corresponds to data column "name" (Alice), not "id".
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[0]).toHaveTextContent("Alice");
    expect(cells[1]).toHaveAttribute("aria-colindex", "2");
    expect(cells[1]).toHaveTextContent("1");
    expect(cells[2]).toHaveAttribute("aria-colindex", "3");
    expect(cells[2]).toHaveTextContent("alice@example.com");
  });

  it("pendingNewRows append <tr role=row> with aria-rowindex = dataRows + newIdx + 2", () => {
    const pendingNewRows: unknown[][] = [[null, "NewName", "new@example.com"]];
    render(<DataGridTable {...makeProps({ pendingNewRows })} />);

    const grid = screen.getByRole("grid");
    // 1 header + 3 data + 1 pending = 5
    expect(grid).toHaveAttribute("aria-rowcount", "5");

    const rows = screen.getAllByRole("row");
    // Last row is the pending row.
    const pendingRow = rows[rows.length - 1]!;
    // dataRows (3) + newIdx (0) + 2 = 5
    expect(pendingRow).toHaveAttribute("aria-rowindex", "5");

    const pendingCells = within(pendingRow).getAllByRole("gridcell");
    expect(pendingCells).toHaveLength(3);
    expect(pendingCells[0]).toHaveAttribute("aria-colindex", "1");
    expect(pendingCells[1]).toHaveAttribute("aria-colindex", "2");
    expect(pendingCells[2]).toHaveAttribute("aria-colindex", "3");
  });

  it("empty-state row carries role=row + a single role=gridcell with aria-colindex=1", () => {
    const emptyData: TableData = { ...MOCK_DATA, rows: [], total_count: 0 };
    render(<DataGridTable {...makeProps({ data: emptyData })} />);

    const rows = screen.getAllByRole("row");
    // 1 header + 1 empty-state row
    expect(rows).toHaveLength(2);
    const emptyRow = rows[1]!;
    const cells = within(emptyRow).getAllByRole("gridcell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[0]).toHaveTextContent("Table is empty");
  });
});
