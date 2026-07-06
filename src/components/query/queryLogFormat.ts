// Issue #1369 — shared query-log formatters. Previously copy-pasted verbatim
// into QueryLog.tsx and GlobalQueryLogPanel.tsx; a single source keeps the
// 80-char truncation invariant and the relative-time buckets from drifting
// (relevant to the #1074 i18n pass, which will localise these strings once).

/** Truncate SQL to `maxLen`, appending an ellipsis when it overflows. */
export function truncateSql(sql: string, maxLen: number): string {
  if (sql.length <= maxLen) return sql;
  return sql.slice(0, maxLen) + "...";
}

/** Human-readable "time since" label for a millisecond epoch timestamp. */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
