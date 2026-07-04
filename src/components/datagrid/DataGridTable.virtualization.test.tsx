import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";
import {
  DATAGRID_PERF_PAGE_SIZE,
  makeDataGridPageSize1000Fixture,
  makeDataGridPerfTable,
} from "./DataGridTable.perfFixtures";
import {
  emitAdvisoryTiming,
  measureAdvisoryTiming,
} from "@/lib/perf/advisoryTiming";

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

function makeTable(rowCount: number, executedQuery = "q1"): TableData {
  return makeDataGridPerfTable(rowCount, executedQuery);
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

  it("keeps a deterministic DataGrid page-size 1000 perf fixture available", () => {
    const data = makeDataGridPageSize1000Fixture();
    expect(data.rows).toHaveLength(1_000);
    expect(data.page_size).toBe(DATAGRID_PERF_PAGE_SIZE);
    expect(data.rows[0]).toEqual([0, "name-0"]);
    expect(data.rows[999]).toEqual([999, "name-999"]);
  });

  it("AC-01 — renders ≤ 100 body rows when total rows exceed threshold (1000)", () => {
    render(
      <DataGridTable
        {...makeProps({ data: makeDataGridPageSize1000Fixture() })}
      />,
    );
    const rows = screen.getAllByRole("row");
    // 1 header + ≤ 100 body rows. 600 / 32 ≈ 19 visible + overscan(40, clamped at top since scrolled to index 0) ≈ 59 total.
    expect(rows.length).toBeLessThanOrEqual(101);
    // Sanity: at least the header + a non-trivial slice rendered.
    expect(rows.length).toBeGreaterThan(1);
  });

  it("reports advisory render timing for the deterministic page-size 1000 fixture", async () => {
    let renderedRowCount = 0;
    const report = await measureAdvisoryTiming(
      "DataGridTable deterministic page-size 1000 render",
      5,
      () => {
        const view = render(
          <DataGridTable
            {...makeProps({ data: makeDataGridPageSize1000Fixture() })}
          />,
        );
        const rows = screen.getAllByRole("row");
        renderedRowCount = rows.length;
        expect(rows.length).toBeLessThanOrEqual(101);
        expect(screen.getByRole("grid")).toHaveAttribute(
          "aria-rowcount",
          "1001",
        );
        view.unmount();
      },
    );

    const line = emitAdvisoryTiming(report);
    expect(line).toContain("p50=");
    expect(line).toContain("p95=");
    expect(line).toContain("env=");
    expect(renderedRowCount).toBeGreaterThan(1);
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

// Sprint 349 (2026-05-15) — virtualized branch master/detail row gap was
// the third Sprint 343 deferred item. The virtualizer assumes uniform
// row heights; opening the inline JSON tree adds a variable-height
// detail row that the virtualizer can't measure cleanly. The minimal
// fix is to disable virtualization while `expandedNested` is set so the
// non-virtualized branch (which already renders the master/detail row)
// takes over. On close, virtualization resumes on the next paint.
describe("DataGridTable virtualization + inline tree (Sprint 349)", () => {
  beforeEach(() => {
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

  function makeJsonbTable(rowCount: number): TableData {
    const rows: unknown[][] = [];
    for (let i = 0; i < rowCount; i++) {
      rows.push([i, { role: `r-${i}` }]);
    }
    return {
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
          name: "meta",
          data_type: "jsonb",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
      rows,
      total_count: rowCount,
      page: 1,
      page_size: rowCount,
      executed_query: "q-jsonb-1",
    };
  }

  it("renders a master/detail row on a >200-row virtualized grid when a jsonb cell is expanded", async () => {
    const user = (await import("@testing-library/user-event")).default;
    const u = user.setup();
    const props = {
      ...makeProps(),
      data: makeJsonbTable(1000),
      columnOrder: [0, 1],
    };
    render(<DataGridTable {...props} />);

    // Toggle the first visible jsonb cell sentinel button. The virtualized
    // window starts at row 0 + overscan; rdb-nested-toggle-0-1 exists for
    // row 0's meta cell.
    const toggle = screen.getByTestId("rdb-nested-toggle-0-1");
    await u.click(toggle);

    // After expanding, virtualization is paused, so the detail row appears.
    expect(screen.getByTestId("rdb-nested-detail-row-0")).toBeInTheDocument();
    // The DocumentTreePanel mounts inside the detail row.
    expect(screen.getByTestId("document-tree-panel")).toBeInTheDocument();
  }, 30_000);

  it("closing the detail row restores virtualization on the next paint", async () => {
    const user = (await import("@testing-library/user-event")).default;
    const u = user.setup();
    const props = {
      ...makeProps(),
      data: makeJsonbTable(1000),
      columnOrder: [0, 1],
    };
    render(<DataGridTable {...props} />);

    const toggle = screen.getByTestId("rdb-nested-toggle-0-1");
    await u.click(toggle);
    expect(screen.getByTestId("rdb-nested-detail-row-0")).toBeInTheDocument();

    // Close (toggle a second time to dismiss).
    await u.click(screen.getByTestId("rdb-nested-toggle-0-1"));
    expect(
      screen.queryByTestId("rdb-nested-detail-row-0"),
    ).not.toBeInTheDocument();
    // Virtualization is back: total rows in the DOM are bounded.
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThanOrEqual(101);
  }, 30_000);
});
