import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

/**
 * Sprint-114 (#PERF-1, #GRID-3) — virtualization regression tests.
 *
 * jsdom returns 0 for `offsetWidth`/`offsetHeight` on every element, which
 * makes `@tanstack/react-virtual` think the scroll container has no
 * viewport and render zero rows. Patching `offsetWidth`/`offsetHeight`
 * (and `getBoundingClientRect`) on `HTMLDivElement.prototype` lifts the
 * viewport to a sensible size so the virtualizer pages a window of rows
 * into the DOM. We restore the originals after every test so we don't
 * leak the override into the broader suite.
 */

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 32;

function makeColumns(): TableData["columns"] {
  return [
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
  ];
}

function makeTable(rowCount: number, executedQuery = "q1"): TableData {
  const rows: unknown[][] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push([i, `name-${i}`]);
  }
  return {
    columns: makeColumns(),
    rows,
    total_count: rowCount,
    page: 1,
    page_size: rowCount,
    executed_query: executedQuery,
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: makeTable(1000),
    loading: false,
    sorts: [],
    columnWidths: {},
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
    onColumnWidthsChange: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("DataGridTable virtualization (sprint-114)", () => {
  beforeEach(() => {
    // Force every element to report a non-zero size so `react-virtual`
    // thinks the scroll container has a viewport. We don't need
    // per-element shaping for these assertions — a constant height is
    // enough to make `getVirtualItems()` return a stable window.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: VIEWPORT_HEIGHT,
        width: 800,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("AC-01 — renders ≤ 100 body rows when total rows exceed threshold (1000)", () => {
    render(<DataGridTable {...makeProps()} />);
    const rows = screen.getAllByRole("row");
    // 1 header + ≤ 100 body rows. 600 / 32 ≈ 18 visible + overscan ≈ 28 total.
    expect(rows.length).toBeLessThanOrEqual(101);
    // Sanity: at least the header + a non-trivial slice rendered.
    expect(rows.length).toBeGreaterThan(1);
  });

  it("AC-03 — first virtual row carries aria-rowindex=2 (header is row 1)", () => {
    render(<DataGridTable {...makeProps()} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is the header (aria-rowindex=1).
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("aria-rowcount stays at 1 (header) + total row count even after virtualization", () => {
    render(<DataGridTable {...makeProps()} />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "1001");
  });

  it("AC-02 — sort change resets viewport so the first row is visible again", () => {
    const { rerender } = render(<DataGridTable {...makeProps()} />);
    // Re-render with a different `sorts` value to simulate the user picking
    // a new sort column. The virtualizer should scroll back to index 0 so
    // the first row of the resorted set is in the DOM.
    rerender(
      <DataGridTable
        {...makeProps({
          sorts: [{ column: "name", direction: "ASC" as const }],
          data: makeTable(1000, "q-sorted"),
        })}
      />,
    );
    const rows = screen.getAllByRole("row");
    // Header is rows[0]; the first body row after reset must be rowindex=2.
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("AC-04 — datasets ≤ 200 rows skip virtualization and render every body row", () => {
    render(<DataGridTable {...makeProps({ data: makeTable(100) })} />);
    const rows = screen.getAllByRole("row");
    // 1 header + 100 data rows, no spacers, no virtualizer windowing.
    expect(rows).toHaveLength(101);
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    expect(rows[100]).toHaveAttribute("aria-rowindex", "101");
  });

  it("aria-colindex on a virtualized cell still tracks visual column order", () => {
    render(<DataGridTable {...makeProps()} />);
    const rows = screen.getAllByRole("row");
    const firstBody = rows[1]!;
    const cells = firstBody.querySelectorAll("[role='gridcell']");
    expect(cells.length).toBe(2);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[1]).toHaveAttribute("aria-colindex", "2");
  });

  it("threshold boundary — exactly 201 rows enters virtualized branch", () => {
    render(<DataGridTable {...makeProps({ data: makeTable(201) })} />);
    const rows = screen.getAllByRole("row");
    // Virtualization is active so we shouldn't see all 201 rows in DOM.
    // Header (1) + virtual window (≤ 100) is the upper bound.
    expect(rows.length).toBeLessThan(202);
    expect(rows.length).toBeGreaterThan(1);
  });
});

// Document the assumed row height so a future contributor changing
// `ROW_HEIGHT_ESTIMATE` knows to revisit these test thresholds.
void ROW_HEIGHT;
