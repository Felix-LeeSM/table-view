/**
 * Pure builder that converts structured filter conditions into a
 * MongoDB MQL filter document. Used by `DocumentFilterBar` so the
 * Structured tab stays decoupled from the editor + data grid.
 *
 * Scope:
 * - Flat field paths only (no nested `a.b.c`).
 * - Operators (field-level, 10): `$eq`, `$ne`, `$gt`, `$gte`, `$lt`,
 *   `$lte`, `$in`, `$nin`, `$exists`, `$regex`. Composite operators
 *   (`$or` / `$and` / `$not`) are reserved for Sprint 314 (Slice B.2).
 * - Numeric coercion is best-effort. A whitespace-only string is NOT
 *   coerced — `Number("  ") === 0` would otherwise silently turn blank
 *   cells into zero.
 * - `$exists` accepts case-insensitive `"true"` / `"false"` → boolean.
 * - `$in` / `$nin` accept comma-separated input — tokens are trimmed,
 *   empty tokens dropped, then numerically coerced per-token. Empty
 *   arrays are skipped because `$in: []` matches nothing (almost
 *   always a typo). See sprint-313 D-23.
 * - Empty conditions → `{}` (no-op filter).
 */

export type MqlOperator =
  | "$eq"
  | "$ne"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$in"
  | "$nin"
  | "$exists"
  | "$regex";

export interface MqlCondition {
  /** Stable identity for React keys; not serialised. */
  id: string;
  field: string;
  operator: MqlOperator;
  /** Always a string at the form layer; coerced at build time. */
  value: string;
}

// Order = frequency (phase-28 Q7: "13 ops 빈도순"). Display label uses
// SQL idiom for IN / NOT IN so RDB ↔ Mongo flippers see the same word
// (D-22). $exists / $regex use lowercase Mongo names because there is
// no SQL equivalent worth aliasing.
export const MQL_OPERATORS: { value: MqlOperator; label: string }[] = [
  { value: "$eq", label: "=" },
  { value: "$ne", label: "≠" },
  { value: "$gt", label: ">" },
  { value: "$gte", label: "≥" },
  { value: "$lt", label: "<" },
  { value: "$lte", label: "≤" },
  { value: "$in", label: "IN" },
  { value: "$nin", label: "NOT IN" },
  { value: "$exists", label: "exists" },
  { value: "$regex", label: "regex" },
];

const NUMERIC_OPERATORS: ReadonlySet<MqlOperator> = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
]);

const ARRAY_OPERATORS: ReadonlySet<MqlOperator> = new Set(["$in", "$nin"]);

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

function coerceArray(raw: string): unknown[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => coerceNumeric(s));
}

function buildOperatorClause(
  operator: MqlOperator,
  raw: string,
): Record<string, unknown> | null {
  if (operator === "$exists") {
    return { [operator]: coerceBoolean(raw) };
  }
  if (operator === "$regex") {
    return { [operator]: raw };
  }
  if (ARRAY_OPERATORS.has(operator)) {
    const arr = coerceArray(raw);
    // `$in: []` / `$nin: []` are almost certainly typos — drop the
    // clause so the row degrades to a no-op instead of silently
    // matching nothing / everything. Sprint-313 D-23.
    if (arr.length === 0) return null;
    return { [operator]: arr };
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
    if (clause === null) continue;
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
