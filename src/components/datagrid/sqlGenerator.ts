import type { ColumnInfo, TableData } from "@/types/schema";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  coerceToSqlLiteral,
  escapeSqlString,
  qualifiedTableName,
  sqlIdentifier,
  type SqlDialect,
} from "@lib/sql/sqlLiteral";
import {
  emitArrayUpdate,
  emitJsonbUpdate,
  emitMysqlJsonUpdate,
  isArrayColumn,
  isJsonbColumn,
  isStructuralJsonColumn,
  type NestedSqlEdit,
} from "@lib/sql/structuralSqlEdit";

export { coerceToSqlLiteral };
export { isArrayColumn, isJsonbColumn, isStructuralJsonColumn };
export type { CoerceResult, SqlDialect } from "@lib/sql/sqlLiteral";

type WhereClauseResult =
  | { kind: "sql"; sql: string }
  | { kind: "error"; message: string };

function rowValueToCoerceInput(
  value: unknown,
  dataType: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return dataType.toLowerCase().trim() === "date" ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "object" && "toString" in (value as object)) {
    return (value as { toString(): string }).toString();
  }
  return String(value);
}

/**
 * Build a SQL WHERE clause that identifies a specific row.
 * Uses primary key columns when available. PostgreSQL/MySQL/SQLite keep the
 * legacy all-column fallback; MSSQL/Oracle writes are blocked without a primary
 * key.
 */
function buildWhereClause(
  row: unknown[],
  columns: ColumnInfo[],
  pkCols: ColumnInfo[],
  dialect: SqlDialect,
): WhereClauseResult | null {
  // Sprint 305 — pk / 비-pk 값이 Decimal 인 경우 `String(decimal)` → `[object
  // Object]` 가 되는 회귀 가드. BigInt 는 String() 으로 digit 보존되지만
  // Decimal 은 명시 분기 필요.
  const literal = (v: unknown): string => {
    if (v == null) return "NULL";
    if (dialect === "mssql" && typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "string") return escapeSqlString(v);
    if (typeof v === "object" && "toString" in (v as object))
      return (v as { toString(): string }).toString();
    return String(v);
  };
  if (pkCols.length > 0) {
    const clauses: string[] = [];
    for (const pk of pkCols) {
      const pkIdx = columns.indexOf(pk);
      const coerced = coerceToSqlLiteral(
        rowValueToCoerceInput(row[pkIdx], pk.data_type),
        pk.data_type,
        dialect,
      );
      if (coerced.kind === "error") {
        return {
          kind: "error",
          message: `Primary key "${pk.name}" ${coerced.message}`,
        };
      }
      clauses.push(`${sqlIdentifier(pk.name, dialect)} = ${coerced.sql}`);
    }
    return { kind: "sql", sql: clauses.join(" AND ") };
  }
  if (dialect === "mssql" || dialect === "oracle") return null;
  return {
    kind: "sql",
    sql: columns
      .map((c, i) => `${sqlIdentifier(c.name, dialect)} = ${literal(row[i])}`)
      .join(" AND "),
  };
}

function primaryKeyRequiredMessage(dialect: SqlDialect): string {
  return `${dialectLabel(dialect)} row edits require a primary key; all-column WHERE fallback is disabled.`;
}

function dialectLabel(dialect: SqlDialect): string {
  if (dialect === "mssql") return "MSSQL";
  if (dialect === "oracle") return "Oracle";
  return "SQL";
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
  // Sprint 305 — safe stringify so nested BigInt / Decimal 든 object 도
  // round-trip 가능 (raw JSON.stringify 가 BigInt 만나면 throw).
  if (typeof value === "object") return safeStringifyCell(value);
  return String(value);
}

export interface GenerateSqlOptions {
  /**
   * Called once per failed pending edit. Invoked synchronously during
   * `generateSql`; the failing edit is excluded from the returned statements.
   * Valid edits in the same batch are unaffected (independent validation).
   */
  onCoerceError?: (err: CoerceError) => void;
  /**
   * Sprint 347 — DBMS dialect tag. Postgres remains the default for
   * back-compat with callers that haven't been plumbed yet (the legacy
   * jsonb-only flow). MySQL routes nested edits through
   * `JSON_SET` / `JSON_REMOVE`. SQLite rejects nested edits with a clear
   * message (`json1` extension dispatch is a follow-up sprint).
   */
  dialect?: SqlDialect;
  allowRowWrites?: boolean;
  /**
   * Issue #1081 — row-identity anchors captured at edit/delete time. When a
   * pending entry has a snapshot, the WHERE clause is built from it instead
   * of the current `data.rows[rowIdx]`, so a page/sort/refetch reorder can't
   * point the UPDATE/DELETE at a different row that now shares the index.
   *
   * - `editRowSnapshots` keyed by `String(rowIdx)` (mirrors the page-less
   *   `pendingEdits` collision domain).
   * - `deletedRowSnapshots` keyed by the full delete key `row-${page}-${rowIdx}`.
   *
   * Absent snapshots fall back to `data.rows[rowIdx]` (unchanged behaviour
   * for callers that don't anchor, e.g. structure editors).
   */
  editRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  deletedRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
}

/**
 * Sprint 343 (2026-05-15) — parse a pendingEdit key that may optionally
 * carry a `:dot.path` suffix from the inline JSON tree panel.
 *
 * Shapes:
 * - `"0-1"`             → `{ rowIdx: 0, colIdx: 1, path: null }` — plain cell edit.
 * - `"0-1:meta.role"`   → `{ rowIdx: 0, colIdx: 1, path: "meta.role" }`
 * - `"0-1:tags[0]"`     → `{ rowIdx: 0, colIdx: 1, path: "tags[0]" }`
 *
 * Mirrors `mqlGenerator.parseEditKey`. Returns `null` for malformed keys
 * (NaN row/col) so the caller never splices `NaN` into a statement.
 */
function parseEditKey(
  key: string,
): { rowIdx: number; colIdx: number; path: string | null } | null {
  const colonIdx = key.indexOf(":");
  const head = colonIdx === -1 ? key : key.slice(0, colonIdx);
  const path = colonIdx === -1 ? null : key.slice(colonIdx + 1);
  const dashIdx = head.indexOf("-");
  if (dashIdx === -1) return null;
  const rowIdx = parseInt(head.slice(0, dashIdx), 10);
  const colIdx = parseInt(head.slice(dashIdx + 1), 10);
  if (!Number.isInteger(rowIdx) || !Number.isInteger(colIdx)) return null;
  return { rowIdx, colIdx, path };
}

/**
 * Generate SQL statements for pending cell edits, row deletions, and new
 * row inserts.
 *
 * UPDATE: each pending edit runs through `coerceToSqlLiteral` keyed by
 * the column's `data_type`. Successes emit `UPDATE … SET col = <literal>`;
 * failures are skipped and reported via `options.onCoerceError`. The
 * preview modal and the commit-shortcut path both call this function so
 * what the user previews is exactly what's sent to the server.
 *
 * INSERT: every new-row cell is normalized then coerced. A row emits a
 * single INSERT only when *all* of its cells coerce — partially-valid
 * rows are dropped (no half-INSERT) and each failing cell reports its
 * own `onCoerceError` entry keyed `new-${newRowIdx}-${colIdx}`. This
 * keeps preview = commit-payload invariant intact.
 */
/**
 * One emitted SQL statement paired with the originating pending-edit key. The
 * key follows the same shape as `pendingEdits` / `pendingNewRows` /
 * `pendingDeletedRowKeys` so the commit caller can route an
 * `executeQuery`-time failure back to the offending cell:
 *
 * - UPDATE: `${rowIdx}-${colIdx}` — cell key shared with `pendingEdits`.
 * - DELETE: `row-${page}-${rowIdx}` — row key shared with
 *   `pendingDeletedRowKeys`.
 * - INSERT: `new-${newRowIdx}-${colIdx}`. INSERTs touch every column of a
 *   new row, so we pick the first column's coordinates as a stable identifier
 *   the UI can use to surface the failure on a specific new-row cell.
 *
 * `key` is optional because, in pathological cases (e.g. a row index that
 * disappeared between generation and execution), the producer may not have a
 * meaningful key. Callers should fall back to a generic message in that case.
 */
export interface GeneratedSqlStatement {
  sql: string;
  key?: string;
}

/**
 * Statement-keyed counterpart of {@link generateSql}. Same pure
 * generation logic, but each emitted statement is paired with its
 * pending-edit key so `handleExecuteCommit` can route an `executeQuery`
 * rejection back to the failing cell.
 */
export function generateSqlWithKeys(
  data: TableData,
  schema: string,
  table: string,
  pendingEdits: Map<string, string | null>,
  pendingDeletedRowKeys: Set<string>,
  pendingNewRows: unknown[][],
  options: GenerateSqlOptions = {},
): GeneratedSqlStatement[] {
  if (options.allowRowWrites === false) return [];

  const pkCols = data.columns.filter((c) => c.is_primary_key);
  const statements: GeneratedSqlStatement[] = [];
  const dialect = options.dialect ?? "postgresql";
  const qualifiedTable = qualifiedTableName(schema, table, dialect);
  const requiresPrimaryKey = dialect === "mssql" || dialect === "oracle";
  const primaryKeyMessage = primaryKeyRequiredMessage(dialect);

  if (requiresPrimaryKey && pkCols.length === 0) {
    pendingEdits.forEach((_, key) => {
      const parsed = parseEditKey(key);
      options.onCoerceError?.({
        key,
        rowIdx: parsed?.rowIdx ?? 0,
        colIdx: parsed?.colIdx ?? 0,
        message: primaryKeyMessage,
      });
    });
    pendingDeletedRowKeys.forEach((key) => {
      const rowIdx = parseInt(key.split("-")[2] ?? "0", 10);
      options.onCoerceError?.({
        key,
        rowIdx: Number.isInteger(rowIdx) ? rowIdx : 0,
        colIdx: 0,
        message: primaryKeyMessage,
      });
    });
    pendingNewRows.forEach((_, rowIdx) => {
      options.onCoerceError?.({
        key: `new-${rowIdx}-0`,
        rowIdx,
        colIdx: 0,
        message: primaryKeyMessage,
      });
    });
    return [];
  }

  // Sprint 343 (2026-05-15) — UPDATE path now supports inline-tree
  // nested edits (`"rowIdx-colIdx:dot.path"`) alongside the flat
  // `"rowIdx-colIdx"` cell edits. Group all entries per (row, col),
  // then dispatch by column type:
  //  - plain scalar column → existing one-edit-per-cell behavior.
  //  - JSONB column → chained `jsonb_set(... #- ...)` over all
  //    pending nested edits for that cell.
  //  - Postgres ARRAY column → reassign the whole array
  //    (`col = ARRAY[...]::elemtype[]`) so element edits + index
  //    deletes round-trip in a single statement.
  const editsByCell = new Map<string, NestedSqlEdit[]>();
  pendingEdits.forEach((value, key) => {
    const parsed = parseEditKey(key);
    if (parsed === null) return;
    const { rowIdx, colIdx, path } = parsed;
    const cellKey = `${rowIdx}-${colIdx}`;
    const list = editsByCell.get(cellKey) ?? [];
    list.push({ key, path, value });
    editsByCell.set(cellKey, list);
  });

  editsByCell.forEach((entries, cellKey) => {
    const [rowStr, colStr] = cellKey.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const col = data.columns[colIdx];
    if (!col) return;
    // Issue #1081 — prefer the row-identity snapshot captured at edit time,
    // keyed by the CELL key so a cross-page edit on the same rowIdx but a
    // different column resolves its own anchor.
    const row = (options.editRowSnapshots?.get(cellKey) ??
      data.rows[rowIdx]) as unknown[] | undefined;
    if (!row) return;

    const topLevel = entries.find((e) => e.path === null);
    const nested = entries.filter((e) => e.path !== null);
    const whereClause = buildWhereClause(row, data.columns, pkCols, dialect);
    if (whereClause === null) {
      options.onCoerceError?.({
        key: entries[0]?.key ?? cellKey,
        rowIdx,
        colIdx,
        message: primaryKeyMessage,
      });
      return;
    }
    if (whereClause.kind === "error") {
      options.onCoerceError?.({
        key: entries[0]?.key ?? cellKey,
        rowIdx,
        colIdx,
        message: whereClause.message,
      });
      return;
    }
    const columnName = sqlIdentifier(col.name, dialect);

    // Top-level cell edit takes precedence — it replaces the entire
    // column value, so any concurrent nested edit on the same cell
    // would be redundant. We prefer the top-level path and skip the
    // nested entries; future work could surface a UI warning instead.
    if (topLevel && nested.length === 0) {
      const coerced = coerceToSqlLiteral(
        topLevel.value,
        col.data_type,
        dialect,
      );
      if (coerced.kind === "error") {
        options.onCoerceError?.({
          key: topLevel.key,
          rowIdx,
          colIdx,
          message: coerced.message,
        });
        return;
      }
      statements.push({
        sql: `UPDATE ${qualifiedTable} SET ${columnName} = ${coerced.sql} WHERE ${whereClause.sql};`,
        key: topLevel.key,
      });
      return;
    }

    if (topLevel && nested.length > 0) {
      // Mixed shape — top-level replaces the cell, so nested are
      // dropped. Report each as a coerce error so the UI can flag them.
      for (const ne of nested) {
        options.onCoerceError?.({
          key: ne.key,
          rowIdx,
          colIdx,
          message:
            "Nested edit shadowed by a top-level cell edit on the same cell — discard one of them.",
        });
      }
      const coerced = coerceToSqlLiteral(
        topLevel.value,
        col.data_type,
        dialect,
      );
      if (coerced.kind === "error") {
        options.onCoerceError?.({
          key: topLevel.key,
          rowIdx,
          colIdx,
          message: coerced.message,
        });
        return;
      }
      statements.push({
        sql: `UPDATE ${qualifiedTable} SET ${columnName} = ${coerced.sql} WHERE ${whereClause.sql};`,
        key: topLevel.key,
      });
      return;
    }

    // Nested-only branch — dispatch by column type + dialect.
    if (isStructuralJsonColumn(col.data_type, dialect)) {
      const emitted =
        dialect === "mysql"
          ? emitMysqlJsonUpdate(columnName, row[colIdx], nested)
          : emitJsonbUpdate(columnName, row[colIdx], nested);
      if (emitted.kind === "error") {
        options.onCoerceError?.({
          key: nested[0]!.key,
          rowIdx,
          colIdx,
          message: emitted.message,
        });
        return;
      }
      statements.push({
        sql: `UPDATE ${qualifiedTable} SET ${columnName} = ${emitted.expr} WHERE ${whereClause.sql};`,
        key: nested[0]!.key,
      });
      return;
    }
    // Sprint 347 — Postgres jsonb / MySQL json are handled above.
    // SQLite: no JSON column type to detect; nested edits must go through
    // the `json1` extension which is a follow-up sprint.
    if (dialect === "sqlite" && col.data_type.toLowerCase().trim() === "json") {
      options.onCoerceError?.({
        key: nested[0]!.key,
        rowIdx,
        colIdx,
        message:
          "SQLite JSON column edits via inline tree are not yet supported.",
      });
      return;
    }

    if (isArrayColumn(col.data_type) && dialect === "postgresql") {
      const emitted = emitArrayUpdate(
        columnName,
        col.data_type,
        row[colIdx],
        nested,
      );
      if (emitted.kind === "error") {
        options.onCoerceError?.({
          key: nested[0]!.key,
          rowIdx,
          colIdx,
          message: emitted.message,
        });
        return;
      }
      statements.push({
        sql: `UPDATE ${qualifiedTable} SET ${columnName} = ${emitted.expr} WHERE ${whereClause.sql};`,
        key: nested[0]!.key,
      });
      return;
    }

    // Nested edit on a non-structural column — caller's bug.
    options.onCoerceError?.({
      key: nested[0]!.key,
      rowIdx,
      colIdx,
      message: `Nested edits are only supported on jsonb or Postgres ARRAY columns, not "${col.data_type}".`,
    });
  });

  // DELETE statements for deleted rows — emit using the row key so the UI can
  // highlight the failed row on commit error.
  pendingDeletedRowKeys.forEach((delKey) => {
    const parts = delKey.split("-");
    const rowIdx = parseInt(parts[2]!, 10);
    // Issue #1081 — prefer the snapshot captured when the row was marked for
    // deletion; the delete key carries a page but `data.rows` may not.
    const row = (options.deletedRowSnapshots?.get(delKey) ??
      data.rows[rowIdx]) as unknown[] | undefined;
    if (!row) return;

    const whereClause = buildWhereClause(row, data.columns, pkCols, dialect);
    if (whereClause === null) {
      options.onCoerceError?.({
        key: delKey,
        rowIdx,
        colIdx: 0,
        message: primaryKeyMessage,
      });
      return;
    }
    if (whereClause.kind === "error") {
      options.onCoerceError?.({
        key: delKey,
        rowIdx,
        colIdx: 0,
        message: whereClause.message,
      });
      return;
    }
    statements.push({
      sql: `DELETE FROM ${qualifiedTable} WHERE ${whereClause.sql};`,
      key: delKey,
    });
  });

  // INSERT statements for new rows. INSERT touches every column, so we pick
  // `new-${newRowIdx}-0` as the canonical cell key — the UI can highlight the
  // first cell of the offending row, which is enough for the user to locate
  // the failed insert. Per-cell coercion errors keep their own granular keys.
  pendingNewRows.forEach((newRow, newRowIdx) => {
    const cells = newRow as unknown[];
    const literals: string[] = [];
    let rowHasError = false;
    data.columns.forEach((col, colIdx) => {
      const normalized = normalizeNewRowCell(cells[colIdx]);
      const coerced = coerceToSqlLiteral(normalized, col.data_type, dialect);
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
    const colList = data.columns
      .map((c) => sqlIdentifier(c.name, dialect))
      .join(", ");
    statements.push({
      sql: `INSERT INTO ${qualifiedTable} (${colList}) VALUES (${literals.join(", ")});`,
      key: `new-${newRowIdx}-0`,
    });
  });

  return statements;
}

/**
 * Backward-compatible wrapper around {@link generateSqlWithKeys}. Callers that
 * only need the SQL strings (the SQL preview modal, the structure editors)
 * keep working unchanged; the commit path uses the keyed variant.
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
  return generateSqlWithKeys(
    data,
    schema,
    table,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
    options,
  ).map((s) => s.sql);
}
