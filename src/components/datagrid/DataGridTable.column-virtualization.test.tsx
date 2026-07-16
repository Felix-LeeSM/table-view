import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

/**
 * Issue #1446 — DataGridTable column virtualization + DataRow memo.
 *
 * Two regressions this pins:
 *   - F6: a row `map`ped every column (200 cols x 50 rows = 10k DOM cells).
 *     Wide grids must now render only a windowed slice of columns per row.
 *   - F13: `DataRow` had no memo + `rowCtx` carried `pendingEdits`, so a
 *     single edit re-rendered every visible row. Now only the edited row
 *     re-renders.
 *
 * The memo assertions count `rowIdentityKey` (called exactly once per
 * DataRow body execution) via a module mock, so a re-render delta is exact.
 */

const h = vi.hoisted(() => ({ rowIdentityCalls: 0 }));

vi.mock("./dataGridEditFsm", async (importActual) => {
  const actual = await importActual<typeof import("./dataGridEditFsm")>();
  return {
    ...actual,
    rowIdentityKey: (...args: Parameters<typeof actual.rowIdentityKey>) => {
      h.rowIdentityCalls++;
      return actual.rowIdentityKey(...args);
    },
  };
});

function makeWideTable(rowCount: number, colCount: number): TableData {
  const columns = Array.from({ length: colCount }, (_, c) => ({
    name: `c${c}`,
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: c === 0,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  }));
  const rows = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => `r${r}c${c}`),
  );
  return {
    columns,
    rows,
    total_count: rowCount,
    page: 1,
    page_size: rowCount,
    executed_query: "q-wide",
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const colCount = 200;
  return {
    data: makeWideTable(5, colCount),
    loading: false,
    sorts: [],
    columnOrder: Array.from({ length: colCount }, (_, i) => i),
    editingCell: null as { row: number; col: number } | null,
    editValue: null as string | null,
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "wide",
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

// jsdom reports clientWidth=0, which would make the column window collapse.
// Patch it to a real viewport width so the window computes a slice.
const originalClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  h.rowIdentityCalls = 0;
});

afterEach(() => {
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .clientWidth;
  }
});

describe("DataGridTable column virtualization (#1446 AC1)", () => {
  it("renders only a windowed column slice per row, not all 200", () => {
    render(<DataGridTable {...makeProps()} />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-colcount", "200");

    const bodyRow = screen.getAllByRole("row")[1]!; // row 0 (header is 0th)
    const cells = bodyRow.querySelectorAll('[role="gridcell"]');
    // A 800px viewport at scroll 0 shows a handful of ~200px columns plus
    // overscan — far below the full 200.
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(30);
    // The left-most column is in the window.
    expect(
      bodyRow.querySelector('[role="gridcell"][aria-colindex="1"]'),
    ).not.toBeNull();
    // A far-right column is NOT rendered.
    expect(
      bodyRow.querySelector('[role="gridcell"][aria-colindex="180"]'),
    ).toBeNull();
  });

  it("keeps the editing column rendered even when it is outside the window", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 150 },
          editValue: "x",
        })}
      />,
    );
    const bodyRow = screen.getAllByRole("row")[1]!;
    // col 150 -> aria-colindex 151. Outside the scroll window but force-kept
    // so the editor input never unmounts (edit state / focus preserved).
    const editingCell = bodyRow.querySelector(
      '[role="gridcell"][aria-colindex="151"]',
    );
    expect(editingCell).not.toBeNull();
    expect(editingCell!.getAttribute("data-editing")).toBe("true");
  });
});

describe("DataGridTable DataRow memo (#1446 AC2/AC3)", () => {
  function makeNarrowProps(overrides: Record<string, unknown> = {}) {
    // 6 rows x 2 cols — below the column-virtualization threshold so this
    // isolates the per-row memo behaviour from column windowing.
    const data: TableData = {
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
      rows: Array.from({ length: 6 }, (_, r) => [r, `name-${r}`]),
      total_count: 6,
      page: 1,
      page_size: 6,
      executed_query: "q-narrow",
    };
    return { ...makeProps({ data, columnOrder: [0, 1] }), ...overrides };
  }

  it("re-renders only the edited row when a pending edit is committed", () => {
    const props = makeNarrowProps();
    const { rerender } = render(<DataGridTable {...props} />);

    // Reset after mount; measure only the re-render triggered by the edit.
    h.rowIdentityCalls = 0;
    rerender(
      <DataGridTable
        {...props}
        pendingEdits={new Map<string, string | null>([["0-1", "edited"]])}
      />,
    );
    // Only row 0's pending slice changed → only row 0 re-renders.
    expect(h.rowIdentityCalls).toBe(1);
  });

  it("re-renders only the editing row on an editValue keystroke", () => {
    const props = makeNarrowProps({
      editingCell: { row: 2, col: 1 },
      editValue: "a",
    });
    const { rerender } = render(<DataGridTable {...props} />);

    h.rowIdentityCalls = 0;
    rerender(<DataGridTable {...props} editValue="ab" />);
    expect(h.rowIdentityCalls).toBe(1);
  });
});
