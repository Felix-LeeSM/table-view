import type { ColumnInfo, TableData } from "../../types/schema";

/**
 * Build a SQL WHERE clause that identifies a specific row.
 * Uses primary key columns when available; falls back to all columns.
 */
function buildWhereClause(
  row: unknown[],
  columns: ColumnInfo[],
  pkCols: ColumnInfo[],
): string {
  if (pkCols.length > 0) {
    return pkCols
      .map((pk) => {
        const pkIdx = columns.indexOf(pk);
        const pkVal = row[pkIdx];
        return `${pk.name} = ${pkVal == null ? "NULL" : typeof pkVal === "string" ? `'${pkVal}'` : String(pkVal)}`;
      })
      .join(" AND ");
  }
  return columns
    .map((c, i) => {
      const val = row[i];
      return `${c.name} = ${val == null ? "NULL" : typeof val === "string" ? `'${val}'` : String(val)}`;
    })
    .join(" AND ");
}

/**
 * Generate SQL statements for pending cell edits, row deletions, and new row inserts.
 */
export function generateSql(
  data: TableData,
  schema: string,
  table: string,
  pendingEdits: Map<string, string>,
  pendingDeletedRowKeys: Set<string>,
  pendingNewRows: unknown[][],
): string[] {
  const pkCols = data.columns.filter((c) => c.is_primary_key);
  const statements: string[] = [];
  const qualifiedTable = schema ? `${schema}.${table}` : table;

  // UPDATE statements for cell edits
  pendingEdits.forEach((newValue, key) => {
    const [rowStr, colStr] = key.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const col = data.columns[colIdx];
    if (!col) return;

    const row = data.rows[rowIdx] as unknown[];
    if (!row) return;

    const whereClause = buildWhereClause(row, data.columns, pkCols);
    const escapedValue =
      newValue === "" ? "NULL" : `'${newValue.replace(/'/g, "''")}'`;
    statements.push(
      `UPDATE ${qualifiedTable} SET ${col.name} = ${escapedValue} WHERE ${whereClause};`,
    );
  });

  // DELETE statements for deleted rows
  pendingDeletedRowKeys.forEach((delKey) => {
    // delKey format: "row-{page}-{rowIdx}"
    const parts = delKey.split("-");
    const rowIdx = parseInt(parts[2]!, 10);
    const row = data.rows[rowIdx] as unknown[];
    if (!row) return;

    const whereClause = buildWhereClause(row, data.columns, pkCols);
    statements.push(`DELETE FROM ${qualifiedTable} WHERE ${whereClause};`);
  });

  // INSERT statements for new rows
  for (const newRow of pendingNewRows) {
    const colList = data.columns.map((c) => c.name).join(", ");
    const valList = (newRow as unknown[])
      .map((v) =>
        v == null ? "NULL" : typeof v === "string" ? `'${v}'` : String(v),
      )
      .join(", ");
    statements.push(
      `INSERT INTO ${qualifiedTable} (${colList}) VALUES (${valList});`,
    );
  }

  return statements;
}
