// `CELL_DISPLAY_LIMIT` + `truncateCell` were removed (AC-238-05).
// `useColumnWidths` + CSS ellipsis handle horizontal width.

import { safeStringifyCell } from "@lib/jsonCell";
import Decimal from "decimal.js";

// Cell rendering helper for the copy formats. ADR 0026 BigInt / Decimal
// cells throw or collapse to `{}` under raw `JSON.stringify`, so they get
// explicit branches. The tab and csv paths share this helper; the sql path
// repeats the same branches in `escapeSqlValue`.
function cellToFlatString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Decimal) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return safeStringifyCell(value);
  return String(value);
}

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
    lines.push(row.map((v) => cellToFlatString(v)).join("\t"));
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
  // The replacer emits BigInt/Decimal as digit strings.
  return safeStringifyCell(objects, 2);
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
    lines.push(row.map((v) => escapeCsvField(cellToFlatString(v))).join(","));
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
  // BigInt / Decimal are emitted as unquoted numeric literals: running the
  // INSERT with a string literal in a numeric column raises a PG cast error,
  // so the original digits are kept as they are.
  if (value instanceof Decimal) return value.toString();
  if (typeof value === "bigint") return value.toString();
  const str =
    typeof value === "object" ? safeStringifyCell(value) : String(value);
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
