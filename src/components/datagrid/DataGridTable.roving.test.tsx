// Purpose: RDB DataGrid data-cell roving tabindex + arrow-key 2D nav
// (non-virtualized path). Exactly one data cell is a tab stop and
// Arrow/Home/End move focus plus the tabIndex=0 anchor. Also checks the
// focus-steal regression (SchemaTree) and the "ignore arrows while editing"
// guard. Virtualization sync is covered deterministically by
// useGridRoving.test.tsx; the real render belongs to E2E.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableData } from "@/types/schema";
import DataGridTable from "./DataGridTable";
import { SELECTED_ROW_FILL } from "./rowState";

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

// rAF flush — useGridRoving.onKeyDown defers `.focus()` by one frame.
function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

/** The gridcell div of data cell (row, visualCol). */
function cell(row: number, col: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DataGridTable roving tabindex (Design-swarm #4 Phase 2)", () => {
  // Reason: initially only the first data cell (0,0) is a tab stop, the
  // rest are -1.
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

  // Reason: ArrowRight → (0,1), ArrowDown → (1,1) moves focus + tabIndex.
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

  // Reason: ArrowLeft clamps at the left edge (no wrap). ArrowUp at row 0
  // no longer clamps — it enters the header (#1127; a separate case checks
  // that).
  it("ArrowLeft clamps at the left edge", async () => {
    render(<DataGridTable {...makeProps()} />);
    act(() => cell(0, 0).focus());

    fireEvent.keyDown(cell(0, 0), { key: "ArrowLeft" });
    await flushRaf();
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 0)).toHaveFocus();
  });

  // Reason: Home → first col of the row, End → last col.
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

  // Reason: focus-steal regression guard — cell onFocus must only update
  // state and never call `.focus()`. When the user moves from a cell to an
  // outside input, a stale rAF must not grab focus back (the SchemaTree
  // mariadb E2E regression).
  it("cell onFocus does not steal focus back on the next frame", async () => {
    render(<DataGridTable {...makeProps()} />);
    const external = document.createElement("input");
    document.body.appendChild(external);

    act(() => cell(0, 0).focus()); // onFocus → syncFocus (state only)
    act(() => external.focus()); // move to an outside control
    await flushRaf(); // a stale rAF must not re-focus the grid

    expect(external).toHaveFocus();
    expect(cell(0, 0)).not.toHaveFocus();
    external.remove();
  });

  // Reason: arrows are ignored while editing. When the editing <input>
  // holds focus, keydown's e.target is the input and the input has no
  // [data-grid-row] → the onKeyDown guard bails, so roving stays on the
  // editing cell instead of moving to the row below (the input's focus
  // bubbles into the gridcell onFocus, syncing the anchor to the editing
  // cell (1,1)).
  it("arrows are ignored while editing (guard bails on non-cell target)", async () => {
    render(
      <DataGridTable
        {...makeProps({ editingCell: { row: 1, col: 1 }, editValue: "Bob" })}
      />,
    );
    // The editing input takes focus (bubbling moves the anchor → (1,1)).
    const input = screen.getByDisplayValue("Bob");
    act(() => input.focus());
    expect(input).toHaveFocus();
    expect(cell(1, 1)).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await flushRaf();

    // Guard bails: roving stays at (1,1) instead of dropping to (2,1), and
    // the input keeps focus.
    expect(cell(1, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(2, 1)).toHaveAttribute("tabindex", "-1");
    expect(input).toHaveFocus();
  });

  // Reason: Enter starts editing the focused cell (same path as
  // double-click, onStartEdit(row, dataCol, value)).
  it("Enter on a focused cell starts editing", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(onStartEdit).toHaveBeenCalledWith(0, 1, "Alice");
  });

  // Reason: F2 also starts editing (the spreadsheet-standard key).
  it("F2 on a focused cell starts editing", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);
    act(() => cell(2, 2).focus());
    fireEvent.keyDown(cell(2, 2), { key: "F2" });
    expect(onStartEdit).toHaveBeenCalledWith(2, 2, "carol@example.com");
  });

  // Reason: with canEditRows=false, Enter/F2 do not start editing.
  it("Enter does not start editing when rows are not editable", () => {
    const onStartEdit = vi.fn();
    render(
      <DataGridTable {...makeProps({ onStartEdit, canEditRows: false })} />,
    );
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  // Reason: #1127 AC1 — ArrowUp from the top data row enters the matching
  // column's header. The only cross-boundary move joining the header row
  // and the body (the roving anchor is kept).
  it("ArrowUp from the top data row enters the header cell of the same column (#1127)", async () => {
    render(<DataGridTable {...makeProps()} />);
    act(() => cell(0, 1).focus());
    fireEvent.keyDown(cell(0, 1), { key: "ArrowUp" });
    await flushRaf();
    const headers = screen.getAllByRole("columnheader");
    expect(headers[1]).toHaveFocus();
  });

  // Reason: #1127 AC1 — ArrowDown from a header cell returns to the top
  // data cell of the matching column. The header ArrowUp → body ArrowDown
  // round-trip preserves the column.
  it("ArrowDown from a header cell returns to the top data row of the same column (#1127)", async () => {
    render(<DataGridTable {...makeProps()} />);
    const headers = screen.getAllByRole("columnheader");
    act(() => headers[2]!.focus());
    fireEvent.keyDown(headers[2]!, { key: "ArrowDown" });
    await flushRaf();
    expect(cell(0, 2)).toHaveFocus();
  });

  // Reason: #1127 AC3 — pending-new-rows must be reachable by arrow-key nav
  // too. The roving rowCount includes pendingNewRows and the cells carry
  // data-grid-* + tabIndex + onFocus, so ArrowDown from the last data row
  // descends into them.
  it("pending new rows are reachable by ArrowDown (#1127)", async () => {
    const pendingNewRows = [[99, "New", "new@example.com"]];
    render(<DataGridTable {...makeProps({ pendingNewRows })} />);
    // data rows 0..2, pending row index = 3.
    const pendingCell = document.querySelector<HTMLElement>(
      `[data-grid-row="3"][data-grid-col="0"]`,
    );
    expect(pendingCell).not.toBeNull();

    act(() => cell(2, 0).focus());
    fireEvent.keyDown(cell(2, 0), { key: "ArrowDown" });
    await flushRaf();
    expect(pendingCell).toHaveFocus();
  });
});

// Purpose: roving-focus visual affordance — user reported the focused row/cell
// was invisible so right-click quick-look targeted an unknown cell. The data
// cell now carries the same `focus-visible:outline-*` as its header/pending
// siblings, and the focus row (the one holding the roving anchor) gets an inset
// box-shadow bar that coexists with the selection background. jsdom does not
// compute Tailwind `:focus-visible` styles, so class presence is the only
// observable channel here; E2E owns the pixel verification. (2026-07-17)
const FOCUS_BAR = "shadow-[inset_2px_0_0_0_var(--color-ring)]";
function rowOf(rowIdx: number): HTMLElement {
  return cell(rowIdx, 0).closest('[role="row"]') as HTMLElement;
}

describe("DataGridTable roving-focus visual affordance", () => {
  // Reason: bug — data cell was the only grid cell missing the focus-visible
  // outline its header sibling already has; assert both carry it. (2026-07-17)
  it("data cells carry the same focus-visible outline as header cells", () => {
    render(<DataGridTable {...makeProps()} />);
    const header = screen.getAllByRole("columnheader")[0]!;
    expect(header.className).toContain("focus-visible:outline-ring");
    expect(cell(0, 0).className).toContain("focus-visible:outline-ring");
  });

  // Reason: the focus-row affordance must follow the roving anchor — the row
  // holding the tab stop shows the bar, other rows don't, and it moves on nav.
  // Guards the `tabCol !== null` branch. (2026-07-17)
  it("only the roving-focus row shows the affordance, and it follows nav", async () => {
    render(<DataGridTable {...makeProps()} />);
    // initial anchor is (0,0) → row 0 is the focus row.
    expect(rowOf(0).className).toContain(FOCUS_BAR);
    expect(rowOf(1).className).not.toContain(FOCUS_BAR);

    act(() => cell(0, 0).focus());
    fireEvent.keyDown(cell(0, 0), { key: "ArrowDown" });
    await flushRaf();
    expect(rowOf(1).className).toContain(FOCUS_BAR);
    expect(rowOf(0).className).not.toContain(FOCUS_BAR);
  });

  // Reason: selection + focus use different paint channels so a row that is
  // both selected and focused must read both (the focus bar must not clobber
  // the selection fill). (2026-07-17; the fill itself moved to
  // `datagrid/rowState.ts` in #1734 (3) and is measured per theme by
  // `DataGridTable.selection-contrast.test.tsx`.)
  it("a selected + focused row keeps both the selection bg and the focus bar", () => {
    render(<DataGridTable {...makeProps({ selectedRowIds: new Set([0]) })} />);
    const row0 = rowOf(0);
    expect(row0.className).toContain(SELECTED_ROW_FILL); // selection channel
    expect(row0.className).toContain(FOCUS_BAR); // focus channel (row 0 anchor)
  });

  // Reason: #1734 (5) — Quick Look restores focus through this handle. If the
  // grid stops publishing it the panel silently falls back to a DOM lookup that
  // cannot see a virtualized-out anchor row, so the wiring needs its own guard.
  // The scroll-in + retry behind it is covered by `useGridRoving.test.tsx`.
  it("publishes a focuser for the current roving anchor", async () => {
    const focusAnchorRef = { current: null as (() => void) | null };
    render(<DataGridTable {...makeProps({ focusAnchorRef })} />);
    expect(focusAnchorRef.current).toBeTypeOf("function");

    // Move the anchor, blur, then use the handle: it must land on the anchor,
    // not on wherever focus happened to be.
    act(() => cell(0, 0).focus());
    fireEvent.keyDown(cell(0, 0), { key: "ArrowDown" });
    await flushRaf();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(cell(1, 0)).not.toHaveFocus();

    await act(async () => {
      focusAnchorRef.current?.();
    });
    expect(cell(1, 0)).toHaveFocus();
  });

  // Reason: regression — the editing cell's `ring-primary` highlight must
  // survive alongside the newly added focus-visible outline. (2026-07-17)
  it("the editing cell keeps its ring-primary highlight", () => {
    render(
      <DataGridTable
        {...makeProps({ editingCell: { row: 0, col: 0 }, editValue: "1" })}
      />,
    );
    expect(cell(0, 0).className).toContain("ring-primary");
  });
});
