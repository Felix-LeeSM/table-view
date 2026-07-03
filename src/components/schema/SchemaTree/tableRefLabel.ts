import type { RdbTreeShape } from "../treeShape";

/**
 * DBMS-shape-aware label for a pinned/recent table (#1218 AC4). The three
 * relational shapes render the same section but qualify the name differently:
 *
 *   - `with-schema` (PG/MSSQL/Oracle) → `schema.table` — the schema layer is
 *     real and disambiguates same-named tables across schemas.
 *   - `no-schema` (MySQL/MariaDB) → `table` — the "schema" the tree carries is
 *     really the database name, so a prefix would be redundant noise.
 *   - `flat` (SQLite/DuckDB) → `table` — there is no schema layer at all.
 *
 * Keeping schemaless shapes to the bare table keeps the two schemaless shapes
 * consistent; cross-db context lives in the tooltip (`formatTableRefTitle`).
 */
export function formatTableRefLabel(
  shape: RdbTreeShape,
  schema: string | null,
  table: string,
): string {
  if (shape === "with-schema" && schema) return `${schema}.${table}`;
  return table;
}

/**
 * Fully-qualified tooltip so a recent/pinned row stays unambiguous even when
 * the visible label drops the schema/db. Always `db.schema.table` when a
 * schema is present, else `db.table`.
 */
export function formatTableRefTitle(
  db: string,
  schema: string | null,
  table: string,
): string {
  return schema ? `${db}.${schema}.${table}` : `${db}.${table}`;
}
