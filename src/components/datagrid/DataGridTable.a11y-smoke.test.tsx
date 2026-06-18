import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

const DATA: TableData = {
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
  rows: [[1, "Alice"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: DATA,
    loading: false,
    sorts: [],
    columnWidths: {},
    columnOrder: [0, 1],
    editingCell: null as { row: number; col: number } | null,
    editValue: null as string | null,
    pendingEdits: new Map<string, string | null>(),
    pendingEditErrors: new Map<string, string>(),
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

describe("DataGridTable critical accessibility smoke", () => {
  it("keeps grid roles, gridcells, edit textbox, and live edit error wired", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alicia",
          pendingEdits: new Map([["0-1", "Alicia"]]),
          pendingEditErrors: new Map([["0-1", "Name must be unique"]]),
        })}
      />,
    );

    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "2");
    expect(grid).toHaveAttribute("aria-colcount", "2");
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(2);

    expect(
      within(grid).getByRole("textbox", { name: "Editing name" }),
    ).toHaveValue("Alicia");
    const alert = within(grid).getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "polite");
    expect(alert).toHaveTextContent("Name must be unique");
  });
});
