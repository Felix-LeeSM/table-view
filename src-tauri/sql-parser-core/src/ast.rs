//! AST types for the sprint-385 / sprint-391 grammar slices.
//!
//! Grammar (sprint-385):
//!   `SELECT <columns> FROM <table> [WHERE <ident> <op> <literal>]`
//!
//! Grammar (sprint-391 — DDL destructive):
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
pub enum ParseResult {
    /// A successfully parsed SELECT statement (sprint-385 grammar slice).
    Select(SelectStatement),
    /// `DROP <object-type> …` (sprint-391).
    Drop(DropStatement),
    /// `TRUNCATE [TABLE] …` (sprint-391).
    Truncate(TruncateStatement),
    /// `ALTER TABLE <name> <action>` (sprint-391 — DROP-only actions for
    /// now; ALTER ADD / RENAME are sprint-394).
    AlterTable(AlterTableStatement),
    /// `INSERT INTO <table> …` (sprint-392).
    Insert(InsertStatement),
    /// `UPDATE <table> SET …` (sprint-392).
    Update(UpdateStatement),
    /// `DELETE FROM <table> …` (sprint-392).
    Delete(DeleteStatement),
    /// A parse / lex error. `kind` discriminator is one of:
    /// `"lex-error"`, `"unsupported-statement"`, `"syntax-error"`,
    /// `"empty-input"`, `"unsupported-expression"` — see `ParseErrorKind`.
    Error(ParseError),
}

/// Sprint-385 narrow SELECT had `table: String` + `where: Option<WhereClause>`.
/// Sprint-393a widens the shape to support multi-table FROM, JOIN, the
/// widened WHERE expression (column-column / BETWEEN / LIKE / ILIKE),
/// GROUP BY, HAVING, ORDER BY, and LIMIT/OFFSET. The top-level `kind`
/// discriminator stays `"select"` so existing callers that only branch on
/// `kind` need no change. New fields are additive: sprint-385 inputs
/// continue to parse — their FROM is a single-item list, their other new
/// slots are absent / empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectStatement {
    pub columns: Columns,
    /// Ordered list of FROM items. Length ≥ 1 for any successfully-parsed
    /// SELECT (a `FROM` clause is required by the sprint-393a grammar —
    /// `SELECT 1` with no FROM is still out of scope).
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
}

/// A single item in the FROM list. The `join` descriptor specifies how
/// this item attaches to the previous item — `Comma` for the first item
/// (and for any later comma-separated item), or one of the JOIN variants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FromItem {
    /// Schema qualifier for `schema.table` references — `None` for a bare
    /// table name.
    pub schema: Option<String>,
    pub table: String,
    /// `AS alias` or bare identifier alias. `None` when omitted.
    pub alias: Option<String>,
    pub join: JoinDescriptor,
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

/// `LIMIT <count> [OFFSET <offset>]`. Both slots accept the same
/// literal-or-placeholder shape as the existing `InsertValue`. The
/// `offset` slot is `None` when the user did not write `OFFSET`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitClause {
    pub count: InsertValue,
    pub offset: Option<InsertValue>,
}

/// Sprint-393a widened expression — used by SELECT's `WHERE`, by `HAVING`,
/// and by any JOIN `ON` predicate. The DML (`UPDATE` / `DELETE`) WHERE
/// continues to use the narrower `WhereExpr` (sprint-392). 393b unifies
/// the two.
///
/// The variant set adds three new primaries over sprint-392:
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
}

// Sprint-385's narrow `WhereClause` / `BinaryOp` / `Literal` types are
// gone in sprint-393a — `SelectStatement` now holds the widened
// `SelectExpr` (with `InsertValue`-shaped values + `ColumnRef`-shaped
// columns). The shape change is intentional: SELECT WHERE is no longer
// a single column-op-literal predicate, so a dedicated narrow type would
// fight the JOIN / GROUP / HAVING / ORDER widening that this sprint
// introduces. DML's narrow WHERE (`WhereExpr`) continues to use
// sprint-392's column-op-`InsertValue` shape until sprint-393b unifies it.

/// Field names are serialized as-is (snake_case) so the TS facade can
/// `result.error_kind` directly — matches the discriminator name used
/// across the codebase (`mongoshAst.ts`'s `errorKind` is camelCase but
/// new code is moving to snake_case in IPC payloads; sprint-385 picks
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
    /// in this sprint (INSERT / UPDATE / DELETE / ALTER ADD / …).
    UnsupportedStatement,
    /// Parser-level failure — wrong token order, missing required clause,
    /// etc. The bulk of `ParseError` variants.
    SyntaxError,
    /// `parse_sql("")` or whitespace-only input.
    EmptyInput,
    /// Sprint-392 — WHERE / SET expression uses a construct outside the
    /// sprint-392 narrow expression slice (subquery / function call /
    /// arithmetic / IN-list / cross-table comparison / …). The verb-level
    /// statement structure was recognized; only the inner expression is
    /// unsupported. Caller may fall back to regex heuristics.
    UnsupportedExpression,
}

// ---- sprint-391 DDL destructive AST nodes ----------------------------

/// `DROP <object-type> [IF EXISTS] <name> [CASCADE|RESTRICT]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DropStatement {
    pub object_type: DropObjectType,
    pub name: String,
    pub if_exists: bool,
    pub cascade: Option<CascadeBehavior>,
}

/// Object kinds this sprint covers. `Trigger` / `Function` / `Procedure` /
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

/// `ALTER TABLE <name> <action>`. Sprint-391 only covers `DROP …` actions;
/// `ADD COLUMN` / `RENAME` etc. surface as `UnsupportedStatement` until
/// sprint-394 widens the grammar.
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
    /// `IF EXISTS` on DROP CONSTRAINT in newer versions; sprint-391 keeps
    /// this strict (no `IF EXISTS`) — extending is a sprint-394 task.
    DropConstraint {
        constraint: String,
        cascade: Option<CascadeBehavior>,
    },
    /// `DROP INDEX <name>` — MySQL-style syntax. PostgreSQL emits this as
    /// a top-level `DROP INDEX` statement instead.
    DropIndex { index: String },
}

// ---- sprint-392 DML write triad AST nodes ----------------------------

/// `INSERT INTO <table> [(cols)] (VALUES (...) | DEFAULT VALUES | SELECT …)
///   [ON CONFLICT …] [RETURNING …]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InsertStatement {
    pub table: String,
    /// Empty when columns were not specified (`INSERT INTO t VALUES (1)`
    /// or `DEFAULT VALUES`).
    pub columns: Vec<String>,
    pub source: InsertSource,
    pub on_conflict: Option<OnConflict>,
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
    /// `INSERT … SELECT …` — sprint-385's narrow SELECT grammar is the
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

/// Sprint-392 widened literal set (sprint-385's `Literal` covered only
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
/// UPSERT semantic. MySQL's `ON DUPLICATE KEY UPDATE` is *not* covered
/// (sprint-395+ dialect work).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OnConflict {
    DoNothing,
    DoUpdate {
        set: Vec<UpdateAssignment>,
        where_clause: Option<WhereExpr>,
    },
}

/// `UPDATE <table> SET <col> = <value>[, …] [FROM …] [WHERE …] [RETURNING …]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateStatement {
    pub table: String,
    pub assignments: Vec<UpdateAssignment>,
    /// PG `UPDATE … FROM other_table` joins. Empty when absent.
    pub from: Vec<String>,
    pub where_clause: Option<WhereExpr>,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeleteStatement {
    pub table: String,
    /// PG `DELETE … USING other_table`. Empty when absent.
    pub using: Vec<String>,
    pub where_clause: Option<WhereExpr>,
    pub returning: Vec<String>,
}

/// Sprint-392 narrow WHERE expression. The grammar accepts:
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

/// Sprint-392 narrow comparison operators (matches `BinaryOp` of
/// sprint-385's WhereClause but lives separately so sprint-393's WHERE
/// widening can extend `WhereExpr` without disturbing `WhereClause`).
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
