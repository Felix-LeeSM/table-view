// AC-238-08 — DOM assertions locking that DataRow applies the text-align
// class (`text-right` / `text-center`) to the grid cell according to the
// column category. The category lookup table itself is verified in
// columnCategory.test; this file is the regression guard for the grid
// renderer wiring.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableData } from "@/types/schema";
import DataGridTable from "./DataGridTable";

function makeData(): TableData {
  return {
    columns: [
      {
        name: "qty",
        data_type: "integer",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
        category: "int",
      },
      {
        name: "price",
        data_type: "numeric",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
        category: "float",
      },
      {
        name: "active",
        data_type: "boolean",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
        category: "bool",
      },
      {
        name: "label",
        data_type: "text",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
        category: "text",
      },
    ],
    rows: [[42, "9.99", true, "widget"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM items LIMIT 100",
  };
}

const baseProps = {
  loading: false,
  sorts: [],
  columnOrder: [0, 1, 2, 3] as number[],
  editingCell: null as { row: number; col: number } | null,
  editValue: "",
  pendingEdits: new Map<string, string | null>(),
  selectedRowIds: new Set<number>(),
  pendingDeletedRowKeys: new Set<string>(),
  pendingNewRows: [] as unknown[][],
  page: 1,
  schema: "public",
  table: "items",
  onSetEditValue: vi.fn(),
  onSetEditNull: vi.fn(),
  onSaveCurrentEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onStartEdit: vi.fn(),
  onSelectRow: vi.fn(),
  onSort: vi.fn(),
  onDeleteRow: vi.fn(),
  onDuplicateRow: vi.fn(),
};

describe("DataGridTable — text-align by ColumnCategory (AC-238-08)", () => {
  it("body cell 의 className 이 column category 에 따라 정렬된다", () => {
    render(<DataGridTable {...baseProps} data={makeData()} />);

    const cells = document.querySelectorAll(
      '[role="row"][aria-rowindex="2"] [role="gridcell"]',
    );
    expect(cells).toHaveLength(4);

    // int → text-right
    expect(cells[0]!.className).toContain("text-right");
    expect(cells[0]!.className).not.toContain("text-center");
    // float → text-right
    expect(cells[1]!.className).toContain("text-right");
    // bool → text-center
    expect(cells[2]!.className).toContain("text-center");
    expect(cells[2]!.className).not.toContain("text-right");
    // text → left-aligned (text-left default — no explicit class)
    expect(cells[3]!.className).not.toContain("text-right");
    expect(cells[3]!.className).not.toContain("text-center");
  });

  it("ColumnInfo.category 가 누락되어도 'unknown' 으로 fallback (좌편향)", () => {
    const data = makeData();
    // Simulates a legacy fixture with no category field.
    const legacyCol = { ...data.columns[0]! };
    delete (legacyCol as { category?: unknown }).category;
    const legacyData: TableData = {
      ...data,
      columns: [legacyCol, ...data.columns.slice(1)],
    };

    render(<DataGridTable {...baseProps} data={legacyData} />);

    const firstCell = document.querySelector(
      '[role="row"][aria-rowindex="2"] [role="gridcell"]',
    );
    expect(firstCell).not.toBeNull();
    // unknown → left-aligned (no text-right / text-center).
    expect(firstCell!.className).not.toContain("text-right");
    expect(firstCell!.className).not.toContain("text-center");
  });
});
