/**
 * Sprint 267 — structured identifier for Sprint 266's `AppError::DbMismatch`.
 *
 * Backend serialises the variant via `Display`:
 *   "Database mismatch: expected '<EXPECTED>', backend pool has '<ACTUAL>'"
 *
 * Frontend uses this regex match to route mismatch errors to a dedicated
 * recovery flow (verifyActiveDb + setActiveDb sync) instead of surfacing
 * as a generic execution error.
 */

export interface DbMismatchInfo {
  expected: string;
  actual: string;
}

const DB_MISMATCH_RE =
  /^Database mismatch: expected '([^']*)', backend pool has '([^']*)'$/;

export function parseDbMismatch(message: string): DbMismatchInfo | null {
  const m = DB_MISMATCH_RE.exec(message);
  if (!m) return null;
  return { expected: m[1]!, actual: m[2]! };
}
