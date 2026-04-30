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
 *
 * Sprint-180 update (2026-04-30): the overlay is now threshold-gated
 * by `useDelayedFlag(loading, 1000)` (AC-180-01). Each test wraps its
 * setup with `vi.useFakeTimers()` and advances 1100ms before asserting
 * the overlay's presence so the Sprint 176 invariants still apply
 * post-threshold. Without this gate, sub-second fetches no longer
 * paint the overlay — but Sprint 176's hardening is still in scope
 * for queries that DO cross the 1s threshold, so the assertions below
 * remain load-bearing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  createEvent,
  act,
} from "@testing-library/react";
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

// Sprint-180 (2026-04-30) — the shared `AsyncProgressOverlay` only paints
// after the host's threshold gate flips visible to true (1s). All Sprint
// 176 invariants below now run after the timer has been advanced past the
// threshold; without `vi.useFakeTimers` here, the overlay would never
// appear and `getByRole("status", { name: "Loading" })` would throw.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper: render `DataGridTable` with `loading=true`, then advance fake
 * timers past the 1s threshold so the shared overlay materialises. Returns
 * the rendered overlay element. Sprint 180 gate-aware adapter.
 */
function renderAndCrossThreshold(props: ReturnType<typeof makeProps>) {
  const utils = render(<DataGridTable {...props} />);
  act(() => {
    vi.advanceTimersByTime(1100);
  });
  const overlay = screen.getByRole("status", { name: "Loading" });
  return { ...utils, overlay };
}

describe("DataGridTable refetch overlay (sprint-176)", () => {
  // Reason: AC-176-01 — the overlay's mouseDown handler must call
  // `e.preventDefault()`. Selection in DataGridTable is sometimes started
  // on mousedown (drag-select), so blocking only `click` is insufficient.
  // Load-bearing assertion: `event.defaultPrevented === true`.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1, F-3 split; sprint-180
  // gate-aware adaptation)
  it("[AC-176-01] overlay calls preventDefault on mouseDown", () => {
    const onSelectRow = vi.fn();
    const { overlay } = renderAndCrossThreshold(makeProps({ onSelectRow }));

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
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1, F-3 split; sprint-180
  // gate-aware adaptation)
  it("[AC-176-01] overlay calls preventDefault on click", () => {
    const onSelectRow = vi.fn();
    const { overlay } = renderAndCrossThreshold(makeProps({ onSelectRow }));

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
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1; sprint-180 gate)
  it("[AC-176-01] overlay calls preventDefault on doubleClick", () => {
    const onStartEdit = vi.fn();
    const { overlay } = renderAndCrossThreshold(makeProps({ onStartEdit }));

    const event = createEvent.dblClick(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  // Reason: AC-176-01 — contextmenu (right-click) must not open the
  // ContextMenu mid-refetch. The overlay must absorb the gesture so the
  // user can't trigger Edit/Delete/Copy actions before the refresh has
  // settled. Load-bearing assertion: `event.defaultPrevented === true`.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-1; sprint-180 gate)
  it("[AC-176-01] overlay calls preventDefault on contextmenu", () => {
    const onSelectRow = vi.fn();
    const { overlay } = renderAndCrossThreshold(makeProps({ onSelectRow }));

    const event = createEvent.contextMenu(overlay);
    fireEvent(overlay, event);

    expect(event.defaultPrevented).toBe(true);
    // Secondary user-visible checks.
    expect(onSelectRow).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // Reason: AC-176-04 — spinner visuals must be unchanged. The wrapper
  // class chain still includes the original `absolute inset-0 z-20 flex
  // items-center justify-center bg-background/60` invariants; the shared
  // `AsyncProgressOverlay` adds `flex-col gap-3` to slot the Cancel
  // button below the spinner (Sprint 180), but the original class names
  // remain — `toHaveClass` matches a subset. The Loader2 child still
  // carries `animate-spin text-muted-foreground` with width/height "24"
  // and `aria-hidden="true"`.
  // Date: 2026-04-30 (sprint-176 attempt 2 — F-5; sprint-180 gate)
  it("[AC-176-04] spinner DOM (classes, size, position) is unchanged", () => {
    const { overlay } = renderAndCrossThreshold(makeProps());

    // Wrapper class chain (locked by AC-176-04). The shared Sprint 180
    // overlay extends but does not break this invariant.
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

    // Even after threshold elapses, no overlay paints.
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(
      screen.queryByRole("status", { name: "Loading" }),
    ).not.toBeInTheDocument();

    // A direct click on a row cell should still fire onSelectRow.
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelectRow).toHaveBeenCalled();
  });

  // Sprint 180 (AC-180-01) — sub-second refetches must NOT paint the
  // overlay. Pre-threshold the overlay element is absent entirely.
  // Date: 2026-04-30 (sprint-180)
  it("[AC-180-01] does not paint overlay before 1s threshold elapses", () => {
    render(<DataGridTable {...makeProps()} />);
    // 500ms < 1000ms → still pre-threshold.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(
      screen.queryByRole("status", { name: "Loading" }),
    ).not.toBeInTheDocument();
  });

  // Sprint 180 (AC-180-02 / AC-180-06) — Cancel button surfaces with
  // the canonical accessible name "Cancel" and clicking it invokes the
  // host-supplied `onCancelRefetch`. The host then clears `loading`,
  // which (via `useDelayedFlag`) flips the overlay back off within one
  // frame.
  // Date: 2026-04-30 (sprint-180)
  it("[AC-180-02] Cancel button click invokes onCancelRefetch", () => {
    const onCancelRefetch = vi.fn();
    renderAndCrossThreshold(makeProps({ onCancelRefetch }));

    const cancelBtn = screen.getByTestId("async-cancel");
    expect(cancelBtn).toHaveAccessibleName("Cancel");
    fireEvent.click(cancelBtn);
    expect(onCancelRefetch).toHaveBeenCalledTimes(1);
  });

  // Sprint 180 (AC-180-05) — per-vector retry guarantee for DataGridTable.
  //
  // Reason (2026-04-30): the contract requires "trigger → cancel →
  // re-trigger" to land cleanly: (a) overlay disappears when loading
  // flips to false post-cancel, (b) second attempt's data renders, (c)
  // no stuck overlay. We simulate the host by re-rendering with a
  // controlled `loading` flag and a fresh `data` payload. This pins the
  // pure presentational contract of `DataGridTable` — host wiring
  // (`fetchIdRef`, `cancelQuery`) is exercised by host-level tests at
  // `rdb/DataGrid.test.tsx`. The two layers together cover Sprint 180
  // AC-180-05 for the RDB DataGrid surface.
  it("[AC-180-05-DataGridTable] cancel → re-trigger paints second attempt's data", () => {
    const onCancelRefetch = vi.fn();
    const { rerender } = render(
      <DataGridTable {...makeProps({ onCancelRefetch })} />,
    );
    // Cross 1s threshold so the overlay paints (first attempt mid-flight).
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    // User clicks Cancel: host is responsible for flipping `loading` to
    // false and bumping the fetchIdRef. We simulate by re-rendering with
    // loading=false (post-cancel resting state).
    fireEvent.click(screen.getByTestId("async-cancel"));
    expect(onCancelRefetch).toHaveBeenCalledTimes(1);
    rerender(
      <DataGridTable {...makeProps({ loading: false, onCancelRefetch })} />,
    );
    // Overlay disappears within a frame (useDelayedFlag clears
    // synchronously when input flips false).
    expect(
      screen.queryByRole("status", { name: "Loading" }),
    ).not.toBeInTheDocument();
    // Original data is still present (cancel does NOT wipe rendered rows).
    expect(screen.getByText("Alice")).toBeInTheDocument();

    // Host re-triggers the fetch with new data. We simulate by
    // re-rendering with loading=true again, then resolving with a fresh
    // payload.
    rerender(
      <DataGridTable {...makeProps({ loading: true, onCancelRefetch })} />,
    );
    // Cross threshold for the second attempt's overlay.
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    // Second attempt resolves with distinct data (e.g., Carol replaces
    // Alice/Bob). Host flips loading=false and supplies the new data.
    const SECOND_ATTEMPT_DATA: TableData = {
      ...MOCK_DATA,
      rows: [[3, "Carol"]],
      total_count: 1,
    };
    rerender(
      <DataGridTable
        {...makeProps({
          loading: false,
          data: SECOND_ATTEMPT_DATA,
          onCancelRefetch,
        })}
      />,
    );
    expect(
      screen.queryByRole("status", { name: "Loading" }),
    ).not.toBeInTheDocument();
    // Second attempt's data is on screen; first attempt's data is gone.
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });
});
