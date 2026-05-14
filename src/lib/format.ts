// Sprint 238 — `CELL_DISPLAY_LIMIT` + `truncateCell` 폐기 (AC-238-05).
// 가로 폭 통제는 `useColumnWidths` + CSS ellipsis 가 담당.

import Decimal from "decimal.js";
import { safeStringifyCell } from "@lib/jsonCell";

// Sprint 305 — copy format 의 cell rendering 헬퍼. ADR 0026 의 BigInt /
// Decimal cell 이 raw `JSON.stringify` 를 만나면 throw / `{}` 로 망가지므로
// 명시 분기. tab/csv/sql 세 갈래가 동일 로직.
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
  // Sprint 305 — replacer 가 BigInt/Decimal 을 digit string 으로 emit.
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
  // Sprint 305 — BigInt / Decimal 은 unquoted numeric literal 로 emit.
  // INSERT 회수 시 numeric column 에 string literal 로 넣으면 PG cast 오류
  // 발생 — 원본 디지트를 그대로 보존.
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
