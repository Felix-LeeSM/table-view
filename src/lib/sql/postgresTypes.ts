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
