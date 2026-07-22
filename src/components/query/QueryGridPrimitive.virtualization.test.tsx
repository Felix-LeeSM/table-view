// Purpose: shared SQL-result grid primitive — @tanstack row virtualization across the
//   read-only (QueryResultTable) and editable (EditableQueryResultGrid) mounts.
//   Consolidates the 7 byte-identical cases duplicated between
//   QueryResultTable.virtualization + EditableQueryResultGrid.virtualization (issue
//   #1622, P9 duplication) into one describe.each; the two genuinely-unique cases stay
//   as per-mount blocks. (2026-07-22)
// Reason: Issue #1442 — bounded DOM window past the 200-row threshold, aria-rowcount
//   spans the full result while virtualized, threshold boundary (200 renders all / 201
//   virtualizes), and #1477 B2 scroll preservation (same-SQL refetch keeps position, a
//   different executed SQL resets to top). jsdom reports 0 offsetWidth/Height so the
//   virtualizer sees no viewport — the prototype patch below stands one up.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent } from "@testing-library/react";
import type { QueryResult } from "@/types/query";
import {
  QUERY_GRID_VARIANTS,
  READONLY_VARIANT,
  EDITABLE_VARIANT,
} from "./__tests__/queryGridPrimitiveVariants";

const VIEWPORT_HEIGHT = 600;

function makeResult(rowCount: number): QueryResult {
  return {
    columns: [
      { name: "id", dataType: "integer", category: "int" },
      { name: "name", dataType: "text", category: "text" },
    ],
    rows: Array.from({ length: rowCount }, (_, i) => [i, `name-${i}`]),
    totalCount: rowCount,
    executionTimeMs: 1,
    queryType: "select",
  };
}

// jsdom has no layout: scrollTop writes and element.scrollTo are no-ops. Wire the
// container instance so (1) user scroll = scrollTop write + scroll event, (2) the
// virtualizer's scrollToIndex → element.scrollTo are both observable (#1477 B2).
function wireScrollable(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0,
  });
  container.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    (container as unknown as { scrollTop: number }).scrollTop = top;
    fireEvent.scroll(container);
  }) as typeof container.scrollTo;
}

function scrollContainerTo(container: HTMLElement, top: number) {
  (container as unknown as { scrollTop: number }).scrollTop = top;
  fireEvent.scroll(container);
}

function firstBodyRowIndex(): number {
  return Number(screen.getAllByRole("row")[1]!.getAttribute("aria-rowindex"));
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

beforeEach(() => {
  // Editable variant runs edit statements through Tauri; read-only ignores it.
  setupTauriMock({
    executeQuery: vi.fn(async () => ({})),
    executeQueryBatch: vi.fn(async () => []),
  });
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

describe.each(QUERY_GRID_VARIANTS)(
  "$name virtualization (#1442)",
  ({ element }) => {
    it("renders a bounded row window when rows exceed the threshold (1000)", () => {
      render(element(makeResult(1000)));
      const rows = screen.getAllByRole("row");
      // 1 header + virtual window (≈ 19 visible + 24 overscan) ≤ 101.
      expect(rows.length).toBeLessThanOrEqual(101);
      expect(rows.length).toBeGreaterThan(1);
    });

    it("keeps aria-rowcount at 1 (header) + total rows while virtualized", () => {
      render(element(makeResult(1000)));
      expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
    });

    it("first virtual row carries aria-rowindex=2 (header is row 1)", () => {
      render(element(makeResult(1000)));
      const rows = screen.getAllByRole("row");
      expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
      expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    });

    it("threshold boundary — exactly 200 rows renders every body row", () => {
      render(element(makeResult(200)));
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(201);
      expect(rows[200]).toHaveAttribute("aria-rowindex", "201");
    });

    it("threshold boundary — 201 rows enters the virtualized branch", () => {
      render(element(makeResult(201)));
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBeLessThan(202);
      expect(rows.length).toBeGreaterThan(1);
    });

    // #1477 review B2 — same executed SQL (new result identity, e.g. commit-then-
    // refetch) preserves scroll; a different SQL resets to the top (DataGridTable #1369).
    it("B2 — same-SQL refetch (new result identity) preserves scroll position", () => {
      const sql = "SELECT * FROM t";
      const { rerender } = render(element(makeResult(1000), { sql }));
      const grid = screen.getByRole("grid");
      wireScrollable(grid);
      scrollContainerTo(grid, 12800);
      expect(firstBodyRowIndex()).toBeGreaterThan(2);

      rerender(element(makeResult(1000), { sql }));
      expect(firstBodyRowIndex()).toBeGreaterThan(2);
    });

    it("B2 — a different executed SQL resets scroll to the top", () => {
      const { rerender } = render(
        element(makeResult(1000), { sql: "SELECT * FROM t" }),
      );
      const grid = screen.getByRole("grid");
      wireScrollable(grid);
      scrollContainerTo(grid, 12800);
      expect(firstBodyRowIndex()).toBeGreaterThan(2);

      rerender(element(makeResult(1000), { sql: "SELECT * FROM t2" }));
      expect(firstBodyRowIndex()).toBe(2);
    });
  },
);

// Read-only unique — a row-cap hit yields exactly cap-sized rows + `truncated`.
// The banner is guarded by QueryResultGrid.rowcap-banner.test.tsx; here we pin
// that a truncated large result still renders a bounded window.
describe("QueryResultTable virtualization — read-only unique (#1442)", () => {
  it("truncated (row-cap hit) result still renders a bounded window", () => {
    const result = { ...makeResult(1000), truncated: true };
    render(READONLY_VARIANT.element(result));
    expect(screen.getAllByRole("row").length).toBeLessThanOrEqual(101);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
  });
});

// Editable unique — the edit input can unmount when its row scrolls out of the
// virtual window; on remount it must not steal focus back (effect-keyed focus).
describe("EditableQueryResultGrid virtualization — editable unique (#1442)", () => {
  it("B1 — remounting the editing row does not steal focus back to the input", () => {
    render(EDITABLE_VARIANT.element(makeResult(1000)));
    const grid = screen.getByRole("grid");
    wireScrollable(grid);

    const cell = grid.querySelector('[data-grid-row="0"][data-grid-col="1"]')!;
    fireEvent.doubleClick(cell);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    // Editing starts with focus on the input (edit-start effect).
    expect(input).toHaveFocus();

    // Push the editing row out of the window — input unmounts, focus drops to body.
    scrollContainerTo(grid, 12800);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    // Back into view — edit value restores but focus is NOT stolen back.
    scrollContainerTo(grid, 0);
    const restored = screen.getByRole<HTMLInputElement>("textbox");
    expect(restored).toHaveValue("name-0");
    expect(restored).not.toHaveFocus();
  });
});
