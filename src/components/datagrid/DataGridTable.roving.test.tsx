// Purpose: RDB DataGrid data-cell roving tabindex + 방향키 2D nav (Design-swarm
// #4 Phase 2, non-virtualized 경로). 정확히 한 data cell 만 tab stop 이고
// Arrow/Home/End 가 focus + tabIndex=0 anchor 를 옮긴다. focus-steal 회귀
// (SchemaTree) 와 "편집 중 방향키 무시" 가드도 확인한다. virtualization sync
// 는 useGridRoving.test.tsx 가 결정적으로 커버, 실제 render 는 E2E 담당. (2026-07-01)

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

const MOCK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
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
    {
      name: "email",
      data_type: "varchar",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
    [3, "Carol", "carol@example.com"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnOrder: [0, 1, 2],
    editingCell: null as { row: number; col: number } | null,
    editValue: null as string | null,
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "users",
    onSetEditValue: vi.fn(),
    onSetEditNull: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

// rAF flush — useGridRoving.onKeyDown 이 `.focus()` 를 프레임 단위로 defer 한다.
function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

/** data cell (row, visualCol) 의 gridcell div. */
function cell(row: number, col: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DataGridTable roving tabindex (Design-swarm #4 Phase 2)", () => {
  // Reason: 초기엔 첫 data cell (0,0) 만 tab stop, 나머지는 -1. (2026-07-01)
  it("initially only the first data cell is a tab stop", () => {
    render(<DataGridTable {...makeProps()} />);
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    for (const [r, c] of [
      [0, 1],
      [0, 2],
      [1, 0],
      [2, 2],
    ] as const) {
      expect(cell(r, c)).toHaveAttribute("tabindex", "-1");
    }
  });

  // Reason: ArrowRight → (0,1), ArrowDown → (1,1) focus + tabIndex 이동. (2026-07-01)
  it("ArrowRight then ArrowDown move focus + tabIndex", async () => {
    render(<DataGridTable {...makeProps()} />);
    act(() => cell(0, 0).focus());

    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
    await flushRaf();
    expect(cell(0, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 0)).toHaveAttribute("tabindex", "-1");
    expect(cell(0, 1)).toHaveFocus();

    fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
    await flushRaf();
    expect(cell(1, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(1, 1)).toHaveFocus();
  });

  // Reason: ArrowLeft/ArrowUp 가 top-left edge 에서 clamp (no wrap). (2026-07-01)
  it("ArrowLeft/ArrowUp clamp at the top-left edge", async () => {
    render(<DataGridTable {...makeProps()} />);
    act(() => cell(0, 0).focus());

    fireEvent.keyDown(cell(0, 0), { key: "ArrowLeft" });
    await flushRaf();
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 0)).toHaveFocus();

    fireEvent.keyDown(cell(0, 0), { key: "ArrowUp" });
    await flushRaf();
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 0)).toHaveFocus();
  });

  // Reason: Home → row 첫 col, End → 마지막 col. (2026-07-01)
  it("Home/End jump to first/last column of the row", async () => {
    render(<DataGridTable {...makeProps()} />);
    act(() => cell(1, 1).focus());

    fireEvent.keyDown(cell(1, 1), { key: "End" });
    await flushRaf();
    expect(cell(1, 2)).toHaveAttribute("tabindex", "0");
    expect(cell(1, 2)).toHaveFocus();

    fireEvent.keyDown(cell(1, 2), { key: "Home" });
    await flushRaf();
    expect(cell(1, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(1, 0)).toHaveFocus();
  });

  // Reason: focus-steal 회귀 가드 — cell onFocus 는 state 만 갱신하고 `.focus()`
  // 를 부르지 않아야 한다. 사용자가 cell 후 외부 input 으로 이동하면 stale rAF
  // 가 focus 를 도로 낚아채선 안 된다 (SchemaTree mariadb E2E 회귀). (2026-07-01)
  it("cell onFocus does not steal focus back on the next frame", async () => {
    render(<DataGridTable {...makeProps()} />);
    const external = document.createElement("input");
    document.body.appendChild(external);

    act(() => cell(0, 0).focus()); // onFocus → syncFocus (state only)
    act(() => external.focus()); // 외부 컨트롤로 이동
    await flushRaf(); // stale rAF 가 grid 를 re-focus 하면 안 됨

    expect(external).toHaveFocus();
    expect(cell(0, 0)).not.toHaveFocus();
    external.remove();
  });

  // Reason: 편집 중 방향키 무시. 편집 <input> 이 focus 를 쥐면 keydown 의
  // e.target 은 input 이고 input 엔 [data-grid-row] 가 없다 → onKeyDown 가드가
  // bail, roving 이 아래 row 로 이동하지 않고 편집 셀에 머문다 (input focus
  // 버블링이 gridcell onFocus 를 발동해 anchor 는 편집 셀 (1,1) 로 sync 됨). (2026-07-01)
  it("arrows are ignored while editing (guard bails on non-cell target)", async () => {
    render(
      <DataGridTable
        {...makeProps({ editingCell: { row: 1, col: 1 }, editValue: "Bob" })}
      />,
    );
    // 편집 input 이 focus 를 쥔다 (버블링으로 anchor → (1,1)).
    const input = screen.getByDisplayValue("Bob");
    act(() => input.focus());
    expect(input).toHaveFocus();
    expect(cell(1, 1)).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await flushRaf();

    // 가드 bail: roving 은 (2,1) 로 내려가지 않고 (1,1) 유지, input 도 focus 유지.
    expect(cell(1, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(2, 1)).toHaveAttribute("tabindex", "-1");
    expect(input).toHaveFocus();
  });

  // Reason: Phase 3 — Enter 로 focus 된 cell 편집 진입 (double-click 과 동일
  // 경로, onStartEdit(row, dataCol, value)). (2026-07-01)
  it("Enter on a focused cell starts editing", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(onStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
  });

  // Reason: Phase 3 — F2 도 편집 진입 (스프레드시트 표준 키). (2026-07-01)
  it("F2 on a focused cell starts editing", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);
    act(() => cell(2, 2).focus());
    fireEvent.keyDown(cell(2, 2), { key: "F2" });
    expect(onStartEdit).toHaveBeenCalledWith(2, 2, "carol@example.com");
  });

  // Reason: Phase 3 — canEditRows=false 면 Enter/F2 편집 진입 안 함. (2026-07-01)
  it("Enter does not start editing when rows are not editable", () => {
    const onStartEdit = vi.fn();
    render(
      <DataGridTable {...makeProps({ onStartEdit, canEditRows: false })} />,
    );
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});
