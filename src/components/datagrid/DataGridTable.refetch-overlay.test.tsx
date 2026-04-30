/**
 * Reason: Sprint-176 / RISK-009 — selective-attention overlay hardening.
 * The refetch loading overlay must swallow pointer events that the user
 * directs at the cells underneath, so a mid-flight refetch can't be
 * hijacked into selecting a row, opening cell-edit mode, or surfacing
 * the context menu. Also locks AC-176-04: spinner DOM (classes / size /
 * position) is unchanged from the pre-176 implementation.
 *
 * NOTE on test mechanism (sprint-176 attempt 2 — Evaluator finding F-1):
 * In jsdom the overlay <div> is a sibling of <table> in the DOM, so a
 * `fireEvent.click(overlay)` does NOT bubble to <tr> regardless of
 * `stopPropagation`. Asserting `expect(spy).not.toHaveBeenCalled()` on
 * the row handler is therefore vacuous — it would pass even if the
 * sprint-176 production handlers were removed. The load-bearing
 * assertion in this file is `event.defaultPrevented === true`, which
 * proves `e.preventDefault()` actually executed inside the overlay's
 * onClick / onMouseDown / onDoubleClick / onContextMenu handlers. The
 * `expect(spy).not.toHaveBeenCalled()` lines remain as secondary
 * checks documenting the user-visible invariant, but the
 * `defaultPrevented` assertions are what actually catch a regression.
 *
 * Date: 2026-04-30 (sprint-176, generator phase — attempt 2)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
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
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: true,
    sorts: [],
    columnWidths: {},
    columnOrder: [0, 1],
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
    onColumnWidthsChange: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

describe("DataGridTable refetch overlay (sprint-176)", () => {
  // Reason: AC-176-01 — the overlay's mouseDown handler must call
  // `e.preventDefault()`. Selection in DataGridTable is sometimes started
  // on mousedown (drag-select), so blocking only `click` is insufficient.
  // Load-bearing assertion: `event.defaultPrevented === true`.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1, F-3 split)
  it("[AC-176-01] overlay calls preventDefault on mouseDown", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ onSelectRow })} />);

    const overlay = screen.getByRole("status", { name: "Loading" });
    expect(overlay).toBeInTheDocument();

    const event = createEvent.mouseDown(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    // Secondary check (user-visible invariant): the row-level handler
    // remained un-fired. This is informative but, in jsdom where the
    // overlay is a sibling of <table>, would pass even without the
    // production handler — see the file-level NOTE.
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  // Reason: AC-176-01 — same shape as the mouseDown test above but for
  // the click gesture (the row-selection toggle on RDB grids).
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1, F-3 split)
  it("[AC-176-01] overlay calls preventDefault on click", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ onSelectRow })} />);

    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.click(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  // Reason: AC-176-01 — confirm doubleClick (the cell-edit entry gesture)
  // also fires preventDefault. onStartEdit is the user-visible secondary
  // assertion: in pre-sprint-176 code a double-click on the overlay
  // region directly above a cell would bubble to the cell's
  // `onDoubleClick` and open the inline editor mid-refetch.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1)
  it("[AC-176-01] overlay calls preventDefault on doubleClick", () => {
    const onStartEdit = vi.fn();
    render(<DataGridTable {...makeProps({ onStartEdit })} />);

    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.dblClick(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  // Reason: AC-176-01 — contextmenu (right-click) must not open the
  // ContextMenu mid-refetch. The overlay must absorb the gesture so the
  // user can't trigger Edit/Delete/Copy actions before the refresh has
  // settled. Load-bearing assertion: `event.defaultPrevented === true`.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1)
  it("[AC-176-01] overlay calls preventDefault on contextmenu", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ onSelectRow })} />);

    const overlay = screen.getByRole("status", { name: "Loading" });
    const event = createEvent.contextMenu(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    // Secondary user-visible checks.
    expect(onSelectRow).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // Reason: AC-176-04 — spinner visuals must be unchanged. Specifically
  // the wrapper carries the existing class chain
  // (`absolute inset-0 z-20 flex items-center justify-center
  // bg-background/60`) and the Loader2 child carries
  // (`animate-spin text-muted-foreground`). Snapshot-equivalent assertion
  // via class-list is enough — no new visual snapshot needed. Attempt 2
  // also pins `aria-hidden="true"` on the SVG — added per Evaluator F-5.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-5)
  it("[AC-176-04] spinner DOM (classes, size, position) is unchanged", () => {
    render(<DataGridTable {...makeProps()} />);

    const overlay = screen.getByRole("status", { name: "Loading" });
    // Wrapper class chain (locked by AC-176-04).
    expect(overlay).toHaveClass(
      "absolute",
      "inset-0",
      "z-20",
      "flex",
      "items-center",
      "justify-center",
      "bg-background/60",
    );
    // The Loader2 child must keep its animation + colour classes.
    const spinner = overlay.querySelector("svg.animate-spin");
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass("animate-spin", "text-muted-foreground");
    // Loader2 size={24} renders width/height attributes of "24". This
    // pins the size invariant from AC-176-04.
    expect(spinner).toHaveAttribute("width", "24");
    expect(spinner).toHaveAttribute("height", "24");
    // a11y polish: SVG is decorative — assistive tech should ignore it
    // and read the parent's aria-label instead. Attempt-2 addition.
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  // Reason: regression guard — when loading=false, the overlay is gone
  // and pointer events on the rows reach their handlers as before.
  // Without this, sprint-176 could over-correct and break the normal
  // (non-loading) path.
  // Date: 2026-04-30
  it("regression: with loading=false overlay is absent and clicks reach the row", () => {
    const onSelectRow = vi.fn();
    render(<DataGridTable {...makeProps({ loading: false, onSelectRow })} />);

    expect(
      screen.queryByRole("status", { name: "Loading" }),
    ).not.toBeInTheDocument();

    // A direct click on a row cell should still fire onSelectRow.
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelectRow).toHaveBeenCalled();
  });
});
