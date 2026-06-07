/**
 * Sprint 385 / 391 / 392 / 393a — SQL parser frontend facade.
 *
 * Bridges the WASM module emitted by `wasm-pack build --target web`
 * (`src/lib/sql/wasm/`) to the rest of the TS codebase. The WASM module
 * is **lazy-loaded** via dynamic `import()` so it lives in its own Vite
 * chunk and does NOT bloat the main entry bundle — that is a load-bearing
 * invariant of the sprint-385 contract.
 *
 * Grammar (sprint-385): `SELECT <columns> FROM <table> [WHERE <ident>
 * <op> <literal>]`. Sprint-391 adds DDL destructive — `DROP …`,
 * `TRUNCATE …`, `ALTER TABLE … DROP COLUMN/CONSTRAINT/INDEX`. Sprint-392
 * adds the DML write triad — `INSERT INTO <table> [(cols)] (VALUES /
 * DEFAULT VALUES / SELECT) [ON CONFLICT …] [ON DUPLICATE KEY UPDATE …]
 * [RETURNING …]`,
 * `UPDATE <table> SET … [FROM] [WHERE] [RETURNING]`,
 * `DELETE FROM <table> [USING] [WHERE] [RETURNING]`. WHERE is the narrow
 * `column-op-literal + AND/OR/NOT/IS NULL` slice; richer expressions
 * surface as `error-kind:'unsupported-expression'` so callers can fall
 * back to regex heuristics.
 *
 * Sprint-393a widens the **SELECT** grammar with FROM-list (commas /
 * schema qualifiers / aliases), the JOIN family (INNER/LEFT/RIGHT/FULL/
 * CROSS + ON/USING), WHERE expression widening (column-column /
 * BETWEEN / LIKE / ILIKE), GROUP BY, HAVING, ORDER BY [ASC|DESC]
 * [NULLS FIRST|LAST], and LIMIT [OFFSET]. The new SELECT WHERE / HAVING
 * / JOIN-ON expression shape is `SqlSelectExpr`; the DML (UPDATE /
 * DELETE) WHERE continues to use the sprint-392 narrow `SqlWhereExpr`
 * until sprint-393b unifies the two. The top-level `kind` discriminator
 * stays `"select"` — downstream consumers that only branched on top-
 * level kind need no code change.
 *
 * The TS types mirror the Rust `serde::Serialize` output one-for-one —
 * see `src-tauri/sql-parser-core/src/ast.rs`. The tagged-union shape
 * (`{ kind: "..." }`) lets callers narrow without exception flow.
 */

// ---- public types ----------------------------------------------------

export type SqlColumns =
  | { kind: "star" }
  | { kind: "named"; names: string[] }
  // Sprint-393b — at least one item is a non-bare-column expression
  // (CASE / window-function / scalar-subquery / literal). The list
  // preserves input order.
  | { kind: "expressions"; items: SqlSelectListItem[] };

export type SqlSelectListItem =
  | { kind: "star" }
  | { kind: "column"; reference: SqlColumnRef }
  | { kind: "expression"; expression: SqlSelectExpr };

// ---- sprint-393a SELECT widening types -------------------------------

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
 * Sprint-393a widened expression — used by SELECT's WHERE, HAVING, and
 * JOIN ON predicates. The variant set adds three new primaries over the
 * sprint-392 narrow `SqlWhereExpr` (which remains in use for DML WHERE
 * until sprint-393b):
 *
 * - `comparison` — column-op-(literal|placeholder|default). The left side
 *   is a `SqlColumnRef` (qualified or unqualified); the right side is an
 *   `SqlInsertValue`. This is the same wire shape sprint-392 produced for
 *   DML WHERE, except the left side is widened from `string` to
 *   `SqlColumnRef`.
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
  // Sprint-393b — new primaries.
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

// Sprint-393b — window-function support types --------------------------

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
 * AST shape stays uniform). The spec keeps `comma` and `cross-join`
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
   * Sprint-393b — discriminated FROM-item source. For a plain table
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
   * Sprint-393b — chained set operations (`UNION` / `UNION ALL` /
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
  // Sprint-392 — verb-level structure was recognized but the inner
  // expression (WHERE / SET RHS) uses a construct outside the narrow
  // sprint-392 expression slice (subquery / IN-list / cross-table
  // comparison / arithmetic / function call). Callers may treat this as
  // "fall back to regex heuristic".
  | "unsupported-expression";

export interface SqlParseError {
  kind: "error";
  error_kind: SqlParseErrorKind;
  message: string;
  at: number | null;
}

// ---- sprint-391 DDL destructive types --------------------------------

/**
 * Object kinds the sprint-391 grammar recognises after `DROP`.
 * Trigger / function / procedure / role are deliberately out of scope —
 * sqlSafety's regex fallback continues to classify them.
 */
export type SqlDropObjectType =
  | "table"
  | "database"
  | "index"
  | "view"
  | "schema"
  | "sequence"
  | "type";

export type SqlCascadeBehavior = "cascade" | "restrict";

export interface SqlDropStatement {
  kind: "drop";
  object_type: SqlDropObjectType;
  name: string;
  if_exists: boolean;
  /** `null` when the user did not write CASCADE/RESTRICT. */
  cascade: SqlCascadeBehavior | null;
}

export interface SqlTruncateStatement {
  kind: "truncate";
  table: string;
  /**
   * `null` if unspecified, `true` if `RESTART IDENTITY`, `false` if
   * `CONTINUE IDENTITY` — matches the Rust `Option<bool>` shape.
   */
  restart_identity: boolean | null;
  cascade: SqlCascadeBehavior | null;
}

export type SqlAlterAction =
  | {
      kind: "drop-column";
      column: string;
      if_exists: boolean;
      cascade: SqlCascadeBehavior | null;
    }
  | {
      kind: "drop-constraint";
      constraint: string;
      cascade: SqlCascadeBehavior | null;
    }
  | { kind: "drop-index"; index: string }
  // Sprint-394 — additive ALTER actions.
  | {
      kind: "add-column";
      column: SqlColumnDefinition;
      if_not_exists: boolean;
    }
  | {
      kind: "add-constraint";
      constraint: SqlTableConstraint;
    }
  | { kind: "rename-table"; new_name: string }
  | { kind: "rename-column"; old_name: string; new_name: string };

export interface SqlAlterTableStatement {
  kind: "alter-table";
  table: string;
  action: SqlAlterAction;
}

// ---- sprint-394 DDL additive types -----------------------------------

/**
 * Sprint-394 — schema-qualified table / view / index reference. Mirrors
 * the sprint-393a FROM-item shape (`schema: string | null` +
 * `table: string`). CREATE TABLE, CREATE INDEX (`ON <table>`), CREATE
 * VIEW (the view's own name), ALTER TABLE ADD CONSTRAINT REFERENCES
 * target, and column-level REFERENCES targets all carry this shape.
 */
export interface SqlTableRef {
  schema: string | null;
  table: string;
}

/**
 * Sprint-394 — column-type discriminated union. The `kind` tag is the
 * kebab-case lowercase form of the SQL type-name. Vendor-specific
 * synonyms (INT4 / STRING / DATETIME / LONGTEXT) parse to
 * `SqlParseError` unless they are known PostgreSQL extension-backed types.
 */
export type SqlColumnType =
  | { kind: "integer" }
  | { kind: "bigint" }
  | { kind: "text" }
  | { kind: "date" }
  | { kind: "boolean" }
  | { kind: "serial" }
  | { kind: "uuid" }
  | { kind: "varchar"; length: number }
  | { kind: "timestamp"; with_time_zone: boolean }
  | {
      kind: "numeric";
      precision: number | null;
      scale: number | null;
    }
  | {
      kind: "number";
      precision: number | null;
      scale: number | null;
    }
  | { kind: "varchar2"; length: number }
  | { kind: "clob" }
  | { kind: "blob" }
  | {
      kind: "extension";
      name: string;
      modifiers: SqlExtensionTypeModifier[];
    };

export type SqlExtensionTypeModifier =
  | { kind: "identifier"; value: string }
  | { kind: "integer"; value: number }
  | { kind: "float"; value: number }
  | { kind: "string"; value: string };

/**
 * Sprint-394 — column-level constraint. The optional `name` slot is
 * populated when the user wrote `CONSTRAINT <name> <body>`; bare
 * constraints leave it `null`.
 */
export interface SqlColumnConstraint {
  name: string | null;
  body: SqlColumnConstraintBody;
}

export type SqlColumnConstraintBody =
  | { kind: "primary-key" }
  | { kind: "not-null" }
  | { kind: "default"; value: SqlInsertValue }
  | { kind: "unique" }
  | {
      kind: "references";
      table: SqlTableRef;
      column: string | null;
    }
  | { kind: "check"; expression: SqlSelectExpr };

/**
 * Sprint-394 — table-level constraint. Same `name` + `body` shape as
 * `SqlColumnConstraint`; the body variants carry a `columns` slot for
 * `primary-key` / `unique` / `references`. `check` carries only an
 * expression (the predicate already names columns).
 */
export interface SqlTableConstraint {
  name: string | null;
  body: SqlTableConstraintBody;
}

export type SqlTableConstraintBody =
  | { kind: "primary-key"; columns: string[] }
  | { kind: "unique"; columns: string[] }
  | {
      kind: "references";
      columns: string[];
      target_table: SqlTableRef;
      /** Empty when the user wrote bare `REFERENCES other` with no
       *  parenthesized target column list. */
      target_columns: string[];
    }
  | { kind: "check"; expression: SqlSelectExpr };

/**
 * Sprint-394 — one column definition in a CREATE TABLE / ALTER TABLE
 * ADD COLUMN list. `source_index` is the zero-based ordinal of this
 * column in the source list — set by the parser, not the user.
 */
export interface SqlColumnDefinition {
  name: string;
  data_type: SqlColumnType;
  constraints: SqlColumnConstraint[];
  source_index: number;
}

export interface SqlCreateTableStatement {
  kind: "create-table";
  table: SqlTableRef;
  if_not_exists: boolean;
  columns: SqlColumnDefinition[];
  table_constraints: SqlTableConstraint[];
}

export interface SqlCreateIndexStatement {
  kind: "create-index";
  unique: boolean;
  if_not_exists: boolean;
  name: string;
  table: SqlTableRef;
  columns: string[];
}

/**
 * Sprint-394 — CREATE VIEW body. The two body shapes match the AST
 * `CreateViewBody` enum: a plain SELECT (with optional set-operation
 * chain) or a CTE-wrapped SELECT (`WITH t AS (...) SELECT ...`). The
 * discriminator uses the same kebab-case `kind` tag scheme as the rest
 * of the AST.
 */
export type SqlCreateViewBody =
  | (SqlSelectStatement & { kind: "select" })
  | (SqlWithStatement & { kind: "with" });

export interface SqlCreateViewStatement {
  kind: "create-view";
  or_replace: boolean;
  name: SqlTableRef;
  body: SqlCreateViewBody;
}

// ---- sprint-392 DML write triad types --------------------------------

/**
 * Sprint-392 widened literal set — sprint-385's `SqlLiteral` covered only
 * `integer` / `string`; DML VALUES needs every JSON-shaped column type.
 * Re-using the existing `SqlLiteral` name would be a breaking change for
 * sprint-385 callsites (sqlAst.test, useSafeModeGate, etc.), so we name
 * the new union `SqlLiteralValue` and keep `SqlLiteral` untouched.
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
 * Sprint-393b — DML WHERE migrates to the unified `SqlSelectExpr` shape.
 * `SqlWhereExpr` is preserved as a type alias for backwards compatibility
 * (downstream callers may still import the name), but the union expanded
 * to match the wider `SqlSelectExpr` shape.
 */
export type SqlWhereExpr = SqlSelectExpr;

export type SqlInsertSource =
  | { kind: "values"; rows: SqlInsertValue[][] }
  | { kind: "default-values" }
  | { kind: "select"; statement: SqlSelectStatement };

export interface SqlUpdateAssignment {
  column: string;
  value: SqlInsertValue;
}

export type SqlOnDuplicateKeyUpdateValue =
  | SqlInsertValue
  | { kind: "values-column"; column: string };

export interface SqlOnDuplicateKeyUpdateAssignment {
  column: string;
  value: SqlOnDuplicateKeyUpdateValue;
}

export interface SqlOnDuplicateKeyUpdate {
  assignments: SqlOnDuplicateKeyUpdateAssignment[];
}

export type SqlOnConflict =
  | { kind: "do-nothing" }
  | {
      kind: "do-update";
      set: SqlUpdateAssignment[];
      where_clause: SqlWhereExpr | null;
    };

export interface SqlInsertStatement {
  kind: "insert";
  table: string;
  columns: string[];
  source: SqlInsertSource;
  on_conflict: SqlOnConflict | null;
  on_duplicate_key_update: SqlOnDuplicateKeyUpdate | null;
  returning: string[];
}

export interface SqlProcedureRef {
  schema: string | null;
  name: string;
}

export type SqlCallArgument =
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "default" }
  | { kind: "placeholder"; name: string }
  | { kind: "user-variable"; name: string };

export interface SqlCallStatement {
  kind: "call";
  procedure: SqlProcedureRef;
  arguments: SqlCallArgument[];
}

export interface SqlUpdateStatement {
  kind: "update";
  table: string;
  assignments: SqlUpdateAssignment[];
  from: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

export interface SqlDeleteStatement {
  kind: "delete";
  table: string;
  using: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

// ---- sprint-484 PostgreSQL MERGE first-slice types -------------------

export interface SqlMergeStatement {
  kind: "merge";
  target: SqlTableRef;
  target_alias: string | null;
  source: SqlTableRef;
  source_alias: string | null;
  on: SqlSelectExpr;
  clauses: SqlMergeWhenClause[];
}

export interface SqlMergeWhenClause {
  not_matched: boolean;
  action: "update" | "insert" | "do-nothing";
  assignments: Array<[string, SqlMergeValue]>;
  columns: string[];
  values: SqlMergeValue[];
}

export type SqlMergeValue = SqlSelectExpr;

/**
 * Sprint-393b — `WITH [RECURSIVE] cte AS (...) <inner-statement>`. The
 * inner statement is one of SELECT / INSERT / UPDATE / DELETE (nested
 * WITH is rejected at parse time, out of scope this sprint).
 */
export interface SqlWithStatement {
  kind: "with";
  recursive: boolean;
  ctes: SqlCteDefinition[];
  inner_statement: SqlWithInner;
}

/**
 * Sprint-393b — the four statement variants accepted as the inner body
 * of a `WITH`. Serialized with a `kind` discriminator matching the Rust
 * `WithInner` enum.
 */
export type SqlWithInner =
  | SqlSelectStatement
  | SqlInsertStatement
  | SqlUpdateStatement
  | SqlDeleteStatement;

export interface SqlCteDefinition {
  name: string;
  /** Empty list when the user did not write `(col, col, ...)`. */
  columns: string[];
  body: SqlSelectStatement;
}

// ---- sprint-395 misc grammar types -----------------------------------

/**
 * Sprint-395 — One privilege tag in a GRANT/REVOKE statement. `select`,
 * `update`, and `references` may carry a `columns` slot (empty when the
 * privilege applies to all columns of the table). `all` represents both
 * `ALL` and `ALL PRIVILEGES`.
 */
export type SqlPrivilegeTag =
  | { kind: "all" }
  | { kind: "select"; columns: string[] }
  | { kind: "insert" }
  | { kind: "update"; columns: string[] }
  | { kind: "delete" }
  | { kind: "truncate" }
  | { kind: "references"; columns: string[] }
  | { kind: "trigger" }
  | { kind: "usage" }
  | { kind: "execute" };

/**
 * Sprint-395 — GRANT/REVOKE object target. `all-in-schema` represents
 * the PG `ALL TABLES IN SCHEMA name` shorthand.
 */
export type SqlGrantObject =
  | { kind: "table"; tables: SqlTableRef[] }
  | { kind: "schema"; schemas: string[] }
  | { kind: "database"; databases: string[] }
  | { kind: "sequence"; sequences: string[] }
  | { kind: "function"; functions: string[] }
  | { kind: "all-in-schema"; schema_name: string };

/**
 * Sprint-395 — grantee / revokee reference. Plain identifier roles get
 * `kind="role"`. `PUBLIC` gets `kind="public"`. Both `CURRENT_USER` and
 * `SESSION_USER` normalize to `kind="current-session"`.
 */
export type SqlRoleRef =
  | { kind: "role"; name: string }
  | { kind: "public" }
  | { kind: "current-session" };

export interface SqlGrantStatement {
  kind: "grant";
  privileges: SqlPrivilegeTag[];
  object: SqlGrantObject;
  grantees: SqlRoleRef[];
  with_grant_option: boolean;
}

export interface SqlRevokeStatement {
  kind: "revoke";
  privileges: SqlPrivilegeTag[];
  object: SqlGrantObject;
  revokees: SqlRoleRef[];
  grant_option_for: boolean;
  cascade: SqlCascadeBehavior | null;
}

/**
 * Sprint-395 — EXPLAIN/COPY option pair. The `name` slot is normalized to
 * lowercase by the parser. The `value` slot uses the sprint-392
 * `SqlInsertValue` shape.
 */
export interface SqlExplainOption {
  name: string;
  value: SqlInsertValue;
}

/**
 * Sprint-395 — statement variants accepted as the inner body of an
 * EXPLAIN. The discriminator uses kebab-case `kind` tags matching the
 * Rust `ExplainInner` enum.
 */
export type SqlExplainInner =
  | SqlSelectStatement
  | SqlInsertStatement
  | SqlUpdateStatement
  | SqlDeleteStatement
  | SqlMergeStatement
  | SqlWithStatement;

export interface SqlExplainStatement {
  kind: "explain";
  analyze: boolean;
  verbose: boolean;
  options: SqlExplainOption[];
  inner_statement: SqlExplainInner;
}

/**
 * Sprint-395 — SHOW target variant. The `variable` form carries the
 * variable name (possibly dotted); the `tables` form carries an optional
 * schema qualifier.
 */
export type SqlShowTarget =
  | { kind: "variable"; name: string }
  | { kind: "tables"; schema: string | null }
  | { kind: "databases" }
  | { kind: "schemas" };

export interface SqlShowStatement {
  kind: "show";
  target: SqlShowTarget;
}

export type SqlSetScope = "session" | "local" | "default";

/**
 * Sprint-395 — SET RHS. Distinct from `SqlInsertValue` so bare-identifier
 * SET targets (`SET search_path = public`) do not pollute the placeholder
 * surface used by DML/SELECT.
 */
export type SqlSetValue =
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "default" }
  | { kind: "identifier"; name: string };

export interface SqlSetStatement {
  kind: "set-stmt";
  scope: SqlSetScope;
  name: string;
  value: SqlSetValue;
}

export type SqlCopyDirection = "from" | "to";

export type SqlCopyTarget =
  | { kind: "table"; table: SqlTableRef; columns: string[] }
  | { kind: "select"; statement: SqlSelectStatement };

export type SqlCopySource =
  | { kind: "file"; path: string }
  | { kind: "stdin" }
  | { kind: "stdout" };

export interface SqlCopyStatement {
  kind: "copy";
  direction: SqlCopyDirection;
  target: SqlCopyTarget;
  source: SqlCopySource;
  options: SqlExplainOption[];
}

/**
 * Sprint-395 — COMMENT object target. `column` carries `table` + `column`;
 * `constraint` carries `table` + `constraint`; the rest carry a single
 * `name` slot.
 */
export type SqlCommentTarget =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "view"; name: string }
  | { kind: "index"; name: string }
  | { kind: "schema"; name: string }
  | { kind: "sequence"; name: string }
  | { kind: "database"; name: string }
  | { kind: "constraint"; table: string; constraint: string };

/**
 * Sprint-395 — COMMENT text. The `null` variant captures `IS NULL` (clear
 * the comment); `string` carries the literal text.
 */
export type SqlCommentText =
  | { kind: "string"; value: string }
  | { kind: "null" };

export interface SqlCommentStatement {
  kind: "comment";
  target: SqlCommentTarget;
  text: SqlCommentText;
}

export type SqlParseResult =
  | SqlSelectStatement
  | SqlDropStatement
  | SqlTruncateStatement
  | SqlAlterTableStatement
  | SqlCreateTableStatement
  | SqlCreateIndexStatement
  | SqlCreateViewStatement
  | SqlInsertStatement
  | SqlCallStatement
  | SqlUpdateStatement
  | SqlDeleteStatement
  | SqlMergeStatement
  | SqlWithStatement
  // Sprint-395 — misc grammar top-levels.
  | SqlGrantStatement
  | SqlRevokeStatement
  | SqlExplainStatement
  | SqlShowStatement
  | SqlSetStatement
  | SqlCopyStatement
  | SqlCommentStatement
  | SqlParseError;

// ---- WASM bridge -----------------------------------------------------

/**
 * The wasm-pack-generated module shape. `default` is the init function
 * (returns a promise that resolves when the WASM linear memory is ready);
 * `parse_sql` is our exported Rust function. We type these via `unknown`
 * + a narrow runtime guard rather than `any` — the d.ts emitted by
 * wasm-pack uses `any` for the return value, which we tighten to
 * `SqlParseResult` here.
 */
interface SqlWasmModule {
  default: (input?: unknown) => Promise<unknown>;
  parse_sql: (sql: string) => unknown;
}

// Module-level cached init promise — `parseSql` is called once per
// editor keystroke at the worst, so we memoize the WASM instantiation
// rather than re-fetching for each call.
let modulePromise: Promise<SqlWasmModule> | null = null;

// Sprint 391 — once the WASM module has finished initialising we mirror
// the module reference into a synchronous slot so sync callers
// (`parseSqlPreloaded`, used by `sqlSafety.analyzeStatement`) can route
// through the AST path without awaiting. `null` means the module has
// not yet been loaded — sync callers must fall back to their existing
// regex / heuristic path in that case.
let loadedModule: SqlWasmModule | null = null;

async function loadWasm(): Promise<SqlWasmModule> {
  if (modulePromise === null) {
    modulePromise = (async () => {
      // Dynamic import — Vite tree-splits this into its own chunk so the
      // ~45KB WASM glue does not land in the main entry bundle.
      const mod = (await import(
        // The relative path is intentional — the wasm-pack output dir
        // (`src/lib/sql/wasm/`) is a sibling of this file. Using `@/...`
        // alias would also work but the relative form makes the chunk
        // boundary obvious to anyone grepping for `wasm`.
        "./wasm/sql_parser_core.js"
      )) as unknown as SqlWasmModule;
      // `default` is the init function generated by wasm-pack `--target
      // web`. Calling it with no args lets the glue locate the sibling
      // `.wasm` via `new URL("...", import.meta.url)`.
      await mod.default();
      // Sprint 391 — once the module is ready, expose it via the sync
      // slot so `parseSqlPreloaded` can dispatch without awaiting.
      loadedModule = mod;
      return mod;
    })();
  }
  return modulePromise;
}

/**
 * Lazy-loaded SQL parser entry point. Resolves to either a successful
 * `SqlSelectStatement` or a `SqlParseError` — errors are NOT thrown so
 * callers can pattern-match on the `kind` discriminant without
 * try/catch ceremony.
 *
 * Caller responsibility: do NOT pass untrusted SQL to a backend executor
 * based on the AST alone. The parser only verifies syntax; semantic
 * checks (schema-aware completion, dialect validation, safety gating)
 * still belong to the existing pipelines (`sqlSafety`, `queryAnalyzer`,
 * …). Replacing those is sprint-386+.
 */
export async function parseSql(sql: string): Promise<SqlParseResult> {
  const mod = await loadWasm();
  const raw = mod.parse_sql(sql);
  if (!isSqlParseResult(raw)) {
    // The Rust crate's WASM bridge falls back to `JsValue::NULL` only
    // on an internal serde-bindgen serialization bug, which is not a
    // user-input failure mode. Surface it as a synthetic error so the
    // caller's narrowing stays exhaustive.
    return {
      kind: "error",
      error_kind: "lex-error",
      message: "internal: WASM bridge returned non-serializable result",
      at: null,
    };
  }
  return raw;
}

/**
 * Sprint 391 — synchronous AST entry point. Returns `null` if the WASM
 * module is not yet loaded; otherwise dispatches into the same Rust
 * `parse_sql` function as `parseSql`. Used by `sqlSafety.analyzeStatement`
 * to migrate the regex-based DDL destructive classifier to an AST-based
 * one without breaking the synchronous public API of `analyzeStatement`.
 *
 * Callers MUST treat a `null` return as "fall back to the prior regex /
 * heuristic path" — the function deliberately does NOT throw so the
 * classifier can stay drop-in regression-safe.
 */
export function parseSqlPreloaded(sql: string): SqlParseResult | null {
  if (loadedModule === null) return null;
  const raw = loadedModule.parse_sql(sql);
  if (!isSqlParseResult(raw)) return null;
  return raw;
}

/**
 * Sprint 391 — fire-and-forget preload. Resolves once the WASM module
 * is loaded. Used by integration tests to make `parseSqlPreloaded`
 * synchronously available. Production code does not need to call this
 * explicitly; the first `parseSql(...)` await primes the same cache.
 */
export async function preloadSqlWasm(): Promise<void> {
  await loadWasm();
}

// ---- runtime guards --------------------------------------------------

const SQL_PARSE_RESULT_KINDS = new Set<string>([
  "select",
  "drop",
  "truncate",
  "alter-table",
  // Sprint-392 — DML write triad.
  "insert",
  "call",
  "update",
  "delete",
  "merge",
  // Sprint-393b — CTE-wrap top-level.
  "with",
  // Sprint-394 — DDL additive top-levels.
  "create-table",
  "create-index",
  "create-view",
  // Sprint-395 — misc grammar top-levels.
  "grant",
  "revoke",
  "explain",
  "show",
  "set-stmt",
  "copy",
  "comment",
  "error",
]);

function isSqlParseResult(value: unknown): value is SqlParseResult {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && SQL_PARSE_RESULT_KINDS.has(kind);
}

/**
 * Test-only escape hatch — used by `sqlAst.test.ts` to force a fresh
 * `import()` between tests. Not part of the public surface and not
 * exported through `index.ts`-style barrels.
 *
 * The function is `export` so vitest can reach it; production callers
 * should never invoke it (there is no production use case for evicting
 * the WASM module after it has been loaded).
 */
export function __resetSqlWasmModuleForTests(): void {
  modulePromise = null;
  loadedModule = null;
}
