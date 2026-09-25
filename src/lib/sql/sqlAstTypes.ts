/**
 * SQL AST — shared value + expression + SELECT types.
 *
 * The foundational slice of the SQL AST: literal/value primitives, the
 * widened `SqlSelectExpr` expression tree, the SELECT statement shape, and
 * parse-error variants. Statement wrappers (DDL / DML / misc) live in
 * `sqlAstStatementTypes.ts` and depend on these; this file depends on none
 * of them, so the type graph stays a single-direction DAG
 * (parser -> statement types -> these).
 *
 * All types mirror the Rust `serde::Serialize` output one-for-one — see
 * `src-tauri/sql-parser-core/src/ast.rs`. The tagged-union shape
 * (`{ kind: "..." }`) lets callers narrow without exception flow.
 *
 * Re-exported through the `sqlAst.ts` barrel — import from `./sqlAst`, not
 * from this file directly.
 */

// ---- public types ----------------------------------------------------

export type SqlColumns =
  | { kind: "star" }
  | { kind: "named"; names: string[] }
  // At least one item is a non-bare-column expression
  // (CASE / window-function / scalar-subquery / literal). The list
  // preserves input order.
  | { kind: "expressions"; items: SqlSelectListItem[] };

export type SqlSelectListItem =
  | { kind: "star" }
  // Issue #1297 — `alias` carries the `AS <ident>` / bare-ident output alias
  // (`SELECT id AS user_id` → `alias: "user_id"`); `null` when the column is
  // projected under its own name. Mirrors `SelectListItem::Column` in
  // `src-tauri/sql-parser-core/src/ast.rs`.
  | { kind: "column"; reference: SqlColumnRef; alias: string | null }
  | { kind: "expression"; expression: SqlSelectExpr };

// ---- SELECT widening types -------------------------------------------

/**
 * A column reference — `column` (unqualified) or `table.column`
 * (qualified). `table` is `null` for unqualified references; the parser
 * does not resolve aliases or schema scopes, it only records what the
 * input wrote.
 */
export interface SqlColumnRef {
  table: string | null;
  column: string;
}

export type SqlLikeCase = "sensitive" | "insensitive";

/**
 * Widened expression — used by SELECT's WHERE, HAVING, and JOIN ON
 * predicates, and by DML WHERE through the `SqlWhereExpr` alias. The
 * variant set includes:
 *
 * - `comparison` — column-op-(literal|placeholder|default). The left side
 *   is a `SqlColumnRef` (qualified or unqualified); the right side is an
 *   `SqlInsertValue`.
 * - `column-comparison` — column-op-column (cross-table or same-table).
 * - `extension-operator-comparison` — column symbolic-operator value/column
 *   for bounded PostgreSQL extension/operator-class tolerance.
 * - `between` — `col BETWEEN low AND high`. The negated `NOT BETWEEN`
 *   form is encoded as `not` wrapping `between` (no discrete variant).
 * - `like` — `col LIKE 'pattern'` (`case_sensitivity: "sensitive"`) or
 *   `col ILIKE 'pattern'` (`"insensitive"`). The negated `NOT LIKE` /
 *   `NOT ILIKE` forms wrap with `not`.
 */
export type SqlSelectExpr =
  | {
      kind: "comparison";
      left: SqlColumnRef;
      op: SqlCompareOp;
      value: SqlInsertValue;
    }
  | {
      kind: "column-comparison";
      left: SqlColumnRef;
      op: SqlCompareOp;
      right: SqlColumnRef;
    }
  | {
      kind: "extension-operator-comparison";
      left: SqlColumnRef;
      operator: string;
      right: SqlExtensionOperatorOperand;
    }
  | {
      kind: "scalar-subquery-comparison";
      left: SqlColumnRef;
      op: SqlCompareOp;
      right: SqlSelectStatement;
    }
  | {
      kind: "between";
      column: SqlColumnRef;
      low: SqlInsertValue;
      high: SqlInsertValue;
    }
  | {
      kind: "like";
      column: SqlColumnRef;
      case_sensitivity: SqlLikeCase;
      pattern: SqlInsertValue;
    }
  | { kind: "and"; left: SqlSelectExpr; right: SqlSelectExpr }
  | { kind: "or"; left: SqlSelectExpr; right: SqlSelectExpr }
  | { kind: "not"; inner: SqlSelectExpr }
  | { kind: "is-null"; column: SqlColumnRef }
  | { kind: "is-not-null"; column: SqlColumnRef }
  | {
      kind: "in-list";
      column: SqlColumnRef;
      values: SqlInsertValue[];
    }
  | {
      kind: "in-subquery";
      column: SqlColumnRef;
      statement: SqlSelectStatement;
    }
  | { kind: "exists"; statement: SqlSelectStatement }
  | { kind: "scalar-subquery"; statement: SqlSelectStatement }
  | {
      kind: "window-function";
      name: string;
      arguments: SqlWindowArgument[];
      over: SqlOverClause;
    }
  | {
      kind: "function-call";
      name: string;
      arguments: SqlWindowArgument[];
    }
  | {
      kind: "case";
      operand: SqlSelectExpr | null;
      when_clauses: SqlCaseWhen[];
      else_clause: SqlSelectExpr | null;
    }
  | { kind: "literal"; value: SqlInsertValue }
  | { kind: "column-ref-expr"; column: SqlColumnRef }
  | {
      kind: "expression-comparison";
      left: SqlSelectExpr;
      op: SqlCompareOp;
      value: SqlInsertValue;
    };

export type SqlExtensionOperatorOperand =
  | { kind: "value"; value: SqlInsertValue }
  | { kind: "column"; column: SqlColumnRef };

// ---- window-function support types -----------------------------------

export type SqlWindowArgument =
  | { kind: "star" }
  | { kind: "column-ref"; reference: SqlColumnRef }
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "placeholder"; name: string };

export interface SqlOverClause {
  partition_by: SqlColumnRef[];
  order_by: SqlOrderingItem[];
  frame: SqlWindowFrame | null;
}

export interface SqlWindowFrame {
  unit: "rows" | "range";
  start: SqlFrameBound;
  end: SqlFrameBound | null;
}

export type SqlFrameBound =
  | { kind: "unbounded-preceding" }
  | { kind: "unbounded-following" }
  | { kind: "current-row" }
  | { kind: "preceding"; offset: number }
  | { kind: "following"; offset: number };

export interface SqlCaseWhen {
  condition: SqlSelectExpr;
  result: SqlSelectExpr;
}

/**
 * A JOIN's `ON <expr>` or `USING (col, …)` predicate. Every JOIN variant
 * other than `comma` and `cross-join` carries one of these.
 */
export type SqlJoinPredicate =
  | { kind: "on"; expression: SqlSelectExpr }
  | { kind: "using"; columns: string[] };

/**
 * How a FROM item attaches to the preceding item. The first FROM item
 * always carries `comma` (the variant is reused for "no join" so the
 * AST shape stays uniform). The parser keeps `comma` and `cross-join`
 * distinct — downstream tooling must accept both shapes (no normalization).
 */
export type SqlJoinDescriptor =
  | { kind: "comma" }
  | { kind: "inner-join"; predicate: SqlJoinPredicate }
  | { kind: "left-join"; predicate: SqlJoinPredicate }
  | { kind: "right-join"; predicate: SqlJoinPredicate }
  | { kind: "full-join"; predicate: SqlJoinPredicate }
  | { kind: "cross-join" };

export interface SqlFromItem {
  /** Schema qualifier for `schema.table`. `null` for bare table names. */
  schema: string | null;
  table: string;
  /** `AS alias` or bare-identifier alias. `null` when omitted. */
  alias: string | null;
  join: SqlJoinDescriptor;
  /**
   * Discriminated FROM-item source. For a plain table
   * reference: `kind="table"` with `schema` + `table` (duplicating the
   * top-level slots). For `FROM (SELECT ...) AS alias`: `kind="subquery"`
   * with the nested SELECT body.
   */
  source: SqlFromSource;
}

export type SqlFromSource =
  | { kind: "table"; schema: string | null; table: string }
  | { kind: "subquery"; statement: SqlSelectStatement };

export type SqlOrderDirection = "asc" | "desc";

export type SqlNullsPlacement = "first" | "last" | "unspecified";

export interface SqlOrderingItem {
  column: SqlColumnRef;
  direction: SqlOrderDirection;
  nulls: SqlNullsPlacement;
}

export interface SqlLimitClause {
  count: SqlInsertValue;
  offset: SqlInsertValue | null;
}

export interface SqlSelectStatement {
  kind: "select";
  columns: SqlColumns;
  from: SqlFromItem[];
  where: SqlSelectExpr | null;
  group_by: SqlColumnRef[];
  having: SqlSelectExpr | null;
  order_by: SqlOrderingItem[];
  limit: SqlLimitClause | null;
  /**
   * Chained set operations (`UNION` / `UNION ALL` /
   * `INTERSECT` / `EXCEPT`). Empty when the SELECT is not part of a chain.
   * Entries are in left-to-right input order — implementations must NOT
   * normalize or reorder.
   */
  set_operation: SqlSetOperationEntry[];
}

export interface SqlSetOperationEntry {
  operator: "union" | "union-all" | "intersect" | "except";
  statement: SqlSelectStatement;
}

export type SqlParseErrorKind =
  | "lex-error"
  | "unsupported-statement"
  | "syntax-error"
  | "empty-input"
  // Verb-level structure was recognized but the inner expression
  // (WHERE / SET RHS) uses an unsupported construct. Callers may treat
  // this as "fall back to regex heuristic".
  | "unsupported-expression";

export interface SqlParseError {
  kind: "error";
  error_kind: SqlParseErrorKind;
  message: string;
  at: number | null;
}

// ---- shared value primitives -----------------------------------------

/**
 * Literal values — covers every JSON-shaped column type DML VALUES needs.
 */
export type SqlLiteralValue =
  | { kind: "integer"; value: number }
  | { kind: "float"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };

export type SqlInsertValue =
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "default" }
  | { kind: "placeholder"; name: string };

export type SqlCompareOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

/**
 * DML WHERE uses the unified `SqlSelectExpr` shape.
 * `SqlWhereExpr` is preserved as a type alias for backwards compatibility
 * (downstream callers may still import the name), but the union expanded
 * to match the wider `SqlSelectExpr` shape.
 */
export type SqlWhereExpr = SqlSelectExpr;
