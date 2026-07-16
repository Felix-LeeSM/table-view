/**
 * Pure helpers + constants for `DataGridTable`. Zero React/store
 * imports so any sub-file can depend on it.
 *
 * `parseFkReference`'s wire format `"<schema>.<table>(<column>)"` is
 * paired with the Rust `format_fk_reference` (db/postgres.rs); the two
 * sides stay in lock-step via `tests/fixtures/fk_reference_samples.json`.
 * `parseFkReference` is re-exported from `DataGridTable.tsx` because
 * external tests depend on that path — don't move it.
 */

export const MIN_COL_WIDTH = 60;

/**
 * Above this row count, `<tbody>` is rendered through
 * `@tanstack/react-virtual`. Below it we keep the eager render so
 * existing DataGrid tests (small fixtures) assert against full DOM.
 */
export const VIRTUALIZE_THRESHOLD = 200;

/**
 * Estimated body-row height for the virtualizer. Body cells render
 * ~28-32px; 32px is slightly conservative so overscan doesn't clip when
 * content varies. `react-virtual` measures actual DOM after first paint,
 * so this only governs initial layout.
 */
export const ROW_HEIGHT_ESTIMATE = 32;

/**
 * Issue #1446 — above this visible-column count a row renders only the
 * horizontally-visible slice of columns (column virtualization). Below it
 * every column renders eagerly so narrow grids (and their DOM-shape tests)
 * are byte-identical to the pre-#1446 behavior.
 */
export const COLUMN_VIRTUALIZE_THRESHOLD = 30;

/**
 * Extra columns rendered on each side of the visible window so a fast
 * horizontal scroll doesn't flash empty cells. Small (unlike the row
 * overscan of 24) because column jumps are bounded by viewport width.
 */
export const COLUMN_OVERSCAN = 3;

/**
 * Issue #1446 — pure column-window math. Given per-visual-column widths
 * (px), the current horizontal `scrollLeft` and the viewport width,
 * return the `[start, end]` inclusive visual-column range to render
 * (overscan applied). No React/DOM deps so it's unit-testable.
 */
export function computeColumnWindow(
  widths: number[],
  scrollLeft: number,
  viewportWidth: number,
  overscan = COLUMN_OVERSCAN,
): { start: number; end: number } {
  const total = widths.length;
  const viewRight = scrollLeft + viewportWidth;
  let start = total;
  let end = -1;
  let left = 0;
  for (let i = 0; i < total; i++) {
    const right = left + widths[i]!;
    if (start === total && right > scrollLeft) start = i;
    if (left < viewRight) end = i;
    left = right;
  }
  // Degenerate (zero viewport / empty) → render everything to stay safe.
  if (start > end) {
    start = 0;
    end = total - 1;
  }
  return {
    start: Math.max(0, start - overscan),
    end: Math.min(total - 1, end + overscan),
  };
}

/**
 * Parse `"<schema>.<table>(<column>)"`. Returns `null` on the legacy
 * bare-`"<table>.<column>"` shape or empty input. The production grid
 * and the contract test both consume this single implementation.
 */
export function parseFkReference(
  ref: string,
): { schema: string; table: string; column: string } | null {
  const match = ref.match(/^(.+)\.(.+)\((.+)\)$/);
  if (!match) return null;
  return { schema: match[1]!, table: match[2]!, column: match[3]! };
}

export function isBlobColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return (
    lower.includes("blob") ||
    lower.includes("bytea") ||
    lower.includes("binary") ||
    lower.includes("varbinary") ||
    lower.includes("image")
  );
}
