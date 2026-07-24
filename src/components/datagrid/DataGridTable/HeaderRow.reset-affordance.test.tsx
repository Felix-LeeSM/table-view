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
 *
 * #1733 (2026-07-24): 중복이던 열 너비 초기화 툴바 버튼을 제거했으므로 초기화의
 * 사용자 가시 계약(컨텍스트 메뉴 + grip 더블클릭)이 이 파일에 온전히 남아야
 * 한다 (P1 lowest layer). 더불어 grip hover `title` 힌트("double-click to
 * reset")로 발견성을 보완했고 아래 신규 test 가 이를 lock 한다. grip 조회는
 * CSS class(`.cursor-col-resize`, P9 change-detector) 대신 `role="separator"`
 * 접근성 계약으로 쿼리한다.
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

  // 작성 2026-05-17 (sprint-378). 사유: 사용자가 column width drag 후
  // 기본값 복귀를 위해 호버 시 노출되는 보라색 drag handle 을 더블클릭
  // 으로 즉시 reset 할 수 있어야 한다 (이미지 #7). column-level 이 아닌
  // *전체 widths reset* — sprint-376 의 IPC `reset_datagrid_prefs
  // (field=widths)` 재활용. per-column reset 은 별 sprint. #1733: grip 을
  // role="separator" 접근성 계약으로 쿼리 (기존 CSS class 대체).
  it("AC-378-03: column resize handle 더블클릭 → onResetColumnWidths 1회 호출", () => {
    const onResetColumnWidths = vi.fn();
    setup({ onResetColumnWidths });
    const handles = screen.getAllByRole("separator", {
      name: /resize column/i,
    });
    expect(handles.length).toBeGreaterThan(0);
    fireEvent.doubleClick(handles[0]!);
    expect(onResetColumnWidths).toHaveBeenCalledTimes(1);
  });

  it("AC-378-04: column resize handle 단일 mousedown (drag-start) → onResetColumnWidths 미호출", () => {
    const onResetColumnWidths = vi.fn();
    setup({ onResetColumnWidths });
    const handle = screen.getAllByRole("separator", {
      name: /resize column/i,
    })[0]!;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseUp(handle, { clientX: 100 });
    expect(onResetColumnWidths).not.toHaveBeenCalled();
  });

  it("AC-378-05: column resize handle 더블클릭이 header onSort 로 bubble 되지 않는다", () => {
    const onResetColumnWidths = vi.fn();
    const onSort = vi.fn();
    const data = buildData();
    render(
      <HeaderRow
        data={data}
        order={[0, 1]}
        sorts={[]}
        editingCell={null}
        onSort={onSort}
        onSaveCurrentEdit={vi.fn()}
        onResizeStart={vi.fn()}
        onResetColumnWidths={onResetColumnWidths}
      />,
    );
    const handle = screen.getAllByRole("separator", {
      name: /resize column/i,
    })[0]!;
    fireEvent.doubleClick(handle);
    expect(onResetColumnWidths).toHaveBeenCalledTimes(1);
    expect(onSort).not.toHaveBeenCalled();
  });

  // 작성 2026-07-24 (#1733). 사유: 중복이던 툴바 초기화 버튼을 제거하면서
  // 더블클릭이 유일한 grip reset 트리거가 됐다. 마우스 사용자가 이 hidden
  // affordance 를 발견할 수 있도록 grip 에 hover `title` 힌트를 노출한다.
  // title 텍스트에서 초기화 힌트가 사라지면 이 test 가 fail 한다 (발견성 회귀
  // 가드). SR 용 aria-label("Resize column") 과는 별개 계약.
  it("AC-1733-01: resize grip 이 더블클릭 초기화 힌트를 title 로 노출한다", () => {
    setup({ onResetColumnWidths: vi.fn() });
    const handles = screen.getAllByRole("separator", {
      name: /resize column/i,
    });
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect(handle).toHaveAttribute(
        "title",
        expect.stringMatching(/double-click to reset/i),
      );
    }
  });
});
