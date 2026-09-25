// Purpose: keyboard-reachability guard for HeaderRow's sort headers (issue
// #1130 AC3). The header row is a single roving tab stop (the first
// columnheader is tabindex 0, the rest -1), ArrowLeft/Right move it, and
// Enter/Space call onSort (Shift appends to the multi-sort). aria-sort
// exposure is guarded too. HeaderRow is shared by the RDB and Document grids
// (DataGridHeaderRow), so one fix covers both.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SortInfo, TableData } from "@/types/schema";
import HeaderRow from "./HeaderRow";

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
  it("header exposes a single roving tab stop (first columnheader)", () => {
    render(<HeaderRow {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("tabindex", "0");
    expect(headers[1]).toHaveAttribute("tabindex", "-1");
    const stops = headers.filter((h) => h.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });

  it("ArrowRight moves the header roving tab stop + focus", () => {
    render(<HeaderRow {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    act(() => headers[0]!.focus());
    fireEvent.keyDown(headers[0]!, { key: "ArrowRight" });
    expect(headers[1]).toHaveAttribute("tabindex", "0");
    expect(headers[0]).toHaveAttribute("tabindex", "-1");
    expect(headers[1]).toHaveFocus();
  });

  it("ArrowLeft/Home/End move within the header row (clamped)", () => {
    render(<HeaderRow {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    act(() => headers[0]!.focus());

    // End -> last column.
    fireEvent.keyDown(headers[0]!, { key: "End" });
    expect(headers[1]).toHaveAttribute("tabindex", "0");
    expect(headers[1]).toHaveFocus();

    // Home -> first column.
    fireEvent.keyDown(headers[1]!, { key: "Home" });
    expect(headers[0]).toHaveAttribute("tabindex", "0");
    expect(headers[0]).toHaveFocus();

    // ArrowLeft at the first column clamps (no wrap).
    fireEvent.keyDown(headers[0]!, { key: "ArrowLeft" });
    expect(headers[0]).toHaveAttribute("tabindex", "0");
    expect(headers[0]).toHaveFocus();
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
