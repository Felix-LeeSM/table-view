// Purpose: shared SQL-result grid primitive — drag column resize across the
//   read-only (QueryResultTable) and editable (EditableQueryResultGrid) mounts.
//   Consolidates the byte-identical QueryResultGrid.column-resize +
//   EditableQueryResultGrid.column-resize copies (issue #1622, P9 duplication) into
//   one describe.each over both mounts. (2026-07-22)
// Reason: Sprint 260 AC-260-02 — resize handle per column; drag → mouseup grows only
//   its own `--cols` px track (neighbour unchanged); query results have no stable
//   identity so neither mount persists widths to localStorage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, act } from "@testing-library/react";
import type { QueryResult } from "@/types/query";
import { QUERY_GRID_VARIANTS } from "./__tests__/queryGridPrimitiveVariants";

beforeEach(() => {
  setupTauriMock({
    executeQuery: vi.fn(async () => ({})),
    executeQueryBatch: vi.fn(async () => []),
  });
});

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

const RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "int" },
    { name: "name", dataType: "text", category: "text" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  totalCount: 2,
  executionTimeMs: 1,
  queryType: "select",
};

function getResizeHandles(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(".cursor-col-resize"),
  ) as HTMLElement[];
}

function getOuterGrid(): HTMLElement {
  const el = document.querySelector('[role="grid"]') as HTMLElement | null;
  if (!el) throw new Error("outer role=grid not found");
  return el;
}

function parseColsPx(outer: HTMLElement): number[] {
  const raw = outer.style.getPropertyValue("--cols").trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((tok) => parseFloat(tok));
}

describe.each(QUERY_GRID_VARIANTS)(
  "$name — column resize (Sprint 260 AC-260-02)",
  ({ element }) => {
    it("header exposes a resize handle per column", () => {
      render(element(RESULT));
      expect(getResizeHandles().length).toBe(2);
    });

    it("drag → mouseup grows only its own --cols px track, neighbour unchanged", () => {
      render(element(RESULT));

      const handle = getResizeHandles()[0]!;
      const before = parseColsPx(getOuterGrid());
      expect(before.length).toBe(2);

      act(() => {
        handle.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: 100,
          }),
        );
      });
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mousemove", { bubbles: true, clientX: 250 }),
        );
      });
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, clientX: 250 }),
        );
      });

      const after = parseColsPx(getOuterGrid());
      expect(after.length).toBe(2);
      expect(after[0]!).toBeGreaterThan(before[0]!);
      expect(after[1]!).toBe(before[1]!);
    });

    it("does not persist widths to localStorage (no stable result identity)", () => {
      window.localStorage.clear();
      render(element(RESULT));

      const handle = getResizeHandles()[0]!;
      act(() => {
        handle.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: 100,
          }),
        );
      });
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mousemove", { bubbles: true, clientX: 240 }),
        );
      });
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, clientX: 240 }),
        );
      });

      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        expect(key?.startsWith("column-widths:")).toBe(false);
      }
    });
  },
);
