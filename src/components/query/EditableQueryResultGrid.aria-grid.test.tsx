// Sprint 260 (2026-05-11) — AC-260-03: EditableQueryResultGrid 의 ARIA
// grid roles integrity 가드. RDB DataGridTable.aria-grid.test.tsx 와 동형.
// Raw query editable 도 column reorder 없음 — visual order == data order.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

vi.mock("@lib/tauri", () => ({
  executeQuery: vi.fn(async () => ({})),
  executeQueryBatch: vi.fn(async () => []),
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer", category: "int" },
    { name: "name", data_type: "text", category: "text" },
    { name: "email", data_type: "varchar", category: "text" },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
  ],
  total_count: 2,
  execution_time_ms: 1,
  query_type: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name", "email"],
};

describe("EditableQueryResultGrid ARIA grid roles (Sprint 260 AC-260-03)", () => {
  it("outer role=grid 가 aria-rowcount (1 + rows) + aria-colcount (cols) 를 노출", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "3"); // 1 header + 2 rows
    expect(grid).toHaveAttribute("aria-colcount", "3");
  });

  it("header row 가 aria-rowindex=1, body row 들이 2 부터 연속", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    expect(rows[2]).toHaveAttribute("aria-rowindex", "3");
  });

  it("header columnheader 의 aria-colindex 가 visual order 1..N", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveAttribute("aria-colindex", "1");
    expect(headers[1]).toHaveAttribute("aria-colindex", "2");
    expect(headers[2]).toHaveAttribute("aria-colindex", "3");
    expect(headers[0]).toHaveTextContent("id");
    expect(headers[1]).toHaveTextContent("name");
    expect(headers[2]).toHaveTextContent("email");
  });

  it("body gridcell 들의 aria-colindex 가 visual order 1..N", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    const firstBody = rows[1]!;
    const cells = within(firstBody).getAllByRole("gridcell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[1]).toHaveAttribute("aria-colindex", "2");
    expect(cells[2]).toHaveAttribute("aria-colindex", "3");
    expect(cells[0]).toHaveTextContent("1");
    expect(cells[1]).toHaveTextContent("Alice");
    expect(cells[2]).toHaveTextContent("alice@example.com");
  });

  // Sprint 261 (2026-05-11) — bug fix: horizontal overflow 시 row 박스가
  // parent width 에서 끊겨 hover:bg-muted / border-b 가 잘리던 문제. 모든
  // row 가 min-width: max-content 으로 grid tracks 합만큼 늘어나야 한다.
  it("모든 row 가 min-width: max-content (horizontal overflow bg 회귀 가드)", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    for (const r of rows) {
      expect((r as HTMLElement).style.minWidth).toBe("max-content");
    }
  });

  it("empty result 의 row 이 단일 role=gridcell + aria-colindex=1", () => {
    const emptyResult: QueryResult = { ...RESULT, rows: [], total_count: 0 };
    render(
      <EditableQueryResultGrid
        result={emptyResult}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2); // header + empty row
    const cells = within(rows[1]!).getAllByRole("gridcell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[0]).toHaveTextContent("No data");
  });
});
