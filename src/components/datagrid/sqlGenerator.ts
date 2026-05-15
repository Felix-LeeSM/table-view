import type { ColumnInfo, TableData } from "@/types/schema";
import { safeStringifyCell } from "@lib/jsonCell";

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
 * - unknown family: legacy escape path (quoted + single-quote escape) for
 *   types the classifier doesn't know yet (`money`, `bytea`, ...).
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
  // Sprint 305 — pk / 비-pk 값이 Decimal 인 경우 `String(decimal)` → `[object
  // Object]` 가 되는 회귀 가드. BigInt 는 String() 으로 digit 보존되지만
  // Decimal 은 명시 분기 필요.
  const literal = (v: unknown): string => {
    if (v == null) return "NULL";
    if (typeof v === "string") return `'${v}'`;
    if (typeof v === "object" && "toString" in (v as object))
      return (v as { toString(): string }).toString();
    return String(v);
  };
  if (pkCols.length > 0) {
    return pkCols
      .map((pk) => {
        const pkIdx = columns.indexOf(pk);
        return `${pk.name} = ${literal(row[pkIdx])}`;
      })
      .join(" AND ");
  }
  return columns.map((c, i) => `${c.name} = ${literal(row[i])}`).join(" AND ");
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
 * Sprint 343 — structural-edit sentinel. `__op__:unset` in pendingEdits
 * value means "remove this path" — translated to `col #- '{path}'` for
 * JSONB or to array element removal (splice + reassign) for ARRAY.
 */
const UNSET_OP = "__op__:unset";

/**
 * Sprint 343 — turn a dot-path with bracket-index segments
 * (`meta.tags[0].name`) into a Postgres path-array literal
 * (`'{meta,tags,0,name}'`). Each `[N]` becomes its own segment `N`.
 * Segments are quoted to survive identifiers with spaces / unicode.
 */
function jsonbPathLiteral(path: string): string {
  const segments: string[] = [];
  // Split on dots that aren't inside brackets, then expand `key[i]` →
  // `key`, `i`.
  for (const part of path.split(".")) {
    if (part === "") continue;
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part)) !== null) {
      if (m[1] !== undefined) segments.push(m[1]);
      else if (m[2] !== undefined) segments.push(m[2]);
    }
  }
  // Quote each segment, escape `"` and `\`.
  const quoted = segments
    .map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `'{${quoted}}'`;
}

/**
 * Sprint 343 — Postgres JSONB literal for a scalar leaf value committed
 * via the inline tree. The panel strips outer quotes for string leaves
 * (so a string `"foo"` is committed as raw `foo`), and leaves other JSON
 * primitives in their JS-literal form (`42`, `true`, `null`). We re-
 * canonicalise to JSON here and append `::jsonb`.
 *
 * Recognised forms:
 *  - `null` → `'null'::jsonb`
 *  - `true` / `false` → `'true'::jsonb` / `'false'::jsonb`
 *  - numeric (`42`, `-3.14`) → `'<n>'::jsonb`
 *  - everything else → JSON-encoded string (`'"foo"'::jsonb`).
 */
function jsonbValueLiteral(value: string): string {
  let json: string;
  if (value === "null") json = "null";
  else if (value === "true" || value === "false") json = value;
  else if (NUMERIC_RE.test(value)) json = value;
  else json = safeStringifyCell(value);
  return `${escapeSqlString(json)}::jsonb`;
}

/**
 * Sprint 343 — Postgres ARRAY element type extracted from a column
 * `data_type`. Accepts both the public `text[]` form and the internal
 * `_text` form Postgres returns from `information_schema`.
 */
function arrayElementType(dataType: string): string | null {
  const lower = dataType.toLowerCase().trim();
  if (lower.endsWith("[]")) return lower.slice(0, -2);
  if (lower.startsWith("_")) return lower.slice(1);
  return null;
}

export function isJsonbColumn(dataType: string): boolean {
  return dataType.toLowerCase() === "jsonb";
}

export function isArrayColumn(dataType: string): boolean {
  return arrayElementType(dataType) !== null;
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
 * Sprint 343 — build the chained `jsonb_set(... #- ...)` expression
 * for a JSONB column with one or more nested pending edits. Returns
 * `{ expr }` with the SQL fragment to splice into `SET col = <expr>`,
 * or `{ kind: "error" }` if any path is malformed.
 *
 * Order of application matches insertion order in `pendingEdits`. For
 * the same path, the LAST entry wins (consistent with `Map.set`).
 * Empty/garbage paths drop the whole emit with an error so the user
 * fixes the offending edit instead of seeing a partial UPDATE.
 *
 * Sprint 344 (2026-05-15) — `jsonb_set` now passes `create_missing=true`
 * (the 4th arg) so adding a brand-new key to an existing object actually
 * creates it instead of being a no-op when the path doesn't exist. When
 * the current cell value is SQL `null` (jsonb column nullable, row has
 * no object yet), the base is wrapped in `COALESCE(<col>, '{}'::jsonb)`
 * once so the chained `jsonb_set` sees an empty object to grow from.
 */
function emitJsonbUpdate(
  colName: string,
  cellValue: unknown,
  nested: Array<{ key: string; path: string | null; value: string | null }>,
): { kind: "expr"; expr: string } | { kind: "error"; message: string } {
  // Sprint 344 (2026-05-15) — jsonb-null base: a row whose jsonb column is
  // SQL NULL has no object to grow into. Fall back to `'{}'::jsonb` so the
  // add path can create the key. The wrap is applied once on the base; the
  // chained jsonb_set inherits it via the `expr` accumulator.
  const base =
    cellValue === null || cellValue === undefined
      ? `COALESCE(${colName}, '{}'::jsonb)`
      : colName;
  let expr = base;
  for (const ne of nested) {
    if (!ne.path) {
      return { kind: "error", message: "nested edit missing path" };
    }
    const pathLit = jsonbPathLiteral(ne.path);
    if (pathLit === "'{}'") {
      return {
        kind: "error",
        message: `Cannot derive a JSON path from "${ne.path}"`,
      };
    }
    if (ne.value === UNSET_OP) {
      expr = `${expr} #- ${pathLit}`;
    } else if (ne.value === null) {
      // null at a jsonb leaf means JSON null (not SQL NULL) — the
      // tree's "● will delete" affordance routes through __op__:unset
      // explicitly, so plain null is treated as "set to JSON null".
      // Sprint 344 — `, true` enables create_missing so a leaf can be
      // added even when the parent path doesn't yet exist.
      expr = `jsonb_set(${expr}, ${pathLit}, 'null'::jsonb, true)`;
    } else {
      // Sprint 344 — `, true` enables create_missing (see above).
      expr = `jsonb_set(${expr}, ${pathLit}, ${jsonbValueLiteral(ne.value)}, true)`;
    }
  }
  return { kind: "expr", expr };
}

/**
 * Sprint 343 — emit a full ARRAY[...] reassignment for a Postgres
 * native array column with element edits and/or index deletes.
 *
 * We reassign the whole array (rather than `col[i] = $1` per edit)
 * because index-delete cannot be expressed without a `WHERE/ARRAY`
 * trick — primitives don't have a stable identity for
 * `array_remove(col, val)` and duplicates would all collapse. Reading
 * the current array from the row and emitting `ARRAY[...]::elemtype[]`
 * keeps the round-trip exact and gives the user a single statement
 * regardless of whether they edited, deleted, or both.
 *
 * Constraints:
 *  - Paths must be single-segment `[N]`. Anything else (e.g. a deep
 *    `meta.role` inside a `jsonb[]` element) is rejected — that's a
 *    Sprint 343 follow-up.
 *  - Element type must coerce through `coerceToSqlLiteral`. Composite
 *    types (`_record`, custom) currently land in the unknown family
 *    and get escape-quoted as text, which is wrong; we reject up
 *    front so the user sees the unsupported case before submit.
 */
function emitArrayUpdate(
  _colName: string,
  dataType: string,
  cellValue: unknown,
  nested: Array<{ key: string; path: string | null; value: string | null }>,
): { kind: "expr"; expr: string } | { kind: "error"; message: string } {
  const elementType = arrayElementType(dataType);
  if (elementType === null) {
    return { kind: "error", message: `Not an ARRAY column: ${dataType}` };
  }
  if (elementType === "jsonb" || elementType === "json") {
    return {
      kind: "error",
      message:
        "jsonb[] / json[] element edits are not yet supported (Sprint 343 follow-up).",
    };
  }
  const elementFamily = classifySqlType(elementType);

  const original = Array.isArray(cellValue) ? (cellValue as unknown[]) : [];
  type Action = { kind: "edit"; value: string | null } | { kind: "delete" };
  const actions = new Map<number, Action>();
  const INDEX_RE = /^\[(\d+)\]$/;
  for (const ne of nested) {
    const m = ne.path ? INDEX_RE.exec(ne.path) : null;
    if (!m) {
      return {
        kind: "error",
        message: `Only single-index ARRAY paths are supported, got "${ne.path}".`,
      };
    }
    const idx = parseInt(m[1]!, 10);
    if (ne.value === UNSET_OP) actions.set(idx, { kind: "delete" });
    else actions.set(idx, { kind: "edit", value: ne.value });
  }

  // Apply: iterate original by index, drop deletes, swap edits, keep rest.
  const out: string[] = [];
  for (let i = 0; i < original.length; i++) {
    const a = actions.get(i);
    if (a?.kind === "delete") continue;
    if (a?.kind === "edit") {
      const coerced = coerceToSqlLiteral(a.value, elementType);
      if (coerced.kind === "error") {
        return { kind: "error", message: coerced.message };
      }
      out.push(coerced.sql);
    } else {
      // Untouched element — stringify into a SQL literal of the same
      // family so the reassign round-trips exactly.
      out.push(arrayElementToLiteral(original[i], elementFamily));
    }
  }
  // Edits at indexes beyond the current length: append in index order.
  const extraIndexes = Array.from(actions.keys())
    .filter((i) => i >= original.length)
    .sort((a, b) => a - b);
  for (const i of extraIndexes) {
    const a = actions.get(i)!;
    if (a.kind === "delete") continue; // delete past end = no-op
    const coerced = coerceToSqlLiteral(a.value, elementType);
    if (coerced.kind === "error") {
      return { kind: "error", message: coerced.message };
    }
    out.push(coerced.sql);
  }

  return {
    kind: "expr",
    expr: `ARRAY[${out.join(", ")}]::${elementType}[]`,
  };
}

/**
 * Sprint 343 — stringify a JS value (the raw cell array's element)
 * into a SQL literal compatible with `coerceToSqlLiteral`'s output.
 * Mirrors the WHERE-clause `literal` helper but uses family-aware
 * quoting so untouched elements round-trip cleanly.
 */
function arrayElementToLiteral(value: unknown, family: SqlTypeFamily): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return escapeSqlString(value.toISOString());
  }
  const stringy = typeof value === "string" ? value : String(value);
  if (family === "integer" || family === "numeric" || family === "boolean") {
    // Numeric families assume the value already prints as a number.
    return stringy;
  }
  return escapeSqlString(stringy);
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
  const pkCols = data.columns.filter((c) => c.is_primary_key);
  const statements: GeneratedSqlStatement[] = [];
  const qualifiedTable = schema ? `${schema}.${table}` : table;

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
  type EditEntry = {
    key: string;
    path: string | null; // null = top-level cell edit
    value: string | null; // __op__:unset is a string sentinel
  };
  const editsByCell = new Map<string, EditEntry[]>();
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
    const row = data.rows[rowIdx] as unknown[] | undefined;
    if (!row) return;

    const topLevel = entries.find((e) => e.path === null);
    const nested = entries.filter((e) => e.path !== null);
    const whereClause = buildWhereClause(row, data.columns, pkCols);

    // Top-level cell edit takes precedence — it replaces the entire
    // column value, so any concurrent nested edit on the same cell
    // would be redundant. We prefer the top-level path and skip the
    // nested entries; future work could surface a UI warning instead.
    if (topLevel && nested.length === 0) {
      const coerced = coerceToSqlLiteral(topLevel.value, col.data_type);
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
        sql: `UPDATE ${qualifiedTable} SET ${col.name} = ${coerced.sql} WHERE ${whereClause};`,
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
      const coerced = coerceToSqlLiteral(topLevel.value, col.data_type);
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
        sql: `UPDATE ${qualifiedTable} SET ${col.name} = ${coerced.sql} WHERE ${whereClause};`,
        key: topLevel.key,
      });
      return;
    }

    // Nested-only branch — dispatch by column type.
    if (isJsonbColumn(col.data_type)) {
      const emitted = emitJsonbUpdate(col.name, row[colIdx], nested);
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
        sql: `UPDATE ${qualifiedTable} SET ${col.name} = ${emitted.expr} WHERE ${whereClause};`,
        key: nested[0]!.key,
      });
      return;
    }

    if (isArrayColumn(col.data_type)) {
      const emitted = emitArrayUpdate(
        col.name,
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
        sql: `UPDATE ${qualifiedTable} SET ${col.name} = ${emitted.expr} WHERE ${whereClause};`,
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
    const row = data.rows[rowIdx] as unknown[];
    if (!row) return;

    const whereClause = buildWhereClause(row, data.columns, pkCols);
    statements.push({
      sql: `DELETE FROM ${qualifiedTable} WHERE ${whereClause};`,
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
