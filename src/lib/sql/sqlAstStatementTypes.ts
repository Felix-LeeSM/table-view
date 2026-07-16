/**
 * SQL AST — statement wrapper types (DDL / DML / misc grammar).
 *
 * The top-level statement shapes and the `SqlParseResult` union. These
 * depend on the shared value/expression/SELECT types in `sqlAstTypes.ts`
 * (one-direction only — those never reference these), keeping the type
 * graph a single DAG.
 *
 * All types mirror the Rust `serde::Serialize` output one-for-one — see
 * `src-tauri/sql-parser-core/src/ast.rs`.
 *
 * Re-exported through the `sqlAst.ts` barrel — import from `./sqlAst`, not
 * from this file directly.
 */

import type {
  SqlInsertValue,
  SqlLiteralValue,
  SqlParseError,
  SqlSelectExpr,
  SqlSelectStatement,
  SqlWhereExpr,
} from "./sqlAstTypes";

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
