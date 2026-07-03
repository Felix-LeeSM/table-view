// Purpose: RDB DataGrid 행 선택 a11y 가드 (issue #1130 AC2). 선택된 행은
// aria-selected="true", 그 외 "false". focus 된 셀에서 Space 로 행 선택
// (onSelectRow) — modifier 는 click 과 동일하게 전달. Document 그리드는 이미
// aria-selected 를 노출하므로 RDB 를 맞춰 일관성 확보. (2026-07-03)

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
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
  executed_query: "SELECT * FROM public.users",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnOrder: [0, 1],
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
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

function cell(row: number, col: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DataGridTable row selection a11y (issue #1130 AC2)", () => {
  it("selected row exposes aria-selected=true, others false", () => {
    render(<DataGridTable {...makeProps({ selectedRowIds: new Set([1]) })} />);
    const row0 = cell(0, 0).closest('[role="row"]')!;
    const row1 = cell(1, 0).closest('[role="row"]')!;
    expect(row0).toHaveAttribute("aria-selected", "false");
    expect(row1).toHaveAttribute("aria-selected", "true");
  });

  it("Space on a focused cell selects the row", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ onSelectRow })} />);
    act(() => cell(0, 0).focus());
    fireEvent.keyDown(cell(0, 0), { key: " " });
    expect(onSelectRow).toHaveBeenCalledWith(0, false, false);
  });

  it("Ctrl+Space forwards modifiers for multi-select toggle", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ onSelectRow })} />);
    act(() => cell(1, 1).focus());
    fireEvent.keyDown(cell(1, 1), { key: " ", ctrlKey: true });
    expect(onSelectRow).toHaveBeenCalledWith(1, true, false);
  });
});
