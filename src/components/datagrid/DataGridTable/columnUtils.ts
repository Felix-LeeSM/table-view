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

export function calcDefaultColWidth(name: string, dataType: string): number {
  const nameWidth = name.length * 8 + 40;
  const typeWidth = dataType.length * 6 + 20;
  return Math.max(MIN_COL_WIDTH, Math.min(400, Math.max(nameWidth, typeWidth)));
}
