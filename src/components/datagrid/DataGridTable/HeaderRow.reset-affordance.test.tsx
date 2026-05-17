/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #5 + #6).
 *
 * 사유: DataGrid column header 우클릭 context menu 에
 *   (5) "Reset column widths" → `onResetColumnWidths` callback 1회.
 *   (6) "Show all columns" → `onShowAllColumns` callback 1회.
 *
 * 본 spec 은 callback 단위 contract — `DataGridTable.tsx` 가 위 두
 * callback 을 각각 `useColumnWidths.reset` (이미 `resetDatagridPrefs
 * field=widths` IPC 발사) / `useHiddenColumns.clear` (이미 `setDatagridPrefs
 * hiddenColumns=[]` 발사) 로 연결. 따라서 callback 호출만 lock 하면 IPC
 * 까지 자동 흐름. Q21 contract — confirm dialog 없음.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HeaderRow from "./HeaderRow";
import type { SortInfo, TableData } from "@/types/schema";

function buildData(): TableData {
  return {
    columns: [
      {
        name: "id",
        data_type: "int",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "text",
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
  onResetColumnWidths?: () => void;
  onShowAllColumns?: () => void;
  hiddenColumnsPresent?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const data = buildData();
  render(
    <HeaderRow
      data={data}
      order={[0, 1]}
      sorts={opts.sorts ?? []}
      editingCell={null}
      onSort={vi.fn()}
      onSaveCurrentEdit={vi.fn()}
      onResizeStart={vi.fn()}
      onResetColumnWidths={opts.onResetColumnWidths}
      onShowAllColumns={opts.onShowAllColumns}
      anyColumnHidden={opts.hiddenColumnsPresent ?? false}
    />,
  );
}

function openContextMenuOn(columnName: string) {
  const header = screen.getByRole("columnheader", {
    name: new RegExp(columnName),
  });
  fireEvent.contextMenu(header);
  return header;
}

describe("HeaderRow reset affordances (Q21 #5 + #6)", () => {
  it("AC-376-05: 'Reset column widths' 메뉴 클릭 → onResetColumnWidths 1회 호출", () => {
    const onResetColumnWidths = vi.fn();
    setup({ onResetColumnWidths });
    openContextMenuOn("name");
    fireEvent.click(
      screen.getByRole("menuitem", { name: /reset column widths/i }),
    );
    expect(onResetColumnWidths).toHaveBeenCalledTimes(1);
  });

  it("AC-376-06: 'Show all columns' 메뉴 클릭 → onShowAllColumns 1회 호출 (hidden 존재 시 enabled)", () => {
    const onShowAllColumns = vi.fn();
    setup({ onShowAllColumns, hiddenColumnsPresent: true });
    openContextMenuOn("name");
    fireEvent.click(
      screen.getByRole("menuitem", { name: /show all columns/i }),
    );
    expect(onShowAllColumns).toHaveBeenCalledTimes(1);
  });

  it("AC-376-06 disabled state: hidden 0 일 때 'Show all columns' 는 disabled — onShowAllColumns 미호출", () => {
    const onShowAllColumns = vi.fn();
    setup({ onShowAllColumns, hiddenColumnsPresent: false });
    openContextMenuOn("name");
    const item = screen.getByRole("menuitem", { name: /show all columns/i });
    expect(item).toHaveAttribute("data-disabled");
    fireEvent.click(item);
    expect(onShowAllColumns).not.toHaveBeenCalled();
  });
});
