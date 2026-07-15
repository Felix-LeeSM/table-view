import type { ColumnInfo } from "@/types/schema";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  coerceToSqlLiteral,
  sqlIdentifier,
  type SqlDialect,
} from "./sqlLiteral";

/**
 * Dialect-aware identifier quoting for raw-edit SQL (issue #1299). Raw-edit
 * identifiers are ALWAYS quoted so case + special chars survive the cached
 * result's exact name. `quotePostgres: true` opts Postgres into ANSI quoting
 * (the canonical default leaves it bare for the structured grid path). #1357.
 */
function ident(name: string, dialect: SqlDialect): string {
  return sqlIdentifier(name, dialect, { quotePostgres: true });
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
  // Sprint 306 — cell 값이 nested BigInt / Decimal 일 때 raw JSON.stringify
  // 가 throw 했던 회귀. safeStringifyCell 은 BigInt/Decimal 을 string 으로
  // emit 하므로 raw query edit literal 이 안전하게 round-trip.
  if (typeof value === "object") return quoteString(safeStringifyCell(value));
  if (typeof value === "bigint") return String(value);
  return quoteString(String(value));
}

/**
 * Coerce a raw-edit cell value to a SQL literal using the column's declared
 * data type (issue #1436). Routes through the same `coerceToSqlLiteral` the
 * structured grid uses, so both grids emit identical literals: a textual
 * column's empty string is preserved as `''`, while numeric/date/etc. clears
 * collapse to `NULL`. Unknown types keep the plain quoted-string path.
 *
 * On a strict-validation error (e.g. `"abc"` for an integer column) the raw
 * builder stays lenient by design — it falls back to a quoted string literal so
 * the value still round-trips via implicit cast instead of dropping the edit.
 */
function editLiteral(
  newValue: string,
  dataType: string | undefined,
  dialect: SqlDialect,
): string {
  const coerced = coerceToSqlLiteral(newValue, dataType ?? "", dialect);
  if (coerced.kind === "sql") return coerced.sql;
  // ponytail: raw-edit is lenient — quote the rejected input rather than drop it.
  return quoteString(newValue);
}

/** A `(pkColumnName, resultRowIndex)` pair used to build a PK WHERE clause. */
interface PkEntry {
  name: string;
  idx: number;
}

/**
 * Build the WHERE clause that uniquely identifies one row by its primary-key
 * columns, given each PK column's *positional* index into the result row.
 *
 * Returns `null` — meaning "do not emit a statement for this row" — when:
 *  - there are no PK entries, or
 *  - every PK value in the row is NULL (a LEFT JOIN unmatched instance, issue
 *    #1299 #3 — there is no source row to target).
 *
 * A NULL value in an otherwise-populated PK tuple compares with `IS NULL`, not
 * `= NULL` (which is UNKNOWN in SQL 3-valued logic and matches zero rows). This
 * mirrors the #1305 fix in `datagrid/sqlGenerator.ts` and repairs the prior
 * `col = NULL` bug for both the single- and multi-table paths.
 */
function buildPkWhereByPositions(
  row: unknown[],
  entries: PkEntry[],
  dialect: SqlDialect,
): string | null {
  if (entries.length === 0) return null;
  if (entries.every((e) => row[e.idx] == null)) return null;
  return entries
    .map((e) =>
      row[e.idx] == null
        ? `${ident(e.name, dialect)} IS NULL`
        : `${ident(e.name, dialect)} = ${literal(row[e.idx])}`,
    )
    .join(" AND ");
}

/** One source table occurrence in a multi-table result (issue #1299). */
export interface MultiTableInstance {
  schema: string;
  table: string;
  /** PK column names — empty when the instance's PK is not fully in-result. */
  pkColumns: string[];
  /** PK column name → result column index (positional identity). */
  pkPositions: Record<string, number>;
}

/** Per result column attribution for a multi-table result (issue #1299). */
export interface MultiTableColumnPlan {
  /** Owning `MultiTablePlan.instances` index, or `null` if unattributable. */
  instance: number | null;
  /** Underlying source column name, or `null` (expression / unattributable). */
  sourceColumn: string | null;
  /** Base editability (attributed + owning instance carries its full PK). */
  editable: boolean;
  /** Reason shown when the column is read-only, else `null`. */
  readonlyReason: string | null;
}

/**
 * Multi-table edit plan (issue #1299). Present on `RawEditPlan.multi` when the
 * result maps to more than one source table (or an aliased/JOIN result); it
 * replaces the single-table `schema` / `table` / `pkColumns` routing with
 * per-instance UPDATE targeting. DELETE is intentionally unsupported here.
 */
export interface MultiTablePlan {
  /** FROM-position ordered; index === attribution's `instance`. */
  instances: MultiTableInstance[];
  /** Positional, aligned 1:1 with the result columns. */
  columns: MultiTableColumnPlan[];
}

export interface RawEditPlan {
  schema: string;
  table: string;
  pkColumns: string[];
  /** Result column index → underlying column name (aliases resolved). */
  resultColumnNames: string[];
  /**
   * Result column index → declared SQL data type, aligned 1:1 with
   * `resultColumnNames`. Drives type-aware literal coercion (issue #1436) so a
   * textual column's empty string is preserved as `''` instead of being forced
   * to `NULL`. Absent (or absent entries) fall back to the plain quoted-string
   * path.
   */
  resultColumnTypes?: string[];
  /** DBMS dialect for identifier quoting. Defaults to `"postgresql"`. */
  dialect?: SqlDialect;
  /**
   * Issue #1299 — multi-table per-column routing. When set, `buildRawEditSql`
   * groups edits by source instance and emits one table-scoped UPDATE each;
   * the single-table `schema` / `table` / `pkColumns` fields are unused.
   */
  multi?: MultiTablePlan;
}

/** True when the plan is a multi-table result (issue #1299 — DELETE disabled). */
export function isMultiTablePlan(plan: RawEditPlan): boolean {
  return plan.multi !== undefined;
}

/** Result column indices that are a PK of their owning instance (header 🔑). */
export function multiPkColumnIndices(multi: MultiTablePlan): Set<number> {
  const indices = new Set<number>();
  for (const inst of multi.instances) {
    for (const pk of inst.pkColumns) {
      const idx = inst.pkPositions[pk];
      if (idx !== undefined) indices.add(idx);
    }
  }
  return indices;
}

/**
 * Whether a multi-table cell is editable *for this specific row* — base
 * column editability AND the owning instance's PK is not all-NULL in the row
 * (LEFT JOIN unmatched rows lock, issue #1299 #3).
 */
export function isMultiCellEditable(
  multi: MultiTablePlan,
  row: unknown[],
  colIdx: number,
): boolean {
  const colPlan = multi.columns[colIdx];
  if (!colPlan || !colPlan.editable || colPlan.instance == null) return false;
  const inst = multi.instances[colPlan.instance];
  if (!inst || inst.pkColumns.length === 0) return false;
  return !inst.pkColumns.every((pk) => row[inst.pkPositions[pk]!] == null);
}

/** The read-only reason for a multi-table cell in a given row, or `null`. */
export function multiCellReadonlyReason(
  multi: MultiTablePlan,
  row: unknown[],
  colIdx: number,
): string | null {
  const colPlan = multi.columns[colIdx];
  if (!colPlan) return null;
  if (!colPlan.editable) return colPlan.readonlyReason;
  if (colPlan.instance != null) {
    const inst = multi.instances[colPlan.instance];
    if (
      inst &&
      inst.pkColumns.length > 0 &&
      inst.pkColumns.every((pk) => row[inst.pkPositions[pk]!] == null)
    ) {
      return "This row is unmatched (LEFT JOIN) — there is no source row to edit.";
    }
  }
  return null;
}

/** Emit table-scoped UPDATEs for a multi-table plan (issue #1299). */
function buildMultiTableEditSql(
  rows: unknown[][],
  pendingEdits: Map<string, string>,
  multi: MultiTablePlan,
  resultColumnTypes: string[] | undefined,
  dialect: SqlDialect,
): string[] {
  const statements: string[] = [];
  pendingEdits.forEach((newValue, key) => {
    const [rowStr, colStr] = key.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const row = rows[rowIdx];
    const colPlan = multi.columns[colIdx];
    if (
      !row ||
      !colPlan ||
      !colPlan.editable ||
      colPlan.instance == null ||
      colPlan.sourceColumn == null
    ) {
      return;
    }
    const inst = multi.instances[colPlan.instance];
    if (!inst) return;
    const entries = inst.pkColumns.map((pk) => ({
      name: pk,
      idx: inst.pkPositions[pk]!,
    }));
    const where = buildPkWhereByPositions(row, entries, dialect);
    if (where === null) return; // locked / unmatched row
    const qualified = `${ident(inst.schema, dialect)}.${ident(inst.table, dialect)}`;
    const valueLiteral = editLiteral(
      newValue,
      resultColumnTypes?.[colIdx],
      dialect,
    );
    statements.push(
      `UPDATE ${qualified} SET ${ident(colPlan.sourceColumn, dialect)} = ${valueLiteral} WHERE ${where};`,
    );
  });
  return statements;
}

/**
 * Generate UPDATE / DELETE statements for raw query edits. The shape mirrors
 * `datagrid/sqlGenerator.ts` so the preview UX feels consistent — but it
 * skips INSERT (raw query results have no canonical "new row" target).
 *
 * When `plan.multi` is present the result spans multiple source tables: edits
 * route per-instance and DELETE is disabled (issue #1299 #4 — which table a
 * joined row deletes from is inherently ambiguous).
 */
export function buildRawEditSql(
  rows: unknown[][],
  pendingEdits: Map<string, string>,
  pendingDeletedRowKeys: Set<string>,
  plan: RawEditPlan,
): string[] {
  const dialect = plan.dialect ?? "postgresql";
  if (plan.multi) {
    return buildMultiTableEditSql(
      rows,
      pendingEdits,
      plan.multi,
      plan.resultColumnTypes,
      dialect,
    );
  }

  const qualifiedTable = `${ident(plan.schema, dialect)}.${ident(plan.table, dialect)}`;
  const statements: string[] = [];
  const pkEntries: PkEntry[] = plan.pkColumns.map((pk) => ({
    name: pk,
    idx: plan.resultColumnNames.indexOf(pk),
  }));

  pendingEdits.forEach((newValue, key) => {
    const [rowStr, colStr] = key.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const colName = plan.resultColumnNames[colIdx];
    const row = rows[rowIdx];
    if (!colName || !row) return;
    const where = buildPkWhereByPositions(row, pkEntries, dialect);
    if (where === null) return;
    const valueLiteral = editLiteral(
      newValue,
      plan.resultColumnTypes?.[colIdx],
      dialect,
    );
    statements.push(
      `UPDATE ${qualifiedTable} SET ${ident(colName, dialect)} = ${valueLiteral} WHERE ${where};`,
    );
  });

  pendingDeletedRowKeys.forEach((rowKey) => {
    // rowKey shape: "row-{page}-{rowIdx}" — page is always 1 for raw results.
    const parts = rowKey.split("-");
    const rowIdx = parseInt(parts[2]!, 10);
    const row = rows[rowIdx];
    if (!row) return;
    const where = buildPkWhereByPositions(row, pkEntries, dialect);
    if (where === null) return;
    statements.push(`DELETE FROM ${qualifiedTable} WHERE ${where};`);
  });

  return statements;
}

/**
 * Re-export of `ColumnInfo` for downstream consumers — keeps the helper
 * surface area localised.
 */
export type { ColumnInfo };
