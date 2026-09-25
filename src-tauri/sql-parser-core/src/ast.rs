//! AST types for the SQL grammar slices.
//!
//! Grammar (core SELECT):
//!   `SELECT <columns> FROM <table> [WHERE <ident> <op> <literal>]`
//!
//! Grammar (DDL destructive):
//!   `DROP <object-type> [IF EXISTS] <name> [CASCADE|RESTRICT]`
//!   `TRUNCATE [TABLE] <name> [RESTART|CONTINUE IDENTITY] [CASCADE|RESTRICT]`
//!   `ALTER TABLE <name> DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]`
//!   `ALTER TABLE <name> DROP CONSTRAINT <name> [CASCADE|RESTRICT]`
//!   `ALTER TABLE <name> DROP INDEX <name>` (MySQL-style)
//!
//! All node types are `serde::Serialize` + `Deserialize` so the same
//! discriminated union shape round-trips through both the WASM bridge
//! (`serde-wasm-bindgen`) and the Tauri IPC bridge (`serde_json`). The
//! frontend `sqlAst.ts` mirrors this shape one-for-one.
//!
//! `#[serde(tag = "kind", rename_all = "kebab-case")]` on the top-level
//! result and on `Columns` / `Literal` / `ParseError` keeps the TS-side
//! union narrow-able by a `kind` discriminant — matches the rest of the
//! codebase's tagged-union pattern (e.g. `mongoshAst.ts`).

use serde::{Deserialize, Serialize};

/// Top-level result returned by `parse_sql`. Tagged union so the caller
/// (TS facade, Tauri command) does NOT need to use `Result<…, …>` — a
/// `ParseError` is just another variant of the same shape and travels
/// through `serde_wasm_bindgen` / `serde_json` symmetrically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(clippy::large_enum_variant)]
pub enum ParseResult {
    /// A successfully parsed SELECT statement (core grammar slice).
    Select(SelectStatement),
    /// `DROP <object-type> …`.
    Drop(DropStatement),
    /// `TRUNCATE [TABLE] …`.
    Truncate(TruncateStatement),
    /// `ALTER TABLE <name> <action>` — only the DROP actions are covered.
    /// ADD COLUMN / ADD CONSTRAINT / RENAME TO / RENAME COLUMN are not.
    AlterTable(AlterTableStatement),
    /// `CREATE TABLE [IF NOT EXISTS] <name> (cols, table-
    /// constraints)`. TEMPORARY / UNLOGGED / MATERIALIZED variants are
    /// rejected as `SyntaxError` (out of scope).
    CreateTable(CreateTableStatement),
    /// `CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON
    /// table (cols)`. Functional / expression indexes are not supported.
    CreateIndex(CreateIndexStatement),
    /// `CREATE [OR REPLACE] VIEW name AS <select-stmt>`.
    /// The view body may be a `SelectStatement` or `WithStatement`.
    CreateView(CreateViewStatement),
    /// `INSERT INTO <table> …`.
    Insert(InsertStatement),
    /// MySQL/MariaDB `CALL proc(...)`. Stored routine bodies and
    /// DELIMITER scripting remain out of scope.
    Call(CallStatement),
    /// `UPDATE <table> SET …`.
    Update(UpdateStatement),
    /// `DELETE FROM <table> …`.
    Delete(DeleteStatement),
    /// Narrow PostgreSQL `MERGE INTO ... USING ... ON ...`
    /// with UPDATE / INSERT / DO NOTHING actions.
    Merge(MergeStatement),
    /// `WITH [RECURSIVE] cte AS (...) <inner-statement>`. The
    /// `inner_statement` slot is one of SELECT / INSERT / UPDATE / DELETE —
    /// nested `WITH` is rejected at parse time (out of scope).
    With(WithStatement),
    /// `GRANT priv ON object TO role [WITH GRANT OPTION]`. Maps
    /// to the `permission-change` sqlSafety classification.
    Grant(GrantStatement),
    /// `REVOKE [GRANT OPTION FOR] priv ON object FROM role
    /// [CASCADE|RESTRICT]`.
    Revoke(RevokeStatement),
    /// `EXPLAIN [ANALYZE] [VERBOSE] [(option …)] inner-stmt`.
    /// The `inner_statement` slot carries the wrapped statement; the safety
    /// classifier inherits the inner statement's `kind` / `severity` /
    /// `reasons` (decision D1).
    Explain(ExplainStatement),
    /// `SHOW <variable> | SHOW TABLES [IN schema] | SHOW
    /// DATABASES | SHOW SCHEMAS`.
    Show(ShowStatement),
    /// `SET [SESSION|LOCAL] <name> {TO|=} <value>` where value
    /// is literal / DEFAULT / bare identifier.
    SetStmt(SetStatement),
    /// `COPY {table | (SELECT …)} [(cols)] FROM/TO {file |
    /// STDIN | STDOUT} [WITH (option …)]`.
    Copy(CopyStatement),
    /// `COMMENT ON <object-kind> <ident> IS <string-or-NULL>`.
    Comment(CommentStatement),
    /// A parse / lex error. `kind` discriminator is one of:
    /// `"lex-error"`, `"unsupported-statement"`, `"syntax-error"`,
    /// `"empty-input"`, `"unsupported-expression"` — see `ParseErrorKind`.
    Error(ParseError),
}

/// `WITH [RECURSIVE] <cte-list> <inner-statement>`. The
/// inner statement is one of SELECT / INSERT / UPDATE / DELETE; the
/// `Box` avoids the recursive-size issue without forcing every callsite
/// into an indirection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WithStatement {
    pub recursive: bool,
    pub ctes: Vec<CteDefinition>,
    pub inner_statement: Box<WithInner>,
}

/// The four statement variants accepted as the inner body
/// of a `WITH`. Nested `WITH` is out of scope (rejected as SyntaxError).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(clippy::large_enum_variant)]
pub enum WithInner {
    Select(SelectStatement),
    Insert(InsertStatement),
    Update(UpdateStatement),
    Delete(DeleteStatement),
}

/// A single CTE entry in the `WITH ... AS (...)` list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CteDefinition {
    pub name: String,
    /// Optional column-list (`WITH t(a, b) AS (...)`). Empty when absent.
    pub columns: Vec<String>,
    pub body: SelectStatement,
}

/// The original narrow SELECT had `table: String` + `where: Option<WhereClause>`.
/// The widened shape supports multi-table FROM, JOIN, the
/// widened WHERE expression (column-column / BETWEEN / LIKE / ILIKE),
/// GROUP BY, HAVING, ORDER BY, and LIMIT/OFFSET. The top-level `kind`
/// discriminator stays `"select"` so existing callers that only branch on
/// `kind` need no change. New fields are additive: narrow-grammar inputs
/// continue to parse — their FROM is a single-item list, their other new
/// slots are absent / empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectStatement {
    pub columns: Columns,
    /// Ordered list of FROM items. Empty for PostgreSQL-style no-FROM
    /// projection SELECTs such as `SELECT 1`; otherwise left-to-right.
    pub from: Vec<FromItem>,
    #[serde(rename = "where")]
    pub where_clause: Option<SelectExpr>,
    /// `GROUP BY` columns. Empty when the clause is absent. Each item is a
    /// qualified-or-unqualified column reference.
    pub group_by: Vec<ColumnRef>,
    pub having: Option<SelectExpr>,
    /// `ORDER BY` items. Empty when the clause is absent.
    pub order_by: Vec<OrderingItem>,
    pub limit: Option<LimitClause>,
    /// Chained set operations (`UNION` / `INTERSECT` /
    /// `EXCEPT`). Empty when the SELECT is not part of a set-operation
    /// chain. Entries are stored in left-to-right input order; the
    /// serializer/parser MUST NOT normalize order — set operations are
    /// non-commutative in general.
    pub set_operation: Vec<SetOperationEntry>,
}

/// One chained set operation. The first SELECT in a chain
/// is the root `SelectStatement`; subsequent operators + right-hand
/// SELECTs are recorded here in input order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetOperationEntry {
    pub operator: SetOperator,
    pub statement: SelectStatement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetOperator {
    Union,
    UnionAll,
    Intersect,
    Except,
}

/// A single item in the FROM list. The `join` descriptor specifies how
/// this item attaches to the previous item — `Comma` for the first item
/// (and for any later comma-separated item), or one of the JOIN variants.
///
/// Earlier revisions kept the `schema` + `table` slots at the top level. The
/// existing tests inspect those slots directly via `item.table` /
/// `item.schema`. Subquery FROM items are *added* on top —
/// `FROM (SELECT ...) AS alias` — by surfacing the same data through a
/// discriminated `source` slot AND keeping the legacy `schema` + `table`
/// slots populated for table-source items (empty string for `table` when
/// the source is a subquery). Downstream code that switches on
/// `source.kind` gets the wider shape; legacy code that reads `table`
/// continues to work for table-source items.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FromItem {
    /// Schema qualifier for `schema.table` references — `None` for a bare
    /// table name or for a subquery FROM item.
    pub schema: Option<String>,
    /// Table identifier for a table source; empty string when the source
    /// is a subquery (the legacy `table` field is kept for the tests that
    /// index `from[i].table` directly).
    pub table: String,
    /// `AS alias` or bare identifier alias. `None` when omitted.
    /// Subquery FROM items REQUIRE an alias — a missing alias is a
    /// `SyntaxError` (AC-393b-Q06).
    pub alias: Option<String>,
    pub join: JoinDescriptor,
    /// Discriminated FROM-item source. For a plain table
    /// reference, this carries `kind="table"` with `schema` + `table`
    /// duplicated from the top-level slots; for a parenthesized SELECT,
    /// `kind="subquery"` with the nested SELECT body.
    pub source: FromSource,
}

/// FROM-item source. The variant tag is the same shape
/// the spec mandates for downstream consumers (`source.kind === "table"`
/// vs `"subquery"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FromSource {
    Table {
        schema: Option<String>,
        table: String,
    },
    Subquery {
        statement: Box<SelectStatement>,
    },
}

/// How a FROM item attaches to the preceding item. The first FROM item
/// always carries `Comma` (it is not a join — the variant is reused for
/// "no join" so the AST stays uniform). Subsequent items carry the kind
/// of attachment the user wrote: `Comma` for comma-separation, one of the
/// `*-Join` variants for an explicit join keyword. The spec deliberately
/// keeps `Comma` and `CrossJoin` distinct (no normalization) — downstream
/// tooling must accept both shapes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum JoinDescriptor {
    Comma,
    InnerJoin { predicate: JoinPredicate },
    LeftJoin { predicate: JoinPredicate },
    RightJoin { predicate: JoinPredicate },
    FullJoin { predicate: JoinPredicate },
    CrossJoin,
}

/// `ON <expression>` or `USING (col, col, …)`. Every JOIN variant other
/// than `CrossJoin` and `Comma` carries a predicate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum JoinPredicate {
    On { expression: SelectExpr },
    Using { columns: Vec<String> },
}

/// A column reference — `column` (unqualified) or `table.column`
/// (qualified). `table` carries the alias / table identifier the user
/// wrote; resolution (mapping aliases to real tables) is downstream. The
/// parser only records what the input wrote.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColumnRef {
    pub table: Option<String>,
    pub column: String,
}

/// One ORDER BY item — column, direction (defaults to `Asc` when omitted),
/// and nulls placement. The `Unspecified` variant of `nulls` is distinct
/// from `First`/`Last`: downstream tooling must read it directly rather
/// than defaulting to one of the explicit forms (contract §AST additions).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderingItem {
    pub column: ColumnRef,
    pub direction: OrderDirection,
    pub nulls: NullsPlacement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NullsPlacement {
    First,
    Last,
    Unspecified,
}

/// `LIMIT <count> [OFFSET <offset>]`, also used for MySQL-family
/// `LIMIT <offset>, <count>`. Both slots accept the same literal-or-
/// placeholder shape as the existing `InsertValue`. The `offset` slot is
/// `None` when the user did not write an offset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitClause {
    pub count: InsertValue,
    pub offset: Option<InsertValue>,
}

/// Widened expression — used by SELECT's `WHERE`, by `HAVING`, by any JOIN
/// `ON` predicate, and by the DML (`UPDATE` / `DELETE`) WHERE. It replaced
/// the narrower `WhereExpr`, which is still exported but no longer held by
/// any statement.
///
/// The variant set adds three new primaries over the narrow form:
/// - `Comparison` — column-op-literal/placeholder (existing semantics
///   widened so the left side records a `ColumnRef` instead of a bare
///   `String`; qualified columns `x.a > 10` are now first-class).
/// - `ColumnComparison` — column-op-column (cross-table or same-table).
/// - `Between` — `col BETWEEN low AND high`.
/// - `Like` — `col LIKE 'pattern'` / `col ILIKE 'pattern'`. The negated
///   forms (`NOT LIKE`, `NOT BETWEEN`) are not separate variants — they
///   are wrapped in `Not { inner: ... }` so callers can switch on `kind`
///   without enumerating "negative twins".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SelectExpr {
    Comparison {
        left: ColumnRef,
        op: CompareOp,
        value: InsertValue,
    },
    ColumnComparison {
        left: ColumnRef,
        op: CompareOp,
        right: ColumnRef,
    },
    /// Bounded PostgreSQL symbolic operators from extension
    /// surfaces (`pg_trgm` `%`, PostGIS `&&`, pgvector operators, JSON
    /// operators). The parser preserves the operator text but does not
    /// semantically validate installed extensions or precedence.
    ExtensionOperatorComparison {
        left: ColumnRef,
        operator: String,
        right: ExtensionOperatorOperand,
    },
    /// `col op (SELECT ...)` — column-vs-scalar-subquery
    /// comparison. The right-hand side is a parenthesized SELECT used as
    /// a scalar.
    ScalarSubqueryComparison {
        left: ColumnRef,
        op: CompareOp,
        right: Box<SelectStatement>,
    },
    Between {
        column: ColumnRef,
        low: InsertValue,
        high: InsertValue,
    },
    Like {
        column: ColumnRef,
        case_sensitivity: LikeCase,
        pattern: InsertValue,
    },
    And {
        left: Box<SelectExpr>,
        right: Box<SelectExpr>,
    },
    Or {
        left: Box<SelectExpr>,
        right: Box<SelectExpr>,
    },
    Not {
        inner: Box<SelectExpr>,
    },
    IsNull {
        column: ColumnRef,
    },
    IsNotNull {
        column: ColumnRef,
    },
    /// `column IN (literal, literal, ...)`. The negated
    /// `NOT IN` form wraps this primary in `Not`.
    InList {
        column: ColumnRef,
        values: Vec<InsertValue>,
    },
    /// `column IN (SELECT ...)`. Distinct AST variant from
    /// `InList` so downstream tooling can branch on intent (subquery
    /// IN-membership vs. literal IN-list); the parser routes by lookahead
    /// on the first token inside the parentheses.
    InSubquery {
        column: ColumnRef,
        statement: Box<SelectStatement>,
    },
    /// `EXISTS (SELECT ...)`. The negated `NOT EXISTS` form
    /// wraps this primary in `Not`.
    Exists {
        statement: Box<SelectStatement>,
    },
    /// `(SELECT ...)` used as a scalar value in a SELECT
    /// list / comparison RHS. The variant carries the nested SELECT body
    /// only — column count / row count are runtime-checked, not at parse.
    ScalarSubquery {
        statement: Box<SelectStatement>,
    },
    /// `func(args)` in SELECT-list and simple predicate
    /// expression positions without `OVER`.
    FunctionCall {
        name: String,
        arguments: Vec<WindowArgument>,
    },
    /// `func(args) OVER (...)`. The arg list, partition-by,
    /// order-by, and frame are populated per the OVER clause body.
    WindowFunction {
        name: String,
        arguments: Vec<WindowArgument>,
        over: OverClause,
    },
    /// `CASE [operand] WHEN cond THEN result ... [ELSE
    /// fallback] END`. The simple-CASE form populates `operand`; the
    /// searched-CASE form leaves it null.
    Case {
        operand: Option<Box<SelectExpr>>,
        when_clauses: Vec<CaseWhen>,
        else_clause: Option<Box<SelectExpr>>,
    },
    /// Bare literal expression. The earlier expression
    /// grammar required every primary to start with a column reference,
    /// which makes `CASE WHEN x.a > 0 THEN 'pos' ELSE 'neg' END`
    /// un-parseable (the THEN/ELSE result is a literal). This variant
    /// carries a bare literal-or-placeholder so result expressions can
    /// be represented uniformly.
    Literal {
        value: InsertValue,
    },
    /// Bare column-reference expression (the value of a
    /// column). Used when a column reference appears in operand /
    /// THEN-result / ELSE-result positions of a CASE expression without
    /// a following comparator.
    ColumnRefExpr {
        column: ColumnRef,
    },
    /// `<expression> <op> <literal>`. Used for the rare
    /// case where the left-hand side of a comparator is not a bare
    /// column reference — e.g. `CASE WHEN ... END = 1`. The existing
    /// `Comparison` variant is preserved for the common column-op-value
    /// shape (downstream tooling indexes by `kind`).
    ExpressionComparison {
        left: Box<SelectExpr>,
        op: CompareOp,
        value: InsertValue,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ExtensionOperatorOperand {
    Value { value: InsertValue },
    Column { column: ColumnRef },
}

/// One argument to a window function. The `Star` variant is
/// a dedicated AST shape for `COUNT(*)`; the spec forbids encoding `*` as
/// a column reference with literal column-name `"*"` (downstream tooling
/// treats column-ref values as identifiers).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WindowArgument {
    Star,
    ColumnRef { reference: ColumnRef },
    Literal { value: SqlLiteral },
    Placeholder { name: String },
}

/// `OVER (...)` body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OverClause {
    pub partition_by: Vec<ColumnRef>,
    pub order_by: Vec<OrderingItem>,
    pub frame: Option<WindowFrame>,
}

/// `ROWS|RANGE <start> [BETWEEN <start> AND <end>]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowFrame {
    pub unit: FrameUnit,
    pub start: FrameBound,
    pub end: Option<FrameBound>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameUnit {
    Rows,
    Range,
}

/// One frame bound (`UNBOUNDED PRECEDING` / `N PRECEDING`
/// / `CURRENT ROW` / `N FOLLOWING` / `UNBOUNDED FOLLOWING`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FrameBound {
    UnboundedPreceding,
    UnboundedFollowing,
    CurrentRow,
    Preceding { offset: i64 },
    Following { offset: i64 },
}

/// One `WHEN ... THEN ...` arm of a `CASE` expression.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CaseWhen {
    pub condition: SelectExpr,
    pub result: SelectExpr,
}

/// `LIKE` (case-sensitive) vs `ILIKE` (PostgreSQL case-insensitive). The
/// negated forms are encoded via `SelectExpr::Not` wrapping a `Like`
/// primary — see `SelectExpr` doc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LikeCase {
    Sensitive,
    Insensitive,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Columns {
    /// `SELECT *`
    Star,
    /// `SELECT a, b, c`
    Named { names: Vec<String> },
    /// At least one expression item that is not a bare
    /// column identifier (CASE, window function, scalar subquery, …).
    /// The list preserves input order. Bare-identifier and `*` items
    /// passed through this variant get wrapped accordingly so callers
    /// that only switch on `Columns::Star` / `Columns::Named` continue
    /// to work for those inputs unchanged.
    Expressions { items: Vec<SelectListItem> },
}

/// One item in a SELECT list when at least one item is a
/// non-bare-column expression. The discriminator uses kebab-case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SelectListItem {
    /// `*` inside an `Expressions` list — preserved verbatim so a mix
    /// of `*` and expressions stays serializable.
    Star,
    /// Bare or qualified identifier, with an optional output alias.
    /// `alias` carries the `AS <ident>` / bare-ident alias the user wrote
    /// (`SELECT id AS user_id` → `alias: Some("user_id")`); `None` when the
    /// column is projected under its own name. Downstream editability gating
    /// (issue #1297) uses it to map a result column back to its source
    /// column so an aliased primary key stays editable.
    Column {
        reference: ColumnRef,
        alias: Option<String>,
    },
    /// A widened expression — CASE / window-function / scalar-subquery
    /// / IN-list etc. The expression uses the same `SelectExpr` grammar
    /// as WHERE / HAVING / JOIN ON.
    Expression { expression: SelectExpr },
}

// The narrow `WhereClause` / `BinaryOp` / `Literal` types are
// gone — `SelectStatement` now holds the widened
// `SelectExpr` (with `InsertValue`-shaped values + `ColumnRef`-shaped
// columns). The shape change is intentional: SELECT WHERE is no longer
// a single column-op-literal predicate, so a dedicated narrow type would
// fight the JOIN / GROUP / HAVING / ORDER widening introduced here.
// DML WHERE is unified onto the same `SelectExpr`; the narrow `WhereExpr`
// below is still exported but no statement in this AST holds it.

/// Field names are serialized as-is (snake_case) so the TS facade can
/// `result.error_kind` directly — matches the discriminator name used
/// across the codebase (`mongoshAst.ts`'s `errorKind` is camelCase but
/// new code is moving to snake_case in IPC payloads; this crate picks
/// snake to align with the Rust source of truth).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParseError {
    pub error_kind: ParseErrorKind,
    pub message: String,
    /// Best-effort 0-based byte offset into the original input where the
    /// error was detected. `None` for non-positional errors like
    /// "empty input".
    pub at: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ParseErrorKind {
    /// Lexer-level failure (unterminated string, unknown char, etc.).
    LexError,
    /// Statement begins with a keyword we recognize but do not support
    /// (INSERT / UPDATE / DELETE / ALTER ADD / …).
    UnsupportedStatement,
    /// Parser-level failure — wrong token order, missing required clause,
    /// etc. The bulk of `ParseError` variants.
    SyntaxError,
    /// `parse_sql("")` or whitespace-only input.
    EmptyInput,
    /// WHERE / SET expression uses a construct outside the
    /// narrow expression slice (subquery / function call /
    /// arithmetic / IN-list / cross-table comparison / …). The verb-level
    /// statement structure was recognized; only the inner expression is
    /// unsupported. Caller may fall back to regex heuristics.
    UnsupportedExpression,
}

// ---- DDL destructive AST nodes ----------------------------

/// `DROP <object-type> [IF EXISTS] <name> [CASCADE|RESTRICT]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DropStatement {
    pub object_type: DropObjectType,
    pub name: String,
    pub if_exists: bool,
    pub cascade: Option<CascadeBehavior>,
}

/// Object kinds this parser covers. `Trigger` / `Function` / `Procedure` /
/// `Role` are deliberately out of scope — the sqlSafety regex fallback
/// continues to classify those as `ddl-drop`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DropObjectType {
    Table,
    Database,
    Index,
    View,
    Schema,
    Sequence,
    Type,
}

/// `CASCADE` and `RESTRICT` are mutually exclusive; the parser surfaces a
/// `SyntaxError` if both appear. `None` means the option was omitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CascadeBehavior {
    Cascade,
    Restrict,
}

/// `TRUNCATE [TABLE] <name> [RESTART|CONTINUE IDENTITY] [CASCADE|RESTRICT]`.
///
/// `restart_identity`:
/// - `None`     — unspecified (default behavior is dialect-specific).
/// - `Some(true)`  — `RESTART IDENTITY`.
/// - `Some(false)` — `CONTINUE IDENTITY`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TruncateStatement {
    pub table: String,
    pub restart_identity: Option<bool>,
    pub cascade: Option<CascadeBehavior>,
}

/// `ALTER TABLE <name> <action>`. Only `DROP …` actions are covered here;
/// `ADD COLUMN` / `RENAME` etc. surface as `UnsupportedStatement`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlterTableStatement {
    pub table: String,
    pub action: AlterAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AlterAction {
    /// `DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]`.
    DropColumn {
        column: String,
        if_exists: bool,
        cascade: Option<CascadeBehavior>,
    },
    /// `DROP CONSTRAINT <name> [CASCADE|RESTRICT]`. PostgreSQL allows
    /// `IF EXISTS` on DROP CONSTRAINT in newer versions; this parser keeps
    /// it strict and rejects `IF EXISTS` here.
    DropConstraint {
        constraint: String,
        cascade: Option<CascadeBehavior>,
    },
    /// `DROP INDEX <name>` — MySQL-style syntax. PostgreSQL emits this as
    /// a top-level `DROP INDEX` statement instead.
    DropIndex { index: String },
    /// `ADD COLUMN [IF NOT EXISTS] <col-def>`. The
    /// column-def shape (name + data type + constraints) is reused from
    /// CREATE TABLE so downstream tooling that walks column metadata can
    /// share traversal code.
    AddColumn {
        column: ColumnDefinition,
        if_not_exists: bool,
    },
    /// `ADD [CONSTRAINT <name>] <table-constraint>`. The
    /// constraint shape (kebab-case `kind` discriminator + payload) is
    /// the same one used inside CREATE TABLE's table-constraint list.
    AddConstraint { constraint: TableConstraint },
    /// `RENAME TO <new-name>`. Bare identifier; schema-
    /// qualified rename targets (e.g. cross-schema move) are out of
    /// scope.
    RenameTable { new_name: String },
    /// `RENAME COLUMN <old> TO <new>`.
    RenameColumn { old_name: String, new_name: String },
}

// ---- DDL additive AST nodes -------------------------------

/// Schema-qualified table / view / index reference. Mirrors
/// the FROM-item shape (`schema: Option<String>` +
/// `table: String`) so downstream tooling can share traversal helpers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableRef {
    pub schema: Option<String>,
    pub table: String,
}

/// `CREATE TABLE [IF NOT EXISTS] <name> ( <cols + table-
/// constraints> )`. The definition list is split into two ordered slots:
/// `columns` (column definitions) and `table_constraints` (top-level
/// table constraints introduced by `CONSTRAINT name …` or by a bare
/// `PRIMARY KEY (...)` / `UNIQUE (...)` / `CHECK (...)` / `FOREIGN KEY
/// (...) REFERENCES …`). Empty `columns` is rejected at parse time
/// (`AC-394-T20`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateTableStatement {
    pub table: TableRef,
    pub if_not_exists: bool,
    pub columns: Vec<ColumnDefinition>,
    pub table_constraints: Vec<TableConstraint>,
}

/// One column in a CREATE TABLE / ALTER TABLE ADD COLUMN
/// definition list. `source_index` records the zero-based ordinal of
/// this column in the source list — downstream tooling that maps AST
/// back to source position relies on it (the slot is set by the parser,
/// not by the user).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: ColumnType,
    pub constraints: Vec<ColumnConstraint>,
    pub source_index: usize,
}

/// Column-type discriminated union. The `kind` tag is the
/// kebab-case lowercase form of the type name (`integer`, `bigint`,
/// `text`, …). Vendor-specific synonyms (`INT4`, `STRING`, `LONGTEXT`)
/// are NOT lexed as type tokens — they parse as identifiers, and the
/// parser surfaces a `SyntaxError`.
///
/// Oracle scalar DDL variants are parser/Safe Mode evidence only; they do
/// not imply Oracle runtime DDL support.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ColumnType {
    Integer,
    Bigint,
    Text,
    Date,
    Boolean,
    Serial,
    Uuid,
    /// `VARCHAR(<length>)`. The length argument is required by the
    /// DDL grammar; bare `VARCHAR` parses to `SyntaxError`.
    Varchar {
        length: i64,
    },
    /// `TIMESTAMP [WITH TIME ZONE]`. The `with_time_zone` flag defaults
    /// to false when the user wrote bare `TIMESTAMP`.
    Timestamp {
        with_time_zone: bool,
    },
    /// `NUMERIC[(precision[, scale])]`. Both slots are `None` when the
    /// user wrote bare `NUMERIC`; `precision` is set and `scale` is
    /// `None` when only one argument is supplied.
    Numeric {
        precision: Option<i64>,
        scale: Option<i64>,
    },
    /// Oracle `NUMBER[(precision[, scale])]`.
    Number {
        precision: Option<i64>,
        scale: Option<i64>,
    },
    /// Oracle `VARCHAR2(<length>)`.
    Varchar2 {
        length: i64,
    },
    /// Oracle large text object.
    Clob,
    /// Oracle binary large object.
    Blob,
    /// Known PostgreSQL extension-backed type names. The
    /// parser stores the written name and simple modifiers but does not
    /// validate that the backing extension is installed.
    Extension {
        name: String,
        modifiers: Vec<ExtensionTypeModifier>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ExtensionTypeModifier {
    Identifier { value: String },
    Integer { value: i64 },
    Float { value: f64 },
    String { value: String },
}

/// Column-level constraint. The optional `name` slot is set
/// when the user wrote `CONSTRAINT <name> <constraint-body>` inline; it
/// is `None` for bare constraints. The `kind` discriminator narrows to
/// the constraint variant; the payload (if any) lives on the variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColumnConstraint {
    pub name: Option<String>,
    pub body: ColumnConstraintBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ColumnConstraintBody {
    PrimaryKey,
    NotNull,
    Default {
        value: InsertValue,
    },
    Unique,
    /// Inline `REFERENCES <other> [(<other-col>)]`. The optional column
    /// slot is `None` when the user wrote bare `REFERENCES other`.
    References {
        table: TableRef,
        column: Option<String>,
    },
    /// `CHECK ( <expression> )` — the expression uses the unified
    /// `SelectExpr` shape so any WHERE-
    /// shaped predicate is admissible inside CHECK.
    Check {
        expression: SelectExpr,
    },
}

/// Table-level constraint. Same `name` / `body` shape as
/// `ColumnConstraint`; the body variants carry a `columns` slot for
/// `primary-key` / `unique` / `references` (the constraint applies to a
/// named list of columns), and a bare `expression` slot for `check`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableConstraint {
    pub name: Option<String>,
    pub body: TableConstraintBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TableConstraintBody {
    PrimaryKey {
        columns: Vec<String>,
    },
    Unique {
        columns: Vec<String>,
    },
    /// `FOREIGN KEY (<local-cols>) REFERENCES <other-table> [(<other-cols>)]`.
    /// The `target_columns` slot is empty when the user wrote bare
    /// `REFERENCES other` (no parenthesized target column list).
    References {
        columns: Vec<String>,
        target_table: TableRef,
        target_columns: Vec<String>,
    },
    Check {
        expression: SelectExpr,
    },
}

/// `CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table
/// (col1, col2, …)`. The column list is identifier-only — functional /
/// expression indexes are deferred.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateIndexStatement {
    pub unique: bool,
    pub if_not_exists: bool,
    pub name: String,
    pub table: TableRef,
    pub columns: Vec<String>,
}

/// `CREATE [OR REPLACE] VIEW <name> AS <select-stmt>`. The
/// body may be a plain SELECT (with optional set-operation chain) or a
/// CTE-wrapped SELECT (`WITH t AS (...) SELECT ...`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateViewStatement {
    pub or_replace: bool,
    pub name: TableRef,
    pub body: CreateViewBody,
}

/// The two body shapes accepted inside a CREATE VIEW. The
/// discriminator uses the same kebab-case `kind` tag scheme as
/// `WithInner` so consumers can branch uniformly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(clippy::large_enum_variant)]
pub enum CreateViewBody {
    Select(SelectStatement),
    With(WithStatement),
}

// ---- DML write triad AST nodes ----------------------------

/// `INSERT INTO <table> [(cols)] (VALUES (...) | DEFAULT VALUES | SELECT …)
///   [ON CONFLICT …] [ON DUPLICATE KEY UPDATE …] [RETURNING …]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InsertStatement {
    pub table: String,
    /// Empty when columns were not specified (`INSERT INTO t VALUES (1)`
    /// or `DEFAULT VALUES`).
    pub columns: Vec<String>,
    pub source: InsertSource,
    pub on_conflict: Option<OnConflict>,
    #[serde(default)]
    pub on_duplicate_key_update: Option<OnDuplicateKeyUpdate>,
    /// Empty when `RETURNING` is absent.
    pub returning: Vec<String>,
}

/// Where the inserted row payload comes from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InsertSource {
    /// `VALUES (...)[, (...)]` — at least one row, each row at least one value.
    Values { rows: Vec<Vec<InsertValue>> },
    /// `DEFAULT VALUES` — PG short-hand for "all defaults".
    DefaultValues,
    /// `INSERT … SELECT …` — the narrow SELECT grammar is the
    /// source. Boxed to keep `InsertSource` small (recursive variant).
    Select { statement: Box<SelectStatement> },
}

/// A single value cell inside `VALUES (...)` or an `UpdateAssignment`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InsertValue {
    Literal {
        value: SqlLiteral,
    },
    /// `DEFAULT` keyword — server fills the column default.
    Default,
    /// `$1` / `?` / `:name` — prepared-statement placeholder. `name` is
    /// the raw identifier without prefix (`"1"`, `""`, `"name"`).
    Placeholder {
        name: String,
    },
}

/// MySQL/MariaDB `CALL` argument. This deliberately stays separate from
/// `InsertValue` so user variables do not become valid DML values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CallArgument {
    Literal {
        value: SqlLiteral,
    },
    Default,
    Placeholder {
        name: String,
    },
    /// `@name` — user variable reference used by MySQL-family routines.
    UserVariable {
        name: String,
    },
}

impl From<InsertValue> for CallArgument {
    fn from(value: InsertValue) -> Self {
        match value {
            InsertValue::Literal { value } => CallArgument::Literal { value },
            InsertValue::Default => CallArgument::Default,
            InsertValue::Placeholder { name } => CallArgument::Placeholder { name },
        }
    }
}

/// Schema-qualified or bare stored procedure reference for MySQL/MariaDB
/// `CALL`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcedureRef {
    pub schema: Option<String>,
    pub name: String,
}

/// `CALL <procedure>(<literal/default/placeholder/user-variable>, ...)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallStatement {
    pub procedure: ProcedureRef,
    pub arguments: Vec<CallArgument>,
}

/// Widened literal set (the original `Literal` covered only
/// `Integer` / `String`; we now also need `Float` / `Boolean` / `Null` so
/// VALUES can hold every JSON-shaped column type a user would write).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SqlLiteral {
    Integer {
        value: i64,
    },
    /// f64 because IEEE-754 is what postgres `numeric`/`double precision`
    /// values are coerced to over the JSON bridge anyway.
    Float {
        value: f64,
    },
    String {
        value: String,
    },
    Boolean {
        value: bool,
    },
    Null,
}

/// `ON CONFLICT { DO NOTHING | DO UPDATE SET … [WHERE …] }` — PG-only
/// UPSERT semantic.
///
/// The `where_clause` slot now uses the unified `SelectExpr`
/// shape (with IN-list / IN-subquery / EXISTS / CASE support) so the DML
/// WHERE matches the SELECT WHERE widening.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OnConflict {
    DoNothing,
    DoUpdate {
        set: Vec<UpdateAssignment>,
        where_clause: Option<SelectExpr>,
    },
}

/// MySQL/MariaDB `ON DUPLICATE KEY UPDATE <col> = <value>[, …]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OnDuplicateKeyUpdate {
    pub assignments: Vec<OnDuplicateKeyUpdateAssignment>,
}

/// `<column> = <value>` inside `ON DUPLICATE KEY UPDATE`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OnDuplicateKeyUpdateAssignment {
    pub column: String,
    pub value: OnDuplicateKeyUpdateValue,
}

/// RHS values accepted in MySQL/MariaDB `ON DUPLICATE KEY UPDATE`.
///
/// Literal/default/placeholder variants intentionally keep the same wire
/// shape as `InsertValue`; `values-column` records MySQL's `VALUES(col)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OnDuplicateKeyUpdateValue {
    Literal { value: SqlLiteral },
    Default,
    Placeholder { name: String },
    ValuesColumn { column: String },
}

impl From<InsertValue> for OnDuplicateKeyUpdateValue {
    fn from(value: InsertValue) -> Self {
        match value {
            InsertValue::Literal { value } => OnDuplicateKeyUpdateValue::Literal { value },
            InsertValue::Default => OnDuplicateKeyUpdateValue::Default,
            InsertValue::Placeholder { name } => OnDuplicateKeyUpdateValue::Placeholder { name },
        }
    }
}

/// `UPDATE <table> SET <col> = <value>[, …] [FROM …] [WHERE …] [RETURNING …]`.
///
/// `where_clause` migrates to the unified `SelectExpr`
/// shape (was `WhereExpr`). DML WHERE now accepts every
/// expression form that SELECT WHERE accepts (BETWEEN / LIKE / IN-list /
/// IN-subquery / EXISTS / CASE / window functions); the previous
/// `UnsupportedExpression` deferrals (e.g. AC-392-D06 IN-list) are lifted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateStatement {
    pub table: String,
    pub assignments: Vec<UpdateAssignment>,
    /// PG `UPDATE … FROM other_table` joins. Empty when absent.
    pub from: Vec<String>,
    pub where_clause: Option<SelectExpr>,
    pub returning: Vec<String>,
}

/// `<column> = <value>` — used by `UPDATE SET …` and `ON CONFLICT DO
/// UPDATE SET …`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateAssignment {
    pub column: String,
    pub value: InsertValue,
}

/// `DELETE FROM <table> [USING …] [WHERE …] [RETURNING …]`.
///
/// `where_clause` migrates to the unified `SelectExpr`
/// shape (was `WhereExpr`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeleteStatement {
    pub table: String,
    /// PG `DELETE … USING other_table`. Empty when absent.
    pub using: Vec<String>,
    pub where_clause: Option<SelectExpr>,
    pub returning: Vec<String>,
}

/// Table-source PostgreSQL MERGE. The target and
/// source are table references with optional aliases; source subqueries,
/// `WHEN ... AND`, `DELETE`, `BY SOURCE`, and RETURNING stay out of scope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeStatement {
    pub target: TableRef,
    pub target_alias: Option<String>,
    pub source: TableRef,
    pub source_alias: Option<String>,
    pub on: SelectExpr,
    pub clauses: Vec<MergeWhenClause>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MergeWhenClause {
    pub not_matched: bool,
    pub action: String,
    pub assignments: Vec<(String, SelectExpr)>,
    pub columns: Vec<String>,
    pub values: Vec<SelectExpr>,
}

/// Narrow WHERE expression. The grammar accepts:
///   - `column <op> <literal-or-placeholder>` — `Comparison`
///   - `<expr> AND <expr>` / `<expr> OR <expr>` — boolean
///   - `NOT <expr>` — unary
///   - `column IS NULL` / `column IS NOT NULL` — null tests
///
/// Anything richer (function calls, sub-queries, arithmetic, `IN (...)`,
/// `LIKE`, `BETWEEN`, cross-table comparison `a.x = b.y`) surfaces as
/// `Error(UnsupportedExpression)` from the parser — caller can fall back
/// to a regex heuristic for safety classification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WhereExpr {
    Comparison {
        column: String,
        op: CompareOp,
        value: InsertValue,
    },
    And {
        left: Box<WhereExpr>,
        right: Box<WhereExpr>,
    },
    Or {
        left: Box<WhereExpr>,
        right: Box<WhereExpr>,
    },
    Not {
        inner: Box<WhereExpr>,
    },
    IsNull {
        column: String,
    },
    IsNotNull {
        column: String,
    },
}

/// Narrow comparison operators (matches `BinaryOp` of
/// the original WhereClause but lives separately so the widened WHERE
/// grammar can extend `WhereExpr` without disturbing `WhereClause`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompareOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

// ---- misc AST nodes ---------------------------------------

/// `GRANT priv ON object TO role [WITH GRANT OPTION]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrantStatement {
    pub privileges: Vec<PrivilegeTag>,
    pub object: GrantObject,
    pub grantees: Vec<RoleRef>,
    pub with_grant_option: bool,
}

/// `REVOKE [GRANT OPTION FOR] priv ON object FROM role
/// [CASCADE|RESTRICT]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RevokeStatement {
    pub privileges: Vec<PrivilegeTag>,
    pub object: GrantObject,
    pub revokees: Vec<RoleRef>,
    pub grant_option_for: bool,
    pub cascade: Option<CascadeBehavior>,
}

/// One privilege tag in a GRANT/REVOKE statement. The `kind`
/// discriminator (`all`, `select`, `insert`, `update`, `delete`, …) is the
/// kebab-case form of the SQL keyword. `UPDATE` / `SELECT` / `REFERENCES`
/// can carry a column-list qualifier (`columns` slot, empty for non-column
/// invocations).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PrivilegeTag {
    All,
    Select { columns: Vec<String> },
    Insert,
    Update { columns: Vec<String> },
    Delete,
    Truncate,
    References { columns: Vec<String> },
    Trigger,
    Usage,
    Execute,
}

/// GRANT/REVOKE object. The `kind` tag narrows to the object
/// kind keyword that followed `ON`. `all-in-schema` represents the PG
/// `ALL TABLES IN SCHEMA name` shorthand.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GrantObject {
    Table { tables: Vec<TableRef> },
    Schema { schemas: Vec<String> },
    Database { databases: Vec<String> },
    Sequence { sequences: Vec<String> },
    Function { functions: Vec<String> },
    AllInSchema { schema_name: String },
}

/// Grantee / revokee reference. Plain identifier roles get
/// `kind="role"`. The `PUBLIC` pseudo-role gets `kind="public"`. Both
/// `CURRENT_USER` and `SESSION_USER` normalize to `kind="current-session"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RoleRef {
    Role { name: String },
    Public,
    CurrentSession,
}

/// `EXPLAIN [ANALYZE] [VERBOSE] [(option …)] inner-stmt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplainStatement {
    pub analyze: bool,
    pub verbose: bool,
    pub options: Vec<ExplainOption>,
    pub inner_statement: Box<ExplainInner>,
}

/// One option pair inside `EXPLAIN (name value, …)` or
/// `COPY … WITH (name value, …)`. The `name` slot is normalized to
/// lowercase by the parser. The `value` slot uses the
/// `InsertValue` shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplainOption {
    pub name: String,
    pub value: InsertValue,
}

/// The statement variants accepted as the inner body of an
/// EXPLAIN. Mirrors the `WithInner` shape but additionally permits the
/// other DML/DDL kinds that EXPLAIN can wrap on the supported backends.
/// The dispatcher rejects nested EXPLAIN and out-of-scope inner kinds at
/// parse time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(clippy::large_enum_variant)]
pub enum ExplainInner {
    Select(SelectStatement),
    Insert(InsertStatement),
    Update(UpdateStatement),
    Delete(DeleteStatement),
    Merge(MergeStatement),
    With(WithStatement),
}

/// `SHOW <target>`. The `target` discriminator narrows to the
/// SHOW variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShowStatement {
    pub target: ShowTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ShowTarget {
    Variable { name: String },
    Tables { schema: Option<String> },
    Databases,
    Schemas,
}

/// `SET [SESSION|LOCAL] <name> {TO|=} <value>`. The `scope`
/// slot defaults to `default` when neither `SESSION` nor `LOCAL` was
/// specified.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetStatement {
    pub scope: SetScope,
    pub name: String,
    pub value: SetValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetScope {
    Session,
    Local,
    Default,
}

/// SET RHS. Distinct from `InsertValue` so bare-identifier
/// SET targets (`SET search_path = public`) do not pollute the
/// placeholder surface used by DML / SELECT.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SetValue {
    Literal { value: SqlLiteral },
    Default,
    Identifier { name: String },
}

/// `COPY { table | (SELECT …) } [(cols)] FROM/TO source
/// [WITH (options)]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CopyStatement {
    pub direction: CopyDirection,
    pub target: CopyTarget,
    pub source: CopySource,
    pub options: Vec<ExplainOption>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CopyDirection {
    From,
    To,
}

/// COPY target. Either a (schema-qualified) table with an
/// optional column list, or a parenthesized SELECT.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CopyTarget {
    Table {
        table: TableRef,
        columns: Vec<String>,
    },
    Select {
        statement: Box<SelectStatement>,
    },
}

/// COPY source. STDIN is only valid with `FROM`; STDOUT is
/// only valid with `TO` (the parser enforces).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CopySource {
    File { path: String },
    Stdin,
    Stdout,
}

/// `COMMENT ON <object-kind> <ident> IS <string-or-NULL>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommentStatement {
    pub target: CommentTarget,
    pub text: CommentText,
}

/// COMMENT object target. Each variant carries the relevant
/// identifier slots — `column` carries `table` + `column`, `constraint`
/// carries `table` + `constraint`, the rest carry a single `name` slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommentTarget {
    Table { name: String },
    Column { table: String, column: String },
    View { name: String },
    Index { name: String },
    Schema { name: String },
    Sequence { name: String },
    Database { name: String },
    Constraint { table: String, constraint: String },
}

/// COMMENT text payload. The `null` variant captures the
/// literal `IS NULL` form (clearing the comment); the `string` variant
/// carries the string literal payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommentText {
    String { value: String },
    Null,
}
