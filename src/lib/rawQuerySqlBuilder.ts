import type { ColumnInfo } from "../types/schema";

/**
 * Quote a SQL identifier with double quotes, escaping internal `"`.
 * The backend uses the same convention for identifiers in generated SQL.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Escape a single-quoted SQL string literal. */
function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Format a value for inclusion in a raw SQL statement. Strings are
 * single-quoted (with embedded `'` doubled); booleans and numbers go in
 * literally; null becomes the unquoted SQL `NULL`.
 *
 * For raw query edits the user types the new value as a string — we still
 * pass it through `quoteString` so it round-trips safely even when the
 * column is numeric (`'42'` is implicitly cast).
 */
function literal(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return quoteString(JSON.stringify(value));
  return quoteString(String(value));
}

/**
 * Build the WHERE clause that uniquely identifies one row by its primary
 * key columns. The row layout matches `resultColumnNames`, which is the
 * raw query's projection — we use index lookups to find each PK value.
 */
function buildPkWhere(
  row: unknown[],
  resultColumnNames: string[],
  pkColumns: string[],
): string {
  return pkColumns
    .map((pk) => {
      const idx = resultColumnNames.indexOf(pk);
      const value = row[idx];
      return `${quoteIdent(pk)} = ${literal(value)}`;
    })
    .join(" AND ");
}

export interface RawEditPlan {
  schema: string;
  table: string;
  pkColumns: string[];
  /** Result column index → underlying column name (no aliasing for now). */
  resultColumnNames: string[];
}

/**
 * Generate UPDATE / DELETE statements for raw query edits. The shape mirrors
 * `datagrid/sqlGenerator.ts` so the preview UX feels consistent — but it
 * skips INSERT (raw query results have no canonical "new row" target).
 */
export function buildRawEditSql(
  rows: unknown[][],
  pendingEdits: Map<string, string>,
  pendingDeletedRowKeys: Set<string>,
  plan: RawEditPlan,
): string[] {
  const qualifiedTable = `${quoteIdent(plan.schema)}.${quoteIdent(plan.table)}`;
  const statements: string[] = [];

  pendingEdits.forEach((newValue, key) => {
    const [rowStr, colStr] = key.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const colName = plan.resultColumnNames[colIdx];
    const row = rows[rowIdx];
    if (!colName || !row) return;
    const where = buildPkWhere(row, plan.resultColumnNames, plan.pkColumns);
    const valueLiteral = newValue === "" ? "NULL" : quoteString(newValue);
    statements.push(
      `UPDATE ${qualifiedTable} SET ${quoteIdent(colName)} = ${valueLiteral} WHERE ${where};`,
    );
  });

  pendingDeletedRowKeys.forEach((rowKey) => {
    // rowKey shape: "row-{page}-{rowIdx}" — page is always 1 for raw results.
    const parts = rowKey.split("-");
    const rowIdx = parseInt(parts[2]!, 10);
    const row = rows[rowIdx];
    if (!row) return;
    const where = buildPkWhere(row, plan.resultColumnNames, plan.pkColumns);
    statements.push(`DELETE FROM ${qualifiedTable} WHERE ${where};`);
  });

  return statements;
}

/**
 * Re-export of `ColumnInfo` for downstream consumers — keeps the helper
 * surface area localised.
 */
export type { ColumnInfo };
