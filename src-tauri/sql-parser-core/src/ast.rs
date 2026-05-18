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
    /// A parse / lex error. `kind` discriminator is one of:
    /// `"lex-error"`, `"unsupported-statement"`, `"syntax-error"`,
    /// `"empty-input"` — see `ParseErrorKind`.
    Error(ParseError),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectStatement {
    pub columns: Columns,
    pub table: String,
    #[serde(rename = "where")]
    pub where_clause: Option<WhereClause>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Columns {
    /// `SELECT *`
    Star,
    /// `SELECT a, b, c`
    Named { names: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WhereClause {
    pub column: String,
    pub op: BinaryOp,
    pub literal: Literal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BinaryOp {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "<>")]
    NotEq,
    #[serde(rename = "!=")]
    BangEq,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = "<=")]
    LtEq,
    #[serde(rename = ">=")]
    GtEq,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Literal {
    /// 64-bit integer literal — `42`, `0`, etc. We use i64 (not u64) so
    /// negative literals would be representable, but sprint-385 lex does
    /// not actually produce negatives (no unary minus in the grammar).
    Integer { value: i64 },
    /// Single-quoted string literal. The quotes are stripped; embedded
    /// `''` escapes resolved (sprint-385 lex only handles `''` escape,
    /// not backslash escapes — see `lexer.rs`).
    String { value: String },
}

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
