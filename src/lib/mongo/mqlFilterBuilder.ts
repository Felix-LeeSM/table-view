/**
 * Sprint 122 — Pure builder that converts a list of structured filter
 * conditions into a MongoDB MQL filter document. Used by the document
 * paradigm's `DocumentFilterBar` to keep the Structured tab decoupled from
 * the editor and the data grid.
 *
 * Scope (v1):
 * - Flat field paths only (no nested `a.b.c`).
 * - Eight operators: `$eq` `$ne` `$gt` `$lt` `$gte` `$lte` `$regex`
 *   `$exists`. Composite operators (`$or`, `$and`, `$in`, `$elemMatch`)
 *   are deferred to a follow-up sprint.
 * - Numeric coercion is best-effort: a value parses as a number when
 *   `Number(raw)` is finite (and the input is not whitespace-only —
 *   `Number("  ") === 0` would otherwise silently coerce blank cells);
 *   otherwise it stays a string.
 * - `$exists` accepts `"true"` / `"false"` (case-insensitive) → boolean.
 * - Empty conditions list → `{}` (no-op filter).
 */

export type MqlOperator =
  | "$eq"
  | "$ne"
  | "$gt"
  | "$lt"
  | "$gte"
  | "$lte"
  | "$regex"
  | "$exists";

export interface MqlCondition {
  /** Stable identity for React keys; not serialised. */
  id: string;
  field: string;
  operator: MqlOperator;
  /** Always a string at the form layer; coerced at build time. */
  value: string;
}

export const MQL_OPERATORS: { value: MqlOperator; label: string }[] = [
  { value: "$eq", label: "=" },
  { value: "$ne", label: "≠" },
  { value: "$gt", label: ">" },
  { value: "$lt", label: "<" },
  { value: "$gte", label: "≥" },
  { value: "$lte", label: "≤" },
  { value: "$regex", label: "regex" },
  { value: "$exists", label: "exists" },
];

const NUMERIC_OPERATORS: ReadonlySet<MqlOperator> = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$lt",
  "$gte",
  "$lte",
]);

function coerceNumeric(raw: string): string | number {
  if (raw.length === 0) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  // Reject pure-whitespace inputs — `Number("  ") === 0` would otherwise
  // silently coerce blank cells.
  if (raw.trim().length === 0) return raw;
  return n;
}

function coerceBoolean(raw: string): boolean {
  return raw.trim().toLowerCase() === "true";
}

function buildOperatorClause(
  operator: MqlOperator,
  raw: string,
): Record<string, unknown> {
  if (operator === "$exists") {
    return { [operator]: coerceBoolean(raw) };
  }
  if (operator === "$regex") {
    return { [operator]: raw };
  }
  if (NUMERIC_OPERATORS.has(operator)) {
    return { [operator]: coerceNumeric(raw) };
  }
  return { [operator]: raw };
}

/**
 * Build a Mongo filter document from a list of conditions. Multiple
 * operators on the same field are merged into a nested object. Multiple
 * fields become top-level keys (implicit `$and`).
 */
export function buildMqlFilter(
  conditions: readonly MqlCondition[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const c of conditions) {
    if (c.field.length === 0) continue;
    const clause = buildOperatorClause(c.operator, c.value);
    const existing = result[c.field];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      result[c.field] = { ...(existing as Record<string, unknown>), ...clause };
    } else {
      result[c.field] = clause;
    }
  }
  return result;
}

/**
 * Render a filter object as a stable JSON string. Used for the
 * Structured → Raw mode swap so the raw editor inherits the structured
 * filter the user already built.
 */
export function stringifyMqlFilter(filter: Record<string, unknown>): string {
  return JSON.stringify(filter, null, 2);
}
