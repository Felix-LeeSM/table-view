// Purpose: shared SQL-result grid primitive — ARIA grid-roles integrity across the
//   read-only (QueryResultTable) and editable (EditableQueryResultGrid) mounts.
//   Consolidates the byte-identical QueryResultGrid.aria-grid + EditableQueryResultGrid
//   .aria-grid copies (issue #1622, P9 subset duplication) into one describe.each over
//   both mounts. DataGridTable.aria-grid.test.tsx keeps its RDB-only cases (column
//   reorder, pendingNewRows) and stays separate. (2026-07-22)
// Reason: Sprint 260 AC-260-03 — grid ARIA integrity (aria-rowcount/colcount,
//   aria-rowindex, aria-colindex in visual order, min-width max-content overflow
//   guard, empty-state single gridcell). Read-only + editable share visual==data
//   order (no reorder), so a single parametrized contract covers both.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, within } from "@testing-library/react";
import type { QueryResult } from "@/types/query";
import { QUERY_GRID_VARIANTS } from "./__tests__/queryGridPrimitiveVariants";

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

describe.each(QUERY_GRID_VARIANTS)(
  "$name ARIA grid roles (Sprint 260 AC-260-03)",
  ({ element }) => {
    it("outer role=grid exposes aria-rowcount (1 + rows) + aria-colcount (cols)", () => {
      render(element(RESULT));
      const grid = screen.getByRole("grid");
      expect(grid).toHaveAttribute("aria-rowcount", "3"); // 1 header + 2 rows
      expect(grid).toHaveAttribute("aria-colcount", "3");
    });

    it("header row is aria-rowindex=1, body rows continue from 2", () => {
      render(element(RESULT));
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
      expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
      expect(rows[2]).toHaveAttribute("aria-rowindex", "3");
    });

    it("header columnheader aria-colindex is visual order 1..N", () => {
      render(element(RESULT));
      const headers = screen.getAllByRole("columnheader");
      expect(headers).toHaveLength(3);
      expect(headers[0]).toHaveAttribute("aria-colindex", "1");
      expect(headers[1]).toHaveAttribute("aria-colindex", "2");
      expect(headers[2]).toHaveAttribute("aria-colindex", "3");
      expect(headers[0]).toHaveTextContent("id");
      expect(headers[1]).toHaveTextContent("name");
      expect(headers[2]).toHaveTextContent("email");
    });

    it("body gridcell aria-colindex is visual order 1..N", () => {
      render(element(RESULT));
      const firstBody = screen.getAllByRole("row")[1]!;
      const cells = within(firstBody).getAllByRole("gridcell");
      expect(cells).toHaveLength(3);
      expect(cells[0]).toHaveAttribute("aria-colindex", "1");
      expect(cells[1]).toHaveAttribute("aria-colindex", "2");
      expect(cells[2]).toHaveAttribute("aria-colindex", "3");
      expect(cells[0]).toHaveTextContent("1");
      expect(cells[1]).toHaveTextContent("Alice");
      expect(cells[2]).toHaveTextContent("alice@example.com");
    });

    // Sprint 261 — horizontal overflow: row box must span the grid tracks
    // (min-width: max-content) so hover:bg-muted / border-b draw to the end.
    it("every row has min-width: max-content (overflow bg regression guard)", () => {
      render(element(RESULT));
      for (const r of screen.getAllByRole("row")) {
        expect((r as HTMLElement).style.minWidth).toBe("max-content");
      }
    });

    it("empty result renders header + a single role=gridcell (aria-colindex=1)", () => {
      const emptyResult: QueryResult = { ...RESULT, rows: [], totalCount: 0 };
      render(element(emptyResult));
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(2); // header + empty row
      const cells = within(rows[1]!).getAllByRole("gridcell");
      expect(cells).toHaveLength(1);
      expect(cells[0]).toHaveAttribute("aria-colindex", "1");
      expect(cells[0]).toHaveTextContent("No data");
    });
  },
);
