// Purpose: shared SQL-result grid primitive — cell keyboard roving (issue #1130)
//   across the read-only (QueryResultTable) and editable (EditableQueryResultGrid)
//   mounts. Both wire the same `useGridRoving`, so the tab-stop + arrow-nav contract
//   is asserted once via describe.each; the Enter/F2 activation branch differs per
//   mount (read-only opens the cell-detail dialog; editable enters edit mode) and
//   stays per-mount. Consolidates EditableQueryResultGrid.roving +
//   QueryResultTable.roving (issue #1622, P9 duplication). (2026-07-22)
// Reason: issue #1130 AC1/AC2/AC4 — exactly one cell is a tab stop, Arrow keys move
//   focus + tabIndex in 2D; Enter/F2 activate per paradigm.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { QueryResult } from "@/types/query";
import {
  QUERY_GRID_VARIANTS,
  READONLY_VARIANT,
  EDITABLE_VARIANT,
} from "./__tests__/queryGridPrimitiveVariants";

beforeEach(() => {
  // Editable variant runs edit statements through Tauri; read-only ignores it.
  setupTauriMock({
    executeQuery: vi.fn(async () => ({})),
    executeQueryBatch: vi.fn(async () => []),
  });
});

const RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "int" },
    { name: "name", dataType: "text", category: "text" },
    { name: "email", dataType: "varchar", category: "text" },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
  ],
  totalCount: 2,
  executionTimeMs: 1,
  queryType: "select",
};

function cell(row: number, col: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe.each(QUERY_GRID_VARIANTS)(
  "$name roving nav (issue #1130 AC1/AC2)",
  ({ element }) => {
    it("only the first data cell is a tab stop initially", () => {
      render(element(RESULT));
      expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
      for (const [r, c] of [
        [0, 1],
        [1, 0],
        [1, 2],
      ] as const) {
        expect(cell(r, c)).toHaveAttribute("tabindex", "-1");
      }
    });

    it("ArrowRight then ArrowDown move focus + tabIndex", async () => {
      render(element(RESULT));
      act(() => cell(0, 0).focus());

      fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
      await flushRaf();
      expect(cell(0, 1)).toHaveAttribute("tabindex", "0");
      expect(cell(0, 1)).toHaveFocus();

      fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
      await flushRaf();
      expect(cell(1, 1)).toHaveAttribute("tabindex", "0");
      expect(cell(1, 1)).toHaveFocus();
    });
  },
);

// Enter/F2 activation branch — read-only opens the cell-detail dialog (AC4: the
// grid stays role=grid instead of downgrading to a table, so the keyboard path
// mirrors double-click).
describe("QueryResultTable roving — read-only activation (issue #1130 AC4)", () => {
  it("Enter on a focused cell opens the cell-detail dialog", () => {
    render(READONLY_VARIANT.element(RESULT));
    act(() => cell(0, 2).focus());
    fireEvent.keyDown(cell(0, 2), { key: "Enter" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("email");
    expect(dialog.textContent).toContain("alice@example.com");
  });
});

// Editable activation — Enter and F2 both enter edit mode on the focused cell.
describe("EditableQueryResultGrid roving — editable activation (issue #1130 AC2)", () => {
  it("Enter on a focused cell starts editing", () => {
    render(EDITABLE_VARIANT.element(RESULT));
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(cell(0, 1)).toHaveAttribute("data-editing", "true");
  });

  it("F2 on a focused cell starts editing", () => {
    render(EDITABLE_VARIANT.element(RESULT));
    act(() => cell(1, 2).focus());
    fireEvent.keyDown(cell(1, 2), { key: "F2" });
    expect(cell(1, 2)).toHaveAttribute("data-editing", "true");
  });
});
