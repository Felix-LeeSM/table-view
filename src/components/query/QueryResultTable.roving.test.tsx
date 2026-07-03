// Purpose: read-only QueryResultTable 셀 키보드 nav 가드 (issue #1130 AC1/AC4).
// AC4 는 role="table" 강등을 허용하나 일관성/키보드 완결을 위해 role="grid" 를
// 유지하고 공유 useGridRoving 을 배선한다. 읽기 전용이라 편집은 없고 Enter/F2 는
// double-click 과 동일하게 cell-detail dialog 를 연다. (2026-07-03)

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryResultTable } from "./QueryResultTable";
import type { QueryResult } from "@/types/query";

const RESULT: QueryResult = {
  columns: [
    { name: "region", dataType: "text", category: "text" },
    { name: "total", dataType: "bigint", category: "int" },
  ],
  rows: [
    ["North", 4],
    ["South", 7],
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

describe("QueryResultTable roving nav (issue #1130 AC1/AC4)", () => {
  it("keeps role=grid and makes only the first cell a tab stop", () => {
    render(<QueryResultTable result={RESULT} />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 1)).toHaveAttribute("tabindex", "-1");
    expect(cell(1, 0)).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight then ArrowDown move focus + tabIndex", async () => {
    render(<QueryResultTable result={RESULT} />);
    act(() => cell(0, 0).focus());

    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
    await flushRaf();
    expect(cell(0, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 1)).toHaveFocus();

    fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
    await flushRaf();
    expect(cell(1, 1)).toHaveFocus();
  });

  it("Enter on a focused cell opens the cell-detail dialog", () => {
    render(<QueryResultTable result={RESULT} />);
    act(() => cell(0, 0).focus());
    fireEvent.keyDown(cell(0, 0), { key: "Enter" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("region");
    expect(dialog.textContent).toContain("North");
  });
});
