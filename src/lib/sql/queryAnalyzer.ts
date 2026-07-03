/**
 * Lightweight analysers for raw SQL queries — used to decide whether the
 * result of a user-typed query can be edited/deleted in place.
 *
 * Intentionally narrow: we only recognise the simple
 * `SELECT … FROM <schema>.<table> [WHERE/ORDER/…]` shape. Anything more
 * complicated (JOINs, subqueries, set operations, multiple tables) makes
 * the result read-only — we'd have no safe way to map a row back to a
 * single source row.
 */

import type { ColumnInfo } from "@/types/schema";
import type { QueryColumn } from "@/types/query";
import type { DatabaseType } from "@/types/connection";

export interface SingleTableSelectInfo {
  schema: string | null;
  table: string;
}

/**
 * The schema an unqualified single-table SELECT resolves to, per DBMS. Used to
 * map a result row back to its source table's cached PK metadata (keyed by
 * schema) and to fill the edit plan's `schema` field. The wrong default makes
 * `SELECT * FROM mytable` match a phantom table, breaking edit judgment.
 *
 * - postgresql → "public" (search_path default).
 * - sqlite / duckdb → "main" (their sole attached schema).
 * - mssql → "dbo" (SQL Server's default schema).
 * - mysql / mariadb → the active `database`: they have no schema layer, so
 *   `schema === database` and an unqualified table lives in the current DB.
 * - oracle → the connecting `user`, upper-cased: Oracle's default schema is the
 *   session user and the catalog stores owners upper-case (unquoted idents fold
 *   to upper).
 *
 * ponytail: a quoted/case-sensitive Oracle username, or a mysql call with no
 * active database, mismatches and the result stays read-only — safe (no
 * false-positive edit). The connection's `user`/`database` are the only signals
 * available without a backend current-schema probe, which the fix deems
 * over-engineering (issue #1066).
 */
export function resolveDefaultSchema(
  dbType: DatabaseType | undefined,
  database: string,
  user: string,
): string {
  switch (dbType) {
    case "sqlite":
    case "duckdb":
      return "main";
    case "mssql":
      return "dbo";
    case "mysql":
    case "mariadb":
      return database;
    case "oracle":
      return user.toUpperCase();
    default:
      return "public";
  }
}

/** Strip leading SQL comments and whitespace, mirroring backend behaviour. */
function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  while (true) {
    if (s.startsWith("--")) {
      const idx = s.indexOf("\n");
      s = idx >= 0 ? s.slice(idx + 1).trimStart() : "";
    } else if (s.startsWith("/*")) {
      const idx = s.indexOf("*/");
      s = idx >= 0 ? s.slice(idx + 2).trimStart() : "";
    } else {
      return s;
    }
  }
}

/** Drop a trailing `;` (and any whitespace following it). */
function stripTrailingTerminator(sql: string): string {
  return sql.replace(/[;\s]+$/, "");
}

const QUOTED_OR_IDENT = `("[^"]+"|\\w+)`;
const FROM_RE = new RegExp(
  `\\bFROM\\s+${QUOTED_OR_IDENT}(?:\\.${QUOTED_OR_IDENT})?(?=\\s|$|;)`,
  "i",
);
// Major clause keywords that close the FROM clause.
const FROM_BOUNDARY_RE =
  /\b(WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|FOR|FETCH|WINDOW|UNION|INTERSECT|EXCEPT|RETURNING)\b/i;

function unquote(id: string): string {
  if (id.startsWith('"') && id.endsWith('"')) {
    return id.slice(1, -1).replace(/""/g, '"');
  }
  return id;
}

/**
 * Parse a SQL string and return single-table-select metadata, or `null`
 * if the query is anything more complex than a simple unjoined SELECT.
 *
 * Examples that ARE single-table:
 *   - `SELECT * FROM users`
 *   - `SELECT id, name FROM public.users WHERE id > 0`
 *   - `SELECT * FROM "MySchema"."MyTable" ORDER BY id`
 *
 * Examples that are NOT (returns null):
 *   - `SELECT * FROM users JOIN orders ON …`
 *   - `SELECT * FROM users, orders`
 *   - `SELECT * FROM (SELECT 1) sub`
 *   - `WITH cte AS (...) SELECT * FROM cte`
 *   - `SELECT * FROM users UNION SELECT * FROM customers`
 */
export function parseSingleTableSelect(
  sql: string,
): SingleTableSelectInfo | null {
  const stripped = stripTrailingTerminator(stripLeadingComments(sql));
  if (!stripped) return null;

  // Must start with SELECT (no WITH / VALUES / EXPLAIN, etc.)
  if (!/^SELECT\s/i.test(stripped)) return null;

  const fromMatch = FROM_RE.exec(stripped);
  if (!fromMatch) return null;

  const fromStart = fromMatch.index;
  const fromEnd = fromStart + fromMatch[0].length;

  // The text between the FROM table reference and the next major clause
  // (or end of string) must not contain a JOIN, comma, or subquery —
  // those would all imply a multi-source result.
  const tail = stripped.slice(fromEnd);
  const boundary = tail.search(FROM_BOUNDARY_RE);
  const fromTrailing = boundary >= 0 ? tail.slice(0, boundary) : tail;

  if (/\b(JOIN|CROSS|NATURAL)\b/i.test(fromTrailing)) return null;
  if (/,/.test(fromTrailing)) return null;
  if (/\(/.test(fromTrailing)) return null;

  // Set operations anywhere in the statement merge multiple sources, so
  // we cannot map a result row back to a single source row — read-only.
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(stripped)) return null;

  const first = fromMatch[1]!;
  const second = fromMatch[2];
  if (second) {
    return { schema: unquote(first), table: unquote(second) };
  }
  return { schema: null, table: unquote(first) };
}

export type ResultEditability =
  | {
      editable: true;
      schema: string;
      table: string;
      pkColumns: string[];
      // Map result column index → underlying column name (same name today;
      // kept as a level of indirection so AS-aliasing can be added later).
      resultToColumnName: string[];
    }
  | { editable: false; reason: string };

/**
 * Decide whether a raw query result can be edited in place. We allow it
 * only when:
 *   - the query is a simple single-table SELECT (see parseSingleTableSelect),
 *   - the table has at least one primary-key column,
 *   - every primary-key column appears in the result by name.
 *
 * The result column names must match the underlying column names exactly —
 * `SELECT id, name AS alias FROM users` would fail PK lookup if `id` is the
 * PK because we don't track aliases yet.
 */
export function analyzeResultEditability(
  sql: string,
  resultColumns: QueryColumn[],
  tableColumns: ColumnInfo[] | null,
  defaultSchema = "public",
): ResultEditability {
  const parsed = parseSingleTableSelect(sql);
  if (!parsed) {
    return {
      editable: false,
      reason:
        "Editing requires a single-table SELECT (no JOIN, subquery, or set operations).",
    };
  }
  if (!tableColumns) {
    return {
      editable: false,
      reason: "Loading column metadata…",
    };
  }
  const pkCols = tableColumns.filter((c) => c.is_primary_key);
  if (pkCols.length === 0) {
    return {
      editable: false,
      reason: `Table ${parsed.table} has no primary key, so rows cannot be uniquely identified.`,
    };
  }
  const resultNames = new Set(resultColumns.map((c) => c.name));
  const missing = pkCols.filter((pk) => !resultNames.has(pk.name));
  if (missing.length > 0) {
    return {
      editable: false,
      reason: `Result is missing primary-key column(s): ${missing.map((c) => c.name).join(", ")}. Add them to the SELECT to enable editing.`,
    };
  }
  return {
    editable: true,
    schema: parsed.schema ?? defaultSchema,
    table: parsed.table,
    pkColumns: pkCols.map((c) => c.name),
    resultToColumnName: resultColumns.map((c) => c.name),
  };
}
