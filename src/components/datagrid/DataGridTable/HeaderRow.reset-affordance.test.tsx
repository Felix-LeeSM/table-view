/**
 * Q21 affordance #5 + #6.
 *
 * Reason: in the DataGrid column header's right-click context menu,
 *   (5) "Reset column widths" → one `onResetColumnWidths` callback.
 *   (6) "Show all columns" → one `onShowAllColumns` callback.
 *
 * This spec is a callback-level contract — `DataGridTable.tsx` wires those
 * two callbacks to `useColumnWidths.reset` (which already fires the
 * `resetDatagridPrefs field=widths` IPC) and `useHiddenColumns.clear` (which
 * already fires `setDatagridPrefs hiddenColumns=[]`). Locking the callback
 * calls therefore carries through to the IPC. Q21 contract — no confirm
 * dialog.
 *
 * #1733 (2026-07-24): the duplicate column-width reset toolbar button was
 * removed, so the user-visible reset contract (context menu + grip
 * double-click) must survive in this file in full (P1 lowest layer). A grip
 * hover `title` hint ("double-click to reset") was added for
 * discoverability and the new test below locks it. The grip is queried
 * through the `role="separator"` accessibility contract instead of the CSS
 * class (`.cursor-col-resize`, a P9 change-detector).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SortInfo, TableData } from "@/types/schema";
import HeaderRow from "./HeaderRow";

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

  // Reason: after dragging a column width, the user must be able to
  // double-click the purple drag handle shown on hover to reset straight
  // back to the defaults (image #7). This is a *reset of all widths*, not
  // column-level — it reuses the `reset_datagrid_prefs (field=widths)` IPC.
  // #1733: the grip is queried through the role="separator" accessibility
  // contract (replacing the CSS class).
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

  // #1733. Reason: removing the duplicate toolbar reset button made the
  // double-click the only grip reset trigger. The grip exposes a hover
  // `title` hint so mouse users can discover this hidden affordance. If the
  // reset hint leaves the title text, this test fails (discoverability
  // regression guard). A contract separate from the SR-facing aria-label
  // ("Resize column").
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
