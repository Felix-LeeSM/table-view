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
    AlterAction, AlterTableStatement, BinaryOp, CascadeBehavior, Columns, DropObjectType,
    DropStatement, Literal, ParseError, ParseErrorKind, ParseResult, SelectStatement,
    TruncateStatement, WhereClause,
};
use crate::lexer::{lex, Spanned, Token};

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
            message: "no tokens after stripping whitespace/semicolons".to_string(),
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
            message: "unexpected trailing tokens after statement".to_string(),
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
            .ok_or_else(|| syntax_err(None, "expected statement, got end of input"))?;

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
                "expected SELECT / DROP / TRUNCATE / ALTER at start of statement",
            )),
        }
    }

    /// `SELECT` body — assumes the verb token has already been consumed.
    fn parse_select(&mut self) -> Result<SelectStatement, ParseError> {
        let columns = self.parse_columns()?;

        // FROM
        let from_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected FROM after column list"))?;
        if from_tok.token != Token::From {
            return Err(syntax_err(
                Some(from_tok.at),
                "expected FROM keyword after column list",
            ));
        }
        self.advance();

        // table name
        let table_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name after FROM"))?;
        let table = match &table_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(table_tok.at),
                    "expected table identifier after FROM",
                ));
            }
        };
        self.advance();

        // Optional WHERE.
        let where_clause = if matches!(self.peek().map(|t| &t.token), Some(Token::Where)) {
            self.advance();
            Some(self.parse_where()?)
        } else {
            None
        };

        Ok(SelectStatement {
            columns,
            table,
            where_clause,
        })
    }

    // ---------------------------------------------------------------
    // Sprint 391 — DDL destructive sub-parsers.
    // ---------------------------------------------------------------

    /// `DROP <object-type> [IF EXISTS] <name> [CASCADE|RESTRICT]`.
    /// Assumes the `DROP` token has already been consumed.
    fn parse_drop(&mut self) -> Result<DropStatement, ParseError> {
        // object-type
        let obj_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected object type after DROP"))?;
        let object_type = match obj_tok.token {
            Token::Table => DropObjectType::Table,
            Token::Database => DropObjectType::Database,
            Token::Index => DropObjectType::Index,
            Token::View => DropObjectType::View,
            Token::Schema => DropObjectType::Schema,
            Token::Sequence => DropObjectType::Sequence,
            Token::Type => DropObjectType::Type,
            _ => {
                return Err(syntax_err(
                    Some(obj_tok.at),
                    "expected one of TABLE / DATABASE / INDEX / VIEW / SCHEMA / SEQUENCE / TYPE",
                ));
            }
        };
        self.advance();

        // optional IF EXISTS
        let if_exists = self.consume_if_exists()?;

        // name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected object name after DROP"))?;
        let name = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected object name identifier",
                ));
            }
        };
        self.advance();

        // optional CASCADE / RESTRICT
        let cascade = self.consume_cascade_or_restrict()?;

        Ok(DropStatement {
            object_type,
            name,
            if_exists,
            cascade,
        })
    }

    /// `TRUNCATE [TABLE] <name>
    ///  [RESTART IDENTITY | CONTINUE IDENTITY]
    ///  [CASCADE | RESTRICT]`.
    /// Assumes the `TRUNCATE` token has already been consumed.
    fn parse_truncate(&mut self) -> Result<TruncateStatement, ParseError> {
        // Optional TABLE keyword.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Table)) {
            self.advance();
        }

        // table name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name after TRUNCATE"))?;
        let table = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected table name identifier after TRUNCATE",
                ));
            }
        };
        self.advance();

        // optional RESTART/CONTINUE IDENTITY
        let restart_identity = match self.peek().map(|t| &t.token) {
            Some(Token::Restart) => {
                self.advance();
                self.expect_keyword(Token::Identity, "expected IDENTITY after RESTART")?;
                Some(true)
            }
            Some(Token::Continue) => {
                self.advance();
                self.expect_keyword(Token::Identity, "expected IDENTITY after CONTINUE")?;
                Some(false)
            }
            _ => None,
        };

        // optional CASCADE / RESTRICT
        let cascade = self.consume_cascade_or_restrict()?;

        Ok(TruncateStatement {
            table,
            restart_identity,
            cascade,
        })
    }

    /// `ALTER TABLE <name> <action>`. Assumes the `ALTER` token has been
    /// consumed. Only DROP-family actions are accepted here — ADD /
    /// RENAME / ALTER COLUMN surface as `UnsupportedStatement`.
    fn parse_alter_table(&mut self) -> Result<AlterTableStatement, ParseError> {
        // TABLE
        self.expect_keyword(
            Token::Table,
            "expected TABLE after ALTER (sprint-391 only supports ALTER TABLE)",
        )?;

        // table name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name after ALTER TABLE"))?;
        let table = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected table name identifier after ALTER TABLE",
                ));
            }
        };
        self.advance();

        // action — only DROP is supported in sprint-391; everything else
        // is an unsupported statement (or syntax error if the token isn't
        // a recognised ALTER action keyword).
        let action_tok = self.peek().ok_or_else(|| {
            syntax_err(None, "expected action keyword after ALTER TABLE <name>")
        })?;
        match action_tok.token {
            Token::Drop => {
                self.advance();
                let action = self.parse_alter_drop_action()?;
                Ok(AlterTableStatement { table, action })
            }
            // Any non-DROP action keyword (ADD / RENAME / ALTER /
            // identifier) is out of scope for sprint-391 — DDL additive
            // grammar is sprint-394.
            Token::Ident(_) => Err(ParseError {
                error_kind: ParseErrorKind::UnsupportedStatement,
                message:
                    "sprint-391 only supports ALTER TABLE … DROP (ADD/RENAME is sprint-394)"
                        .to_string(),
                at: Some(action_tok.at),
            }),
            _ => Err(syntax_err(
                Some(action_tok.at),
                "expected DROP keyword after ALTER TABLE <name>",
            )),
        }
    }

    /// `DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]`
    /// | `DROP CONSTRAINT <name> [CASCADE|RESTRICT]`
    /// | `DROP INDEX <name>` (MySQL-style).
    /// Assumes the `DROP` token has been consumed.
    fn parse_alter_drop_action(&mut self) -> Result<AlterAction, ParseError> {
        let target_tok = self.peek().ok_or_else(|| {
            syntax_err(
                None,
                "expected COLUMN / CONSTRAINT / INDEX after ALTER TABLE … DROP",
            )
        })?;
        match target_tok.token {
            Token::Column => {
                self.advance();
                let if_exists = self.consume_if_exists()?;
                let col_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected column name after DROP COLUMN"))?;
                let column = match &col_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(col_tok.at),
                            "expected column name identifier",
                        ));
                    }
                };
                self.advance();
                let cascade = self.consume_cascade_or_restrict()?;
                Ok(AlterAction::DropColumn {
                    column,
                    if_exists,
                    cascade,
                })
            }
            Token::Constraint => {
                self.advance();
                let c_tok = self.peek().ok_or_else(|| {
                    syntax_err(None, "expected constraint name after DROP CONSTRAINT")
                })?;
                let constraint = match &c_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(c_tok.at),
                            "expected constraint name identifier",
                        ));
                    }
                };
                self.advance();
                let cascade = self.consume_cascade_or_restrict()?;
                Ok(AlterAction::DropConstraint {
                    constraint,
                    cascade,
                })
            }
            Token::Index => {
                self.advance();
                let i_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected index name after DROP INDEX"))?;
                let index = match &i_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(i_tok.at),
                            "expected index name identifier",
                        ));
                    }
                };
                self.advance();
                Ok(AlterAction::DropIndex { index })
            }
            _ => Err(syntax_err(
                Some(target_tok.at),
                "expected COLUMN / CONSTRAINT / INDEX after ALTER TABLE … DROP",
            )),
        }
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
            .ok_or_else(|| syntax_err(Some(if_tok.at), "expected EXISTS after IF"))?;
        if exists_tok.token != Token::Exists {
            return Err(syntax_err(Some(exists_tok.at), "expected EXISTS after IF"));
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
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, msg))?;
        if tok.token != expected {
            return Err(syntax_err(Some(tok.at), msg));
        }
        self.advance();
        Ok(())
    }

    fn parse_columns(&mut self) -> Result<Columns, ParseError> {
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column list after SELECT"))?;
        if first.token == Token::Star {
            self.advance();
            return Ok(Columns::Star);
        }

        let mut names: Vec<String> = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected column identifier"))?;
            match &tok.token {
                Token::Ident(name) => {
                    names.push(name.clone());
                    self.advance();
                }
                _ => {
                    return Err(syntax_err(Some(tok.at), "expected column identifier"));
                }
            }
            // Trailing comma → another column. Anything else → end of list.
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
            } else {
                break;
            }
        }
        Ok(Columns::Named { names })
    }

    fn parse_where(&mut self) -> Result<WhereClause, ParseError> {
        // identifier
        let col_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column identifier after WHERE"))?;
        let column = match &col_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(col_tok.at),
                    "expected column identifier after WHERE",
                ));
            }
        };
        self.advance();

        // op
        let op_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected comparison operator after column"))?;
        let op = match op_tok.token {
            Token::Eq => BinaryOp::Eq,
            Token::NotEq => BinaryOp::NotEq,
            Token::BangEq => BinaryOp::BangEq,
            Token::Lt => BinaryOp::Lt,
            Token::Gt => BinaryOp::Gt,
            Token::LtEq => BinaryOp::LtEq,
            Token::GtEq => BinaryOp::GtEq,
            _ => {
                return Err(syntax_err(
                    Some(op_tok.at),
                    "expected one of =, <>, !=, <, >, <=, >=",
                ));
            }
        };
        self.advance();

        // literal
        let lit_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected literal after comparison operator"))?;
        let literal = match &lit_tok.token {
            Token::Integer(v) => Literal::Integer { value: *v },
            Token::String(s) => Literal::String { value: s.clone() },
            _ => {
                return Err(syntax_err(
                    Some(lit_tok.at),
                    "expected integer or string literal",
                ));
            }
        };
        self.advance();

        Ok(WhereClause {
            column,
            op,
            literal,
        })
    }
}

/// Cheap pre-lex scan: returns the first ASCII-alphanumeric/underscore
/// run together with its starting byte offset, or `None` if the input
/// has no such word. Only used to detect "non-SELECT verb at top of
/// statement" before the lexer (which may choke on later punctuation)
/// gets a chance.
fn first_word(input: &str) -> Option<(String, usize)> {
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len()
        && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b'\n' || bytes[i] == b'\r')
    {
        i += 1;
    }
    let start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i == start {
        None
    } else {
        std::str::from_utf8(&bytes[start..i])
            .ok()
            .map(|s| (s.to_string(), start))
    }
}

fn syntax_err(at: Option<usize>, msg: &str) -> ParseError {
    ParseError {
        error_kind: ParseErrorKind::SyntaxError,
        message: msg.to_string(),
        at,
    }
}

fn is_known_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT"
            | "INSERT"
            | "UPDATE"
            | "DELETE"
            | "CREATE"
            | "DROP"
            | "ALTER"
            | "TRUNCATE"
            | "GRANT"
            | "REVOKE"
            | "EXPLAIN"
            | "WITH"
            | "MERGE"
            | "REPLACE"
    )
}

/// Sprint-391 — the set of verbs whose grammar this crate actually
/// implements. Anything in `is_known_sql_verb` but not in here is an
/// `UnsupportedStatement`.
fn is_supported_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT" | "DROP" | "TRUNCATE" | "ALTER"
    )
}

fn unsupported_message(verb: &str) -> String {
    format!(
        "sprint-391 only supports SELECT / DROP / TRUNCATE / ALTER TABLE … DROP; got '{}'",
        verb
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_select(input: &str) -> SelectStatement {
        match parse(input) {
            ParseResult::Select(s) => s,
            other => panic!("expected Select, got: {:?}", other),
        }
    }

    fn err(input: &str) -> ParseError {
        match parse(input) {
            ParseResult::Error(e) => e,
            other => panic!("expected error, got: {:?}", other),
        }
    }

    #[test]
    fn ac_p1_select_star_from_users() {
        let s = ok_select("SELECT * FROM users");
        assert_eq!(s.columns, Columns::Star);
        assert_eq!(s.table, "users");
        assert!(s.where_clause.is_none());
    }

    #[test]
    fn ac_p2_select_named_columns() {
        let s = ok_select("SELECT id, name FROM users");
        assert_eq!(
            s.columns,
            Columns::Named {
                names: vec!["id".into(), "name".into()]
            }
        );
        assert_eq!(s.table, "users");
    }

    #[test]
    fn ac_p2_single_named_column() {
        let s = ok_select("SELECT id FROM users");
        assert_eq!(
            s.columns,
            Columns::Named {
                names: vec!["id".into()]
            }
        );
    }

    #[test]
    fn ac_p3_where_integer_literal() {
        let s = ok_select("SELECT id FROM users WHERE id = 42");
        let w = s.where_clause.expect("WHERE");
        assert_eq!(w.column, "id");
        assert_eq!(w.op, BinaryOp::Eq);
        assert_eq!(w.literal, Literal::Integer { value: 42 });
    }

    #[test]
    fn ac_p4_where_string_literal() {
        let s = ok_select("SELECT id FROM users WHERE name = 'felix'");
        let w = s.where_clause.expect("WHERE");
        assert_eq!(w.column, "name");
        assert_eq!(w.op, BinaryOp::Eq);
        assert_eq!(
            w.literal,
            Literal::String {
                value: "felix".into()
            }
        );
    }

    #[test]
    fn ac_p5_all_seven_ops() {
        let ops = [
            ("=", BinaryOp::Eq),
            ("<>", BinaryOp::NotEq),
            ("!=", BinaryOp::BangEq),
            ("<", BinaryOp::Lt),
            (">", BinaryOp::Gt),
            ("<=", BinaryOp::LtEq),
            (">=", BinaryOp::GtEq),
        ];
        for (sym, expected) in ops {
            let sql = format!("SELECT id FROM users WHERE id {} 1", sym);
            let s = ok_select(&sql);
            let w = s.where_clause.expect("WHERE");
            assert_eq!(w.op, expected, "op={sym}");
        }
    }

    #[test]
    fn ac_p6_missing_from_is_syntax_error() {
        let e = err("SELECT * users");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_lowercase().contains("from"));
    }

    #[test]
    fn ac_p7_missing_table_after_from_is_syntax_error() {
        let e = err("SELECT * FROM");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_p8_insert_is_unsupported_statement() {
        let e = err("INSERT INTO users VALUES (1)");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p8_update_is_unsupported_statement() {
        let e = err("UPDATE users SET name = 'x'");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p8_delete_is_unsupported_statement() {
        let e = err("DELETE FROM users");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p9_empty_input_is_empty_input_kind() {
        assert_eq!(err("").error_kind, ParseErrorKind::EmptyInput);
        assert_eq!(err("   ").error_kind, ParseErrorKind::EmptyInput);
        assert_eq!(err(";").error_kind, ParseErrorKind::EmptyInput);
    }

    #[test]
    fn ac_p10_trailing_semicolon_accepted() {
        let s = ok_select("SELECT * FROM users;");
        assert_eq!(s.columns, Columns::Star);
        assert_eq!(s.table, "users");
    }

    #[test]
    fn extra_trailing_tokens_rejected() {
        let e = err("SELECT * FROM users garbage");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_lowercase().contains("trailing"));
    }

    #[test]
    fn unknown_first_keyword_is_syntax_error_not_unsupported() {
        // `FOO BAR` is not a known SQL verb — it's syntactically broken.
        let e = err("FOO BAR");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn where_requires_literal_not_identifier() {
        // `WHERE a = b` is parser-time SyntaxError — sprint-385 does not
        // support column-to-column comparison.
        let e = err("SELECT * FROM t WHERE a = b");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // -----------------------------------------------------------------
    // Sprint 391 — DDL destructive grammar.
    // -----------------------------------------------------------------

    fn ok_drop(input: &str) -> DropStatement {
        match parse(input) {
            ParseResult::Drop(d) => d,
            other => panic!("expected Drop, got: {:?}", other),
        }
    }

    fn ok_truncate(input: &str) -> TruncateStatement {
        match parse(input) {
            ParseResult::Truncate(t) => t,
            other => panic!("expected Truncate, got: {:?}", other),
        }
    }

    fn ok_alter(input: &str) -> AlterTableStatement {
        match parse(input) {
            ParseResult::AlterTable(a) => a,
            other => panic!("expected AlterTable, got: {:?}", other),
        }
    }

    // ── DROP — AC-391-D ──────────────────────────────────────────────

    #[test]
    fn ac_391_d01_drop_table_basic() {
        let s = ok_drop("DROP TABLE users");
        assert_eq!(s.object_type, DropObjectType::Table);
        assert_eq!(s.name, "users");
        assert!(!s.if_exists);
        assert_eq!(s.cascade, None);
    }

    #[test]
    fn ac_391_d02_drop_table_if_exists() {
        let s = ok_drop("DROP TABLE IF EXISTS users");
        assert!(s.if_exists);
        assert_eq!(s.cascade, None);
    }

    #[test]
    fn ac_391_d03_drop_table_cascade() {
        let s = ok_drop("DROP TABLE users CASCADE");
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d04_drop_table_if_exists_cascade() {
        let s = ok_drop("DROP TABLE IF EXISTS users CASCADE");
        assert!(s.if_exists);
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d05_drop_table_restrict() {
        let s = ok_drop("DROP TABLE users RESTRICT");
        assert_eq!(s.cascade, Some(CascadeBehavior::Restrict));
    }

    #[test]
    fn ac_391_d06_drop_database_basic() {
        let s = ok_drop("DROP DATABASE myapp");
        assert_eq!(s.object_type, DropObjectType::Database);
        assert_eq!(s.name, "myapp");
    }

    #[test]
    fn ac_391_d07_drop_database_if_exists() {
        let s = ok_drop("DROP DATABASE IF EXISTS myapp");
        assert_eq!(s.object_type, DropObjectType::Database);
        assert!(s.if_exists);
    }

    #[test]
    fn ac_391_d08_drop_index_basic() {
        let s = ok_drop("DROP INDEX idx_users_email");
        assert_eq!(s.object_type, DropObjectType::Index);
        assert_eq!(s.name, "idx_users_email");
    }

    #[test]
    fn ac_391_d09_drop_index_if_exists_cascade() {
        let s = ok_drop("DROP INDEX IF EXISTS idx CASCADE");
        assert_eq!(s.object_type, DropObjectType::Index);
        assert!(s.if_exists);
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d10_drop_view_basic() {
        let s = ok_drop("DROP VIEW v_active_users");
        assert_eq!(s.object_type, DropObjectType::View);
        assert_eq!(s.name, "v_active_users");
    }

    #[test]
    fn ac_391_d11_drop_view_if_exists_restrict() {
        let s = ok_drop("DROP VIEW IF EXISTS v RESTRICT");
        assert_eq!(s.object_type, DropObjectType::View);
        assert!(s.if_exists);
        assert_eq!(s.cascade, Some(CascadeBehavior::Restrict));
    }

    #[test]
    fn ac_391_d12_drop_schema_cascade() {
        let s = ok_drop("DROP SCHEMA public CASCADE");
        assert_eq!(s.object_type, DropObjectType::Schema);
        assert_eq!(s.name, "public");
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d13_drop_schema_if_exists_cascade() {
        let s = ok_drop("DROP SCHEMA IF EXISTS s CASCADE");
        assert_eq!(s.object_type, DropObjectType::Schema);
        assert!(s.if_exists);
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d14_drop_sequence_basic() {
        let s = ok_drop("DROP SEQUENCE my_seq");
        assert_eq!(s.object_type, DropObjectType::Sequence);
        assert_eq!(s.name, "my_seq");
    }

    #[test]
    fn ac_391_d15_drop_type_cascade() {
        let s = ok_drop("DROP TYPE my_enum CASCADE");
        assert_eq!(s.object_type, DropObjectType::Type);
        assert_eq!(s.name, "my_enum");
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_d16_drop_table_missing_name_is_syntax_error() {
        let e = err("DROP TABLE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_d17_drop_unknown_object_is_syntax_error() {
        let e = err("DROP FROOBAR x");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_d18_drop_cascade_then_restrict_is_syntax_error() {
        // CASCADE consumed; RESTRICT becomes an unexpected trailing token.
        let e = err("DROP TABLE x CASCADE RESTRICT");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_d19_drop_table_case_insensitive() {
        let s = ok_drop("drop table users");
        assert_eq!(s.object_type, DropObjectType::Table);
        assert_eq!(s.name, "users");
    }

    #[test]
    fn ac_391_d_trailing_semicolon_accepted_on_drop() {
        let s = ok_drop("DROP TABLE users;");
        assert_eq!(s.name, "users");
    }

    #[test]
    fn ac_391_d_drop_missing_object_type_is_syntax_error() {
        // `DROP` alone (no TABLE / DATABASE / …) is a syntax error, not
        // unsupported — the verb is supported, the body is malformed.
        let e = err("DROP");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_d_drop_if_without_exists_is_syntax_error() {
        let e = err("DROP TABLE IF users");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_uppercase().contains("EXISTS"));
    }

    // ── TRUNCATE — AC-391-T ──────────────────────────────────────────

    #[test]
    fn ac_391_t01_truncate_users_basic() {
        let s = ok_truncate("TRUNCATE users");
        assert_eq!(s.table, "users");
        assert_eq!(s.restart_identity, None);
        assert_eq!(s.cascade, None);
    }

    #[test]
    fn ac_391_t02_truncate_table_users() {
        let s = ok_truncate("TRUNCATE TABLE users");
        assert_eq!(s.table, "users");
    }

    #[test]
    fn ac_391_t03_truncate_users_cascade() {
        let s = ok_truncate("TRUNCATE users CASCADE");
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_t04_truncate_users_restrict() {
        let s = ok_truncate("TRUNCATE users RESTRICT");
        assert_eq!(s.cascade, Some(CascadeBehavior::Restrict));
    }

    #[test]
    fn ac_391_t05_truncate_restart_identity() {
        let s = ok_truncate("TRUNCATE users RESTART IDENTITY");
        assert_eq!(s.restart_identity, Some(true));
    }

    #[test]
    fn ac_391_t06_truncate_continue_identity() {
        let s = ok_truncate("TRUNCATE users CONTINUE IDENTITY");
        assert_eq!(s.restart_identity, Some(false));
    }

    #[test]
    fn ac_391_t07_truncate_restart_identity_cascade() {
        let s = ok_truncate("TRUNCATE users RESTART IDENTITY CASCADE");
        assert_eq!(s.restart_identity, Some(true));
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_t08_truncate_continue_identity_restrict() {
        let s = ok_truncate("TRUNCATE users CONTINUE IDENTITY RESTRICT");
        assert_eq!(s.restart_identity, Some(false));
        assert_eq!(s.cascade, Some(CascadeBehavior::Restrict));
    }

    #[test]
    fn ac_391_t09_truncate_table_full_form() {
        let s = ok_truncate("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        assert_eq!(s.table, "users");
        assert_eq!(s.restart_identity, Some(true));
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_t10_truncate_missing_name_is_syntax_error() {
        let e = err("TRUNCATE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_t11_truncate_restart_without_identity_is_syntax_error() {
        let e = err("TRUNCATE users RESTART");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_uppercase().contains("IDENTITY"));
    }

    #[test]
    fn ac_391_t12_truncate_cascade_then_restrict_is_syntax_error() {
        let e = err("TRUNCATE users CASCADE RESTRICT");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_t13_truncate_case_insensitive() {
        let s = ok_truncate("truncate table users cascade");
        assert_eq!(s.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_391_t_truncate_continue_without_identity_is_syntax_error() {
        let e = err("TRUNCATE users CONTINUE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_uppercase().contains("IDENTITY"));
    }

    #[test]
    fn ac_391_t_truncate_trailing_semicolon_accepted() {
        let s = ok_truncate("TRUNCATE TABLE users;");
        assert_eq!(s.table, "users");
    }

    // ── ALTER TABLE — AC-391-A ───────────────────────────────────────

    #[test]
    fn ac_391_a01_alter_drop_column_basic() {
        let s = ok_alter("ALTER TABLE users DROP COLUMN email");
        assert_eq!(s.table, "users");
        assert_eq!(
            s.action,
            AlterAction::DropColumn {
                column: "email".into(),
                if_exists: false,
                cascade: None,
            }
        );
    }

    #[test]
    fn ac_391_a02_alter_drop_column_cascade() {
        let s = ok_alter("ALTER TABLE users DROP COLUMN email CASCADE");
        assert_eq!(
            s.action,
            AlterAction::DropColumn {
                column: "email".into(),
                if_exists: false,
                cascade: Some(CascadeBehavior::Cascade),
            }
        );
    }

    #[test]
    fn ac_391_a03_alter_drop_column_if_exists() {
        let s = ok_alter("ALTER TABLE users DROP COLUMN IF EXISTS email");
        assert_eq!(
            s.action,
            AlterAction::DropColumn {
                column: "email".into(),
                if_exists: true,
                cascade: None,
            }
        );
    }

    #[test]
    fn ac_391_a04_alter_drop_column_if_exists_cascade() {
        let s = ok_alter("ALTER TABLE users DROP COLUMN IF EXISTS email CASCADE");
        assert_eq!(
            s.action,
            AlterAction::DropColumn {
                column: "email".into(),
                if_exists: true,
                cascade: Some(CascadeBehavior::Cascade),
            }
        );
    }

    #[test]
    fn ac_391_a05_alter_drop_column_restrict() {
        let s = ok_alter("ALTER TABLE users DROP COLUMN email RESTRICT");
        assert_eq!(
            s.action,
            AlterAction::DropColumn {
                column: "email".into(),
                if_exists: false,
                cascade: Some(CascadeBehavior::Restrict),
            }
        );
    }

    #[test]
    fn ac_391_a06_alter_drop_constraint_basic() {
        let s = ok_alter("ALTER TABLE users DROP CONSTRAINT users_pkey");
        assert_eq!(
            s.action,
            AlterAction::DropConstraint {
                constraint: "users_pkey".into(),
                cascade: None,
            }
        );
    }

    #[test]
    fn ac_391_a07_alter_drop_constraint_cascade() {
        let s = ok_alter("ALTER TABLE users DROP CONSTRAINT users_pkey CASCADE");
        assert_eq!(
            s.action,
            AlterAction::DropConstraint {
                constraint: "users_pkey".into(),
                cascade: Some(CascadeBehavior::Cascade),
            }
        );
    }

    #[test]
    fn ac_391_a08_alter_drop_constraint_restrict() {
        let s = ok_alter("ALTER TABLE users DROP CONSTRAINT users_pkey RESTRICT");
        assert_eq!(
            s.action,
            AlterAction::DropConstraint {
                constraint: "users_pkey".into(),
                cascade: Some(CascadeBehavior::Restrict),
            }
        );
    }

    #[test]
    fn ac_391_a09_alter_drop_index_mysql_style() {
        let s = ok_alter("ALTER TABLE users DROP INDEX idx_email");
        assert_eq!(
            s.action,
            AlterAction::DropIndex {
                index: "idx_email".into(),
            }
        );
    }

    #[test]
    fn ac_391_a10_alter_table_missing_name_is_syntax_error() {
        let e = err("ALTER TABLE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a11_alter_table_no_action_is_syntax_error() {
        let e = err("ALTER TABLE users");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a12_alter_table_drop_no_target_is_syntax_error() {
        let e = err("ALTER TABLE users DROP");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a13_alter_table_drop_column_missing_name_is_syntax_error() {
        let e = err("ALTER TABLE users DROP COLUMN");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a14_alter_table_add_column_is_unsupported() {
        let e = err("ALTER TABLE users ADD COLUMN x int");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_391_a_alter_missing_table_keyword_is_syntax_error() {
        // `ALTER VIEW v RENAME` etc. — sprint-391 only supports ALTER TABLE.
        let e = err("ALTER VIEW v RENAME TO w");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a_alter_case_insensitive() {
        let s = ok_alter("alter table users drop column email cascade");
        assert_eq!(s.table, "users");
        assert!(matches!(
            s.action,
            AlterAction::DropColumn {
                if_exists: false,
                cascade: Some(CascadeBehavior::Cascade),
                ..
            }
        ));
    }

    #[test]
    fn ac_391_a_alter_drop_constraint_missing_name_is_syntax_error() {
        let e = err("ALTER TABLE users DROP CONSTRAINT");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_391_a_alter_drop_index_missing_name_is_syntax_error() {
        let e = err("ALTER TABLE users DROP INDEX");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }
}
