//! Recursive-descent parser for the sprint-385 + sprint-391 grammar slices.
//!
//! Grammar (EBNF-ish):
//!   stmt        = select-stmt | drop-stmt | truncate-stmt | alter-stmt
//!   select-stmt = "SELECT" columns "FROM" identifier [ "WHERE" predicate ]
//!   columns     = "*" | identifier { "," identifier }
//!   predicate   = identifier op literal
//!   op          = "=" | "<>" | "!=" | "<" | ">" | "<=" | ">="
//!   literal     = integer | string
//!
//!   drop-stmt   = "DROP" drop-object ["IF" "EXISTS"] identifier [cascade]
//!   drop-object = "TABLE" | "DATABASE" | "INDEX" | "VIEW" | "SCHEMA"
//!               | "SEQUENCE" | "TYPE"
//!   cascade     = "CASCADE" | "RESTRICT"
//!
//!   truncate-stmt = "TRUNCATE" ["TABLE"] identifier
//!                   [ ("RESTART" | "CONTINUE") "IDENTITY" ]
//!                   [cascade]
//!
//!   alter-stmt  = "ALTER" "TABLE" identifier alter-action
//!   alter-action = "DROP" "COLUMN" ["IF" "EXISTS"] identifier [cascade]
//!                | "DROP" "CONSTRAINT" identifier [cascade]
//!                | "DROP" "INDEX" identifier
//!
//! On any deviation the parser returns a `ParseError` variant — never a
//! Rust panic. The `kind` field distinguishes:
//!
//! - `EmptyInput` — caller passed `""` or whitespace-only.
//! - `UnsupportedStatement` — first keyword is one we recognize (INSERT /
//!   UPDATE / DELETE / ALTER ADD …) but is out of scope for this sprint.
//! - `SyntaxError` — everything else (wrong order, missing required
//!   keyword, extra trailing tokens, mutually-exclusive options, …).
//! - `LexError` — surfaced verbatim from `lexer::lex`.

use crate::ast::{
    AlterAction, AlterTableStatement, CallArgument, CallStatement, CascadeBehavior, CaseWhen,
    ColumnConstraint, ColumnConstraintBody, ColumnDefinition, ColumnRef, ColumnType, Columns,
    CommentStatement, CommentTarget, CommentText, CompareOp, CopyDirection, CopySource,
    CopyStatement, CopyTarget, CreateIndexStatement, CreateTableStatement, CreateViewBody,
    CreateViewStatement, CteDefinition, DeleteStatement, DropObjectType, DropStatement,
    ExplainInner, ExplainOption, ExplainStatement, FrameBound, FrameUnit, FromItem, FromSource,
    GrantObject, GrantStatement, InsertSource, InsertStatement, InsertValue, JoinDescriptor,
    JoinPredicate, LikeCase, LimitClause, MergeStatement, MergeWhenClause, NullsPlacement,
    OnConflict, OnDuplicateKeyUpdate, OnDuplicateKeyUpdateAssignment, OnDuplicateKeyUpdateValue,
    OrderDirection, OrderingItem, OverClause, ParseError, ParseErrorKind, ParseResult,
    PrivilegeTag, ProcedureRef, RevokeStatement, RoleRef, SelectExpr, SelectListItem,
    SelectStatement, SetOperationEntry, SetOperator, SetScope, SetStatement, SetValue,
    ShowStatement, ShowTarget, SqlLiteral, TableConstraint, TableConstraintBody, TableRef,
    TruncateStatement, UpdateAssignment, UpdateStatement, WindowArgument, WindowFrame, WithInner,
    WithStatement,
};
use crate::lexer::{lex, Spanned, Token};

mod admin;
mod ddl;
mod dml;
mod select;
mod util;

use util::{
    first_word, is_known_sql_verb, is_supported_sql_verb, syntax_err, token_word,
    unsupported_message,
};

/// Entry point. Lex + parse + verify "no trailing tokens" in one shot.
/// Always returns `ParseResult` (never `Err`) — errors are a tagged
/// variant of the union so the WASM/IPC bridge can serialize uniformly.
pub fn parse(input: &str) -> ParseResult {
    if input.trim().is_empty() {
        return ParseResult::Error(ParseError {
            error_kind: ParseErrorKind::EmptyInput,
            message: "input is empty".to_string(),
            at: None,
        });
    }

    // Pre-scan: if the first non-whitespace word is a known SQL verb
    // we do NOT support (sprint-391 supports SELECT / DROP / TRUNCATE /
    // ALTER), short-circuit with `UnsupportedStatement` BEFORE handing
    // the input to the lexer. This matters because the lexer chokes on
    // punctuation we don't support (`(`, `)`), so e.g.
    // `INSERT INTO users VALUES (1)` would otherwise surface as
    // `LexError` instead of the more informative `UnsupportedStatement`.
    if let Some((verb, at)) = first_word(input) {
        let upper = verb.to_ascii_uppercase();
        if !is_supported_sql_verb(&upper) && is_known_sql_verb(&upper) {
            return ParseResult::Error(ParseError {
                error_kind: ParseErrorKind::UnsupportedStatement,
                message: unsupported_message(&verb),
                at: Some(at),
            });
        }
    }

    let tokens = match lex(input) {
        Ok(t) => t,
        Err(e) => return ParseResult::Error(e),
    };

    if tokens.is_empty() {
        // `lex` may strip everything (e.g. just a `;`). Treat as empty
        // input — same surface as `parse_sql("")`.
        return ParseResult::Error(ParseError {
            error_kind: ParseErrorKind::EmptyInput,
            message: "no tokens".to_string(),
            at: None,
        });
    }

    let mut p = Parser::new(&tokens);
    let result = match p.parse_statement() {
        Ok(r) => r,
        Err(e) => return ParseResult::Error(e),
    };

    // Reject extra trailing tokens — every statement variant is strictly
    // single-statement per call. Tighter error than letting the caller
    // silently lose the tail.
    if p.cursor < tokens.len() {
        let at = tokens[p.cursor].at;
        return ParseResult::Error(ParseError {
            error_kind: ParseErrorKind::SyntaxError,
            message: "unexpected trailing tokens".to_string(),
            at: Some(at),
        });
    }
    result
}

struct Parser<'a> {
    tokens: &'a [Spanned],
    cursor: usize,
}

impl<'a> Parser<'a> {
    fn new(tokens: &'a [Spanned]) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn peek(&self) -> Option<&Spanned> {
        self.tokens.get(self.cursor)
    }

    fn advance(&mut self) -> Option<&Spanned> {
        let t = self.tokens.get(self.cursor);
        if t.is_some() {
            self.cursor += 1;
        }
        t
    }

    /// Dispatch to the per-verb sub-parser based on the first token.
    /// Returns `ParseResult` (not just `SelectStatement`) so sprint-391's
    /// DDL variants (`Drop`, `Truncate`, `AlterTable`) flow through the
    /// same entry point as the sprint-385 `Select` slice.
    fn parse_statement(&mut self) -> Result<ParseResult, ParseError> {
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected statement"))?;

        match &first.token {
            Token::Select => {
                self.advance();
                Ok(ParseResult::Select(self.parse_select()?))
            }
            Token::Drop => {
                self.advance();
                Ok(ParseResult::Drop(self.parse_drop()?))
            }
            Token::Truncate => {
                self.advance();
                Ok(ParseResult::Truncate(self.parse_truncate()?))
            }
            Token::Alter => {
                self.advance();
                Ok(ParseResult::AlterTable(self.parse_alter_table()?))
            }
            Token::Insert => {
                self.advance();
                Ok(ParseResult::Insert(self.parse_insert()?))
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("call") => {
                self.advance();
                Ok(ParseResult::Call(self.parse_call()?))
            }
            Token::Update => {
                self.advance();
                Ok(ParseResult::Update(self.parse_update()?))
            }
            Token::Delete => {
                self.advance();
                Ok(ParseResult::Delete(self.parse_delete()?))
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("merge") => {
                self.advance();
                Ok(ParseResult::Merge(self.parse_merge()?))
            }
            Token::With => {
                self.advance();
                Ok(ParseResult::With(self.parse_with()?))
            }
            Token::Create => {
                // Sprint-394 — `CREATE TABLE / CREATE INDEX / CREATE
                // UNIQUE INDEX / CREATE VIEW / CREATE OR REPLACE VIEW`.
                // Any other follow-up token (FUNCTION / TRIGGER /
                // EXTENSION / TEMPORARY / MATERIALIZED / …) falls
                // through to `SyntaxError` here — the regex fallback in
                // sqlSafety still classifies them.
                self.advance();
                self.parse_create_dispatch()
            }
            Token::Grant => {
                self.advance();
                Ok(ParseResult::Grant(self.parse_grant()?))
            }
            Token::Revoke => {
                self.advance();
                Ok(ParseResult::Revoke(self.parse_revoke()?))
            }
            Token::Explain => {
                self.advance();
                Ok(ParseResult::Explain(self.parse_explain()?))
            }
            Token::Show => {
                self.advance();
                Ok(ParseResult::Show(self.parse_show()?))
            }
            Token::Set => {
                self.advance();
                Ok(ParseResult::SetStmt(self.parse_set_stmt()?))
            }
            // Sprint-395 — `COPY` and `COMMENT` are intentionally kept as
            // `Token::Ident` (production schemas often use them as column
            // names). The dispatcher matches them case-insensitively
            // before falling through to the generic ident-as-unsupported
            // verb path below.
            Token::Ident(name) if name.eq_ignore_ascii_case("copy") => {
                self.advance();
                Ok(ParseResult::Copy(self.parse_copy()?))
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("comment") => {
                self.advance();
                Ok(ParseResult::Comment(self.parse_comment()?))
            }
            Token::Ident(name) => {
                // The lexer keeps any non-keyword as an identifier; if it
                // looks like a known SQL verb (INSERT / UPDATE / DELETE /
                // CREATE / GRANT / …) label it as `UnsupportedStatement`
                // so callers can distinguish "we know this SQL but don't
                // implement it" from "syntactically broken".
                let kind = if is_known_sql_verb(name) {
                    ParseErrorKind::UnsupportedStatement
                } else {
                    ParseErrorKind::SyntaxError
                };
                Err(ParseError {
                    error_kind: kind,
                    message: unsupported_message(name),
                    at: Some(first.at),
                })
            }
            _ => Err(syntax_err(
                Some(first.at),
                "expected SELECT/INSERT/CALL/UPDATE/DELETE/DROP/TRUNCATE/ALTER at start",
            )),
        }
    }

    /// Helper — consume a comma-separated identifier list. Reads at
    /// least one identifier; bare empty lists are rejected by the
    /// caller's downstream check (`)` follows immediately).
    fn parse_ident_list(&mut self, msg: &str) -> Result<Vec<String>, ParseError> {
        let mut out: Vec<String> = Vec::new();
        loop {
            let tok = self.peek().ok_or_else(|| syntax_err(None, msg))?.clone();
            match tok.token {
                Token::Ident(name) => {
                    out.push(name);
                    self.advance();
                }
                _ => return Err(syntax_err(Some(tok.at), msg)),
            }
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Consume an identifier token or surface a syntax error.
    fn expect_ident(&mut self, msg: &str) -> Result<String, ParseError> {
        let tok = self.peek().ok_or_else(|| syntax_err(None, msg))?.clone();
        match tok.token {
            Token::Ident(name) => {
                self.advance();
                Ok(name)
            }
            _ => Err(syntax_err(Some(tok.at), msg)),
        }
    }

    /// Consume an exact punctuation/keyword token. Like `expect_keyword`
    /// but the message is supplied per-call.
    fn expect_token(&mut self, expected: Token, msg: &str) -> Result<(), ParseError> {
        let tok = self.peek().ok_or_else(|| syntax_err(None, msg))?;
        if tok.token != expected {
            return Err(syntax_err(Some(tok.at), msg));
        }
        self.advance();
        Ok(())
    }

    /// Consume an optional `IF EXISTS` token pair. Returns `true` if
    /// both tokens were consumed, `false` if neither was present. A
    /// bare `IF` without `EXISTS` is a syntax error.
    fn consume_if_exists(&mut self) -> Result<bool, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::If)) {
            return Ok(false);
        }
        let if_tok = self.peek().expect("just peeked").clone();
        self.advance();
        let exists_tok = self
            .peek()
            .ok_or_else(|| syntax_err(Some(if_tok.at), "expected EXISTS"))?;
        if exists_tok.token != Token::Exists {
            return Err(syntax_err(Some(exists_tok.at), "expected EXISTS"));
        }
        self.advance();
        Ok(true)
    }

    /// Consume an optional `CASCADE` / `RESTRICT` keyword. Returns
    /// `Some(...)` if present, `None` if absent. The two are mutually
    /// exclusive — encountering one then the other in trailing position
    /// is a syntax error, but that error surfaces from the outer
    /// "unexpected trailing tokens" check (the second keyword would not
    /// be consumed here).
    fn consume_cascade_or_restrict(&mut self) -> Result<Option<CascadeBehavior>, ParseError> {
        let kind = match self.peek().map(|t| &t.token) {
            Some(Token::Cascade) => CascadeBehavior::Cascade,
            Some(Token::Restrict) => CascadeBehavior::Restrict,
            _ => return Ok(None),
        };
        self.advance();
        Ok(Some(kind))
    }

    /// Consume the given keyword token or surface a syntax error with
    /// `msg`. Used for required keywords like `TABLE` (after ALTER) and
    /// `IDENTITY` (after RESTART/CONTINUE).
    fn expect_keyword(&mut self, expected: Token, msg: &str) -> Result<(), ParseError> {
        let tok = self.peek().ok_or_else(|| syntax_err(None, msg))?;
        if tok.token != expected {
            return Err(syntax_err(Some(tok.at), msg));
        }
        self.advance();
        Ok(())
    }

    // ---- sprint-395 misc grammar parsers ----------------------------

    /// Sprint-395 — case-insensitive identifier-keyword check (consumes
    /// the token if it matches; leaves cursor in place otherwise). Used
    /// because most sprint-395 keywords stay as `Token::Ident` to avoid
    /// breaking sprint-385/391/394 tests that use those strings as
    /// identifiers (e.g. `public`, `tables`, `analyze`).
    fn consume_ident_kw(&mut self, expected: &str) -> bool {
        if self.peek_ident_kw(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn peek_ident_kw(&self, expected: &str) -> bool {
        match self.peek().map(|t| &t.token) {
            Some(Token::Ident(name)) => name.eq_ignore_ascii_case(expected),
            _ => false,
        }
    }

    /// Sprint-395 — assert the next token is an identifier whose text
    /// matches (case-insensitively) `expected`; advance and return Ok.
    /// Used for required pseudo-keywords like `OPTION`, `FOR`, `IN`.
    fn expect_ident_kw(&mut self, expected: &str, msg: &str) -> Result<(), ParseError> {
        if !self.consume_ident_kw(expected) {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, msg));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
