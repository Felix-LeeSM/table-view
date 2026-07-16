import type { QueryResult } from "@/types/query";

/**
 * #1441 P3-3 — defense-in-depth cross-check for the datagrid / raw-query grid
 * commit batch. Every statement the grid emits is a single-row
 * UPDATE/DELETE/INSERT, so a committed batch should report exactly one affected
 * row per DML statement.
 *
 * The backend single-row guard (#1432, `enforce_single_row_effect`) already
 * rolls a violating batch back before it returns, so on the guarded path this
 * never fires. It exists to catch a dialect/path the guard misses or a future
 * regression: without it a 0-row / partial write would flow back as a plain
 * success. Returns the mismatch summary when `sum(rows_affected) !== dmlCount`,
 * else `null`. Non-DML / non-array inputs are ignored (the batch executors type
 * their result loosely / mock it as `undefined`).
 */
export function detectBatchRowsAffectedMismatch(
  results: unknown,
): { affected: number; expected: number } | null {
  if (!Array.isArray(results)) return null;
  let expected = 0;
  let affected = 0;
  for (const r of results) {
    const qt = (r as QueryResult | undefined)?.queryType;
    if (qt && typeof qt === "object" && "dml" in qt) {
      expected += 1;
      affected += qt.dml.rows_affected;
    }
  }
  if (expected === 0) return null;
  return affected === expected ? null : { affected, expected };
}
