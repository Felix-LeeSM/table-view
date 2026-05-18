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
    AlterAction, AlterTableStatement, BinaryOp, CascadeBehavior, Columns, CompareOp,
    DeleteStatement, DropObjectType, DropStatement, InsertSource, InsertStatement, InsertValue,
    Literal, OnConflict, ParseError, ParseErrorKind, ParseResult, SelectStatement, SqlLiteral,
    TruncateStatement, UpdateAssignment, UpdateStatement, WhereClause, WhereExpr,
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
            Token::Update => {
                self.advance();
                Ok(ParseResult::Update(self.parse_update()?))
            }
            Token::Delete => {
                self.advance();
                Ok(ParseResult::Delete(self.parse_delete()?))
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
                "expected SELECT/INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER at start",
            )),
        }
    }

    /// `SELECT` body — assumes the verb token has already been consumed.
    fn parse_select(&mut self) -> Result<SelectStatement, ParseError> {
        let columns = self.parse_columns()?;

        // FROM
        let from_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected FROM"))?;
        if from_tok.token != Token::From {
            return Err(syntax_err(
                Some(from_tok.at),
                "expected FROM",
            ));
        }
        self.advance();

        // table name
        let table_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name"))?;
        let table = match &table_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(table_tok.at),
                    "expected table ident",
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
            .ok_or_else(|| syntax_err(None, "expected object type"))?;
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
                    "expected object type",
                ));
            }
        };
        self.advance();

        // optional IF EXISTS
        let if_exists = self.consume_if_exists()?;

        // name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected object name"))?;
        let name = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected object ident",
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
            .ok_or_else(|| syntax_err(None, "expected table name"))?;
        let table = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected table ident",
                ));
            }
        };
        self.advance();

        // optional RESTART/CONTINUE IDENTITY
        let restart_identity = match self.peek().map(|t| &t.token) {
            Some(Token::Restart) => {
                self.advance();
                self.expect_keyword(Token::Identity, "expected IDENTITY")?;
                Some(true)
            }
            Some(Token::Continue) => {
                self.advance();
                self.expect_keyword(Token::Identity, "expected IDENTITY")?;
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
            "expected TABLE",
        )?;

        // table name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name"))?;
        let table = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(name_tok.at),
                    "expected table ident",
                ));
            }
        };
        self.advance();

        // action — only DROP is supported in sprint-391; everything else
        // is an unsupported statement (or syntax error if the token isn't
        // a recognised ALTER action keyword).
        let action_tok = self.peek().ok_or_else(|| {
            syntax_err(None, "expected action")
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
                    "ALTER TABLE ADD/RENAME"
                        .to_string(),
                at: Some(action_tok.at),
            }),
            _ => Err(syntax_err(
                Some(action_tok.at),
                "expected DROP",
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
                "expected COLUMN/CONSTRAINT/INDEX",
            )
        })?;
        match target_tok.token {
            Token::Column => {
                self.advance();
                let if_exists = self.consume_if_exists()?;
                let col_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected column name"))?;
                let column = match &col_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(col_tok.at),
                            "expected column ident",
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
                    syntax_err(None, "expected constraint name")
                })?;
                let constraint = match &c_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(c_tok.at),
                            "expected constraint ident",
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
                    .ok_or_else(|| syntax_err(None, "expected index name"))?;
                let index = match &i_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(
                            Some(i_tok.at),
                            "expected index ident",
                        ));
                    }
                };
                self.advance();
                Ok(AlterAction::DropIndex { index })
            }
            _ => Err(syntax_err(
                Some(target_tok.at),
                "expected COLUMN/CONSTRAINT/INDEX",
            )),
        }
    }

    // ---------------------------------------------------------------
    // Sprint 392 — DML write triad sub-parsers (INSERT / UPDATE / DELETE).
    // ---------------------------------------------------------------

    /// `INSERT INTO <table> [(cols)] (VALUES … | DEFAULT VALUES | SELECT …)
    ///  [ON CONFLICT …] [RETURNING …]`. Assumes `INSERT` has been
    /// consumed.
    fn parse_insert(&mut self) -> Result<InsertStatement, ParseError> {
        // INTO
        self.expect_keyword(
            Token::Into,
            "expected INTO",
        )?;

        // table name
        let table = self.expect_ident("expected table name")?;

        // optional `(col, col, …)`
        let columns = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            self.advance();
            let cols = self.parse_ident_list("expected column name")?;
            self.expect_token(Token::RParen, "expected ')'")?;
            cols
        } else {
            Vec::new()
        };

        // source — VALUES / DEFAULT VALUES / SELECT
        let source = match self.peek().map(|t| &t.token) {
            Some(Token::Values) => {
                self.advance();
                let rows = self.parse_values_rows()?;
                InsertSource::Values { rows }
            }
            Some(Token::Default) => {
                self.advance();
                self.expect_keyword(
                    Token::Values,
                    "expected VALUES",
                )?;
                InsertSource::DefaultValues
            }
            Some(Token::Select) => {
                self.advance();
                let select = self.parse_select()?;
                InsertSource::Select {
                    statement: Box::new(select),
                }
            }
            Some(_) | None => {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(
                    at,
                    "expected VALUES/SELECT",
                ));
            }
        };

        // optional ON CONFLICT
        let on_conflict = if matches!(self.peek().map(|t| &t.token), Some(Token::On)) {
            self.advance();
            self.expect_keyword(Token::Conflict, "expected CONFLICT")?;
            Some(self.parse_on_conflict_action()?)
        } else {
            None
        };

        // optional RETURNING
        let returning = self.parse_optional_returning()?;

        Ok(InsertStatement {
            table,
            columns,
            source,
            on_conflict,
            returning,
        })
    }

    /// `UPDATE <table> SET <col> = <value>[, …] [FROM …] [WHERE …]
    ///  [RETURNING …]`. Assumes `UPDATE` has been consumed.
    fn parse_update(&mut self) -> Result<UpdateStatement, ParseError> {
        let table = self.expect_ident("expected table name")?;

        self.expect_keyword(Token::Set, "expected SET")?;

        let assignments = self.parse_assignment_list()?;

        // optional FROM
        let from = if matches!(self.peek().map(|t| &t.token), Some(Token::From)) {
            self.advance();
            self.parse_ident_list("expected table name")?
        } else {
            Vec::new()
        };

        // optional WHERE
        let where_clause = self.parse_optional_where_expr()?;

        // optional RETURNING
        let returning = self.parse_optional_returning()?;

        Ok(UpdateStatement {
            table,
            assignments,
            from,
            where_clause,
            returning,
        })
    }

    /// `DELETE FROM <table> [USING …] [WHERE …] [RETURNING …]`. Assumes
    /// `DELETE` has been consumed.
    fn parse_delete(&mut self) -> Result<DeleteStatement, ParseError> {
        self.expect_keyword(Token::From, "expected FROM")?;
        let table = self.expect_ident("expected table name")?;

        // optional USING
        let using = if matches!(self.peek().map(|t| &t.token), Some(Token::Using)) {
            self.advance();
            self.parse_ident_list("expected table name")?
        } else {
            Vec::new()
        };

        let where_clause = self.parse_optional_where_expr()?;
        let returning = self.parse_optional_returning()?;

        Ok(DeleteStatement {
            table,
            using,
            where_clause,
            returning,
        })
    }

    /// `VALUES (row1), (row2), …`. The `VALUES` keyword has been
    /// consumed; this reads the parenthesised row tuples.
    fn parse_values_rows(&mut self) -> Result<Vec<Vec<InsertValue>>, ParseError> {
        let mut rows: Vec<Vec<InsertValue>> = Vec::new();
        loop {
            self.expect_token(Token::LParen, "expected '('")?;
            let mut row: Vec<InsertValue> = Vec::new();
            loop {
                row.push(self.parse_insert_value()?);
                match self.peek().map(|t| &t.token) {
                    Some(Token::Comma) => {
                        self.advance();
                        // Forbid trailing comma — `(1, 'a',)` is a syntax error.
                        if matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
                            let at = self.peek().map(|t| t.at);
                            return Err(syntax_err(at, "trailing ',' before ')'"));
                        }
                        continue;
                    }
                    Some(Token::RParen) => {
                        self.advance();
                        break;
                    }
                    Some(_) | None => {
                        let at = self.peek().map(|t| t.at);
                        return Err(syntax_err(
                            at,
                            "expected ',' or ')'",
                        ));
                    }
                }
            }
            rows.push(row);
            // Another row?
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(rows)
    }

    /// Parse a single value cell — literal, DEFAULT, or a placeholder.
    fn parse_insert_value(&mut self) -> Result<InsertValue, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected value"))?
            .clone();
        match tok.token {
            Token::Integer(v) => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::Integer { value: v },
                })
            }
            Token::Float(v) => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::Float { value: v },
                })
            }
            Token::String(s) => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::String { value: s },
                })
            }
            Token::Null => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::Null,
                })
            }
            Token::True => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::Boolean { value: true },
                })
            }
            Token::False => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::Boolean { value: false },
                })
            }
            Token::Default => {
                self.advance();
                Ok(InsertValue::Default)
            }
            Token::PlaceholderPositional(name) => {
                self.advance();
                Ok(InsertValue::Placeholder { name })
            }
            Token::PlaceholderAnonymous => {
                self.advance();
                Ok(InsertValue::Placeholder {
                    name: String::new(),
                })
            }
            Token::PlaceholderNamed(name) => {
                self.advance();
                Ok(InsertValue::Placeholder { name })
            }
            _ => Err(syntax_err(
                Some(tok.at),
                "expected value",
            )),
        }
    }

    /// `<col> = <value>[, <col> = <value>]*`. Used by UPDATE SET and
    /// ON CONFLICT DO UPDATE SET.
    fn parse_assignment_list(&mut self) -> Result<Vec<UpdateAssignment>, ParseError> {
        let mut out: Vec<UpdateAssignment> = Vec::new();
        loop {
            let column = self.expect_ident("expected column name")?;
            self.expect_token(Token::Eq, "expected '='")?;
            let value = self.parse_insert_value()?;
            out.push(UpdateAssignment { column, value });
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Parse `ON CONFLICT` action — `DO NOTHING` or `DO UPDATE SET … [WHERE …]`.
    /// The `ON CONFLICT` tokens have been consumed; the parser is
    /// positioned at `DO`.
    fn parse_on_conflict_action(&mut self) -> Result<OnConflict, ParseError> {
        self.expect_keyword(Token::Do, "expected DO")?;
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected NOTHING/UPDATE"))?
            .clone();
        match tok.token {
            Token::Nothing => {
                self.advance();
                Ok(OnConflict::DoNothing)
            }
            Token::Update => {
                self.advance();
                self.expect_keyword(
                    Token::Set,
                    "expected SET",
                )?;
                let set = self.parse_assignment_list()?;
                let where_clause = self.parse_optional_where_expr()?;
                Ok(OnConflict::DoUpdate { set, where_clause })
            }
            _ => Err(syntax_err(
                Some(tok.at),
                "expected NOTHING/UPDATE",
            )),
        }
    }

    /// Optional `RETURNING col1, col2, …` clause. Returns an empty vec
    /// when the keyword is absent.
    fn parse_optional_returning(&mut self) -> Result<Vec<String>, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::Returning)) {
            return Ok(Vec::new());
        }
        self.advance();
        self.parse_ident_list("expected column name")
    }

    /// Optional WHERE expression. Returns None when the keyword is absent.
    fn parse_optional_where_expr(&mut self) -> Result<Option<WhereExpr>, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::Where)) {
            return Ok(None);
        }
        self.advance();
        Ok(Some(self.parse_where_expr_or()?))
    }

    /// WHERE expression — OR precedence (lowest). `expr OR expr`.
    fn parse_where_expr_or(&mut self) -> Result<WhereExpr, ParseError> {
        let mut left = self.parse_where_expr_and()?;
        while matches!(self.peek().map(|t| &t.token), Some(Token::Or)) {
            self.advance();
            let right = self.parse_where_expr_and()?;
            left = WhereExpr::Or {
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    /// `expr AND expr`.
    fn parse_where_expr_and(&mut self) -> Result<WhereExpr, ParseError> {
        let mut left = self.parse_where_expr_not()?;
        while matches!(self.peek().map(|t| &t.token), Some(Token::And)) {
            self.advance();
            let right = self.parse_where_expr_not()?;
            left = WhereExpr::And {
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    /// `NOT expr` | primary.
    fn parse_where_expr_not(&mut self) -> Result<WhereExpr, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Not)) {
            self.advance();
            let inner = self.parse_where_expr_not()?;
            return Ok(WhereExpr::Not {
                inner: Box::new(inner),
            });
        }
        self.parse_where_expr_primary()
    }

    /// Primary expression — either a parenthesised sub-expression or a
    /// `column op literal` / `column IS [NOT] NULL` predicate.
    fn parse_where_expr_primary(&mut self) -> Result<WhereExpr, ParseError> {
        // Parenthesised expression
        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            self.advance();
            let inner = self.parse_where_expr_or()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(inner);
        }

        let col_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column ident"))?
            .clone();
        let column = match col_tok.token {
            Token::Ident(ref s) => s.clone(),
            _ => {
                return Err(syntax_err(
                    Some(col_tok.at),
                    "expected column ident",
                ));
            }
        };
        self.advance();

        // Reject qualified identifiers (`a.b`) — sprint-392 limits WHERE
        // to single-column comparisons. Cross-table comparison is a
        // sprint-393 widening.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            let at = self.peek().map(|t| t.at);
            return Err(unsupported_expression_err(
                at,
                "qualified column ref unsupported",
            ));
        }

        // `IS NULL` / `IS NOT NULL`
        if matches!(self.peek().map(|t| &t.token), Some(Token::Is)) {
            self.advance();
            let is_not = if matches!(self.peek().map(|t| &t.token), Some(Token::Not)) {
                self.advance();
                true
            } else {
                false
            };
            self.expect_keyword(
                Token::Null,
                "expected NULL",
            )?;
            return Ok(if is_not {
                WhereExpr::IsNotNull { column }
            } else {
                WhereExpr::IsNull { column }
            });
        }

        // `IN ( … )` — explicitly unsupported in sprint-392; surface as
        // UnsupportedExpression so caller can fall back to regex.
        if matches!(self.peek().map(|t| &t.token), Some(Token::In)) {
            let at = self.peek().map(|t| t.at);
            return Err(unsupported_expression_err(
                at,
                "IN-list unsupported",
            ));
        }

        // `col op value`
        let op_tok = self
            .peek()
            .ok_or_else(|| {
                syntax_err(None, "expected comparison op")
            })?
            .clone();
        let op = match op_tok.token {
            Token::Eq => CompareOp::Eq,
            Token::NotEq | Token::BangEq => CompareOp::Ne,
            Token::Lt => CompareOp::Lt,
            Token::LtEq => CompareOp::Le,
            Token::Gt => CompareOp::Gt,
            Token::GtEq => CompareOp::Ge,
            _ => {
                return Err(syntax_err(
                    Some(op_tok.at),
                    "expected comparison op",
                ));
            }
        };
        self.advance();

        // Sprint-392 forbids `col = col` (column-to-column). Detect the
        // first token of the RHS — if it's an identifier (with or without
        // a following `.`) surface as UnsupportedExpression. Literals /
        // placeholders / DEFAULT / NULL / TRUE / FALSE are accepted via
        // `parse_insert_value`.
        let rhs_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected value"))?;
        if matches!(rhs_tok.token, Token::Ident(_)) {
            let at = Some(rhs_tok.at);
            return Err(unsupported_expression_err(
                at,
                "column-to-column compare unsupported",
            ));
        }
        let value = self.parse_insert_value()?;

        Ok(WhereExpr::Comparison { column, op, value })
    }

    /// Helper — consume a comma-separated identifier list. Reads at
    /// least one identifier; bare empty lists are rejected by the
    /// caller's downstream check (`)` follows immediately).
    fn parse_ident_list(&mut self, msg: &str) -> Result<Vec<String>, ParseError> {
        let mut out: Vec<String> = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, msg))?
                .clone();
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
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, msg))?
            .clone();
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
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, msg))?;
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
            .ok_or_else(|| syntax_err(None, "expected column list"))?;
        if first.token == Token::Star {
            self.advance();
            return Ok(Columns::Star);
        }

        let mut names: Vec<String> = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected column ident"))?;
            match &tok.token {
                Token::Ident(name) => {
                    names.push(name.clone());
                    self.advance();
                }
                _ => {
                    return Err(syntax_err(Some(tok.at), "expected column ident"));
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
            .ok_or_else(|| syntax_err(None, "expected column ident"))?;
        let column = match &col_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(col_tok.at),
                    "expected column ident",
                ));
            }
        };
        self.advance();

        // op
        let op_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected comparison op"))?;
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
                    "expected comparison op",
                ));
            }
        };
        self.advance();

        // literal
        let lit_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected literal"))?;
        let literal = match &lit_tok.token {
            Token::Integer(v) => Literal::Integer { value: *v },
            Token::String(s) => Literal::String { value: s.clone() },
            _ => {
                return Err(syntax_err(
                    Some(lit_tok.at),
                    "expected literal",
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

/// Sprint-392 — the WHERE expression includes a construct outside the
/// narrow column-op-literal slice (function call, subquery, IN-list,
/// arithmetic, cross-table comparison, …). The parser surfaces this as
/// its own `ParseErrorKind` so the caller (sqlSafety) can fall back to
/// the regex heuristic without conflating it with a generic
/// `SyntaxError` (which is genuinely broken SQL).
fn unsupported_expression_err(at: Option<usize>, msg: &str) -> ParseError {
    ParseError {
        error_kind: ParseErrorKind::UnsupportedExpression,
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

/// Sprint-392 — the set of verbs whose grammar this crate actually
/// implements. Anything in `is_known_sql_verb` but not in here is an
/// `UnsupportedStatement`.
fn is_supported_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT" | "DROP" | "TRUNCATE" | "ALTER" | "INSERT" | "UPDATE" | "DELETE"
    )
}

fn unsupported_message(verb: &str) -> String {
    // Plain concat — `format!` is also fine since the panic infra
    // already brings in `fmt`. We keep this minimal but readable.
    let mut s = String::from("unsupported verb '");
    s.push_str(verb);
    s.push('\'');
    s
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

    // Sprint-392 — INSERT/UPDATE/DELETE are now supported. The
    // sprint-385 tests that asserted they were `UnsupportedStatement`
    // are inverted to assert successful parse + correct ParseResult
    // variant. The `UnsupportedStatement` path is still exercised by
    // verbs sprint-392 does not implement (CREATE / GRANT / REVOKE /
    // MERGE / REPLACE / WITH-prefixed statements).
    #[test]
    fn ac_p8_insert_is_now_supported_statement() {
        let r = parse("INSERT INTO users VALUES (1)");
        assert!(matches!(r, ParseResult::Insert(_)));
    }

    #[test]
    fn ac_p8_update_is_now_supported_statement() {
        let r = parse("UPDATE users SET name = 'x'");
        assert!(matches!(r, ParseResult::Update(_)));
    }

    #[test]
    fn ac_p8_delete_is_now_supported_statement() {
        let r = parse("DELETE FROM users");
        assert!(matches!(r, ParseResult::Delete(_)));
    }

    #[test]
    fn ac_p8_create_is_unsupported_statement() {
        let e = err("CREATE TABLE t (id int)");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p8_grant_is_unsupported_statement() {
        let e = err("GRANT SELECT ON users TO alice");
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

    // -----------------------------------------------------------------
    // Sprint 392 — DML write triad (INSERT / UPDATE / DELETE).
    // -----------------------------------------------------------------

    fn ok_insert(input: &str) -> InsertStatement {
        match parse(input) {
            ParseResult::Insert(i) => i,
            other => panic!("expected Insert, got: {:?}", other),
        }
    }

    fn ok_update(input: &str) -> UpdateStatement {
        match parse(input) {
            ParseResult::Update(u) => u,
            other => panic!("expected Update, got: {:?}", other),
        }
    }

    fn ok_delete(input: &str) -> DeleteStatement {
        match parse(input) {
            ParseResult::Delete(d) => d,
            other => panic!("expected Delete, got: {:?}", other),
        }
    }

    // ── INSERT — AC-392-I ────────────────────────────────────────────

    #[test]
    fn ac_392_i01_insert_minimal() {
        let s = ok_insert("INSERT INTO users VALUES (1, 'a')");
        assert_eq!(s.table, "users");
        assert!(s.columns.is_empty());
        match s.source {
            InsertSource::Values { rows } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].len(), 2);
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 1 }
                    }
                ));
                assert!(matches!(
                    &rows[0][1],
                    InsertValue::Literal { value: SqlLiteral::String { value } } if value == "a"
                ));
            }
            other => panic!("expected Values, got {:?}", other),
        }
        assert!(s.on_conflict.is_none());
        assert!(s.returning.is_empty());
    }

    #[test]
    fn ac_392_i02_insert_explicit_columns() {
        let s = ok_insert("INSERT INTO users (id, name) VALUES (1, 'a')");
        assert_eq!(s.columns, vec!["id".to_string(), "name".to_string()]);
    }

    #[test]
    fn ac_392_i03_insert_multi_row() {
        let s = ok_insert("INSERT INTO users VALUES (1, 'a'), (2, 'b')");
        match s.source {
            InsertSource::Values { rows } => {
                assert_eq!(rows.len(), 2);
                assert_eq!(rows[0].len(), 2);
                assert_eq!(rows[1].len(), 2);
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i04_insert_default_values() {
        let s = ok_insert("INSERT INTO users DEFAULT VALUES");
        assert!(matches!(s.source, InsertSource::DefaultValues));
    }

    #[test]
    fn ac_392_i05_insert_value_default_keyword() {
        let s = ok_insert("INSERT INTO users (id) VALUES (DEFAULT)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(rows[0][0], InsertValue::Default));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i06_insert_positional_placeholder() {
        let s = ok_insert("INSERT INTO users (id) VALUES ($1)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Placeholder { name } if name == "1"
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i07_insert_anonymous_placeholder() {
        let s = ok_insert("INSERT INTO users (id) VALUES (?)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Placeholder { name } if name.is_empty()
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i08_insert_named_placeholder() {
        let s = ok_insert("INSERT INTO users (id) VALUES (:name)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Placeholder { name } if name == "name"
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i09_insert_null_literal() {
        let s = ok_insert("INSERT INTO users VALUES (NULL)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Literal {
                        value: SqlLiteral::Null
                    }
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i10_insert_boolean_literal() {
        let s = ok_insert("INSERT INTO users VALUES (TRUE)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Literal {
                        value: SqlLiteral::Boolean { value: true }
                    }
                ));
            }
            _ => panic!("expected Values"),
        }
        // FALSE works the same way.
        let s = ok_insert("INSERT INTO users VALUES (FALSE)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Literal {
                        value: SqlLiteral::Boolean { value: false }
                    }
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    #[test]
    fn ac_392_i11_insert_select_source() {
        let s = ok_insert("INSERT INTO users (x) SELECT id FROM source");
        match s.source {
            InsertSource::Select { statement } => {
                assert_eq!(statement.table, "source");
                assert_eq!(
                    statement.columns,
                    Columns::Named {
                        names: vec!["id".into()]
                    }
                );
            }
            _ => panic!("expected Select source"),
        }
    }

    #[test]
    fn ac_392_i12_insert_on_conflict_do_nothing() {
        let s = ok_insert("INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING");
        assert!(matches!(s.on_conflict, Some(OnConflict::DoNothing)));
    }

    #[test]
    fn ac_392_i13_insert_on_conflict_do_update() {
        let s = ok_insert(
            "INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'",
        );
        match s.on_conflict {
            Some(OnConflict::DoUpdate { set, where_clause }) => {
                assert_eq!(set.len(), 1);
                assert_eq!(set[0].column, "name");
                assert!(matches!(
                    &set[0].value,
                    InsertValue::Literal { value: SqlLiteral::String { value } } if value == "a"
                ));
                assert!(where_clause.is_none());
            }
            _ => panic!("expected DoUpdate"),
        }
    }

    #[test]
    fn ac_392_i14_insert_returning() {
        let s = ok_insert("INSERT INTO users (id) VALUES (1) RETURNING id, name");
        assert_eq!(s.returning, vec!["id".to_string(), "name".to_string()]);
    }

    #[test]
    fn ac_392_i15_insert_without_source_is_syntax_error() {
        let e = err("INSERT INTO users");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_i16_insert_without_into_is_syntax_error() {
        let e = err("INSERT users VALUES (1)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_i17_insert_trailing_comma_in_values_is_syntax_error() {
        let e = err("INSERT INTO users VALUES (1, 'a',)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_i18_insert_case_insensitive() {
        let s = ok_insert("insert into users values (1)");
        assert_eq!(s.table, "users");
    }

    #[test]
    fn ac_392_i_insert_float_literal_in_values() {
        // 2.5 avoids clippy::approx_constant (3.14 ~ PI).
        let s = ok_insert("INSERT INTO measurements VALUES (2.5)");
        match s.source {
            InsertSource::Values { rows } => {
                assert!(matches!(
                    &rows[0][0],
                    InsertValue::Literal { value: SqlLiteral::Float { value } } if (*value - 2.5).abs() < f64::EPSILON
                ));
            }
            _ => panic!("expected Values"),
        }
    }

    // ── UPDATE — AC-392-U ────────────────────────────────────────────

    #[test]
    fn ac_392_u01_update_no_where() {
        let s = ok_update("UPDATE users SET name = 'a'");
        assert_eq!(s.table, "users");
        assert_eq!(s.assignments.len(), 1);
        assert_eq!(s.assignments[0].column, "name");
        assert!(s.where_clause.is_none());
        assert!(s.from.is_empty());
        assert!(s.returning.is_empty());
    }

    #[test]
    fn ac_392_u02_update_with_where_eq() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1");
        match s.where_clause {
            Some(WhereExpr::Comparison { column, op, value }) => {
                assert_eq!(column, "id");
                assert_eq!(op, CompareOp::Eq);
                assert!(matches!(
                    value,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 1 }
                    }
                ));
            }
            other => panic!("expected Comparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u03_update_multi_assignment() {
        let s = ok_update("UPDATE users SET name = 'a', age = 30");
        assert_eq!(s.assignments.len(), 2);
        assert_eq!(s.assignments[0].column, "name");
        assert_eq!(s.assignments[1].column, "age");
    }

    #[test]
    fn ac_392_u04_update_set_default() {
        let s = ok_update("UPDATE users SET name = DEFAULT");
        assert!(matches!(s.assignments[0].value, InsertValue::Default));
    }

    #[test]
    fn ac_392_u05_update_with_placeholders() {
        let s = ok_update("UPDATE users SET name = $1 WHERE id = $2");
        assert!(matches!(
            &s.assignments[0].value,
            InsertValue::Placeholder { name } if name == "1"
        ));
        match s.where_clause {
            Some(WhereExpr::Comparison { value, .. }) => {
                assert!(matches!(
                    value,
                    InsertValue::Placeholder { name } if name == "2"
                ));
            }
            _ => panic!("expected Comparison"),
        }
    }

    #[test]
    fn ac_392_u06_update_from_cross_table_where_is_unsupported_expression() {
        // FROM other parses OK; WHERE compares cross-table → UnsupportedExpression.
        let r = parse("UPDATE users SET name = 'a' FROM other WHERE other.id = users.id");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedExpression);
            }
            other => panic!("expected Error(UnsupportedExpression), got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u07_update_where_is_null() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id IS NULL");
        assert!(matches!(
            s.where_clause,
            Some(WhereExpr::IsNull { column }) if column == "id"
        ));
    }

    #[test]
    fn ac_392_u08_update_where_is_not_null() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id IS NOT NULL");
        assert!(matches!(
            s.where_clause,
            Some(WhereExpr::IsNotNull { column }) if column == "id"
        ));
    }

    #[test]
    fn ac_392_u09_update_where_and() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1 AND age > 30");
        assert!(matches!(s.where_clause, Some(WhereExpr::And { .. })));
    }

    #[test]
    fn ac_392_u10_update_where_or() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1 OR id = 2");
        assert!(matches!(s.where_clause, Some(WhereExpr::Or { .. })));
    }

    #[test]
    fn ac_392_u11_update_where_not_paren() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE NOT (id = 1)");
        match s.where_clause {
            Some(WhereExpr::Not { inner }) => {
                assert!(matches!(*inner, WhereExpr::Comparison { .. }));
            }
            other => panic!("expected Not(Comparison), got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u12_update_returning() {
        let s = ok_update("UPDATE users SET name = 'a' RETURNING id");
        assert_eq!(s.returning, vec!["id".to_string()]);
    }

    #[test]
    fn ac_392_u13_update_set_missing_is_syntax_error() {
        let e = err("UPDATE users SET");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_u14_update_missing_set_keyword_is_syntax_error() {
        let e = err("UPDATE users name = 'a'");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_u15_update_case_insensitive() {
        let s = ok_update("update users set name = 'a' where id = 1");
        assert_eq!(s.table, "users");
        assert!(s.where_clause.is_some());
    }

    #[test]
    fn ac_392_u_update_from_single_table_with_simple_where() {
        // FROM parses + WHERE with column-op-literal also parses cleanly.
        let s = ok_update("UPDATE users SET name = 'a' FROM other WHERE id = 1");
        assert_eq!(s.from, vec!["other".to_string()]);
        assert!(matches!(
            s.where_clause,
            Some(WhereExpr::Comparison { .. })
        ));
    }

    // ── DELETE — AC-392-D ────────────────────────────────────────────

    #[test]
    fn ac_392_d01_delete_no_where() {
        let s = ok_delete("DELETE FROM users");
        assert_eq!(s.table, "users");
        assert!(s.where_clause.is_none());
        assert!(s.using.is_empty());
        assert!(s.returning.is_empty());
    }

    #[test]
    fn ac_392_d02_delete_with_where() {
        let s = ok_delete("DELETE FROM users WHERE id = 1");
        assert!(matches!(
            s.where_clause,
            Some(WhereExpr::Comparison { .. })
        ));
    }

    #[test]
    fn ac_392_d03_delete_where_and() {
        let s = ok_delete("DELETE FROM users WHERE id = 1 AND age < 30");
        assert!(matches!(s.where_clause, Some(WhereExpr::And { .. })));
    }

    #[test]
    fn ac_392_d04_delete_using_cross_table_where_is_unsupported_expression() {
        let r = parse("DELETE FROM users USING orders WHERE orders.user_id = users.id");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedExpression);
            }
            other => panic!("expected UnsupportedExpression, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_d05_delete_where_is_null() {
        let s = ok_delete("DELETE FROM users WHERE name IS NULL");
        assert!(matches!(
            s.where_clause,
            Some(WhereExpr::IsNull { column }) if column == "name"
        ));
    }

    #[test]
    fn ac_392_d06_delete_where_in_list_is_unsupported_expression() {
        let r = parse("DELETE FROM users WHERE id IN (1, 2, 3)");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedExpression);
            }
            other => panic!("expected UnsupportedExpression, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_d07_delete_returning() {
        let s = ok_delete("DELETE FROM users RETURNING id");
        assert_eq!(s.returning, vec!["id".to_string()]);
    }

    #[test]
    fn ac_392_d08_delete_missing_from_is_syntax_error() {
        let e = err("DELETE users WHERE id = 1");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_d09_delete_no_table_is_syntax_error() {
        let e = err("DELETE FROM");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_392_d10_delete_case_insensitive() {
        let s = ok_delete("delete from users where id = 1");
        assert_eq!(s.table, "users");
        assert!(s.where_clause.is_some());
    }

    #[test]
    fn ac_392_d_delete_using_single_table_no_where() {
        // USING is OK by itself if no cross-table comparison follows.
        let s = ok_delete("DELETE FROM users USING orders");
        assert_eq!(s.using, vec!["orders".to_string()]);
    }

    // ── Serialization — AC-392-S ─────────────────────────────────────

    #[test]
    fn ac_392_s01_insert_serializes_with_kind_insert() {
        let r = parse("INSERT INTO users VALUES (1, 'a')");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "insert");
        assert_eq!(json["table"], "users");
        assert_eq!(json["source"]["kind"], "values");
    }

    #[test]
    fn ac_392_s02_update_serializes_with_kind_update() {
        let r = parse("UPDATE users SET name = 'a' WHERE id = 1");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "update");
        assert_eq!(json["table"], "users");
        assert_eq!(json["where_clause"]["kind"], "comparison");
    }

    #[test]
    fn ac_392_s03_delete_serializes_with_kind_delete() {
        let r = parse("DELETE FROM users WHERE id = 1");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "delete");
        assert_eq!(json["table"], "users");
    }

    #[test]
    fn ac_392_s04_where_comparison_serializes_with_kind_comparison() {
        let r = parse("DELETE FROM users WHERE id = 1");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["where_clause"]["kind"], "comparison");
        assert_eq!(json["where_clause"]["column"], "id");
        assert_eq!(json["where_clause"]["op"], "eq");
    }

    #[test]
    fn ac_392_s05_where_and_nested_round_trips() {
        let r = parse("UPDATE users SET name = 'a' WHERE id = 1 AND age > 30");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_392_s06_insert_null_literal_serializes_nested_kind() {
        let r = parse("INSERT INTO users VALUES (NULL)");
        let json = serde_json::to_value(&r).expect("serialize");
        let v = &json["source"]["rows"][0][0];
        assert_eq!(v["kind"], "literal");
        assert_eq!(v["value"]["kind"], "null");
    }

    #[test]
    fn ac_392_s07_insert_round_trips_through_serde_json() {
        let r = parse(
            "INSERT INTO users (id, name) VALUES (1, 'a'), (2, 'b') ON CONFLICT DO NOTHING RETURNING id",
        );
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_392_s_update_round_trips_through_serde_json() {
        let r = parse("UPDATE users SET name = 'a' FROM other WHERE id = 1 RETURNING id");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_392_s_delete_round_trips_through_serde_json() {
        let r = parse("DELETE FROM users USING orders WHERE id = 1 RETURNING id");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_392_s_unsupported_expression_serializes_with_error_kind() {
        let r = parse("DELETE FROM users WHERE id IN (1, 2, 3)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "error");
        assert_eq!(json["error_kind"], "unsupported-expression");
    }
}
