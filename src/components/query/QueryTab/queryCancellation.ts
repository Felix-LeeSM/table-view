/**
 * Shared cancellation-message classifier for query runners.
 *
 * Every cancel-capable backend surfaces a user cancel as a
 * "…cancelled/canceled…" error string, so a user's own Cancel must land on
 * cancelled-state — not a red `role="alert"` error banner. Extracted from
 * `rdbQueryExecution` (#1230) into a shared module (#1561) so RDB / Search /
 * Mongo route cancellation identically (consistency-first).
 */
export function isQueryCancellationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.startsWith("cancel:") ||
    normalized.includes("query cancelled") ||
    normalized.includes("query canceled") ||
    normalized.includes("operation cancelled") ||
    normalized.includes("operation canceled") ||
    normalized.includes("canceling statement due to user request") ||
    normalized.includes("cancelling statement due to user request") ||
    // Issue #1230 (PR #1241 review) — MySQL/MariaDB surface a native KILL
    // QUERY as ER_QUERY_INTERRUPTED (1317). Backend `finalize_cancelled`
    // normally rewrites this to "Query cancelled", but keep a frontend
    // backstop so an interrupt reaching here still lands on cancelled and no
    // DBMS-specific asymmetry survives.
    normalized.includes("query execution was interrupted")
  );
}
