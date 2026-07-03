// Purpose: EditableQueryResultGrid 셀 키보드 nav 가드 (issue #1130 AC1/AC2).
// 공유 useGridRoving 배선 — 정확히 한 셀만 tab stop, Arrow 로 2D nav, Enter/F2
// 로 편집 진입. raw editable grid 는 가상화 없음(모든 row 렌더)이라 결정적. (2026-07-03)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, fireEvent, act } from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

beforeEach(() => {
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

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name", "email"],
};

function renderGrid() {
  render(
    <EditableQueryResultGrid
      result={RESULT}
      connectionId="conn1"
      plan={PLAN}
    />,
  );
}

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

describe("EditableQueryResultGrid roving nav (issue #1130 AC1/AC2)", () => {
  it("only the first data cell is a tab stop initially", () => {
    renderGrid();
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
    renderGrid();
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

  it("Enter on a focused cell starts editing", async () => {
    renderGrid();
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(cell(0, 1)).toHaveAttribute("data-editing", "true");
  });

  it("F2 on a focused cell starts editing", () => {
    renderGrid();
    act(() => cell(1, 2).focus());
    fireEvent.keyDown(cell(1, 2), { key: "F2" });
    expect(cell(1, 2)).toHaveAttribute("data-editing", "true");
  });
});
