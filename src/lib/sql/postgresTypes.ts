// Sprint 227 — canonical Postgres common-type list for the CREATE
// TABLE column-type combobox. Extracted from `CreateTableDialog.tsx`
// so unit tests can exercise the filter behaviour against a stable
// source-of-truth list without re-rendering the modal.
//
// Ordering matches the spec's `AC-227-03` exemplar list (≥ 25 entries).
// The combobox renders entries verbatim — no coloring (deferred to
// Sprint 230 polish) — and supports free-text fallback for any custom
// type string (`numeric(10,4)`) by committing the raw input on blur.
export const POSTGRES_COMMON_TYPES: readonly string[] = [
  "serial",
  "bigserial",
  "smallserial",
  "integer",
  "bigint",
  "smallint",
  "varchar",
  "varchar(255)",
  "text",
  "boolean",
  "timestamp",
  "timestamptz",
  "date",
  "time",
  "numeric",
  "numeric(10,2)",
  "real",
  "double precision",
  "uuid",
  "jsonb",
  "json",
  "bytea",
  "inet",
  "cidr",
  "interval",
  "char",
  "money",
  "tsvector",
  "xml",
] as const;

/**
 * Case-insensitive substring filter over the canonical list. Empty
 * `query` returns the full list. Match logic is `toLowerCase()`
 * substring (`includes`), not `startsWith`, so users typing `int`
 * surface `integer`, `bigint`, `smallint`, `interval` together (per
 * AC-227-03 testable assertion).
 */
export function filterPostgresTypes(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...POSTGRES_COMMON_TYPES];
  return POSTGRES_COMMON_TYPES.filter((t) => t.toLowerCase().includes(q));
}

// Parametric type defaults — when the user picks a bare parametric
// type from the suggestions list (e.g. `varchar`), the combobox auto-
// expands it to the canonical default form so the user doesn't have to
// remember the parameter syntax. Caret placement (between parens) is
// the caller's job.
export const PARAMETRIC_TYPE_DEFAULTS: Readonly<Record<string, string>> = {
  varchar: "varchar(255)",
  char: "char(1)",
  numeric: "numeric(10,2)",
};

/**
 * Returns the parametric expansion if `type` is a bare parametric type
 * with a known default; otherwise returns `type` unchanged. Idempotent
 * — `expandParametricDefault("varchar(255)")` returns the same string.
 */
export function expandParametricDefault(type: string): string {
  return PARAMETRIC_TYPE_DEFAULTS[type] ?? type;
}

/**
 * Sprint 230 — case-insensitive substring filter against an arbitrary
 * type list. Used by the combobox when a dynamic `typesSource` prop
 * is supplied (the dialog merges canonical + live PG types via
 * `usePostgresTypes`). Empty `query` returns the full list; matching
 * mirrors `filterPostgresTypes` semantics (`includes`, not
 * `startsWith`) so AC-227-03 behaviour is preserved verbatim against
 * the dynamic list.
 */
export function filterPostgresTypesAgainst(
  list: readonly string[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...list];
  return list.filter((t) => t.toLowerCase().includes(q));
}
