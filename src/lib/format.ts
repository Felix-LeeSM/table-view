/** Default character limit for cell display truncation. */
export const CELL_DISPLAY_LIMIT = 200;

// ── Copy format utilities ───────────────────────────────────────────────

/** Data required by copy-format functions. */
export interface CopyRowData {
  columns: string[];
  rows: unknown[][];
  schema: string;
  table: string;
}

/**
 * Convert selected rows to tab-separated plain text.
 * First row contains column headers.
 * Null values become empty strings.
 */
export function rowsToPlainText(data: CopyRowData): string {
  const lines: string[] = [data.columns.join("\t")];
  for (const row of data.rows) {
    lines.push(
      row
        .map((v) =>
          v == null
            ? ""
            : typeof v === "object"
              ? JSON.stringify(v)
              : String(v),
        )
        .join("\t"),
    );
  }
  return lines.join("\n");
}

/**
 * Convert selected rows to a JSON array of objects.
 * Null values become JSON null.
 */
export function rowsToJson(data: CopyRowData): string {
  const objects = data.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    data.columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

/**
 * Escape a single CSV field.
 * Wraps the value in double quotes if it contains a comma, double-quote, or newline.
 * Internal double quotes are escaped by doubling them.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert selected rows to CSV text.
 * First row contains column headers.
 * Null values become empty strings. Fields containing commas, quotes, or newlines are escaped.
 */
export function rowsToCsv(data: CopyRowData): string {
  const lines: string[] = [data.columns.map(escapeCsvField).join(",")];
  for (const row of data.rows) {
    lines.push(
      row
        .map((v) => {
          const str =
            v == null
              ? ""
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v);
          return escapeCsvField(str);
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Escape a value for use in a SQL string literal by doubling single quotes.
 */
function escapeSqlValue(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Convert selected rows to SQL INSERT statements.
 * Generates one INSERT per row targeting `schema.table`.
 */
export function rowsToSqlInsert(data: CopyRowData): string {
  const qualified = data.schema ? `${data.schema}.${data.table}` : data.table;
  const colList = data.columns.join(", ");
  const statements: string[] = [];
  for (const row of data.rows) {
    const valList = row.map((v) => escapeSqlValue(v)).join(", ");
    statements.push(
      `INSERT INTO ${qualified} (${colList}) VALUES (${valList});`,
    );
  }
  return statements.join("\n");
}

/**
 * Truncate a string value for display in a table cell.
 *
 * If the value exceeds `limit` characters, it is sliced and an ellipsis ("...")
 * is appended. Otherwise the original value is returned unchanged.
 */
export function truncateCell(
  value: string,
  limit: number = CELL_DISPLAY_LIMIT,
): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit) + "...";
}
