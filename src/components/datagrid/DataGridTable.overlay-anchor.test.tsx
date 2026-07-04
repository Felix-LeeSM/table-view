import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

// Issue #1174 — the pending-edit render overlay must follow the row it was
// anchored to (PK/row identity), not the visual row index. After pagination
// the same rowIdx points at a DIFFERENT row, so the overlay for cell "0-1"
// (captured on page A's row {id:1}) must NOT paint on page B's row {id:2}.

function col(name: string, isPk = false) {
  return {
    name,
    data_type: name === "id" ? "integer" : "text",
    nullable: !isPk,
    default_value: null,
    is_primary_key: isPk,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

const COLUMNS = [col("id", true), col("name")];

function makeData(rows: unknown[][]): TableData {
  return {
    columns: COLUMNS,
    rows,
    total_count: 999,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM public.users",
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: makeData([[1, "Alice"]]),
    loading: false,
    sorts: [],
    columnOrder: [0, 1],
    editingCell: null as { row: number; col: number } | null,
    editValue: "",
    pendingEdits: new Map<string, string | null>(),
    pendingEditRowSnapshots: new Map<string, ReadonlyArray<unknown>>(),
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

function pendingCell() {
  const tds = document.querySelectorAll(
    '[role="row"][aria-rowindex="2"] [role="gridcell"]',
  );
  return tds[1] as HTMLElement;
}

describe("DataGridTable overlay row-identity anchoring (#1174)", () => {
  it("paints the overlay when the anchored row is still at rowIdx", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEdits: new Map([["0-1", "Alicia"]]),
          pendingEditRowSnapshots: new Map([["0-1", [1, "Alice"]]]),
          data: makeData([[1, "Alice"]]),
        })}
      />,
    );
    expect(pendingCell().className).toMatch(/bg-highlight/);
    expect(pendingCell().textContent).toContain("Alicia");
  });

  it("does NOT paint the overlay after pagination moves a different row to rowIdx", () => {
    render(
      <DataGridTable
        {...makeProps({
          // Same cell key + pending value from page A's row {id:1}...
          pendingEdits: new Map([["0-1", "Alicia"]]),
          pendingEditRowSnapshots: new Map([["0-1", [1, "Alice"]]]),
          // ...but the grid now shows page B whose row 0 is {id:2}.
          data: makeData([[2, "Bob"]]),
        })}
      />,
    );
    const cell = pendingCell();
    expect(cell.className).not.toMatch(/bg-highlight/);
    // The real underlying value shows, not the stale pending overlay.
    expect(cell.textContent).toContain("Bob");
    expect(cell.textContent).not.toContain("Alicia");
  });

  it("falls back to index match when no anchor snapshot exists (legacy)", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEdits: new Map([["0-1", "Alicia"]]),
          pendingEditRowSnapshots: new Map<string, ReadonlyArray<unknown>>(),
          data: makeData([[2, "Bob"]]),
        })}
      />,
    );
    // No snapshot → cannot prove the row moved → keep the pre-#1081 behavior.
    expect(pendingCell().className).toMatch(/bg-highlight/);
    expect(pendingCell().textContent).toContain("Alicia");
  });
});
