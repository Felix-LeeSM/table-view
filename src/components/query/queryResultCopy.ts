import type { QueryResult } from "@/types/query";

/** Format a scalar cell value for clipboard copy: NULL sentinel, strings as-is,
 *  primitives via `String`, objects via `JSON.stringify` (with a safe fallback). */
export function formatCopyValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Pretty-print a value as 2-space JSON for clipboard copy (safe fallback). */
export function formatCopyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Copy text for a non-grid (count / list / findOne) result: the count cell,
 *  a newline-joined first column, or empty for an empty findOne. */
export function formatNonGridCopyText(
  result: QueryResult,
  mode: "count" | "list" | "findOne-empty",
): string {
  if (mode === "findOne-empty" || result.rows.length === 0) return "";
  if (mode === "count") return formatCopyValue(result.rows[0]?.[0]);
  return result.rows.map((row) => formatCopyValue(row[0])).join("\n");
}
