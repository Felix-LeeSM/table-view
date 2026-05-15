// Sprint 316 (2026-05-15) — Slice C.2 column header context menu.
//
// 작성 이유: HeaderRow 가 paradigm-shared 라 한 곳에 6 item 의
// callback 호출을 lock 하면 RDB+Mongo 양쪽 grid 가 자동 보장.
// Radix ContextMenu 는 portal → screen 검색이 동작.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HeaderRow from "./HeaderRow";
import type { SortInfo, TableData } from "@/types/schema";

function buildData(): TableData {
  return {
    columns: [
      {
        name: "_id",
        data_type: "ObjectId",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "string",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [],
    total_count: 0,
    page: 1,
    page_size: 25,
    executed_query: "",
  };
}

interface SetupOpts {
  sorts?: SortInfo[];
  onSortColumn?: (
    column: string,
    direction: "ASC" | "DESC",
    append: boolean,
  ) => void;
  onClearColumnSort?: (column: string) => void;
  onClearAllSorts?: () => void;
  onHideColumn?: (column: string) => void;
}

function setup(opts: SetupOpts = {}) {
  const data = buildData();
  const onSort = vi.fn();
  const onSaveCurrentEdit = vi.fn();
  const onResizeStart = vi.fn();
  const props = {
    data,
    order: [0, 1],
    sorts: opts.sorts ?? [],
    editingCell: null,
    onSort,
    onSaveCurrentEdit,
    onResizeStart,
    onSortColumn: opts.onSortColumn,
    onClearColumnSort: opts.onClearColumnSort,
    onClearAllSorts: opts.onClearAllSorts,
    onHideColumn: opts.onHideColumn,
  };
  render(<HeaderRow {...props} />);
  return props;
}

function openContextMenuOn(columnName: string) {
  const header = screen.getByRole("columnheader", {
    name: new RegExp(columnName),
  });
  fireEvent.contextMenu(header);
  return header;
}

describe("HeaderRow context menu (Sprint 316)", () => {
  it("does not mount the context menu when no menu callbacks are provided", () => {
    setup();
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /name/ }));
    // Without callbacks, HeaderRow renders the plain header — no menu
    // items should appear.
    expect(screen.queryByRole("menuitem", { name: "Sort ASC" })).toBeNull();
  });

  it("opens a 6-item menu on right-click when callbacks are provided", () => {
    setup({
      onSortColumn: vi.fn(),
      onClearColumnSort: vi.fn(),
      onClearAllSorts: vi.fn(),
    });
    openContextMenuOn("name");
    expect(
      screen.getByRole("menuitem", { name: "Sort ASC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Sort DESC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Add to sort ASC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Add to sort DESC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Clear sort for this column" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Clear all sorts" }),
    ).toBeInTheDocument();
  });

  it("Sort ASC item dispatches onSortColumn(col, 'ASC', append=false)", () => {
    const onSortColumn = vi.fn();
    setup({ onSortColumn });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort ASC" }));
    expect(onSortColumn).toHaveBeenCalledWith("name", "ASC", false);
  });

  it("Sort DESC item dispatches onSortColumn(col, 'DESC', append=false)", () => {
    const onSortColumn = vi.fn();
    setup({ onSortColumn });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort DESC" }));
    expect(onSortColumn).toHaveBeenCalledWith("name", "DESC", false);
  });

  it("Add to sort ASC dispatches onSortColumn with append=true", () => {
    const onSortColumn = vi.fn();
    setup({ onSortColumn });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to sort ASC" }));
    expect(onSortColumn).toHaveBeenCalledWith("name", "ASC", true);
  });

  it("Add to sort DESC dispatches onSortColumn with append=true", () => {
    const onSortColumn = vi.fn();
    setup({ onSortColumn });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to sort DESC" }));
    expect(onSortColumn).toHaveBeenCalledWith("name", "DESC", true);
  });

  it("Clear sort for this column dispatches onClearColumnSort(col)", () => {
    const onClearColumnSort = vi.fn();
    setup({
      sorts: [{ column: "name", direction: "ASC" }],
      onClearColumnSort,
    });
    openContextMenuOn("name");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Clear sort for this column" }),
    );
    expect(onClearColumnSort).toHaveBeenCalledWith("name");
  });

  it("Clear all sorts dispatches onClearAllSorts()", () => {
    const onClearAllSorts = vi.fn();
    setup({
      sorts: [{ column: "name", direction: "ASC" }],
      onClearAllSorts,
    });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear all sorts" }));
    expect(onClearAllSorts).toHaveBeenCalled();
  });

  it("Clear sort for this column is disabled when the column is not sorted", () => {
    const onClearColumnSort = vi.fn();
    setup({
      sorts: [{ column: "_id", direction: "ASC" }],
      onClearColumnSort,
    });
    openContextMenuOn("name");
    const item = screen.getByRole("menuitem", {
      name: "Clear sort for this column",
    });
    expect(item).toHaveAttribute("data-disabled");
  });

  it("Clear all sorts is disabled when sorts is empty", () => {
    const onClearAllSorts = vi.fn();
    setup({ sorts: [], onClearAllSorts });
    openContextMenuOn("name");
    const item = screen.getByRole("menuitem", { name: "Clear all sorts" });
    expect(item).toHaveAttribute("data-disabled");
  });

  // Sprint 317 — Slice D.1: Hide column item appears under a separator
  // when `onHideColumn` is provided.
  it("Hide column item dispatches onHideColumn(col) when provided", () => {
    const onHideColumn = vi.fn();
    setup({ onHideColumn });
    openContextMenuOn("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(onHideColumn).toHaveBeenCalledWith("name");
  });

  it("Hide column item is absent when onHideColumn is not provided", () => {
    setup({ onSortColumn: vi.fn() });
    openContextMenuOn("name");
    expect(screen.queryByRole("menuitem", { name: "Hide column" })).toBeNull();
  });
});
