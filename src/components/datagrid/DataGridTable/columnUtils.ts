/**
 * Pure helpers + constants for `DataGridTable`.
 *
 * 책임: column width 계산 / FK reference 파싱 / BLOB 컬럼 판별 + 가상화
 * 임계값 같은 상수. React import 0, store import 0 — 어떤 sub-file 도
 * 의존할 수 있도록 유지. Sprint 200 (`DataGridTable.tsx` 1071-line god
 * file 분해) 에서 entry 로부터 추출.
 *
 * 외부 invariant:
 * - `parseFkReference` 의 wire format 은 `"<schema>.<table>(<column>)"`
 *   (Sprint 89 / #FK-1) — Rust 측 `format_fk_reference`
 *   (`src-tauri/src/db/postgres.rs`) 와 짝. 두 사이드는
 *   `tests/fixtures/fk_reference_samples.json` 으로 lock-step.
 * - `parseFkReference` named export 는 `DataGridTable.tsx` (entry) 에서
 *   re-export 되어 있으며 이는 외부 test (`DataGridTable.parseFkReference.test.ts`)
 *   가 의존하는 contract — re-export path 변경 금지.
 */

export const MIN_COL_WIDTH = 60;

/**
 * Sprint-114 (#PERF-1, #GRID-3) — page sizes above this threshold switch the
 * tbody render path to a `@tanstack/react-virtual` viewport. Below it we
 * keep the eager render so the existing DataGrid tests (which use small
 * fixtures) continue to assert against full DOM output without spacers.
 */
export const VIRTUALIZE_THRESHOLD = 200;

/**
 * Sprint-114 — single-source row height for the virtualizer. The body cells
 * use `px-3 py-1 text-xs` which renders ~28-32px in the table; we estimate
 * 32px to include the `border-b` and stay slightly conservative so overscan
 * doesn't clip when row content varies. `react-virtual` measures actual DOM
 * heights as rows render, so the estimate only governs initial layout.
 */
export const ROW_HEIGHT_ESTIMATE = 32;

/**
 * Parse a foreign-key reference string of the form
 * `"<schema>.<table>(<column>)"` (the canonical contract aligned by
 * sprint-89 / #FK-1) into its three components.
 *
 * Returns `null` when the input does not match the expected shape — for
 * example bare `"<table>.<column>"` strings (the pre-sprint-89 backend
 * shape) or empty input.
 *
 * Exported so that both the production `DataGridTable` render path and the
 * vitest contract tests (`DataGridTable.parseFkReference.test.ts`) consume
 * exactly one implementation. The Rust counterpart is
 * `format_fk_reference` in `src-tauri/src/db/postgres.rs` and the two
 * sides are kept in lock-step via `tests/fixtures/fk_reference_samples.json`.
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
