//! AST types for the sprint-401 mongosh-parser-core crate.
//!
//! Mirrors the TS `MongoshStatementResult` discriminated union one-for-one.
//! Field names use camelCase via `#[serde(rename = "...")]` so the WASM-
//! bridged JS shape matches the existing `MongoshAdminCommand` /
//! `MongoshCollectionCommand` / `MongoshParseError` TS interfaces exactly —
//! that is the load-bearing invariant that makes the regression delta zero.
//!
//! `body` / `args` are `serde_json::Value` because the mongosh grammar
//! supports arbitrary nested objects/arrays. Using `serde_json::Value` keeps
//! the AST polymorphic without requiring a hand-written `Value` enum, and
//! `serde_wasm_bindgen` round-trips `Value` cleanly to JS.

use serde::{Deserialize, Serialize};

/// Top-level result returned by `parse_mongosh`. Tagged union so the TS
/// facade can narrow on `kind` without try/catch — parse errors travel as a
/// variant of the same result, not as a thrown exception.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum MongoshStatement {
    /// `db.runCommand({...})` or `db.adminCommand({...})`. Backend dispatch
    /// to `run_mongo_command` uses `commandName` to pick admin vs scoped DB
    /// context.
    #[serde(rename = "admin-command")]
    AdminCommand {
        #[serde(rename = "commandName")]
        command_name: AdminCommandName,
        body: serde_json::Value,
    },
    /// `db.<coll>.<method>(...)`.
    #[serde(rename = "collection-command")]
    CollectionCommand {
        collection: String,
        method: String,
        args: Vec<serde_json::Value>,
    },
    /// Parse / lex error. `errorKind` distinguishes UI-surfaceable
    /// categories — see `MongoshErrorKind`.
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "errorKind")]
        error_kind: MongoshErrorKind,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdminCommandName {
    #[serde(rename = "runCommand")]
    RunCommand,
    #[serde(rename = "adminCommand")]
    AdminCommand,
}

/// Differentiated rejection categories — TS side mirror at
/// `mongoshAst/lexer.ts:MongoshErrorKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MongoshErrorKind {
    /// Generic parser / lexer failure.
    UnsupportedSyntax,
    /// BSON helper (`BinData`, etc.) we don't yet support.
    BsonLiteral,
    /// `db.users.find({}); db.users.drop()` — top-level `;` separator.
    MultipleStatements,
    /// `let` / `const` / `var` head.
    VariableDeclaration,
    /// `function foo() {}` / `class X {}` head.
    FunctionDeclaration,
    /// Bare expression head (`1 + 1`, `"hello"`, `ObjectId(...)`).
    NonDbStatement,
}
