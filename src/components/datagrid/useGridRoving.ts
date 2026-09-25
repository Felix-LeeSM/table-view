import { useCallback, useRef, useState } from "react";

/**
 * WAI-ARIA grid roving-tabindex + arrow-key 2D navigation (shared by the
 * datagrid).
 *
 * Exactly one grid data cell sits in the tab order (`tabIndex=0`); the rest
 * are `-1`. The user moves focus with the arrow keys. Coordinates: `row` =
 * 0-based data row, `col` = 0-based visual column.
 *
 * Focus split (regression lesson from SchemaTree/useTreeRoving):
 * - `syncFocus` (cell `onFocus`): updates the roving STATE only. Never calls
 *   `.focus()`. The cell already holds focus, so a deferred `.focus()` here
 *   would let a later rAF yank focus back after the user has moved to
 *   another control (e.g. the SQL editor) and drop their key input
 *   (mariadb E2E regression).
 * - `onKeyDown` (arrow keys): the only place that moves DOM focus (deferred
 *   via rAF).
 *
 * The current focus cell is mirrored into a ref so the keydown handler reads
 * the latest value without a stale closure (useTreeRoving pattern).
 *
 * Virtualized grid (RDB): a target row outside the virtual window is not
 * in the DOM, so `.focus()` is a no-op. When `opts.scrollRowIntoView` is
 * given and the cell is not found on the first rAF, that callback scrolls
 * the row into render and focus retries for a few more frames. Callers
 * without the callback (Document grid) always have the cell in the DOM and
 * focus on attempt 0 — unchanged single-frame behavior.
 */

export interface GridRoving {
  focusedCell: { row: number; col: number };
  /** For cell `onFocus` — STATE ONLY. Does not call `.focus()`. */
  syncFocus: (row: number, col: number) => void;
  /**
   * For the `role="grid"` container — arrows/Home/End/PageUp·Down/Ctrl+Home·End.
   * The only place that moves DOM focus. ArrowUp from row 0 enters the
   * matching column header cell
   * (#1127; header→body return is HeaderRow's ArrowDown).
   */
  onKeyDown: (e: React.KeyboardEvent) => void;
  cellTabIndex: (row: number, col: number) => 0 | -1;
  /**
   * Issue #1734 (5) — focuses the current anchor cell through the same
   * scroll-in + bounded rAF retry the arrow keys use. Grid-external callers
   * (Quick Look's focus exchange) need this: a plain
   * `querySelector('[data-grid-row][tabindex="0"]')` returns null while the
   * anchor row sits outside the virtual window, and `.focus()` on null is a
   * silent no-op that drops focus to `<body>`.
   */
  focusAnchorCell: () => void;
}

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

// ponytail: the virtualizer renders the scrolled-to row within a few frames.
// Give up after N frames so focus cannot loop forever.
const MAX_FOCUS_FRAMES = 6;

// ponytail: fixed page size. If dynamic paging based on the viewport row
// count is ever needed, lift this to a computed value passed in from
// container clientHeight / row height.
const PAGE_ROWS = 10;

export function useGridRoving(
  rowCount: number,
  colCount: number,
  containerRef: React.RefObject<HTMLElement | null>,
  opts?: { scrollRowIntoView?: (row: number) => void },
): GridRoving {
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });
  const focusedRef = useRef(focusedCell);
  focusedRef.current = focusedCell;

  // opts is a fresh closure on every render. Mirror the latest value into a
  // ref so the keydown handler always calls the current callback without a
  // useCallback dep.
  const scrollRef = useRef(opts?.scrollRowIntoView);
  scrollRef.current = opts?.scrollRowIntoView;

  // When rowCount/colCount shrink, focus may fall outside the range. Clamp so
  // exactly one cell stays the tab stop (out of range → (0,0) is the tab stop).
  const clampedRow = rowCount > 0 ? clamp(focusedCell.row, rowCount - 1) : 0;
  const clampedCol = colCount > 0 ? clamp(focusedCell.col, colCount - 1) : 0;

  const cellTabIndex = useCallback(
    (row: number, col: number): 0 | -1 =>
      row === clampedRow && col === clampedCol ? 0 : -1,
    [clampedRow, clampedCol],
  );

  // mouse / programmatic focus sync: the cell already holds focus, so only
  // move the roving anchor. Do not call `.focus()` (avoids focus-stealing).
  const syncFocus = useCallback((row: number, col: number) => {
    const next = { row, col };
    focusedRef.current = next;
    setFocusedCell(next);
  }, []);

  const cellAt = useCallback(
    (row: number, col: number) =>
      containerRef.current?.querySelector<HTMLElement>(
        `[data-grid-row="${row}"][data-grid-col="${col}"]`,
      ) ?? null,
    [containerRef],
  );

  // bounded rAF retry: if the cell is in the DOM it gets focus on the first
  // frame (the Document grid is always here). If not, the row is outside the
  // virtual window — scroll it in with scrollRowIntoView and retry a few
  // frames (RDB virtualized grid).
  const focusCell = useCallback(
    (row: number, col: number) => {
      let attempt = 0;
      const tryFocus = () => {
        const el = cellAt(row, col);
        if (el) {
          el.focus();
          return;
        }
        if (attempt === 0) scrollRef.current?.(row);
        if (attempt < MAX_FOCUS_FRAMES) {
          attempt++;
          requestAnimationFrame(tryFocus);
        }
      };
      requestAnimationFrame(tryFocus);
    },
    [cellAt],
  );

  // #1734 (5) — same target as `[data-grid-row][tabindex="0"]`, but survives the
  // anchor row being virtualized out. Synchronous when the cell is already
  // rendered (the common case, and what keeps close-the-panel focus restoration
  // from flashing through `<body>`); otherwise it falls into `focusCell`'s
  // scroll-in + retry. `onKeyDown` deliberately keeps its unconditional rAF
  // defer — see the focus-split note in this file's header.
  const focusAnchorCell = useCallback(() => {
    const el = cellAt(clampedRow, clampedCol);
    if (el) {
      el.focus();
      return;
    }
    focusCell(clampedRow, clampedCol);
  }, [cellAt, focusCell, clampedRow, clampedCol]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const { key } = e;
      if (
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "Home" &&
        key !== "End" &&
        key !== "PageUp" &&
        key !== "PageDown"
      ) {
        return;
      }
      // Act only when a data cell holds focus. Header cells / resize
      // separators / editing <input>s / nested toggle buttons have no
      // [data-grid-row], so they are filtered out here → their keys pass
      // through untouched.
      const target = e.target as HTMLElement;
      if (!target.matches("[data-grid-row]")) return;
      if (rowCount === 0 || colCount === 0) return;

      e.preventDefault();

      const { row, col } = focusedRef.current;
      let nextRow = clamp(row, rowCount - 1);
      let nextCol = clamp(col, colCount - 1);

      // #1127 AC1 — ArrowUp from the topmost data row enters the matching
      // column header cell. The header is the grid container's Nth
      // role="columnheader" (N = visual col). Leave the body roving anchor
      // alone and only hand focus to the header (its onFocus syncs its own
      // roving; ArrowDown returns to this column's data cell). A grid without
      // headers gives undefined → falls through to the clamp below (existing
      // behavior).
      if (key === "ArrowUp" && nextRow === 0) {
        const header = containerRef.current?.querySelectorAll<HTMLElement>(
          '[role="columnheader"]',
        )[nextCol];
        if (header) {
          header.focus();
          return;
        }
      }

      // #1127 AC2 — Ctrl/Cmd+Home/End jumps to the first/last *cell* (grid
      // corner). Plain Home/End moves only to the first/last col of the
      // current row.
      const corner = e.ctrlKey || e.metaKey;
      if (key === "ArrowUp") nextRow = clamp(nextRow - 1, rowCount - 1);
      else if (key === "ArrowDown") nextRow = clamp(nextRow + 1, rowCount - 1);
      else if (key === "ArrowLeft") nextCol = clamp(nextCol - 1, colCount - 1);
      else if (key === "ArrowRight") nextCol = clamp(nextCol + 1, colCount - 1);
      else if (key === "Home") {
        nextCol = 0;
        if (corner) nextRow = 0;
      } else if (key === "End") {
        nextCol = colCount - 1;
        if (corner) nextRow = rowCount - 1;
      } else if (key === "PageUp")
        nextRow = clamp(nextRow - PAGE_ROWS, rowCount - 1);
      else if (key === "PageDown")
        nextRow = clamp(nextRow + PAGE_ROWS, rowCount - 1);

      const next = { row: nextRow, col: nextCol };
      focusedRef.current = next;
      setFocusedCell(next);
      focusCell(nextRow, nextCol);
    },
    [rowCount, colCount, focusCell, containerRef],
  );

  return {
    focusedCell: { row: clampedRow, col: clampedCol },
    syncFocus,
    onKeyDown,
    cellTabIndex,
    focusAnchorCell,
  };
}
