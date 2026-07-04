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
import { tokenizeSql } from "./sqlTokenize";
import { parseSqlPreloaded, type SqlSelectStatement } from "./sqlAst";
import {
  resolveResultColumns,
  type SchemaColumnLookup,
} from "./multiTableResolver";
import type {
  MultiTableColumnPlan,
  MultiTableInstance,
  MultiTablePlan,
} from "./rawQuerySqlBuilder";

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

/**
 * Strip ALL SQL comments (leading, trailing, inline) while preserving string
 * and quoted-identifier literals verbatim. Reuses the literal-aware tokenizer
 * so a `--` / block-comment sequence *inside* a string (e.g.
 * `WHERE note = '-- x'`) is NOT mistaken for a comment — a naive regex strip
 * would delete past it and could hide a disqualifying keyword (JOIN / UNION),
 * flipping a genuinely multi-source query to falsely-editable (data-integrity
 * risk). Each comment becomes a single space so two identifiers separated only
 * by a block comment can't fuse into one token (keeping JOIN word-bounded).
 * Issue #1226.
 */
function stripComments(sql: string): string {
  return tokenizeSql(sql)
    .map((t) => (t.kind === "comment" ? " " : t.text))
    .join("");
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
  const stripped = stripTrailingTerminator(stripComments(sql).trim());
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
      // Source (underlying) primary-key column names.
      pkColumns: string[];
      // Result column index → SOURCE column name. Aliased projections
      // (`id AS user_id`) resolve back to `id` here, so the raw-edit builder's
      // WHERE / UPDATE SET target the real columns while value lookup stays
      // index-based against the result row. Issue #1297.
      resultToColumnName: string[];
    }
  | { editable: false; reason: string };

export const NOT_SINGLE_TABLE_REASON =
  "Editing requires a single-table SELECT (no JOIN, subquery, aggregation, or set operations).";

/**
 * Single-table metadata plus the result→source column map, derived from the
 * sql-parser-core AST. `null` when the statement is anything other than a
 * plain single-table SELECT (or when the AST is unavailable / fails to parse
 * — the caller then keeps the result read-only, never editable). Issue #1297.
 */
interface SingleTableAstInfo {
  schema: string | null;
  table: string;
  /** result column name (alias or bare) → source column name. */
  sourceByResultName: Map<string, string>;
}

function singleTableFromSelect(
  stmt: SqlSelectStatement,
): SingleTableAstInfo | null {
  // Aggregation / grouping / set operations merge or collapse source rows,
  // so a result row no longer maps 1:1 to a source row — read-only.
  if (stmt.set_operation.length > 0) return null;
  if (stmt.group_by.length > 0) return null;
  if (stmt.having !== null) return null;
  // Exactly one FROM item, a plain table (no JOIN, no derived table).
  if (stmt.from.length !== 1) return null;
  const item = stmt.from[0]!;
  if (item.join.kind !== "comma") return null;
  if (item.source.kind !== "table") return null;

  const sourceByResultName = new Map<string, string>();
  const cols = stmt.columns;
  if (cols.kind === "expressions") {
    for (const it of cols.items) {
      // `*` inside an expression list contributes identity-mapped columns;
      // leave them out of the map (the identity fallback covers them).
      if (it.kind === "star") continue;
      // Any non-column expression projection (CASE / function / literal /
      // subquery) has no single source column — read-only. Issue #1297 #3.
      if (it.kind !== "column") return null;
      const resultName = it.alias ?? it.reference.column;
      sourceByResultName.set(resultName, it.reference.column);
    }
  }
  // `star` / `named` variants project source columns under their own names,
  // so the identity fallback (result name === source name) is correct.
  return {
    schema: item.source.schema,
    table: item.source.table,
    sourceByResultName,
  };
}

/**
 * Parse via the preloaded WASM AST and extract single-table-select info.
 * Returns `null` (→ read-only) when the AST module is not yet loaded, the
 * input fails to parse, or the statement is not a plain single-table SELECT.
 */
function parseSingleTableAst(sql: string): SingleTableAstInfo | null {
  const stripped = stripTrailingTerminator(stripComments(sql).trim());
  if (!stripped) return null;
  const ast = parseSqlPreloaded(stripped);
  // `null` = WASM not loaded; `error` = parse failure. Both stay read-only
  // (issue #1297 #4 — the fallback never opens editing).
  if (ast === null || ast.kind !== "select") return null;
  return singleTableFromSelect(ast);
}

/**
 * Decide whether a raw query result can be edited in place. Allowed only when:
 *   - the query is a plain single-table SELECT (no JOIN / subquery /
 *     aggregation / GROUP BY / set operation), resolved via the WASM AST,
 *   - the table has at least one primary-key column,
 *   - every primary-key column is reachable in the result (directly or under
 *     a column alias — `SELECT id AS user_id` keeps an aliased PK editable).
 *
 * When the AST is unavailable (module not loaded) or the parse fails, the
 * result stays read-only — the fallback direction never opens editing.
 */
export function analyzeResultEditability(
  sql: string,
  resultColumns: QueryColumn[],
  tableColumns: ColumnInfo[] | null,
  defaultSchema = "public",
): ResultEditability {
  const parsed = parseSingleTableAst(sql);
  if (!parsed) {
    return { editable: false, reason: NOT_SINGLE_TABLE_REASON };
  }
  if (!tableColumns) {
    return { editable: false, reason: "Loading column metadata…" };
  }
  const pkCols = tableColumns.filter((c) => c.is_primary_key);
  if (pkCols.length === 0) {
    return {
      editable: false,
      reason: `Table ${parsed.table} has no primary key, so rows cannot be uniquely identified.`,
    };
  }
  // Map each result column (in grid order) back to its source column name.
  const resultToColumnName = resultColumns.map(
    (c) => parsed.sourceByResultName.get(c.name) ?? c.name,
  );
  const sourceNames = new Set(resultToColumnName);
  const missing = pkCols.filter((pk) => !sourceNames.has(pk.name));
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
    resultToColumnName,
  };
}

// ---- multi-table editability (issue #1299) ----------------------------

/** Parse a SELECT and return its FROM source tables (for PK prefetch), or
 *  `null` when the input is not a plain-table SELECT (WASM unloaded, parse
 *  failure, non-SELECT, or a derived-table / subquery FROM). */
export function parseSelectInstances(
  sql: string,
): { schema: string | null; table: string }[] | null {
  const stripped = stripTrailingTerminator(stripComments(sql).trim());
  if (!stripped) return null;
  const ast = parseSqlPreloaded(stripped);
  if (ast === null || ast.kind !== "select") return null;
  if (ast.from.length === 0) return null;
  if (ast.from.some((f) => f.source.kind !== "table")) return null;
  return ast.from.map((f) => ({ schema: f.schema, table: f.table }));
}

export type MultiTableEditability =
  | { editable: true; plan: MultiTablePlan }
  | { editable: false; reason: string };

/**
 * Decide whether a multi-table (JOIN) raw result can be edited per-column.
 * Consumes the positional attribution from `resolveResultColumns` (#1298) and
 * projects it into a `MultiTablePlan`: each column is editable iff it is
 * attributed to an instance whose full primary key is present in the result.
 * The resolver's self-verification downgrade (whole result → unattributable on
 * any name mismatch) is preserved — such a result reports `editable: false`.
 *
 * `lookup` resolves a `(schema, table)` pair to its cached column metadata;
 * the caller applies its default-schema policy inside the closure.
 */
export function analyzeMultiTableEditability(
  sql: string,
  resultColumns: QueryColumn[],
  lookup: SchemaColumnLookup,
  defaultSchema: string,
): MultiTableEditability {
  const stripped = stripTrailingTerminator(stripComments(sql).trim());
  if (!stripped) return { editable: false, reason: NOT_SINGLE_TABLE_REASON };
  const ast = parseSqlPreloaded(stripped);
  if (ast === null || ast.kind !== "select") {
    return { editable: false, reason: NOT_SINGLE_TABLE_REASON };
  }

  const resolved = resolveResultColumns(
    ast,
    resultColumns.map((c) => c.name),
    lookup,
  );
  const editByInstance = new Map(
    resolved.instanceEditability.map((e) => [e.instance, e]),
  );

  const instances: MultiTableInstance[] = resolved.instances.map((inst) => {
    const ed = editByInstance.get(inst.index);
    return {
      schema: inst.schema ?? defaultSchema,
      table: inst.table,
      pkColumns: ed?.pkComplete ? Object.keys(ed.pkPositions) : [],
      pkPositions: ed?.pkPositions ?? {},
    };
  });

  const columns: MultiTableColumnPlan[] = resolved.columns.map((c) => {
    if (c.kind === "unattributable") {
      return {
        instance: null,
        sourceColumn: null,
        editable: false,
        readonlyReason: c.reason,
      };
    }
    const pkComplete = editByInstance.get(c.instance)?.pkComplete ?? false;
    return {
      instance: c.instance,
      sourceColumn: c.sourceColumn,
      editable: pkComplete,
      readonlyReason: pkComplete
        ? null
        : `Result is missing the primary key for ${c.table}, so its rows can't be uniquely identified.`,
    };
  });

  if (!columns.some((c) => c.editable)) {
    // Nothing editable — surface the resolver's shared downgrade reason when
    // the whole result was poisoned (e.g. name self-verification mismatch).
    const downgraded = resolved.columns.find(
      (c) => c.kind === "unattributable",
    );
    return {
      editable: false,
      reason:
        downgraded && downgraded.kind === "unattributable"
          ? downgraded.reason
          : NOT_SINGLE_TABLE_REASON,
    };
  }

  return { editable: true, plan: { instances, columns } };
}
