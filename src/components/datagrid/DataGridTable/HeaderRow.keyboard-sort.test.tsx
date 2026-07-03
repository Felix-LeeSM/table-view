// Purpose: HeaderRow 정렬 헤더 키보드 도달 가드 (issue #1130 AC3). columnheader
// 는 focusable(tabindex=0) 이어야 하고 Enter/Space 로 onSort 를 부른다 (Shift 는
// multi-sort append). aria-sort 노출도 회귀 가드. HeaderRow 는 RDB + Document
// 그리드 공유(DataGridHeaderRow)라 한 곳 고치면 둘 다 커버. (2026-07-03)

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HeaderRow from "./HeaderRow";
import type { SortInfo, TableData } from "@/types/schema";

function col(name: string) {
  return {
    name,
    data_type: "text",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

const DATA: TableData = {
  columns: [col("id"), col("name")],
  rows: [],
  total_count: 0,
  page: 1,
  page_size: 100,
  executed_query: "",
};

function makeProps(over: Record<string, unknown> = {}) {
  return {
    data: DATA,
    order: [0, 1],
    sorts: [] as SortInfo[],
    editingCell: null as { row: number; col: number } | null,
    onSort: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onResizeStart: vi.fn(),
    ...over,
  };
}

describe("HeaderRow keyboard sort (issue #1130 AC3)", () => {
  it("columnheader is focusable (tabindex 0)", () => {
    render(<HeaderRow {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    for (const h of headers) {
      expect(h).toHaveAttribute("tabindex", "0");
    }
  });

  it("Enter on a focused columnheader triggers onSort", () => {
    const onSort = vi.fn();
    render(<HeaderRow {...makeProps({ onSort })} />);
    const header = screen.getAllByRole("columnheader")[1]!; // "name"
    fireEvent.keyDown(header, { key: "Enter" });
    expect(onSort).toHaveBeenCalledWith("name", false);
  });

  it("Space on a focused columnheader triggers onSort", () => {
    const onSort = vi.fn();
    render(<HeaderRow {...makeProps({ onSort })} />);
    const header = screen.getAllByRole("columnheader")[0]!; // "id"
    fireEvent.keyDown(header, { key: " " });
    expect(onSort).toHaveBeenCalledWith("id", false);
  });

  it("Shift+Enter appends to the sort (multi-key)", () => {
    const onSort = vi.fn();
    render(<HeaderRow {...makeProps({ onSort })} />);
    const header = screen.getAllByRole("columnheader")[1]!;
    fireEvent.keyDown(header, { key: "Enter", shiftKey: true });
    expect(onSort).toHaveBeenCalledWith("name", true);
  });

  it("keydown from the resize separator does not trigger sort", () => {
    const onSort = vi.fn();
    render(<HeaderRow {...makeProps({ onSort })} />);
    const separators = screen.getAllByRole("separator");
    fireEvent.keyDown(separators[0]!, { key: "Enter" });
    expect(onSort).not.toHaveBeenCalled();
  });

  it("aria-sort reflects the active sort direction", () => {
    const sorts: SortInfo[] = [{ column: "name", direction: "DESC" }];
    render(<HeaderRow {...makeProps({ sorts })} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "none");
    expect(headers[1]).toHaveAttribute("aria-sort", "descending");
  });
});
