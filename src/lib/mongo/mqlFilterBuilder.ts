/**
 * Pure builder that converts structured filter conditions into a
 * MongoDB MQL filter document. Used by `DocumentFilterBar` so the
 * Structured tab stays decoupled from the editor + data grid.
 *
 * Scope:
 * - Flat field paths only (no nested `a.b.c`).
 * - Operators (field-level, 10): `$eq`, `$ne`, `$gt`, `$gte`, `$lt`,
 *   `$lte`, `$in`, `$nin`, `$exists`, `$regex`.
 * - Composite operators (13 ops total = 10 + 3):
 *   - `$or` — surfaced through `matchMode: "any"` on `buildMqlFilter`.
 *     All rows become elements of a top-level `$or` array. Single-row
 *     `any` mode is emitted without the array wrap (Mongo-equivalent
 *     but shorter; see D-26).
 *   - `$and` — implicit. Multi-field flat object is already
 *     Mongo-equivalent to `$and: [...]`. No explicit wrap is emitted
 *     (D-25).
 *   - `$not` — per-row toggle via `MqlCondition.negate`. The
 *     operator clause is wrapped: `{ $not: <clause> }`.
 * - Numeric coercion is best-effort. A whitespace-only string is NOT
 *   coerced — `Number("  ") === 0` would otherwise silently turn blank
 *   cells into zero.
 * - `$exists` accepts case-insensitive `"true"` / `"false"` → boolean.
 * - `$in` / `$nin` accept comma-separated input — tokens are trimmed,
 *   empty tokens dropped, then numerically coerced per-token. Empty
 *   arrays are skipped because `$in: []` matches nothing (almost
 *   always a typo). See D-23.
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
  /** When true, wrap the operator clause in `$not`. */
  negate?: boolean;
}

/**
 * How the structured rows combine. `"all"` = implicit `$and` (current
 * default, flat object). `"any"` = `$or` array of per-row clauses.
 * Single-element `any` mode collapses to the inner clause to avoid the
 * pointless `[single]` wrap (D-26).
 */
export type MatchMode = "all" | "any";

// Order = frequency (phase-28 Q7: 13 ops by frequency). Display label uses
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
    // matching nothing / everything. See D-23.
    if (arr.length === 0) return null;
    return { [operator]: arr };
  }
  if (NUMERIC_OPERATORS.has(operator)) {
    return { [operator]: coerceNumeric(raw) };
  }
  return { [operator]: raw };
}

function wrapNot(
  clause: Record<string, unknown> | null,
  negate: boolean | undefined,
): Record<string, unknown> | null {
  if (clause === null) return null;
  if (!negate) return clause;
  return { $not: clause };
}

/**
 * Build a Mongo filter document from a list of conditions.
 *
 * - `matchMode="all"` (default): multi-field flat object — implicit
 *   `$and`. Multiple operators on the same field merge into one nested
 *   object (`{ age: { $gte: 18, $lt: 65 } }`).
 * - `matchMode="any"`: per-row clauses become elements of a top-level
 *   `$or` array. Same-field merging is intentionally disabled in this
 *   mode (each row is its own element). Single-row collapses to the
 *   inner clause (D-26).
 *
 * Rows with `negate: true` have their operator clause wrapped in
 * `$not`. Rows whose `buildOperatorClause` returns null (e.g. empty
 * `$in` array) are dropped silently per D-23.
 */
export function buildMqlFilter(
  conditions: readonly MqlCondition[],
  matchMode: MatchMode = "all",
): Record<string, unknown> {
  if (matchMode === "any") {
    const elements: Record<string, unknown>[] = [];
    for (const c of conditions) {
      if (c.field.length === 0) continue;
      const clause = wrapNot(
        buildOperatorClause(c.operator, c.value),
        c.negate,
      );
      if (clause === null) continue;
      elements.push({ [c.field]: clause });
    }
    if (elements.length === 0) return {};
    if (elements.length === 1) return elements[0]!;
    return { $or: elements };
  }

  const result: Record<string, unknown> = {};
  for (const c of conditions) {
    if (c.field.length === 0) continue;
    const clause = wrapNot(buildOperatorClause(c.operator, c.value), c.negate);
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
