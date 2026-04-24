import type { ColumnInfo, TableData } from "@/types/schema";

/**
 * Data type family for SQL literal emission. Mirrors — but is distinct from —
 * `classifyDataType` in `useDataGridEdit.ts` because seeding and literal
 * emission have slightly different concerns: seeding cares about "what printable
 * first character makes sense?", literal emission cares about "how do I
 * serialize this string to SQL?". The two share the timestamp-before-time
 * ordering rule (`timestamp` contains `time` as a substring).
 */
type SqlTypeFamily =
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "timestamp"
  | "time"
  | "uuid"
  | "textual"
  | "unknown";

/**
 * Textual data types that preserve `''` as an empty string literal (ADR 0009).
 * Anything outside this set coerces empty string to `NULL` on commit.
 */
function isTextualFamily(family: SqlTypeFamily): boolean {
  return family === "textual";
}

/**
 * Classify a column's data type into a SQL-literal family. Matching rules:
 * - Case-insensitive.
 * - `timestamp`/`timestamptz`/`datetime` MUST be checked before `time` because
 *   `timestamp` contains `time` as a substring.
 * - Integer family checked before numeric so `bigint` etc. don't fall through
 *   to a future contains-check on "int" inside numeric.
 * - Textual family explicitly listed (ADR 0009) so unknown types fall to
 *   `"unknown"` and keep the legacy escape path (safer default).
 */
function classifySqlType(dataType: string): SqlTypeFamily {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp") || lower.includes("datetime")) {
    return "timestamp";
  }
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  if (lower === "bool" || lower.includes("boolean")) return "boolean";
  if (lower.includes("uuid")) return "uuid";
  if (
    lower.includes("int") ||
    lower === "serial" ||
    lower === "bigserial" ||
    lower === "smallserial"
  ) {
    return "integer";
  }
  if (
    lower.includes("numeric") ||
    lower.includes("decimal") ||
    lower.includes("float") ||
    lower.includes("double") ||
    lower.includes("real")
  ) {
    return "numeric";
  }
  // Textual set per ADR 0009 — these preserve `''` on commit. `bpchar` is
  // PostgreSQL's internal name for `char(n)`; `character varying` is the
  // long-form `varchar`.
  if (
    lower === "text" ||
    lower.includes("varchar") ||
    lower === "char" ||
    lower === "bpchar" ||
    lower.includes("character") ||
    lower === "citext" ||
    lower === "string" ||
    lower === "json" ||
    lower === "jsonb"
  ) {
    return "textual";
  }
  return "unknown";
}

/**
 * Result of `coerceToSqlLiteral`. On success `sql` is the ready-to-splice SQL
 * fragment (e.g. `42`, `'2026-04-24'`, `NULL`, `TRUE`). On failure `message` is
 * a user-readable validation error that the UI surfaces as an inline hint.
 */
export type CoerceResult =
  | { kind: "sql"; sql: string }
  | { kind: "error"; message: string };

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts `YYYY-MM-DDTHH:MM[:SS[.fff]][Z|±HH:MM]` — the `T` may also be a space
// to match SQL-style inputs the user might copy in from psql.
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Integers: optional leading `-`, then one or more digits. No `+`, no leading
// zeros restriction (PostgreSQL accepts `042` as 42), no decimals.
const INTEGER_RE = /^-?\d+$/;
// Numeric: optional leading `-`, then digits with optional decimal portion.
// Accepts `.5`, `-.5`, `3.`, `3.14`, `-3`, `0`. Disallows empty and bare `-`.
// Scientific notation (`1e3`) is intentionally rejected — it's rarely what a
// TablePlus-style cell editor user types, and PostgreSQL accepts it only in
// some contexts; keep the accept surface tight for the first pass.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Coerce a user-entered edit value to a SQL literal, given the column's
 * declared data type. Pure function — no I/O, no state — so it can be tested
 * in isolation and reused across UPDATE and (future) INSERT paths.
 *
 * Tri-state rule (ADR 0009):
 * - `null` → `NULL` regardless of type.
 * - `""` + textual family → `''` (preserved).
 * - `""` + non-textual family → `NULL` (empty picker = explicit clear).
 *
 * Valid input examples per family:
 * - integer: `"42"` → `42`.
 * - numeric: `"3.14"`, `"-1"`, `".5"` → unquoted.
 * - boolean: `"true"/"t"/"1"` → `TRUE`; `"false"/"f"/"0"` → `FALSE` (CI).
 * - date: `"2026-04-24"` → `'2026-04-24'`.
 * - timestamp: `"2026-04-24T10:00:00Z"` (or space-separated) → quoted.
 * - time: `"10:00"` / `"10:00:00"` → quoted.
 * - uuid: 36-char canonical form → quoted.
 * - textual: O'Brien → `'O''Brien'`.
 * - unknown family: legacy escape path (quoted + single-quote escape). Keeps
 *   the pre-Sprint-75 behaviour for any type the classifier doesn't know about
 *   (e.g. `money`, `bytea` — Sprint 75 does not tackle those).
 */
export function coerceToSqlLiteral(
  value: string | null,
  dataType: string,
): CoerceResult {
  if (value === null) return { kind: "sql", sql: "NULL" };
  const family = classifySqlType(dataType);

  // Empty-string branch: preserved for textual families, collapsed to NULL for
  // the rest. The unknown family follows the textual rule (safer: preserves
  // prior empty-string commits rather than silently swapping to NULL).
  if (value === "") {
    if (isTextualFamily(family) || family === "unknown") {
      return { kind: "sql", sql: "''" };
    }
    return { kind: "sql", sql: "NULL" };
  }

  switch (family) {
    case "integer": {
      if (INTEGER_RE.test(value)) return { kind: "sql", sql: value };
      return { kind: "error", message: `Expected integer, got "${value}"` };
    }
    case "numeric": {
      if (NUMERIC_RE.test(value)) return { kind: "sql", sql: value };
      return { kind: "error", message: `Expected numeric, got "${value}"` };
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (lower === "true" || lower === "t" || lower === "1") {
        return { kind: "sql", sql: "TRUE" };
      }
      if (lower === "false" || lower === "f" || lower === "0") {
        return { kind: "sql", sql: "FALSE" };
      }
      return { kind: "error", message: `Expected boolean, got "${value}"` };
    }
    case "date": {
      if (ISO_DATE_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return {
        kind: "error",
        message: `Expected date (YYYY-MM-DD), got "${value}"`,
      };
    }
    case "timestamp": {
      if (ISO_DATETIME_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return {
        kind: "error",
        message: `Expected timestamp (YYYY-MM-DD HH:MM[:SS]), got "${value}"`,
      };
    }
    case "time": {
      if (TIME_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return {
        kind: "error",
        message: `Expected time (HH:MM[:SS]), got "${value}"`,
      };
    }
    case "uuid": {
      if (UUID_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return { kind: "error", message: `Expected UUID, got "${value}"` };
    }
    case "textual":
    case "unknown":
    default:
      // Legacy path: single-quote escape. ADR 0009 preserves empty-string
      // textual cells via the `value === ""` branch above.
      return { kind: "sql", sql: escapeSqlString(value) };
  }
}

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
 * One entry in the optional `onCoerceError` callback, emitted when a pending
 * edit's value cannot be coerced to its column's SQL type. Consumers
 * (typically `useDataGridEdit`) use these to populate an error-map state so
 * the UI can render an inline hint next to the offending cell.
 *
 * Two key shapes are emitted so the UI can correlate errors to the right cell
 * regardless of which edit path produced them:
 *
 * - UPDATE pending edits: `${rowIdx}-${colIdx}` — mirrors the pendingEdits
 *   map key shape.
 * - INSERT new-row cells: `new-${newRowIdx}-${colIdx}` — the `new-` prefix
 *   disambiguates from the UPDATE namespace so an existing-row cell at
 *   `(0, 1)` and a new-row cell at `(0, 1)` do not collide. `newRowIdx` is
 *   the index into `pendingNewRows`, not a page-relative DB row.
 */
export interface CoerceError {
  key: string;
  rowIdx: number;
  colIdx: number;
  message: string;
}

/**
 * Normalize a raw new-row cell value to the `string | null` shape
 * `coerceToSqlLiteral` expects. `pendingNewRows` is typed `unknown[][]` because
 * new-row editors may store raw primitives (a JS `number` from a seeded
 * integer editor, or a `boolean` from a future typed picker) rather than the
 * already-stringified values that UPDATE pending edits carry. We stringify
 * non-null primitives and pass `null`/`undefined` through as `null` so the
 * tri-state contract holds: `null` → `NULL`, `""` → NULL-or-'' by family,
 * everything else → the typed coerce branches.
 */
function normalizeNewRowCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  // Primitives (number / boolean / bigint / symbol) stringify deterministically.
  // Objects are JSON-encoded so an array/object accidentally routed through a
  // new-row cell still lands in a recoverable shape rather than `[object …]`.
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface GenerateSqlOptions {
  /**
   * Called once per failed pending edit. Invoked synchronously during
   * `generateSql`; the failing edit is excluded from the returned statements.
   * Valid edits in the same batch are unaffected (independent validation).
   */
  onCoerceError?: (err: CoerceError) => void;
}

/**
 * Generate SQL statements for pending cell edits, row deletions, and new row inserts.
 *
 * UPDATE path (Sprint 75):
 * - Each pending edit is coerced to a SQL literal via `coerceToSqlLiteral`
 *   using the column's declared `data_type`. Successes emit `UPDATE … SET col = <literal>`;
 *   failures are skipped AND reported via `options.onCoerceError`.
 * - This is the single source of truth for UPDATE emission — the SQL preview
 *   modal and the commit-shortcut path both call through here, so the preview
 *   the user sees is exactly what will be sent to the server.
 *
 * INSERT path (Sprint 75, attempt 2):
 * - Each new-row cell is normalized via `normalizeNewRowCell` then routed
 *   through `coerceToSqlLiteral` with the column's `data_type`. When every
 *   cell in a row coerces successfully, a single `INSERT` statement is
 *   emitted. When any cell fails, the row's INSERT is **skipped entirely**
 *   (no partially-valid INSERT emission) and each failing cell reports its
 *   own `onCoerceError` entry keyed `new-${newRowIdx}-${colIdx}`.
 * - Invariant 3 (SQL preview = commit payload) is preserved because the
 *   preview now uses the exact same code path as the commit; the user never
 *   sees a preview row that wouldn't execute, nor gets executed rows the
 *   preview hid.
 *
 * DELETE path is unchanged by Sprint 75.
 */
export function generateSql(
  data: TableData,
  schema: string,
  table: string,
  pendingEdits: Map<string, string | null>,
  pendingDeletedRowKeys: Set<string>,
  pendingNewRows: unknown[][],
  options: GenerateSqlOptions = {},
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

    const coerced = coerceToSqlLiteral(newValue, col.data_type);
    if (coerced.kind === "error") {
      options.onCoerceError?.({
        key,
        rowIdx,
        colIdx,
        message: coerced.message,
      });
      return;
    }

    const whereClause = buildWhereClause(row, data.columns, pkCols);
    statements.push(
      `UPDATE ${qualifiedTable} SET ${col.name} = ${coerced.sql} WHERE ${whereClause};`,
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

  // INSERT statements for new rows — Sprint 75 attempt 2. Each cell is
  // normalised to `string | null` and routed through `coerceToSqlLiteral` so
  // INSERT emits the same type-aware literals as UPDATE. If any cell fails
  // coercion, the entire row's INSERT is dropped and each failing cell
  // reports its own error via `onCoerceError` (keyed `new-${idx}-${col}`) so
  // the UI can highlight every offending cell rather than just the first.
  pendingNewRows.forEach((newRow, newRowIdx) => {
    const cells = newRow as unknown[];
    const literals: string[] = [];
    let rowHasError = false;
    data.columns.forEach((col, colIdx) => {
      const normalized = normalizeNewRowCell(cells[colIdx]);
      const coerced = coerceToSqlLiteral(normalized, col.data_type);
      if (coerced.kind === "error") {
        rowHasError = true;
        options.onCoerceError?.({
          key: `new-${newRowIdx}-${colIdx}`,
          rowIdx: newRowIdx,
          colIdx,
          message: coerced.message,
        });
        return;
      }
      literals.push(coerced.sql);
    });
    if (rowHasError) return;
    const colList = data.columns.map((c) => c.name).join(", ");
    statements.push(
      `INSERT INTO ${qualifiedTable} (${colList}) VALUES (${literals.join(", ")});`,
    );
  });

  return statements;
}
