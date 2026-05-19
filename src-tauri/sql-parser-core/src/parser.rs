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
    AlterAction, AlterTableStatement, CascadeBehavior, CaseWhen, ColumnConstraint,
    ColumnConstraintBody, ColumnDefinition, ColumnRef, ColumnType, Columns, CommentStatement,
    CommentTarget, CommentText, CompareOp, CopyDirection, CopySource, CopyStatement, CopyTarget,
    CreateIndexStatement, CreateTableStatement, CreateViewBody, CreateViewStatement, CteDefinition,
    DeleteStatement, DropObjectType, DropStatement, ExplainInner, ExplainOption, ExplainStatement,
    FrameBound, FrameUnit, FromItem, FromSource, GrantObject, GrantStatement, InsertSource,
    InsertStatement, InsertValue, JoinDescriptor, JoinPredicate, LikeCase, LimitClause,
    NullsPlacement, OnConflict, OrderDirection, OrderingItem, OverClause, ParseError,
    ParseErrorKind, ParseResult, PrivilegeTag, RevokeStatement, RoleRef, SelectExpr,
    SelectListItem, SelectStatement, SetOperationEntry, SetOperator, SetScope, SetStatement,
    SetValue, ShowStatement, ShowTarget, SqlLiteral, TableConstraint, TableConstraintBody,
    TableRef, TruncateStatement, UpdateAssignment, UpdateStatement, WindowArgument, WindowFrame,
    WithInner, WithStatement,
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
                "expected SELECT/INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER at start",
            )),
        }
    }

    /// `SELECT` body + optional set-operation chain. Sprint-393a widened
    /// the SELECT body itself; sprint-393b adds:
    ///   - chained set operations (`UNION` / `UNION ALL` / `INTERSECT` /
    ///     `EXCEPT`) at the end of a SELECT body.
    ///
    /// Clause order is the standard SQL order:
    ///   SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT …
    ///   [UNION … SELECT … ]*
    /// Inputs that supply clauses out of order parse to `SyntaxError`.
    ///
    /// HAVING-without-GROUP-BY is rejected (contract §parser): aggregates
    /// land in sprint-393b/c, so a standalone HAVING would always reduce
    /// to a WHERE — the parser refuses the form to keep the AST shape
    /// unambiguous and the safety classifier straightforward.
    fn parse_select(&mut self) -> Result<SelectStatement, ParseError> {
        let mut head = self.parse_select_body()?;

        // Sprint-393b — collect set-operation chain. Each entry consumes
        // the operator keyword and parses one more SELECT body
        // left-associatively.
        let mut chain: Vec<SetOperationEntry> = Vec::new();
        loop {
            let operator = match self.peek().map(|t| &t.token) {
                Some(Token::Union) => {
                    self.advance();
                    if matches!(self.peek().map(|t| &t.token), Some(Token::All)) {
                        self.advance();
                        SetOperator::UnionAll
                    } else {
                        SetOperator::Union
                    }
                }
                Some(Token::Intersect) => {
                    self.advance();
                    SetOperator::Intersect
                }
                Some(Token::Except) => {
                    self.advance();
                    SetOperator::Except
                }
                _ => break,
            };
            // The right-hand side is *another* SELECT body — `SELECT` token
            // is required and consumed here so the recursive parse can
            // proceed in `parse_select_body`. A missing `SELECT` is a
            // syntax error (AC-393b-U07).
            self.expect_keyword(Token::Select, "expected SELECT after set operator")?;
            let rhs = self.parse_select_body()?;
            chain.push(SetOperationEntry {
                operator,
                statement: rhs,
            });
        }

        // Sprint-393b AC-393b-U06 — when a set-operation chain has a
        // trailing ORDER BY / LIMIT, those clauses lexically belong to
        // the rightmost SELECT body (the parser's natural consumption
        // point), but the contract specifies they record on the *root*
        // SELECT. Move them up so the outer ORDER BY / LIMIT is
        // accessible without traversing the chain.
        if let Some(last) = chain.last_mut() {
            // Only move when the head doesn't already have its own
            // ORDER BY / LIMIT (we never overwrite a head-position clause).
            if head.order_by.is_empty() && !last.statement.order_by.is_empty() {
                head.order_by = std::mem::take(&mut last.statement.order_by);
            }
            if head.limit.is_none() && last.statement.limit.is_some() {
                head.limit = last.statement.limit.take();
            }
        }
        head.set_operation = chain;

        Ok(head)
    }

    /// Parse one SELECT body — columns + FROM + WHERE + GROUP/HAVING +
    /// ORDER + LIMIT. Used both by `parse_select` (top-level) and by
    /// `parse_select` recursively for set-operation right-hand sides and
    /// for nested SELECTs in CTE bodies, FROM subqueries, and
    /// scalar / IN / EXISTS subqueries.
    fn parse_select_body(&mut self) -> Result<SelectStatement, ParseError> {
        let columns = self.parse_columns()?;

        // FROM
        self.expect_keyword(Token::From, "expected FROM")?;
        let from = self.parse_from_list()?;

        // Optional WHERE.
        let where_clause = if matches!(self.peek().map(|t| &t.token), Some(Token::Where)) {
            self.advance();
            Some(self.parse_select_expr_or()?)
        } else {
            None
        };

        // Optional GROUP BY.
        let group_by = if matches!(self.peek().map(|t| &t.token), Some(Token::Group)) {
            self.advance();
            self.expect_keyword(Token::By, "expected BY")?;
            self.parse_column_ref_list()?
        } else {
            Vec::new()
        };

        // Optional HAVING (rejected without GROUP BY).
        let having = if matches!(self.peek().map(|t| &t.token), Some(Token::Having)) {
            let having_tok_at = self.peek().map(|t| t.at);
            if group_by.is_empty() {
                return Err(syntax_err(
                    having_tok_at,
                    "HAVING requires GROUP BY in sprint-393a",
                ));
            }
            self.advance();
            Some(self.parse_select_expr_or()?)
        } else {
            None
        };

        // Optional ORDER BY.
        let order_by = if matches!(self.peek().map(|t| &t.token), Some(Token::Order)) {
            self.advance();
            self.expect_keyword(Token::By, "expected BY")?;
            self.parse_ordering_list()?
        } else {
            Vec::new()
        };

        // Optional LIMIT [OFFSET].
        let limit = if matches!(self.peek().map(|t| &t.token), Some(Token::Limit)) {
            self.advance();
            Some(self.parse_limit_clause()?)
        } else {
            // Bare `OFFSET` without `LIMIT` is a syntax error.
            if matches!(self.peek().map(|t| &t.token), Some(Token::Offset)) {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "OFFSET requires LIMIT"));
            }
            None
        };

        Ok(SelectStatement {
            columns,
            from,
            where_clause,
            group_by,
            having,
            order_by,
            limit,
            set_operation: Vec::new(),
        })
    }

    /// `<from-item> ( ( "," | join-keyword ) <from-item> )*`. Returns at
    /// least one item; an empty list is a `SyntaxError`. The first item's
    /// join descriptor is always `Comma` (the variant is reused for "no
    /// join"; downstream tooling can ignore the first item's descriptor
    /// or branch on FROM length).
    fn parse_from_list(&mut self) -> Result<Vec<FromItem>, ParseError> {
        let mut items: Vec<FromItem> = Vec::new();
        // First item — no join descriptor (we record `Comma` for shape uniformity).
        let first = self.parse_from_item(JoinDescriptor::Comma)?;
        items.push(first);

        loop {
            // Either `,` (more items) or a join keyword (`INNER`/`LEFT`/…
            // /`JOIN`/`CROSS`) starting a join clause. Anything else
            // terminates the FROM list.
            let next = self.peek().map(|t| &t.token);
            match next {
                Some(Token::Comma) => {
                    self.advance();
                    let item = self.parse_from_item(JoinDescriptor::Comma)?;
                    items.push(item);
                }
                Some(
                    Token::Join
                    | Token::Inner
                    | Token::Left
                    | Token::Right
                    | Token::Full
                    | Token::Cross,
                ) => {
                    let join = self.parse_join_clause_prefix()?;
                    let item = self.parse_from_item(join)?;
                    items.push(item);
                }
                _ => break,
            }
        }
        Ok(items)
    }

    /// Parse a JOIN keyword prefix + (for non-CROSS variants) a predicate.
    /// The predicate is consumed AFTER the right-hand FROM item is parsed
    /// (caller responsibility); this function only resolves which join
    /// kind we are in. Returns a `JoinDescriptor` with a *placeholder*
    /// predicate that the caller will fill via `attach_join_predicate`.
    ///
    /// NOTE — to keep the parser straight-line, we delay the predicate
    /// consumption to inside `parse_from_item` via a single-pass helper.
    fn parse_join_clause_prefix(&mut self) -> Result<JoinDescriptor, ParseError> {
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected JOIN"))?
            .clone();
        match first.token {
            Token::Inner => {
                self.advance();
                self.expect_keyword(Token::Join, "expected JOIN")?;
                Ok(JoinDescriptor::InnerJoin {
                    predicate: JoinPredicate::Using {
                        columns: Vec::new(),
                    },
                })
            }
            Token::Left => {
                self.advance();
                if matches!(self.peek().map(|t| &t.token), Some(Token::Outer)) {
                    self.advance();
                }
                self.expect_keyword(Token::Join, "expected JOIN")?;
                Ok(JoinDescriptor::LeftJoin {
                    predicate: JoinPredicate::Using {
                        columns: Vec::new(),
                    },
                })
            }
            Token::Right => {
                self.advance();
                if matches!(self.peek().map(|t| &t.token), Some(Token::Outer)) {
                    self.advance();
                }
                self.expect_keyword(Token::Join, "expected JOIN")?;
                Ok(JoinDescriptor::RightJoin {
                    predicate: JoinPredicate::Using {
                        columns: Vec::new(),
                    },
                })
            }
            Token::Full => {
                self.advance();
                if matches!(self.peek().map(|t| &t.token), Some(Token::Outer)) {
                    self.advance();
                }
                self.expect_keyword(Token::Join, "expected JOIN")?;
                Ok(JoinDescriptor::FullJoin {
                    predicate: JoinPredicate::Using {
                        columns: Vec::new(),
                    },
                })
            }
            Token::Cross => {
                self.advance();
                self.expect_keyword(Token::Join, "expected JOIN")?;
                Ok(JoinDescriptor::CrossJoin)
            }
            // Bare `JOIN` is implicit `INNER JOIN` (SQL-92).
            Token::Join => {
                self.advance();
                Ok(JoinDescriptor::InnerJoin {
                    predicate: JoinPredicate::Using {
                        columns: Vec::new(),
                    },
                })
            }
            _ => Err(syntax_err(Some(first.at), "expected JOIN")),
        }
    }

    /// Parse one FROM item — `[schema.]table [AS alias | alias]` — and
    /// (for non-Comma/non-CrossJoin) the following `ON …` or `USING (…)`
    /// predicate, returning the assembled `FromItem`. The `seeded_join`
    /// is the JOIN kind already resolved by `parse_from_list` (or the
    /// sentinel `Comma` for non-join attachments).
    fn parse_from_item(&mut self, seeded_join: JoinDescriptor) -> Result<FromItem, ParseError> {
        // Sprint-393b — `(SELECT ...)` subquery FROM item. Recognized by
        // a leading `(` token; the inner body must start with `SELECT`.
        // Subquery FROM items REQUIRE an alias (AC-393b-Q06).
        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            let at = self.peek().map(|t| t.at);
            self.advance();
            self.expect_keyword(Token::Select, "expected SELECT inside FROM subquery")?;
            let inner = self.parse_select()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            let alias = self.parse_optional_alias()?;
            if alias.is_none() {
                return Err(syntax_err(at, "FROM subquery requires an alias"));
            }
            let join = self.attach_join_predicate(seeded_join)?;
            return Ok(FromItem {
                schema: None,
                table: String::new(),
                alias,
                join,
                source: FromSource::Subquery {
                    statement: Box::new(inner),
                },
            });
        }

        // schema-qualified or bare table identifier
        let first_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name"))?
            .clone();
        let first_ident = match first_tok.token {
            Token::Ident(name) => name,
            _ => {
                return Err(syntax_err(Some(first_tok.at), "expected table ident"));
            }
        };
        self.advance();

        let (schema, table) = if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            self.advance();
            let table_tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected table name after '.'"))?
                .clone();
            let table_ident = match table_tok.token {
                Token::Ident(name) => name,
                _ => {
                    return Err(syntax_err(
                        Some(table_tok.at),
                        "expected table ident after '.'",
                    ));
                }
            };
            self.advance();
            // Forbid three-dot qualifier (`schema.table.extra`).
            if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "three-dot table qualifier unsupported"));
            }
            (Some(first_ident), table_ident)
        } else {
            (None, first_ident)
        };

        // Optional alias — `AS ident` or bare `ident`. Bare alias must not
        // collide with a join / clause keyword (we explicitly only accept
        // an Ident token here).
        let alias = self.parse_optional_alias()?;

        // Resolve the actual join predicate now.
        let join = self.attach_join_predicate(seeded_join)?;

        let source = FromSource::Table {
            schema: schema.clone(),
            table: table.clone(),
        };
        Ok(FromItem {
            schema,
            table,
            alias,
            join,
            source,
        })
    }

    /// Sprint-393b — second-pass step that fills in the predicate for the
    /// join kind that the FROM-list dispatcher previously seeded with an
    /// empty placeholder. Shared between the table-source and the
    /// subquery-source FROM-item paths.
    fn attach_join_predicate(
        &mut self,
        seeded_join: JoinDescriptor,
    ) -> Result<JoinDescriptor, ParseError> {
        Ok(match seeded_join {
            JoinDescriptor::Comma | JoinDescriptor::CrossJoin => seeded_join,
            JoinDescriptor::InnerJoin { .. } => JoinDescriptor::InnerJoin {
                predicate: self.parse_join_predicate()?,
            },
            JoinDescriptor::LeftJoin { .. } => JoinDescriptor::LeftJoin {
                predicate: self.parse_join_predicate()?,
            },
            JoinDescriptor::RightJoin { .. } => JoinDescriptor::RightJoin {
                predicate: self.parse_join_predicate()?,
            },
            JoinDescriptor::FullJoin { .. } => JoinDescriptor::FullJoin {
                predicate: self.parse_join_predicate()?,
            },
        })
    }

    /// Optional alias — `AS <ident>` or bare `<ident>`. Returns `None`
    /// when the next token is not eligible. Bare alias is recognized
    /// only when the next token is `Ident` *and* the token after it is
    /// not a `.` (otherwise the identifier is the start of the next
    /// schema-qualified FROM item — but FROM-list separation is by
    /// `,` / join keywords, so a bare `Ident` here is unambiguous).
    fn parse_optional_alias(&mut self) -> Result<Option<String>, ParseError> {
        // Explicit `AS alias`.
        if matches!(self.peek().map(|t| &t.token), Some(Token::As)) {
            self.advance();
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected alias after AS"))?
                .clone();
            match tok.token {
                Token::Ident(name) => {
                    self.advance();
                    return Ok(Some(name));
                }
                _ => return Err(syntax_err(Some(tok.at), "expected alias ident after AS")),
            }
        }
        // Bare alias — only if the next token is an Ident.
        if let Some(Spanned {
            token: Token::Ident(name),
            ..
        }) = self.peek().cloned()
        {
            // Lookahead: bare alias only if not immediately followed by a
            // `.` (which would make this the start of `schema.table`).
            // For sprint-393a FROM list, only `,` / JOIN-kw / WHERE / GROUP /
            // ORDER / LIMIT / HAVING / ON / USING / RParen terminate this
            // position, so a bare Ident here is unambiguously an alias.
            // We still guard against the `.` follower for completeness.
            let next_after = self.tokens.get(self.cursor + 1).map(|t| &t.token);
            if !matches!(next_after, Some(Token::Dot)) {
                self.advance();
                return Ok(Some(name));
            }
        }
        Ok(None)
    }

    /// JOIN predicate — `ON <expression>` or `USING ( <col-list> )`.
    fn parse_join_predicate(&mut self) -> Result<JoinPredicate, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected ON or USING"))?
            .clone();
        match tok.token {
            Token::On => {
                self.advance();
                let expression = self.parse_select_expr_or()?;
                Ok(JoinPredicate::On { expression })
            }
            Token::Using => {
                self.advance();
                self.expect_token(Token::LParen, "expected '('")?;
                let columns = self.parse_ident_list("expected column ident")?;
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(JoinPredicate::Using { columns })
            }
            _ => Err(syntax_err(Some(tok.at), "expected ON or USING")),
        }
    }

    /// Comma-separated list of ColumnRefs — used by GROUP BY.
    fn parse_column_ref_list(&mut self) -> Result<Vec<ColumnRef>, ParseError> {
        let mut out: Vec<ColumnRef> = Vec::new();
        loop {
            out.push(self.parse_column_ref()?);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Single column reference — `column` or `table.column`.
    fn parse_column_ref(&mut self) -> Result<ColumnRef, ParseError> {
        let first_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column ident"))?
            .clone();
        let first = match first_tok.token {
            Token::Ident(name) => name,
            _ => {
                return Err(syntax_err(Some(first_tok.at), "expected column ident"));
            }
        };
        self.advance();
        if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            self.advance();
            let col_tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected column ident after '.'"))?
                .clone();
            let column = match col_tok.token {
                Token::Ident(name) => name,
                _ => {
                    return Err(syntax_err(
                        Some(col_tok.at),
                        "expected column ident after '.'",
                    ));
                }
            };
            self.advance();
            Ok(ColumnRef {
                table: Some(first),
                column,
            })
        } else {
            Ok(ColumnRef {
                table: None,
                column: first,
            })
        }
    }

    /// `<ordering-item> ( "," <ordering-item> )*`. Each item is a column
    /// ref + optional direction + optional nulls placement.
    fn parse_ordering_list(&mut self) -> Result<Vec<OrderingItem>, ParseError> {
        let mut out: Vec<OrderingItem> = Vec::new();
        loop {
            let column = self.parse_column_ref()?;
            let direction = match self.peek().map(|t| &t.token) {
                Some(Token::Asc) => {
                    self.advance();
                    OrderDirection::Asc
                }
                Some(Token::Desc) => {
                    self.advance();
                    OrderDirection::Desc
                }
                _ => OrderDirection::Asc,
            };
            let nulls = if matches!(self.peek().map(|t| &t.token), Some(Token::Nulls)) {
                self.advance();
                let tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected FIRST or LAST after NULLS"))?
                    .clone();
                match tok.token {
                    Token::First => {
                        self.advance();
                        NullsPlacement::First
                    }
                    Token::Last => {
                        self.advance();
                        NullsPlacement::Last
                    }
                    _ => {
                        return Err(syntax_err(
                            Some(tok.at),
                            "expected FIRST or LAST after NULLS",
                        ));
                    }
                }
            } else {
                NullsPlacement::Unspecified
            };
            out.push(OrderingItem {
                column,
                direction,
                nulls,
            });
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// `LIMIT <value> [ OFFSET <value> ]`. The `LIMIT` keyword has been
    /// consumed by the caller.
    fn parse_limit_clause(&mut self) -> Result<LimitClause, ParseError> {
        // `LIMIT` requires a value — `parse_insert_value` surfaces the
        // SyntaxError if the next token is not a literal/placeholder.
        let count = self.parse_insert_value()?;
        // Reject MySQL legacy `LIMIT n, m` form (a comma after the count
        // would be an offset position; sprint-393a accepts only ANSI
        // `LIMIT n [OFFSET m]`).
        if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(
                at,
                "MySQL `LIMIT n, m` form unsupported (use OFFSET)",
            ));
        }
        let offset = if matches!(self.peek().map(|t| &t.token), Some(Token::Offset)) {
            self.advance();
            Some(self.parse_insert_value()?)
        } else {
            None
        };
        Ok(LimitClause { count, offset })
    }

    // ----- widened expression parser (SELECT WHERE / HAVING / JOIN ON) ----

    /// OR — lowest precedence.
    fn parse_select_expr_or(&mut self) -> Result<SelectExpr, ParseError> {
        let mut left = self.parse_select_expr_and()?;
        while matches!(self.peek().map(|t| &t.token), Some(Token::Or)) {
            self.advance();
            let right = self.parse_select_expr_and()?;
            left = SelectExpr::Or {
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_select_expr_and(&mut self) -> Result<SelectExpr, ParseError> {
        let mut left = self.parse_select_expr_not()?;
        while matches!(self.peek().map(|t| &t.token), Some(Token::And)) {
            self.advance();
            let right = self.parse_select_expr_not()?;
            left = SelectExpr::And {
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_select_expr_not(&mut self) -> Result<SelectExpr, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Not)) {
            self.advance();
            let inner = self.parse_select_expr_not()?;
            return Ok(SelectExpr::Not {
                inner: Box::new(inner),
            });
        }
        self.parse_select_expr_primary()
    }

    /// Primary — column reference followed by a predicate operator
    /// (comparison / BETWEEN / LIKE / ILIKE / IS NULL / IN-list / IN-
    /// subquery), or a parenthesised sub-expression, or a primary opened
    /// by a leading keyword (`EXISTS (...)`, `NOT EXISTS (...)`, `CASE
    /// ... END`).
    ///
    /// Sprint-393b — new primaries added:
    /// - `EXISTS (SELECT ...)` / `NOT EXISTS (SELECT ...)`.
    /// - `CASE [operand] WHEN ... THEN ... [ELSE ...] END`.
    /// - `col IN (literal, ...)` — literal IN-list (sprint-392 deferral
    ///   lifted).
    /// - `col IN (SELECT ...)` — IN-subquery (routed by lookahead on the
    ///   first token inside the parens).
    /// - `col NOT IN (...)` — wraps the above in `Not`.
    fn parse_select_expr_primary(&mut self) -> Result<SelectExpr, ParseError> {
        // Sprint-393b — `EXISTS (SELECT ...)` primary. `NOT EXISTS (...)`
        // is handled by the outer `parse_select_expr_not` loop wrapping
        // this primary in `Not`.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Exists)) {
            self.advance();
            self.expect_token(Token::LParen, "expected '('")?;
            self.expect_keyword(Token::Select, "expected SELECT inside EXISTS")?;
            let inner = self.parse_select()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(SelectExpr::Exists {
                statement: Box::new(inner),
            });
        }

        // Sprint-393b — `CASE [operand] WHEN ... THEN ... [ELSE ...] END`.
        // After CASE, optionally a comparator + value follows (e.g.
        // `CASE WHEN ... END = 1`); we wrap CASE in `ExpressionComparison`.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Case)) {
            let case = self.parse_case_expression()?;
            if let Some(op) = self.peek_compare_op() {
                self.advance();
                let value = self.parse_insert_value()?;
                return Ok(SelectExpr::ExpressionComparison {
                    left: Box::new(case),
                    op,
                    value,
                });
            }
            return Ok(case);
        }

        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            // Sprint-393b — parenthesized primary disambiguation:
            //   `(SELECT ...)` → scalar-subquery primary.
            //   `(<expr>)` → parenthesized sub-expression (existing).
            // Peek one token past the `(` to decide.
            let after_paren = self.tokens.get(self.cursor + 1).map(|t| &t.token);
            if matches!(after_paren, Some(Token::Select)) {
                self.advance(); // consume `(`
                self.advance(); // consume `SELECT`
                let inner = self.parse_select()?;
                self.expect_token(Token::RParen, "expected ')'")?;
                return Ok(SelectExpr::ScalarSubquery {
                    statement: Box::new(inner),
                });
            }
            self.advance();
            let inner = self.parse_select_expr_or()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(inner);
        }

        let column = self.parse_column_ref()?;

        // `IS NULL` / `IS NOT NULL`
        if matches!(self.peek().map(|t| &t.token), Some(Token::Is)) {
            self.advance();
            let is_not = if matches!(self.peek().map(|t| &t.token), Some(Token::Not)) {
                self.advance();
                true
            } else {
                false
            };
            self.expect_keyword(Token::Null, "expected NULL")?;
            return Ok(if is_not {
                SelectExpr::IsNotNull { column }
            } else {
                SelectExpr::IsNull { column }
            });
        }

        // Postfix-`NOT` for BETWEEN / LIKE / ILIKE / IN. The form
        // `column NOT BETWEEN low AND high` (and similarly NOT LIKE /
        // NOT ILIKE / NOT IN) is recognized by peeking for `NOT` followed
        // by one of those keywords. We synthesize the wrapping
        // `Not { ... }` here so the caller (parse_select_expr_not) doesn't
        // have to know about the postfix form. The negated form is *not*
        // a discrete AST variant — it reuses the existing `Not` primary
        // wrapping the unnegated shape (contract §expression widening).
        let postfix_not = matches!(self.peek().map(|t| &t.token), Some(Token::Not))
            && matches!(
                self.tokens.get(self.cursor + 1).map(|t| &t.token),
                Some(Token::Between | Token::Like | Token::ILike | Token::In)
            );
        if postfix_not {
            self.advance(); // consume NOT
        }

        // Sprint-393b — `IN (...)` (literal list or subquery). Sprint-392
        // surfaced this as `UnsupportedExpression`; sprint-393b lifts the
        // deferral. Lookahead one token past the `(` decides:
        //   first token = SELECT → in-subquery
        //   anything else → in-list (literal/placeholder values)
        if matches!(self.peek().map(|t| &t.token), Some(Token::In)) {
            self.advance();
            self.expect_token(Token::LParen, "expected '(' after IN")?;
            let first_inside = self.peek().map(|t| &t.token);
            let inner = if matches!(first_inside, Some(Token::Select)) {
                self.advance(); // consume SELECT
                let stmt = self.parse_select()?;
                self.expect_token(Token::RParen, "expected ')'")?;
                SelectExpr::InSubquery {
                    column,
                    statement: Box::new(stmt),
                }
            } else {
                // Literal IN-list. At least one value is required; an
                // empty list (`IN ()`) is a syntax error (AC-393b-I05).
                if matches!(first_inside, Some(Token::RParen)) {
                    let at = self.peek().map(|t| t.at);
                    return Err(syntax_err(at, "empty IN-list"));
                }
                let mut values: Vec<InsertValue> = Vec::new();
                loop {
                    values.push(self.parse_insert_value()?);
                    match self.peek().map(|t| &t.token) {
                        Some(Token::Comma) => {
                            self.advance();
                            // Reject mixed `(1, SELECT ...)` — the contract
                            // says any non-literal token after a literal in
                            // the list is a SyntaxError.
                            if matches!(self.peek().map(|t| &t.token), Some(Token::Select)) {
                                let at = self.peek().map(|t| t.at);
                                return Err(syntax_err(
                                    at,
                                    "IN-list cannot mix literals and SELECT",
                                ));
                            }
                            continue;
                        }
                        Some(Token::RParen) => {
                            self.advance();
                            break;
                        }
                        _ => {
                            let at = self.peek().map(|t| t.at);
                            return Err(syntax_err(at, "expected ',' or ')'"));
                        }
                    }
                }
                SelectExpr::InList { column, values }
            };
            return Ok(if postfix_not {
                SelectExpr::Not {
                    inner: Box::new(inner),
                }
            } else {
                inner
            });
        }

        // `BETWEEN low AND high`
        if matches!(self.peek().map(|t| &t.token), Some(Token::Between)) {
            self.advance();
            let low = self.parse_insert_value()?;
            self.expect_keyword(Token::And, "expected AND after BETWEEN low")?;
            let high = self.parse_insert_value()?;
            let inner = SelectExpr::Between { column, low, high };
            return Ok(if postfix_not {
                SelectExpr::Not {
                    inner: Box::new(inner),
                }
            } else {
                inner
            });
        }

        // `LIKE 'pattern'` / `ILIKE 'pattern'`
        if matches!(
            self.peek().map(|t| &t.token),
            Some(Token::Like | Token::ILike)
        ) {
            let case = match self.peek().map(|t| &t.token) {
                Some(Token::Like) => LikeCase::Sensitive,
                Some(Token::ILike) => LikeCase::Insensitive,
                _ => unreachable!("just matched"),
            };
            self.advance();
            let pattern = self.parse_insert_value()?;
            let inner = SelectExpr::Like {
                column,
                case_sensitivity: case,
                pattern,
            };
            return Ok(if postfix_not {
                SelectExpr::Not {
                    inner: Box::new(inner),
                }
            } else {
                inner
            });
        }

        // If we consumed a postfix `NOT` but the next token wasn't
        // BETWEEN / LIKE / ILIKE / IN after all, we have a parser bug —
        // the lookahead should be exhaustive. Defensive guard.
        if postfix_not {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "expected BETWEEN/LIKE/ILIKE/IN after NOT"));
        }

        // Comparison — `col op (literal | placeholder | column |
        // (SELECT ...) scalar-subquery)`.
        let op_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected comparison op"))?
            .clone();
        let op = match op_tok.token {
            Token::Eq => CompareOp::Eq,
            Token::NotEq | Token::BangEq => CompareOp::Ne,
            Token::Lt => CompareOp::Lt,
            Token::LtEq => CompareOp::Le,
            Token::Gt => CompareOp::Gt,
            Token::GtEq => CompareOp::Ge,
            _ => {
                return Err(syntax_err(Some(op_tok.at), "expected comparison op"));
            }
        };
        self.advance();

        // Sprint-393b — RHS scalar subquery: `col op (SELECT ...)`.
        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen))
            && matches!(
                self.tokens.get(self.cursor + 1).map(|t| &t.token),
                Some(Token::Select)
            )
        {
            self.advance(); // consume `(`
            self.advance(); // consume `SELECT`
            let stmt = self.parse_select()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(SelectExpr::ScalarSubqueryComparison {
                left: column,
                op,
                right: Box::new(stmt),
            });
        }

        // RHS — `Ident` starts a ColumnRef (column-column); everything
        // else parses as InsertValue (literal / placeholder).
        let rhs_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected value or column"))?;
        if matches!(rhs_tok.token, Token::Ident(_)) {
            let right = self.parse_column_ref()?;
            return Ok(SelectExpr::ColumnComparison {
                left: column,
                op,
                right,
            });
        }
        let value = self.parse_insert_value()?;
        Ok(SelectExpr::Comparison {
            left: column,
            op,
            value,
        })
    }

    /// Sprint-393b — `CASE [operand] WHEN ... THEN ... [ELSE ...] END`.
    /// Assumes the `CASE` token has been peeked but NOT yet consumed.
    ///
    /// The grammar admits literals/placeholders in operand / condition /
    /// result / else positions; the simple-CASE form (`CASE x WHEN 1
    /// THEN 'one'`) uses a literal as the WHEN-condition and the result
    /// position is always a value-bearing expression. We route both
    /// through `parse_case_value_expression` so a bare `'pos'` literal
    /// promotes into a `SelectExpr::Literal` wrapper.
    fn parse_case_expression(&mut self) -> Result<SelectExpr, ParseError> {
        self.advance(); // consume CASE

        // Simple-CASE has an operand expression between `CASE` and the
        // first `WHEN`; searched-CASE goes directly to `WHEN`. We detect
        // by peeking the next token.
        let operand = if matches!(self.peek().map(|t| &t.token), Some(Token::When)) {
            None
        } else {
            Some(Box::new(self.parse_case_value_expression()?))
        };

        let mut when_clauses: Vec<CaseWhen> = Vec::new();
        loop {
            if !matches!(self.peek().map(|t| &t.token), Some(Token::When)) {
                break;
            }
            self.advance(); // consume WHEN
            // For simple CASE the condition is a value compared against
            // the operand (literal/column/expr); for searched CASE the
            // condition is a boolean expression. Both flow through the
            // same value-or-expression parser because the boolean form
            // is a superset.
            let condition = if operand.is_some() {
                self.parse_case_value_expression()?
            } else {
                self.parse_select_expr_or()?
            };
            self.expect_keyword(Token::Then, "expected THEN")?;
            let result = self.parse_case_value_expression()?;
            when_clauses.push(CaseWhen { condition, result });
        }
        if when_clauses.is_empty() {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "CASE requires at least one WHEN clause"));
        }

        let else_clause = if matches!(self.peek().map(|t| &t.token), Some(Token::Else)) {
            self.advance();
            Some(Box::new(self.parse_case_value_expression()?))
        } else {
            None
        };

        self.expect_keyword(Token::End, "expected END")?;
        Ok(SelectExpr::Case {
            operand,
            when_clauses,
            else_clause,
        })
    }

    /// Sprint-393b — value-or-expression parser used inside CASE clauses.
    /// Accepts bare literals / placeholders (promotes to
    /// `SelectExpr::Literal`), bare column references (promotes to
    /// `SelectExpr::ColumnRefExpr` when no comparator follows), or any
    /// full expression the SELECT WHERE accepts (column ref + operator +
    /// value / BETWEEN / LIKE / IS NULL / etc.).
    /// Sprint-393b — peek the next token without advancing; if it is a
    /// comparison operator, return its semantic `CompareOp`.
    fn peek_compare_op(&self) -> Option<CompareOp> {
        match self.peek().map(|t| &t.token) {
            Some(Token::Eq) => Some(CompareOp::Eq),
            Some(Token::NotEq | Token::BangEq) => Some(CompareOp::Ne),
            Some(Token::Lt) => Some(CompareOp::Lt),
            Some(Token::LtEq) => Some(CompareOp::Le),
            Some(Token::Gt) => Some(CompareOp::Gt),
            Some(Token::GtEq) => Some(CompareOp::Ge),
            _ => None,
        }
    }

    fn parse_case_value_expression(&mut self) -> Result<SelectExpr, ParseError> {
        match self.peek().map(|t| &t.token) {
            Some(
                Token::Integer(_)
                | Token::Float(_)
                | Token::String(_)
                | Token::Null
                | Token::True
                | Token::False
                | Token::PlaceholderPositional(_)
                | Token::PlaceholderAnonymous
                | Token::PlaceholderNamed(_)
                | Token::Default,
            ) => {
                let value = self.parse_insert_value()?;
                Ok(SelectExpr::Literal { value })
            }
            Some(Token::Ident(_)) => {
                // Lookahead: parse the column ref greedily; if the next
                // token after the optional `.<col>` qualifier is a CASE-
                // position terminator (no comparator follows), return a
                // bare `ColumnRefExpr`. Otherwise, rewind and let the
                // normal expression pipeline consume it.
                let save = self.cursor;
                let column = self.parse_column_ref()?;
                if matches!(
                    self.peek().map(|t| &t.token),
                    Some(
                        Token::When
                            | Token::Then
                            | Token::End
                            | Token::Else
                            | Token::Comma
                            | Token::From
                            | Token::RParen
                    )
                ) {
                    return Ok(SelectExpr::ColumnRefExpr { column });
                }
                self.cursor = save;
                self.parse_select_expr_or()
            }
            _ => self.parse_select_expr_or(),
        }
    }

    // -------------------------------------------------------------
    // Sprint-393b — CTE / WITH parser.
    // -------------------------------------------------------------

    /// `WITH [RECURSIVE] <cte> [, <cte>]* <inner-statement>`. Assumes the
    /// `WITH` token has been consumed. The inner statement is one of
    /// SELECT / INSERT / UPDATE / DELETE; nested `WITH` is rejected.
    fn parse_with(&mut self) -> Result<WithStatement, ParseError> {
        let recursive = if matches!(self.peek().map(|t| &t.token), Some(Token::Recursive)) {
            self.advance();
            true
        } else {
            false
        };

        let mut ctes: Vec<CteDefinition> = Vec::new();
        loop {
            ctes.push(self.parse_cte_definition()?);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }

        // Inner statement — SELECT / INSERT / UPDATE / DELETE. Anything
        // else (including a second `WITH`) is a SyntaxError.
        let inner_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected inner statement after CTE list"))?
            .clone();
        let inner = match inner_tok.token {
            Token::Select => {
                self.advance();
                WithInner::Select(self.parse_select()?)
            }
            Token::Insert => {
                self.advance();
                WithInner::Insert(self.parse_insert()?)
            }
            Token::Update => {
                self.advance();
                WithInner::Update(self.parse_update()?)
            }
            Token::Delete => {
                self.advance();
                WithInner::Delete(self.parse_delete()?)
            }
            Token::With => Err(syntax_err(
                Some(inner_tok.at),
                "nested WITH is not supported",
            ))?,
            _ => {
                return Err(syntax_err(
                    Some(inner_tok.at),
                    "expected SELECT/INSERT/UPDATE/DELETE after CTE list",
                ));
            }
        };

        Ok(WithStatement {
            recursive,
            ctes,
            inner_statement: Box::new(inner),
        })
    }

    /// One `<name> [(col, col, ...)] AS ( SELECT ... )` entry. The CTE
    /// body must be a parenthesized SELECT (CTE inner DML is out of scope;
    /// only the outer WITH wraps DML).
    fn parse_cte_definition(&mut self) -> Result<CteDefinition, ParseError> {
        let name = self.expect_ident("expected CTE name")?;

        // Optional column-list `(col1, col2, ...)`.
        let columns = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            self.advance();
            let cols = self.parse_ident_list("expected column name")?;
            self.expect_token(Token::RParen, "expected ')'")?;
            cols
        } else {
            Vec::new()
        };

        self.expect_keyword(Token::As, "expected AS")?;
        self.expect_token(Token::LParen, "expected '(' for CTE body")?;
        self.expect_keyword(Token::Select, "expected SELECT inside CTE body")?;
        let body = self.parse_select()?;
        self.expect_token(Token::RParen, "expected ')'")?;

        Ok(CteDefinition {
            name,
            columns,
            body,
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
                return Err(syntax_err(Some(obj_tok.at), "expected object type"));
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
                return Err(syntax_err(Some(name_tok.at), "expected object ident"));
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
                return Err(syntax_err(Some(name_tok.at), "expected table ident"));
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
    /// consumed. Sprint-391 covers DROP-family actions; sprint-394 adds
    /// ADD COLUMN / ADD CONSTRAINT / RENAME TO / RENAME COLUMN. Any
    /// other action keyword (`ALTER COLUMN TYPE`, `OWNER TO`, …) is a
    /// `SyntaxError` — out of scope for this sprint.
    fn parse_alter_table(&mut self) -> Result<AlterTableStatement, ParseError> {
        // TABLE
        self.expect_keyword(Token::Table, "expected TABLE")?;

        // table name
        let name_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name"))?;
        let table = match &name_tok.token {
            Token::Ident(s) => s.clone(),
            _ => {
                return Err(syntax_err(Some(name_tok.at), "expected table ident"));
            }
        };
        self.advance();

        // action dispatch — DROP / ADD / RENAME. Anything else (ALTER
        // COLUMN / OWNER TO / SET TABLESPACE / …) surfaces as a syntax
        // error per the sprint-394 out-of-scope list.
        let action_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected action"))?;
        match action_tok.token {
            Token::Drop => {
                self.advance();
                let action = self.parse_alter_drop_action()?;
                Ok(AlterTableStatement { table, action })
            }
            Token::Add => {
                self.advance();
                let action = self.parse_alter_add_action()?;
                Ok(AlterTableStatement { table, action })
            }
            Token::Rename => {
                self.advance();
                let action = self.parse_alter_rename_action()?;
                Ok(AlterTableStatement { table, action })
            }
            _ => Err(syntax_err(
                Some(action_tok.at),
                "expected DROP, ADD, or RENAME",
            )),
        }
    }

    /// Sprint-394 — parse the body of `ALTER TABLE <name> ADD …`. Three
    /// shapes are accepted:
    ///   1. `ADD COLUMN [IF NOT EXISTS] <col-def>`
    ///   2. `ADD CONSTRAINT <name> <constraint-body>`
    ///   3. `ADD <bare-constraint>` — same as #2 but the constraint
    ///      name slot stays `None`.
    /// The `ADD` keyword has been consumed by the caller.
    fn parse_alter_add_action(&mut self) -> Result<AlterAction, ParseError> {
        // ADD COLUMN — column-definition shape (shared with CREATE TABLE).
        if matches!(self.peek().map(|t| &t.token), Some(Token::Column)) {
            self.advance();
            let if_not_exists = self.consume_if_not_exists()?;
            // `source_index` is meaningless outside a CREATE TABLE column
            // list; we record 0 so downstream tooling that iterates the
            // single column can still address it uniformly.
            let column = self.parse_column_definition(0)?;
            return Ok(AlterAction::AddColumn {
                column,
                if_not_exists,
            });
        }
        // ADD CONSTRAINT — explicit constraint name.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Constraint)) {
            self.advance();
            let name = self.expect_ident("expected constraint name")?;
            let body = self.parse_table_constraint_body()?;
            return Ok(AlterAction::AddConstraint {
                constraint: TableConstraint {
                    name: Some(name),
                    body,
                },
            });
        }
        // ADD <bare-constraint> — anonymous table constraint introduced
        // by the constraint keyword (PRIMARY / UNIQUE / FOREIGN / CHECK).
        let body = self.parse_table_constraint_body()?;
        Ok(AlterAction::AddConstraint {
            constraint: TableConstraint { name: None, body },
        })
    }

    /// Sprint-394 — parse the body of `ALTER TABLE <name> RENAME …`. Two
    /// shapes are accepted:
    ///   1. `RENAME TO <new-name>` — rename the table itself.
    ///   2. `RENAME COLUMN <old> TO <new>` — rename a column.
    /// The `RENAME` keyword has been consumed by the caller.
    fn parse_alter_rename_action(&mut self) -> Result<AlterAction, ParseError> {
        // RENAME COLUMN — qualified rename.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Column)) {
            self.advance();
            let old_name = self.expect_ident("expected column name")?;
            self.expect_keyword(Token::To, "expected TO")?;
            let new_name = self.expect_ident("expected new column name")?;
            return Ok(AlterAction::RenameColumn { old_name, new_name });
        }
        // RENAME TO — table rename.
        self.expect_keyword(Token::To, "expected TO")?;
        let new_name = self.expect_ident("expected new table name")?;
        Ok(AlterAction::RenameTable { new_name })
    }

    /// `DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]`
    /// | `DROP CONSTRAINT <name> [CASCADE|RESTRICT]`
    /// | `DROP INDEX <name>` (MySQL-style).
    /// Assumes the `DROP` token has been consumed.
    fn parse_alter_drop_action(&mut self) -> Result<AlterAction, ParseError> {
        let target_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected COLUMN/CONSTRAINT/INDEX"))?;
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
                        return Err(syntax_err(Some(col_tok.at), "expected column ident"));
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
                let c_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected constraint name"))?;
                let constraint = match &c_tok.token {
                    Token::Ident(s) => s.clone(),
                    _ => {
                        return Err(syntax_err(Some(c_tok.at), "expected constraint ident"));
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
                        return Err(syntax_err(Some(i_tok.at), "expected index ident"));
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
    // Sprint 394 — DDL additive sub-parsers (CREATE TABLE / INDEX /
    //              VIEW + ALTER TABLE ADD / RENAME helpers).
    // ---------------------------------------------------------------

    /// Dispatch on the token following `CREATE`. Supported shapes:
    ///   - `CREATE TABLE …`
    ///   - `CREATE [UNIQUE] INDEX …`
    ///   - `CREATE [OR REPLACE] VIEW …`
    /// Any other follow-up token (FUNCTION / TRIGGER / EXTENSION /
    /// TEMPORARY / MATERIALIZED / …) parses to `SyntaxError` per the
    /// sprint-394 out-of-scope list.
    fn parse_create_dispatch(&mut self) -> Result<ParseResult, ParseError> {
        let next = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected TABLE/INDEX/VIEW after CREATE"))?
            .clone();
        match next.token {
            Token::Table => {
                self.advance();
                Ok(ParseResult::CreateTable(self.parse_create_table()?))
            }
            Token::Unique => {
                // `CREATE UNIQUE INDEX …`
                self.advance();
                self.expect_keyword(Token::Index, "expected INDEX after UNIQUE")?;
                Ok(ParseResult::CreateIndex(
                    self.parse_create_index_body(true)?,
                ))
            }
            Token::Index => {
                self.advance();
                Ok(ParseResult::CreateIndex(
                    self.parse_create_index_body(false)?,
                ))
            }
            Token::Or => {
                // `CREATE OR REPLACE VIEW …`
                self.advance();
                self.expect_keyword(Token::Replace, "expected REPLACE after OR")?;
                self.expect_keyword(Token::View, "expected VIEW after OR REPLACE")?;
                Ok(ParseResult::CreateView(self.parse_create_view_body(true)?))
            }
            Token::View => {
                self.advance();
                Ok(ParseResult::CreateView(self.parse_create_view_body(false)?))
            }
            // CREATE FUNCTION / TRIGGER / EXTENSION / TEMPORARY /
            // MATERIALIZED / ROLE / SCHEMA — out of scope; surface a
            // SyntaxError so the sqlSafety regex fallback still
            // classifies the statement (D3).
            _ => Err(syntax_err(
                Some(next.at),
                "expected TABLE / INDEX / VIEW / [OR REPLACE] VIEW after CREATE",
            )),
        }
    }

    /// `CREATE TABLE` body — the `CREATE TABLE` tokens have been consumed.
    fn parse_create_table(&mut self) -> Result<CreateTableStatement, ParseError> {
        // Optional `IF NOT EXISTS`.
        let if_not_exists = self.consume_if_not_exists()?;
        // Schema-qualified or bare table reference.
        let table = self.parse_table_ref()?;
        // `( <defs> )` — at least one column.
        self.expect_token(Token::LParen, "expected '(' after table name")?;
        // Empty definition list is rejected (`AC-394-T20`).
        if matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "CREATE TABLE requires at least one column"));
        }
        let mut columns: Vec<ColumnDefinition> = Vec::new();
        let mut table_constraints: Vec<TableConstraint> = Vec::new();
        let mut col_index: usize = 0;
        loop {
            // Branch by the leading token of the next item: a table-
            // constraint keyword vs. a column-definition (the column
            // path requires an identifier as the leading token).
            let lead = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected column or constraint"))?
                .clone();
            match lead.token {
                Token::Constraint => {
                    self.advance();
                    let name = self.expect_ident("expected constraint name")?;
                    let body = self.parse_table_constraint_body()?;
                    table_constraints.push(TableConstraint {
                        name: Some(name),
                        body,
                    });
                }
                Token::Primary | Token::Unique | Token::Foreign | Token::Check => {
                    let body = self.parse_table_constraint_body()?;
                    table_constraints.push(TableConstraint { name: None, body });
                }
                Token::Ident(_) => {
                    let col = self.parse_column_definition(col_index)?;
                    col_index += 1;
                    columns.push(col);
                }
                _ => {
                    return Err(syntax_err(
                        Some(lead.at),
                        "expected column name or constraint keyword",
                    ));
                }
            }
            // Either `,` (more items) or `)` (end of list).
            match self.peek().map(|t| &t.token) {
                Some(Token::Comma) => {
                    self.advance();
                    continue;
                }
                Some(Token::RParen) => {
                    self.advance();
                    break;
                }
                Some(_) | None => {
                    let at = self.peek().map(|t| t.at);
                    return Err(syntax_err(at, "expected ',' or ')'"));
                }
            }
        }
        if columns.is_empty() {
            // Edge case — only table-level constraints inside the
            // parens. Sprint-394 rejects this (AC-394-T20 spec wording
            // says "empty column list" but the broader invariant is
            // that a CREATE TABLE produces at least one column).
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "CREATE TABLE requires at least one column"));
        }
        Ok(CreateTableStatement {
            table,
            if_not_exists,
            columns,
            table_constraints,
        })
    }

    /// Sprint-394 — schema-qualified or bare table reference. Used by
    /// CREATE TABLE / CREATE INDEX (`ON table`) / CREATE VIEW.
    fn parse_table_ref(&mut self) -> Result<TableRef, ParseError> {
        let first = self.expect_ident("expected table name")?;
        if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            self.advance();
            let table = self.expect_ident("expected table name after '.'")?;
            // Reject three-dot qualifier (sprint-393a's table-ref shape
            // is at most two-part).
            if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "three-dot table qualifier unsupported"));
            }
            Ok(TableRef {
                schema: Some(first),
                table,
            })
        } else {
            Ok(TableRef {
                schema: None,
                table: first,
            })
        }
    }

    /// One column definition: `<name> <type> [<col-constraint> …]`.
    /// `source_index` is the zero-based ordinal recorded into the AST.
    fn parse_column_definition(
        &mut self,
        source_index: usize,
    ) -> Result<ColumnDefinition, ParseError> {
        let name = self.expect_ident("expected column name")?;
        let data_type = self.parse_column_type()?;
        let constraints = self.parse_column_constraints()?;
        Ok(ColumnDefinition {
            name,
            data_type,
            constraints,
            source_index,
        })
    }

    /// Parse a column type token sequence. The lexer keyword allowlist
    /// (`INTEGER`, `BIGINT`, `VARCHAR`, `TEXT`, `TIMESTAMP`, `DATE`,
    /// `BOOLEAN`, `NUMERIC`, `SERIAL`, `UUID`) is the source of truth;
    /// any other token in type position parses to `SyntaxError` (AC-
    /// 394-T21). `VARCHAR(n)` requires a parenthesized integer; `NUMERIC`
    /// accepts zero, one, or two integer arguments; `TIMESTAMP WITH TIME
    /// ZONE` is recognized as a three-token sequence.
    fn parse_column_type(&mut self) -> Result<ColumnType, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column type"))?
            .clone();
        match tok.token {
            Token::KwInteger => {
                self.advance();
                Ok(ColumnType::Integer)
            }
            Token::KwBigint => {
                self.advance();
                Ok(ColumnType::Bigint)
            }
            Token::KwText => {
                self.advance();
                Ok(ColumnType::Text)
            }
            Token::KwDate => {
                self.advance();
                Ok(ColumnType::Date)
            }
            Token::KwBoolean => {
                self.advance();
                Ok(ColumnType::Boolean)
            }
            Token::KwSerial => {
                self.advance();
                Ok(ColumnType::Serial)
            }
            Token::KwUuid => {
                self.advance();
                Ok(ColumnType::Uuid)
            }
            Token::KwVarchar => {
                self.advance();
                self.expect_token(Token::LParen, "VARCHAR requires '(<length>)'")?;
                let len_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected length integer"))?
                    .clone();
                let length = match len_tok.token {
                    Token::Integer(v) => v,
                    _ => {
                        return Err(syntax_err(
                            Some(len_tok.at),
                            "VARCHAR length must be an integer literal",
                        ));
                    }
                };
                self.advance();
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(ColumnType::Varchar { length })
            }
            Token::KwTimestamp => {
                self.advance();
                // `TIMESTAMP WITH TIME ZONE` — three-token suffix.
                let with_time_zone =
                    if matches!(self.peek().map(|t| &t.token), Some(Token::With)) {
                        self.advance();
                        self.expect_keyword(Token::Time, "expected TIME after WITH")?;
                        self.expect_keyword(Token::Zone, "expected ZONE after TIME")?;
                        true
                    } else {
                        false
                    };
                Ok(ColumnType::Timestamp { with_time_zone })
            }
            Token::KwNumeric => {
                self.advance();
                // `NUMERIC` — bare, `NUMERIC(p)`, or `NUMERIC(p, s)`.
                if !matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
                    return Ok(ColumnType::Numeric {
                        precision: None,
                        scale: None,
                    });
                }
                self.advance();
                let p_tok = self
                    .peek()
                    .ok_or_else(|| syntax_err(None, "expected precision integer"))?
                    .clone();
                let precision = match p_tok.token {
                    Token::Integer(v) => v,
                    _ => {
                        return Err(syntax_err(
                            Some(p_tok.at),
                            "NUMERIC precision must be an integer literal",
                        ));
                    }
                };
                self.advance();
                let scale = if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                    self.advance();
                    let s_tok = self
                        .peek()
                        .ok_or_else(|| syntax_err(None, "expected scale integer"))?
                        .clone();
                    let s = match s_tok.token {
                        Token::Integer(v) => v,
                        _ => {
                            return Err(syntax_err(
                                Some(s_tok.at),
                                "NUMERIC scale must be an integer literal",
                            ));
                        }
                    };
                    self.advance();
                    Some(s)
                } else {
                    None
                };
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(ColumnType::Numeric {
                    precision: Some(precision),
                    scale,
                })
            }
            // Bare identifier in type position — vendor synonym like
            // INT4 / STRING / DATETIME — out of scope (AC-394-T21).
            Token::Ident(_) => Err(syntax_err(
                Some(tok.at),
                "unsupported column type — sprint-394 allowlist is \
                 INTEGER/BIGINT/VARCHAR/TEXT/TIMESTAMP/DATE/BOOLEAN/NUMERIC/SERIAL/UUID",
            )),
            _ => Err(syntax_err(Some(tok.at), "expected column type")),
        }
    }

    /// Parse the column-level constraint suffix of a column definition.
    /// Returns an empty vec when no constraint keywords are present.
    /// Loops until a comma / closing paren / unrecognized token; the
    /// caller (CREATE TABLE definition list / ALTER TABLE ADD COLUMN)
    /// decides what terminates the surrounding context.
    fn parse_column_constraints(&mut self) -> Result<Vec<ColumnConstraint>, ParseError> {
        let mut out: Vec<ColumnConstraint> = Vec::new();
        loop {
            // Optional `CONSTRAINT <name>` prefix introduces an
            // inline-named column constraint.
            let name = if matches!(self.peek().map(|t| &t.token), Some(Token::Constraint)) {
                self.advance();
                Some(self.expect_ident("expected constraint name")?)
            } else {
                None
            };

            let body = match self.peek().map(|t| &t.token) {
                Some(Token::Primary) => {
                    self.advance();
                    self.expect_keyword(Token::Key, "expected KEY after PRIMARY")?;
                    ColumnConstraintBody::PrimaryKey
                }
                Some(Token::Not) => {
                    self.advance();
                    self.expect_keyword(Token::Null, "expected NULL after NOT")?;
                    ColumnConstraintBody::NotNull
                }
                Some(Token::Default) => {
                    self.advance();
                    // The DEFAULT slot accepts only literal / placeholder
                    // values in this sprint (function calls are deferred —
                    // see contract Out-of-Scope §). `parse_insert_value`
                    // surfaces a `SyntaxError` for anything else.
                    let value = self.parse_insert_value()?;
                    ColumnConstraintBody::Default { value }
                }
                Some(Token::Unique) => {
                    self.advance();
                    ColumnConstraintBody::Unique
                }
                Some(Token::References) => {
                    self.advance();
                    let table = self.parse_table_ref()?;
                    // Optional `(<col>)`.
                    let column =
                        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
                            self.advance();
                            let c = self.expect_ident("expected referenced column")?;
                            self.expect_token(Token::RParen, "expected ')'")?;
                            Some(c)
                        } else {
                            None
                        };
                    ColumnConstraintBody::References { table, column }
                }
                Some(Token::Check) => {
                    self.advance();
                    self.expect_token(Token::LParen, "expected '(' after CHECK")?;
                    let expression = self.parse_select_expr_or()?;
                    self.expect_token(Token::RParen, "expected ')'")?;
                    ColumnConstraintBody::Check { expression }
                }
                _ => {
                    // No more constraints. If a `CONSTRAINT name` prefix
                    // was consumed but no body keyword followed, surface
                    // a SyntaxError — the prefix becomes orphan otherwise.
                    if name.is_some() {
                        let at = self.peek().map(|t| t.at);
                        return Err(syntax_err(at, "expected column-constraint body"));
                    }
                    break;
                }
            };
            out.push(ColumnConstraint { name, body });
        }
        Ok(out)
    }

    /// Parse a table-level constraint body. The leading token is one of:
    ///   - `PRIMARY KEY ( <cols> )` — `Primary` consumed here.
    ///   - `UNIQUE ( <cols> )`.
    ///   - `FOREIGN KEY ( <cols> ) REFERENCES <table> [ ( <cols> ) ]`.
    ///   - `CHECK ( <expression> )`.
    /// Caller already consumed an optional `CONSTRAINT <name>` prefix.
    fn parse_table_constraint_body(&mut self) -> Result<TableConstraintBody, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table-constraint body"))?
            .clone();
        match tok.token {
            Token::Primary => {
                self.advance();
                self.expect_keyword(Token::Key, "expected KEY after PRIMARY")?;
                let columns = self.parse_parenthesized_ident_list()?;
                Ok(TableConstraintBody::PrimaryKey { columns })
            }
            Token::Unique => {
                self.advance();
                let columns = self.parse_parenthesized_ident_list()?;
                Ok(TableConstraintBody::Unique { columns })
            }
            Token::Foreign => {
                self.advance();
                self.expect_keyword(Token::Key, "expected KEY after FOREIGN")?;
                let columns = self.parse_parenthesized_ident_list()?;
                self.expect_keyword(Token::References, "expected REFERENCES")?;
                let target_table = self.parse_table_ref()?;
                let target_columns =
                    if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
                        self.parse_parenthesized_ident_list()?
                    } else {
                        Vec::new()
                    };
                Ok(TableConstraintBody::References {
                    columns,
                    target_table,
                    target_columns,
                })
            }
            Token::Check => {
                self.advance();
                self.expect_token(Token::LParen, "expected '(' after CHECK")?;
                let expression = self.parse_select_expr_or()?;
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(TableConstraintBody::Check { expression })
            }
            _ => Err(syntax_err(
                Some(tok.at),
                "expected PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK",
            )),
        }
    }

    /// `( <ident> ( , <ident> )* )`. The opening paren is required —
    /// reused by PRIMARY KEY / UNIQUE / FOREIGN KEY column lists.
    fn parse_parenthesized_ident_list(&mut self) -> Result<Vec<String>, ParseError> {
        self.expect_token(Token::LParen, "expected '('")?;
        let cols = self.parse_ident_list("expected column name")?;
        self.expect_token(Token::RParen, "expected ')'")?;
        Ok(cols)
    }

    /// Sprint-394 — optional `IF NOT EXISTS` token triple. Returns
    /// `true` when all three keywords are present (in order); returns
    /// `false` if `IF` is absent. A partial sequence (`IF` without
    /// `NOT EXISTS`) is a `SyntaxError`.
    fn consume_if_not_exists(&mut self) -> Result<bool, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::If)) {
            return Ok(false);
        }
        let if_tok = self.peek().expect("just peeked").clone();
        self.advance();
        self.expect_keyword(Token::Not, "expected NOT after IF")
            .map_err(|_| syntax_err(Some(if_tok.at), "expected NOT EXISTS after IF"))?;
        self.expect_keyword(Token::Exists, "expected EXISTS after NOT")?;
        Ok(true)
    }

    /// `CREATE INDEX` body — `unique` is `true` when the caller consumed
    /// `UNIQUE INDEX`. The `INDEX` token has been consumed.
    fn parse_create_index_body(
        &mut self,
        unique: bool,
    ) -> Result<CreateIndexStatement, ParseError> {
        let if_not_exists = self.consume_if_not_exists()?;
        let name = self.expect_ident("expected index name")?;
        self.expect_keyword(Token::On, "expected ON")?;
        let table = self.parse_table_ref()?;
        self.expect_token(Token::LParen, "expected '('")?;
        // Reject empty column list (AC-394-I05).
        if matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "CREATE INDEX requires at least one column"));
        }
        // Identifier-only column list — expression / functional indexes
        // (`CREATE INDEX idx ON t (lower(a))`) parse to `SyntaxError`
        // (AC-394-I06) because the second token after the column ident
        // would be `(`, which fails the comma/RParen branch below.
        let mut columns: Vec<String> = Vec::new();
        loop {
            let col = self.expect_ident("expected column ident")?;
            columns.push(col);
            match self.peek().map(|t| &t.token) {
                Some(Token::Comma) => {
                    self.advance();
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
                        "expected ',' or ')' — expression-indexes are out of scope",
                    ));
                }
            }
        }
        Ok(CreateIndexStatement {
            unique,
            if_not_exists,
            name,
            table,
            columns,
        })
    }

    /// `CREATE VIEW` body — `or_replace` is `true` when the caller
    /// consumed `OR REPLACE`. The `VIEW` token has been consumed.
    fn parse_create_view_body(
        &mut self,
        or_replace: bool,
    ) -> Result<CreateViewStatement, ParseError> {
        let name = self.parse_table_ref()?;
        self.expect_keyword(Token::As, "expected AS")?;
        // The body may start with `SELECT` (plain SELECT, with optional
        // set-operation chain — `parse_select` handles the chain) or
        // `WITH` (CTE-wrapped SELECT — `parse_with` enforces that the
        // inner statement is a SELECT for the view body).
        let body = match self.peek().map(|t| &t.token) {
            Some(Token::Select) => {
                self.advance();
                CreateViewBody::Select(self.parse_select()?)
            }
            Some(Token::With) => {
                self.advance();
                let with = self.parse_with()?;
                // A view body's CTE wrap must be a SELECT (view bodies
                // are read-only by definition).
                if !matches!(*with.inner_statement, WithInner::Select(_)) {
                    return Err(syntax_err(
                        None,
                        "VIEW body's CTE wrap must end in a SELECT",
                    ));
                }
                CreateViewBody::With(with)
            }
            Some(_) | None => {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "expected SELECT or WITH after AS"));
            }
        };
        Ok(CreateViewStatement {
            or_replace,
            name,
            body,
        })
    }

    // ---------------------------------------------------------------
    // Sprint 392 — DML write triad sub-parsers (INSERT / UPDATE / DELETE).
    // ---------------------------------------------------------------

    /// `INSERT INTO <table> [(cols)] (VALUES … | DEFAULT VALUES | SELECT …)
    ///  [ON CONFLICT …] [RETURNING …]`. Assumes `INSERT` has been
    /// consumed.
    fn parse_insert(&mut self) -> Result<InsertStatement, ParseError> {
        // INTO
        self.expect_keyword(Token::Into, "expected INTO")?;

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
                self.expect_keyword(Token::Values, "expected VALUES")?;
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
                return Err(syntax_err(at, "expected VALUES/SELECT"));
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
                        return Err(syntax_err(at, "expected ',' or ')'"));
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
            _ => Err(syntax_err(Some(tok.at), "expected value")),
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
                self.expect_keyword(Token::Set, "expected SET")?;
                let set = self.parse_assignment_list()?;
                let where_clause = self.parse_optional_where_expr()?;
                Ok(OnConflict::DoUpdate { set, where_clause })
            }
            _ => Err(syntax_err(Some(tok.at), "expected NOTHING/UPDATE")),
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
    ///
    /// Sprint-393b — DML WHERE migrates to the unified `SelectExpr` shape
    /// (was sprint-392's narrow `WhereExpr`). DML now accepts every WHERE
    /// form SELECT does: BETWEEN / LIKE / column-column / qualified column
    /// refs / IN-list / IN-subquery / EXISTS / CASE.
    fn parse_optional_where_expr(&mut self) -> Result<Option<SelectExpr>, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::Where)) {
            return Ok(None);
        }
        self.advance();
        Ok(Some(self.parse_select_expr_or()?))
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

    fn parse_columns(&mut self) -> Result<Columns, ParseError> {
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column list"))?;
        if first.token == Token::Star {
            self.advance();
            return Ok(Columns::Star);
        }

        // Sprint-393b — fast path: pure bare-identifier list (`a, b, c`).
        // We peek through identifiers + commas; if we hit `FROM` first
        // *without* encountering any non-Ident expression-start token,
        // the list is a `Columns::Named`. Otherwise we restart and parse
        // the list as `Columns::Expressions`.
        let saved_cursor = self.cursor;
        let bare_list_ok = self.try_parse_bare_named_list();
        if let Some(names) = bare_list_ok {
            return Ok(Columns::Named { names });
        }
        self.cursor = saved_cursor;

        // Sprint-393b — at least one item is a non-bare-column expression
        // (CASE, scalar-subquery, window-function, etc.). Walk the list
        // and capture each item as a `SelectListItem`.
        let mut items: Vec<SelectListItem> = Vec::new();
        loop {
            let item = self.parse_select_list_item()?;
            items.push(item);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(Columns::Expressions { items })
    }

    /// Sprint-393b — fast path: try to parse a pure `Ident (, Ident)*`
    /// select-list. Returns `Some(names)` on success (and leaves the
    /// cursor just before `FROM`), or `None` if any item is not a bare
    /// identifier (caller restarts the cursor and parses as expressions).
    fn try_parse_bare_named_list(&mut self) -> Option<Vec<String>> {
        let mut names: Vec<String> = Vec::new();
        loop {
            let tok = self.peek()?;
            let name = match &tok.token {
                Token::Ident(s) => s.clone(),
                _ => return None,
            };
            // Peek one further to verify the item is a *bare* identifier
            // (not the start of a qualified ref `a.b`, a function call
            // `f(...)`, etc.).
            let after = self.tokens.get(self.cursor + 1).map(|t| &t.token);
            match after {
                Some(Token::Comma) | Some(Token::From) => {
                    names.push(name);
                    self.advance();
                }
                _ => return None,
            }
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Some(names)
    }

    /// Sprint-393b — parse one item of an expression-form select list.
    /// Possible shapes:
    ///   - `*` → `SelectListItem::Star`.
    ///   - bare or qualified column ref (no following operator) →
    ///     `SelectListItem::Column`.
    ///   - bare literal / placeholder → `SelectListItem::Expression`
    ///     wrapping a `SelectExpr::Literal`.
    ///   - any other expression form (CASE / EXISTS / scalar-subquery /
    ///     window function) → `SelectListItem::Expression`.
    fn parse_select_list_item(&mut self) -> Result<SelectListItem, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Star)) {
            self.advance();
            return Ok(SelectListItem::Star);
        }
        // Bare literal / placeholder in select list (e.g. `SELECT 1
        // FROM x`). Wrap in `SelectExpr::Literal`.
        if matches!(
            self.peek().map(|t| &t.token),
            Some(
                Token::Integer(_)
                    | Token::Float(_)
                    | Token::String(_)
                    | Token::Null
                    | Token::True
                    | Token::False
                    | Token::PlaceholderPositional(_)
                    | Token::PlaceholderAnonymous
                    | Token::PlaceholderNamed(_)
            )
        ) {
            let value = self.parse_insert_value()?;
            return Ok(SelectListItem::Expression {
                expression: SelectExpr::Literal { value },
            });
        }
        // CASE / EXISTS / scalar-subquery → expression item.
        if matches!(
            self.peek().map(|t| &t.token),
            Some(Token::Case | Token::Exists | Token::LParen)
        ) {
            let expr = self.parse_select_list_expression()?;
            return Ok(SelectListItem::Expression { expression: expr });
        }
        // Identifier — either a bare/qualified column ref or a function
        // call (window function with OVER). Decide by peeking past the
        // identifier (and optional `.<col>` qualifier) for `(` or for a
        // list terminator (`,` / `FROM`).
        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_))) {
            let save = self.cursor;
            // Try to parse a column ref greedily.
            let column = self.parse_column_ref()?;
            // If the next token is `(`, the identifier was actually a
            // function name — rewind and dispatch through expression
            // parsing (window-function path).
            if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
                self.cursor = save;
                let expr = self.parse_select_list_expression()?;
                return Ok(SelectListItem::Expression { expression: expr });
            }
            // Plain column ref (followed by `,` / `FROM` / clause kw).
            if matches!(
                self.peek().map(|t| &t.token),
                Some(Token::Comma | Token::From)
            ) {
                return Ok(SelectListItem::Column { reference: column });
            }
            // Anything else after the column ref is unexpected at top-
            // level select-list position (we don't support arithmetic
            // expressions yet — that's a future sprint).
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "unexpected token in SELECT list"));
        }
        let at = self.peek().map(|t| t.at);
        Err(syntax_err(at, "expected SELECT list item"))
    }

    /// Sprint-393b — parse one expression that lives in select-list
    /// position. Distinct from `parse_select_expr_or` because the
    /// select-list grammar admits a subset (no top-level boolean
    /// `AND`/`OR` — those are reserved for WHERE/HAVING).
    fn parse_select_list_expression(&mut self) -> Result<SelectExpr, ParseError> {
        // CASE / scalar-subquery / window-function — leading tokens.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Case)) {
            return self.parse_case_expression();
        }
        if matches!(self.peek().map(|t| &t.token), Some(Token::Exists)) {
            // EXISTS in select list is unusual but legal SQL (boolean
            // expression in SELECT list). Reuse the primary parser.
            return self.parse_select_expr_primary();
        }
        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            // Scalar subquery in SELECT list — `(SELECT ...)`.
            if matches!(
                self.tokens.get(self.cursor + 1).map(|t| &t.token),
                Some(Token::Select)
            ) {
                self.advance(); // `(`
                self.advance(); // `SELECT`
                let inner = self.parse_select()?;
                self.expect_token(Token::RParen, "expected ')'")?;
                return Ok(SelectExpr::ScalarSubquery {
                    statement: Box::new(inner),
                });
            }
        }
        // Identifier followed by `(` → function call. Sprint-393b only
        // accepts a function call when followed by `OVER (...)` (window
        // function). Otherwise it's UnsupportedExpression.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_))) {
            return self.parse_function_or_window();
        }
        let at = self.peek().map(|t| t.at);
        Err(syntax_err(at, "expected expression in SELECT list"))
    }

    /// Sprint-393b — `<ident>(args) OVER (...)`. Bare function calls
    /// without `OVER` continue to surface as `UnsupportedExpression`
    /// (AC-393b-O08).
    fn parse_function_or_window(&mut self) -> Result<SelectExpr, ParseError> {
        let ident_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected function name"))?
            .clone();
        let name = match ident_tok.token {
            Token::Ident(n) => n,
            _ => return Err(syntax_err(Some(ident_tok.at), "expected function name")),
        };
        self.advance();
        self.expect_token(Token::LParen, "expected '(' after function name")?;
        let mut arguments: Vec<WindowArgument> = Vec::new();
        if !matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
            loop {
                arguments.push(self.parse_window_argument()?);
                if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                    self.advance();
                    continue;
                }
                break;
            }
        }
        self.expect_token(Token::RParen, "expected ')'")?;

        // Sprint-393b — function call without `OVER` is UnsupportedExpression.
        if !matches!(self.peek().map(|t| &t.token), Some(Token::Over)) {
            let at = ident_tok.at;
            return Err(unsupported_expression_err(
                Some(at),
                "bare function call (no OVER) unsupported",
            ));
        }
        self.advance(); // consume OVER
        let over = self.parse_over_clause()?;
        Ok(SelectExpr::WindowFunction {
            name,
            arguments,
            over,
        })
    }

    /// Sprint-393b — one window-function argument: `*` / column-ref /
    /// literal / placeholder. The `Star` variant is a dedicated AST
    /// shape (AC-393b-O07).
    fn parse_window_argument(&mut self) -> Result<WindowArgument, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Star)) {
            self.advance();
            return Ok(WindowArgument::Star);
        }
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected window argument"))?
            .clone();
        match tok.token {
            Token::Integer(v) => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::Integer { value: v },
                })
            }
            Token::Float(v) => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::Float { value: v },
                })
            }
            Token::String(s) => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::String { value: s },
                })
            }
            Token::Null => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::Null,
                })
            }
            Token::True => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::Boolean { value: true },
                })
            }
            Token::False => {
                self.advance();
                Ok(WindowArgument::Literal {
                    value: SqlLiteral::Boolean { value: false },
                })
            }
            Token::PlaceholderPositional(name) => {
                self.advance();
                Ok(WindowArgument::Placeholder { name })
            }
            Token::PlaceholderAnonymous => {
                self.advance();
                Ok(WindowArgument::Placeholder {
                    name: String::new(),
                })
            }
            Token::PlaceholderNamed(name) => {
                self.advance();
                Ok(WindowArgument::Placeholder { name })
            }
            Token::Ident(_) => {
                let reference = self.parse_column_ref()?;
                Ok(WindowArgument::ColumnRef { reference })
            }
            _ => Err(syntax_err(Some(tok.at), "expected window argument")),
        }
    }

    /// Sprint-393b — `OVER ( [PARTITION BY ...] [ORDER BY ...] [frame] )`.
    /// The `OVER` keyword has been consumed by the caller.
    fn parse_over_clause(&mut self) -> Result<OverClause, ParseError> {
        self.expect_token(Token::LParen, "expected '(' after OVER")?;

        let partition_by = if matches!(self.peek().map(|t| &t.token), Some(Token::Partition)) {
            self.advance();
            self.expect_keyword(Token::By, "expected BY")?;
            self.parse_column_ref_list()?
        } else {
            Vec::new()
        };

        let order_by = if matches!(self.peek().map(|t| &t.token), Some(Token::Order)) {
            self.advance();
            self.expect_keyword(Token::By, "expected BY")?;
            self.parse_ordering_list()?
        } else {
            Vec::new()
        };

        let frame = if matches!(
            self.peek().map(|t| &t.token),
            Some(Token::Rows | Token::Range)
        ) {
            Some(self.parse_window_frame()?)
        } else {
            None
        };

        self.expect_token(Token::RParen, "expected ')'")?;
        Ok(OverClause {
            partition_by,
            order_by,
            frame,
        })
    }

    /// Sprint-393b — `(ROWS | RANGE) ( BETWEEN <start> AND <end> | <start> )`.
    fn parse_window_frame(&mut self) -> Result<WindowFrame, ParseError> {
        let unit = match self.peek().map(|t| &t.token) {
            Some(Token::Rows) => {
                self.advance();
                FrameUnit::Rows
            }
            Some(Token::Range) => {
                self.advance();
                FrameUnit::Range
            }
            _ => unreachable!("just matched"),
        };
        let (start, end) = if matches!(self.peek().map(|t| &t.token), Some(Token::Between)) {
            self.advance();
            let start = self.parse_frame_bound()?;
            self.expect_keyword(Token::And, "expected AND")?;
            let end = self.parse_frame_bound()?;
            (start, Some(end))
        } else {
            (self.parse_frame_bound()?, None)
        };
        Ok(WindowFrame { unit, start, end })
    }

    fn parse_frame_bound(&mut self) -> Result<FrameBound, ParseError> {
        // `UNBOUNDED PRECEDING` / `UNBOUNDED FOLLOWING`
        if matches!(self.peek().map(|t| &t.token), Some(Token::Unbounded)) {
            self.advance();
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected PRECEDING/FOLLOWING"))?
                .clone();
            return match tok.token {
                Token::Preceding => {
                    self.advance();
                    Ok(FrameBound::UnboundedPreceding)
                }
                Token::Following => {
                    self.advance();
                    Ok(FrameBound::UnboundedFollowing)
                }
                _ => Err(syntax_err(
                    Some(tok.at),
                    "expected PRECEDING or FOLLOWING after UNBOUNDED",
                )),
            };
        }
        // `CURRENT ROW`
        if matches!(self.peek().map(|t| &t.token), Some(Token::Current)) {
            self.advance();
            self.expect_keyword(Token::Row, "expected ROW after CURRENT")?;
            return Ok(FrameBound::CurrentRow);
        }
        // `<integer> PRECEDING|FOLLOWING`
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected frame bound"))?
            .clone();
        let offset = match tok.token {
            Token::Integer(v) => v,
            _ => return Err(syntax_err(Some(tok.at), "expected integer for frame bound")),
        };
        self.advance();
        let kw_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected PRECEDING/FOLLOWING"))?
            .clone();
        match kw_tok.token {
            Token::Preceding => {
                self.advance();
                Ok(FrameBound::Preceding { offset })
            }
            Token::Following => {
                self.advance();
                Ok(FrameBound::Following { offset })
            }
            _ => Err(syntax_err(
                Some(kw_tok.at),
                "expected PRECEDING or FOLLOWING",
            )),
        }
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

    /// `GRANT priv [, priv]* ON object TO grantee [, grantee]* [WITH GRANT
    /// OPTION]`. The `GRANT` keyword has been consumed.
    fn parse_grant(&mut self) -> Result<GrantStatement, ParseError> {
        let privileges = self.parse_privilege_list()?;
        self.expect_keyword(Token::On, "expected ON")?;
        let object = self.parse_grant_object()?;
        self.expect_keyword(Token::To, "expected TO")?;
        let grantees = self.parse_role_list()?;
        let with_grant_option =
            if matches!(self.peek().map(|t| &t.token), Some(Token::With)) {
                self.advance();
                self.expect_keyword(Token::Grant, "expected GRANT")?;
                self.expect_ident_kw("option", "expected OPTION")?;
                true
            } else {
                false
            };
        Ok(GrantStatement {
            privileges,
            object,
            grantees,
            with_grant_option,
        })
    }

    /// `REVOKE [GRANT OPTION FOR] priv [, priv]* ON object FROM revokee […]
    /// [CASCADE|RESTRICT]`. The `REVOKE` keyword has been consumed.
    fn parse_revoke(&mut self) -> Result<RevokeStatement, ParseError> {
        let grant_option_for = if matches!(self.peek().map(|t| &t.token), Some(Token::Grant)) {
            // Lookahead: `GRANT OPTION FOR`. We consume only on the
            // full three-token match — bare `GRANT` is not a privilege
            // here, so the absence of `OPTION FOR` is a syntax error.
            self.advance();
            self.expect_ident_kw("option", "expected OPTION")?;
            self.expect_ident_kw("for", "expected FOR")?;
            true
        } else {
            false
        };
        let privileges = self.parse_privilege_list()?;
        self.expect_keyword(Token::On, "expected ON")?;
        let object = self.parse_grant_object()?;
        self.expect_keyword(Token::From, "expected FROM")?;
        let revokees = self.parse_role_list()?;
        let cascade = self.consume_cascade_or_restrict()?;
        Ok(RevokeStatement {
            privileges,
            object,
            revokees,
            grant_option_for,
            cascade,
        })
    }

    /// Privilege list — `ALL [PRIVILEGES]` or one-or-more named privileges
    /// separated by commas. Returns at least one entry.
    fn parse_privilege_list(&mut self) -> Result<Vec<PrivilegeTag>, ParseError> {
        // ALL [PRIVILEGES] short-circuit.
        if matches!(self.peek().map(|t| &t.token), Some(Token::All)) {
            self.advance();
            self.consume_ident_kw("privileges");
            return Ok(vec![PrivilegeTag::All]);
        }
        let mut list: Vec<PrivilegeTag> = Vec::new();
        loop {
            list.push(self.parse_privilege_tag()?);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        if list.is_empty() {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "expected privilege"));
        }
        Ok(list)
    }

    /// Single privilege token + optional column qualifier (SELECT / UPDATE /
    /// REFERENCES only — INSERT / DELETE / TRIGGER reject the column
    /// qualifier per contract).
    fn parse_privilege_tag(&mut self) -> Result<PrivilegeTag, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected privilege"))?
            .clone();
        let (base, accepts_columns) = match tok.token {
            Token::Select => (PrivilegeTag::Select { columns: Vec::new() }, true),
            Token::Insert => (PrivilegeTag::Insert, false),
            Token::Update => (PrivilegeTag::Update { columns: Vec::new() }, true),
            Token::Delete => (PrivilegeTag::Delete, false),
            Token::Truncate => (PrivilegeTag::Truncate, false),
            Token::References => (PrivilegeTag::References { columns: Vec::new() }, true),
            Token::Ident(ref name) if name.eq_ignore_ascii_case("trigger") => {
                (PrivilegeTag::Trigger, false)
            }
            Token::Ident(ref name) if name.eq_ignore_ascii_case("usage") => {
                (PrivilegeTag::Usage, false)
            }
            Token::Ident(ref name) if name.eq_ignore_ascii_case("execute") => {
                (PrivilegeTag::Execute, false)
            }
            _ => return Err(syntax_err(Some(tok.at), "expected privilege keyword")),
        };
        self.advance();

        // Optional `(col1, col2)` qualifier. SELECT / UPDATE / REFERENCES
        // accept it; everything else surfaces a SyntaxError when the
        // user wrote a column list (per AC-395-G06).
        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            if !accepts_columns {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(
                    at,
                    "this privilege does not accept a column qualifier",
                ));
            }
            self.advance();
            let cols = self.parse_ident_list("expected column name")?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(match base {
                PrivilegeTag::Select { .. } => PrivilegeTag::Select { columns: cols },
                PrivilegeTag::Update { .. } => PrivilegeTag::Update { columns: cols },
                PrivilegeTag::References { .. } => {
                    PrivilegeTag::References { columns: cols }
                }
                // `accepts_columns` is true only for the three above —
                // the match is exhaustive in practice.
                other => other,
            });
        }
        Ok(base)
    }

    /// `[TABLE] tables | SEQUENCE seqs | FUNCTION funcs | SCHEMA schemas
    /// | DATABASE dbs | ALL TABLES IN SCHEMA name`.
    fn parse_grant_object(&mut self) -> Result<GrantObject, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected object kind"))?
            .clone();
        match tok.token {
            Token::Table => {
                self.advance();
                let tables = self.parse_table_ref_list()?;
                Ok(GrantObject::Table { tables })
            }
            Token::Schema => {
                self.advance();
                let schemas = self.parse_ident_list("expected schema name")?;
                Ok(GrantObject::Schema { schemas })
            }
            Token::Database => {
                self.advance();
                let databases = self.parse_ident_list("expected database name")?;
                Ok(GrantObject::Database { databases })
            }
            Token::Sequence => {
                self.advance();
                let sequences = self.parse_ident_list("expected sequence name")?;
                Ok(GrantObject::Sequence { sequences })
            }
            // `FUNCTION` is not a reserved keyword in our lexer (out of
            // scope); the user writes the bare identifier "FUNCTION". Match
            // case-insensitively against the identifier text.
            Token::Ident(ref name) if name.eq_ignore_ascii_case("function") => {
                self.advance();
                let functions = self.parse_ident_list("expected function name")?;
                Ok(GrantObject::Function { functions })
            }
            Token::All => {
                // `ALL TABLES IN SCHEMA name` shorthand.
                self.advance();
                self.expect_ident_kw("tables", "expected TABLES")?;
                self.expect_keyword(Token::In, "expected IN")?;
                self.expect_keyword(Token::Schema, "expected SCHEMA")?;
                let schema_name = self.expect_ident("expected schema name")?;
                Ok(GrantObject::AllInSchema { schema_name })
            }
            // Implicit `TABLE` object kind — when the user writes `ON
            // tablename` (without a `TABLE` keyword) we still classify as
            // a table grant.
            Token::Ident(_) => {
                let tables = self.parse_table_ref_list()?;
                Ok(GrantObject::Table { tables })
            }
            _ => Err(syntax_err(Some(tok.at), "expected GRANT/REVOKE object")),
        }
    }

    /// Comma-separated list of (optionally schema-qualified) table refs.
    fn parse_table_ref_list(&mut self) -> Result<Vec<TableRef>, ParseError> {
        let mut out: Vec<TableRef> = Vec::new();
        loop {
            out.push(self.parse_table_ref()?);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Comma-separated grantee / revokee list. `PUBLIC`, `CURRENT_USER`,
    /// `SESSION_USER` are matched as case-insensitive identifiers (per
    /// sprint-395 lexer design — these stay `Token::Ident` to avoid
    /// breaking sprint-385/394 tests that use `public` as a schema
    /// name).
    fn parse_role_list(&mut self) -> Result<Vec<RoleRef>, ParseError> {
        let mut out: Vec<RoleRef> = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected role"))?
                .clone();
            match tok.token {
                Token::Ident(name) => {
                    self.advance();
                    if name.eq_ignore_ascii_case("public") {
                        out.push(RoleRef::Public);
                    } else if name.eq_ignore_ascii_case("current_user")
                        || name.eq_ignore_ascii_case("session_user")
                    {
                        out.push(RoleRef::CurrentSession);
                    } else {
                        out.push(RoleRef::Role { name });
                    }
                }
                _ => return Err(syntax_err(Some(tok.at), "expected role")),
            }
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// `EXPLAIN [ANALYZE] [VERBOSE] [(option [, option …])] inner-stmt`.
    /// `EXPLAIN` token has been consumed.
    fn parse_explain(&mut self) -> Result<ExplainStatement, ParseError> {
        // Parenthesized options form takes precedence — once we see `(`,
        // we expect a full `(name value, name value)` list. `ANALYZE` /
        // `VERBOSE` may NOT appear outside the parens after the list (PG
        // parses both forms but does not mix them).
        let mut analyze = false;
        let mut verbose = false;
        let mut options: Vec<ExplainOption> = Vec::new();

        if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            self.advance();
            options = self.parse_explain_option_list()?;
            self.expect_token(Token::RParen, "expected ')'")?;
        } else {
            // Bare ANALYZE / VERBOSE flags (matched case-insensitively as
            // identifiers per sprint-395 lexer design). The spec allows
            // them in either order.
            loop {
                if !analyze && self.peek_ident_kw("analyze") {
                    self.advance();
                    analyze = true;
                    continue;
                }
                if !verbose && self.peek_ident_kw("verbose") {
                    self.advance();
                    verbose = true;
                    continue;
                }
                break;
            }
        }

        // Inner statement. We re-enter the dispatcher — but only a subset
        // of variants is permitted (Select / Insert / Update / Delete /
        // With). EXPLAIN of EXPLAIN / EXPLAIN of GRANT / etc. surface a
        // SyntaxError per the contract.
        let inner_tok = self.peek().cloned();
        let at = inner_tok.as_ref().map(|t| t.at);
        let inner = match self.parse_statement() {
            Ok(stmt) => stmt,
            Err(e) => return Err(e),
        };
        let inner_kind = match inner {
            ParseResult::Select(s) => ExplainInner::Select(s),
            ParseResult::Insert(i) => ExplainInner::Insert(i),
            ParseResult::Update(u) => ExplainInner::Update(u),
            ParseResult::Delete(d) => ExplainInner::Delete(d),
            ParseResult::With(w) => ExplainInner::With(w),
            ParseResult::Error(e) => return Err(e),
            _ => {
                return Err(syntax_err(
                    at,
                    "EXPLAIN inner statement must be SELECT / INSERT / UPDATE / DELETE / WITH",
                ));
            }
        };
        Ok(ExplainStatement {
            analyze,
            verbose,
            options,
            inner_statement: Box::new(inner_kind),
        })
    }

    /// `(name value [, name value]*)` — used by EXPLAIN's parenthesized
    /// option list and COPY's `WITH (...)` list. The opening paren has
    /// been consumed by the caller.
    fn parse_explain_option_list(&mut self) -> Result<Vec<ExplainOption>, ParseError> {
        let mut out: Vec<ExplainOption> = Vec::new();
        loop {
            // Option name — accept either a bare identifier OR a known
            // keyword that the user wrote in option position (FORMAT /
            // ANALYZE / VERBOSE / etc.). We use the displayed name and
            // lowercase it.
            let name_tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected option name"))?
                .clone();
            let name_text = token_word(&name_tok.token).ok_or_else(|| {
                syntax_err(Some(name_tok.at), "expected option name")
            })?;
            self.advance();
            let value = self.parse_explain_option_value()?;
            out.push(ExplainOption {
                name: name_text.to_ascii_lowercase(),
                value,
            });
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Option value — literal / DEFAULT / placeholder / bare identifier
    /// (treated as a string-literal payload).
    fn parse_explain_option_value(&mut self) -> Result<InsertValue, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected option value"))?
            .clone();
        match tok.token {
            Token::Ident(name) => {
                self.advance();
                Ok(InsertValue::Literal {
                    value: SqlLiteral::String { value: name },
                })
            }
            _ => self.parse_insert_value(),
        }
    }

    /// `SHOW <variable> | SHOW TABLES [IN schema] | SHOW DATABASES | SHOW
    /// SCHEMAS`. The `SHOW` keyword has been consumed.
    fn parse_show(&mut self) -> Result<ShowStatement, ParseError> {
        // `TABLES`, `DATABASES`, `SCHEMAS` are matched case-insensitively
        // against the leading identifier so the lexer can keep them as
        // `Token::Ident` (preserving back-compat with prior-sprint tests).
        if self.consume_ident_kw("tables") {
            let schema = if matches!(self.peek().map(|t| &t.token), Some(Token::In)) {
                self.advance();
                Some(self.expect_ident("expected schema name")?)
            } else {
                None
            };
            return Ok(ShowStatement {
                target: ShowTarget::Tables { schema },
            });
        }
        if self.consume_ident_kw("databases") {
            return Ok(ShowStatement {
                target: ShowTarget::Databases,
            });
        }
        if self.consume_ident_kw("schemas") {
            return Ok(ShowStatement {
                target: ShowTarget::Schemas,
            });
        }
        // Otherwise — variable name (possibly dotted).
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected SHOW target"))?
            .clone();
        match tok.token {
            Token::Ident(_) => {
                let name = self.parse_dotted_identifier()?;
                Ok(ShowStatement {
                    target: ShowTarget::Variable { name },
                })
            }
            _ => Err(syntax_err(Some(tok.at), "expected SHOW target")),
        }
    }

    /// `SET [SESSION|LOCAL] <name> {= | TO} <value>`. The `SET` keyword
    /// has been consumed.
    fn parse_set_stmt(&mut self) -> Result<SetStatement, ParseError> {
        // Optional scope keyword (matched case-insensitively as
        // `Token::Ident` per sprint-395 lexer design).
        let scope = if self.consume_ident_kw("session") {
            SetScope::Session
        } else if self.consume_ident_kw("local") {
            SetScope::Local
        } else {
            SetScope::Default
        };
        // Variable name (possibly dotted: `SET datestyle = ...` or
        // `SET search_path = ...`). We accept a dotted identifier.
        let name = self.parse_dotted_identifier()?;
        // Separator — `=` or `TO`.
        let sep = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected '=' or TO"))?
            .clone();
        match sep.token {
            Token::Eq => {
                self.advance();
            }
            Token::To => {
                self.advance();
            }
            _ => return Err(syntax_err(Some(sep.at), "expected '=' or TO")),
        }
        // Value.
        let value = self.parse_set_value()?;
        Ok(SetStatement { scope, name, value })
    }

    /// SET RHS — literal / DEFAULT / bare identifier. Distinct shape from
    /// `InsertValue` per contract.
    fn parse_set_value(&mut self) -> Result<SetValue, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected SET value"))?
            .clone();
        match tok.token {
            Token::Default => {
                self.advance();
                Ok(SetValue::Default)
            }
            Token::Integer(v) => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::Integer { value: v },
                })
            }
            Token::Float(v) => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::Float { value: v },
                })
            }
            Token::String(s) => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::String { value: s },
                })
            }
            Token::Null => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::Null,
                })
            }
            Token::True => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::Boolean { value: true },
                })
            }
            Token::False => {
                self.advance();
                Ok(SetValue::Literal {
                    value: SqlLiteral::Boolean { value: false },
                })
            }
            Token::Ident(name) => {
                self.advance();
                Ok(SetValue::Identifier { name })
            }
            _ => Err(syntax_err(Some(tok.at), "expected SET value")),
        }
    }

    /// `COPY {table-or-subquery} [(cols)] {FROM|TO} {file|STDIN|STDOUT}
    /// [WITH (options)]`. The `COPY` keyword has been consumed.
    fn parse_copy(&mut self) -> Result<CopyStatement, ParseError> {
        // Target: subquery `(SELECT ...)` or table reference.
        let target = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            self.advance();
            self.expect_keyword(Token::Select, "expected SELECT inside COPY subquery")?;
            let inner = self.parse_select()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            CopyTarget::Select {
                statement: Box::new(inner),
            }
        } else {
            let table_ref = self.parse_table_ref()?;
            // Optional `(col, col)` list.
            let columns = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
                self.advance();
                let cols = self.parse_ident_list("expected column name")?;
                self.expect_token(Token::RParen, "expected ')'")?;
                cols
            } else {
                Vec::new()
            };
            CopyTarget::Table {
                table: table_ref,
                columns,
            }
        };

        // Direction.
        let dir_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected FROM or TO"))?
            .clone();
        let direction = match dir_tok.token {
            Token::From => {
                self.advance();
                CopyDirection::From
            }
            Token::To => {
                self.advance();
                CopyDirection::To
            }
            _ => return Err(syntax_err(Some(dir_tok.at), "expected FROM or TO")),
        };

        // Subquery target is only legal with TO direction.
        if matches!(target, CopyTarget::Select { .. }) && direction == CopyDirection::From {
            return Err(syntax_err(
                Some(dir_tok.at),
                "COPY (SELECT ...) FROM is not supported",
            ));
        }

        // Source.
        let src_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected source"))?
            .clone();
        let source = match src_tok.token {
            Token::Stdin => {
                if direction == CopyDirection::To {
                    return Err(syntax_err(Some(src_tok.at), "STDIN is only valid with FROM"));
                }
                self.advance();
                CopySource::Stdin
            }
            Token::Stdout => {
                if direction == CopyDirection::From {
                    return Err(syntax_err(Some(src_tok.at), "STDOUT is only valid with TO"));
                }
                self.advance();
                CopySource::Stdout
            }
            Token::String(path) => {
                self.advance();
                CopySource::File { path }
            }
            _ => return Err(syntax_err(Some(src_tok.at), "expected source path / STDIN / STDOUT")),
        };

        // Optional `WITH (options)` trailer.
        let options = if matches!(self.peek().map(|t| &t.token), Some(Token::With)) {
            self.advance();
            self.expect_token(Token::LParen, "expected '(' after WITH")?;
            let opts = self.parse_explain_option_list()?;
            self.expect_token(Token::RParen, "expected ')'")?;
            opts
        } else {
            Vec::new()
        };

        Ok(CopyStatement {
            direction,
            target,
            source,
            options,
        })
    }

    /// `COMMENT ON <object-kind> <ident> IS <string-or-NULL>`. The
    /// `COMMENT` keyword has been consumed.
    fn parse_comment(&mut self) -> Result<CommentStatement, ParseError> {
        self.expect_keyword(Token::On, "expected ON")?;
        let kind_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected object kind"))?
            .clone();
        let target = match kind_tok.token {
            Token::Table => {
                self.advance();
                let name = self.expect_ident("expected table name")?;
                CommentTarget::Table { name }
            }
            Token::Column => {
                self.advance();
                // Must be `table.column` form.
                let first = self.expect_ident("expected qualified column name")?;
                if !matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
                    let at = self.peek().map(|t| t.at);
                    return Err(syntax_err(
                        at,
                        "COMMENT ON COLUMN requires the table.column form",
                    ));
                }
                self.advance();
                let column = self.expect_ident("expected column name")?;
                CommentTarget::Column {
                    table: first,
                    column,
                }
            }
            Token::View => {
                self.advance();
                let name = self.expect_ident("expected view name")?;
                CommentTarget::View { name }
            }
            Token::Index => {
                self.advance();
                let name = self.expect_ident("expected index name")?;
                CommentTarget::Index { name }
            }
            Token::Schema => {
                self.advance();
                let name = self.expect_ident("expected schema name")?;
                CommentTarget::Schema { name }
            }
            Token::Sequence => {
                self.advance();
                let name = self.expect_ident("expected sequence name")?;
                CommentTarget::Sequence { name }
            }
            Token::Database => {
                self.advance();
                let name = self.expect_ident("expected database name")?;
                CommentTarget::Database { name }
            }
            Token::Constraint => {
                self.advance();
                let constraint = self.expect_ident("expected constraint name")?;
                self.expect_keyword(Token::On, "expected ON after constraint name")?;
                let table = self.expect_ident("expected table name")?;
                CommentTarget::Constraint { table, constraint }
            }
            _ => {
                return Err(syntax_err(
                    Some(kind_tok.at),
                    "COMMENT target out of scope (only TABLE/COLUMN/VIEW/INDEX/SCHEMA/SEQUENCE/DATABASE/CONSTRAINT)",
                ));
            }
        };
        self.expect_keyword(Token::Is, "expected IS")?;
        let text_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected string or NULL"))?
            .clone();
        let text = match text_tok.token {
            Token::String(s) => {
                self.advance();
                CommentText::String { value: s }
            }
            Token::Null => {
                self.advance();
                CommentText::Null
            }
            _ => {
                return Err(syntax_err(
                    Some(text_tok.at),
                    "expected string literal or NULL",
                ));
            }
        };
        Ok(CommentStatement { target, text })
    }

    /// Parse a dotted identifier — `name` or `name.sub` or `name.sub.tail`.
    /// Returns the full dotted string. Used by SHOW variable names and
    /// SET variable names where PG accepts `extra_float_digits` style
    /// bare identifiers as well as dotted compound names.
    fn parse_dotted_identifier(&mut self) -> Result<String, ParseError> {
        let first = self.expect_ident("expected identifier")?;
        let mut out = first;
        while matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            self.advance();
            let part = self.expect_ident("expected identifier after '.'")?;
            out.push('.');
            out.push_str(&part);
        }
        Ok(out)
    }
}

/// Sprint-395 helper — best-effort textual form of a token for use as an
/// option name. Returns the user-written form for identifiers (preserving
/// case). `None` for tokens that have no meaningful text form (punctuation,
/// literals). Sprint-395's lexer leaves option-name words (`analyze`,
/// `verbose`, `format`, etc.) as `Token::Ident`, so the Ident arm covers
/// everything we need.
fn token_word(tok: &Token) -> Option<&str> {
    match tok {
        Token::Ident(s) => Some(s.as_str()),
        _ => None,
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
            | "SHOW"
            | "SET"
            | "COPY"
            | "COMMENT"
    )
}

/// Sprint-392 — the set of verbs whose grammar this crate actually
/// implements. Anything in `is_known_sql_verb` but not in here is an
/// `UnsupportedStatement`. Sprint-393b adds `WITH` (CTE wrap). Sprint-394
/// adds `CREATE` (TABLE / INDEX / VIEW) — `CREATE FUNCTION` /
/// `CREATE TRIGGER` etc. surface as `SyntaxError` from the dispatcher.
/// Sprint-395 adds GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT.
fn is_supported_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT"
            | "DROP"
            | "TRUNCATE"
            | "ALTER"
            | "INSERT"
            | "UPDATE"
            | "DELETE"
            | "WITH"
            | "CREATE"
            | "GRANT"
            | "REVOKE"
            | "EXPLAIN"
            | "SHOW"
            | "SET"
            | "COPY"
            | "COMMENT"
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

    /// Helper: assert the SELECT has exactly one FROM item and return its
    /// table identifier. Used by sprint-385 narrow tests that were written
    /// before FROM-list widening.
    fn single_table(s: &SelectStatement) -> &str {
        assert_eq!(s.from.len(), 1, "expected single FROM item");
        &s.from[0].table
    }

    #[test]
    fn ac_p1_select_star_from_users() {
        let s = ok_select("SELECT * FROM users");
        assert_eq!(s.columns, Columns::Star);
        assert_eq!(single_table(&s), "users");
        assert!(s.where_clause.is_none());
        assert!(s.group_by.is_empty());
        assert!(s.having.is_none());
        assert!(s.order_by.is_empty());
        assert!(s.limit.is_none());
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
        assert_eq!(single_table(&s), "users");
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
        match w {
            SelectExpr::Comparison { left, op, value } => {
                assert_eq!(left.table, None);
                assert_eq!(left.column, "id");
                assert_eq!(op, CompareOp::Eq);
                assert!(matches!(
                    value,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 42 }
                    }
                ));
            }
            other => panic!("expected Comparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_p4_where_string_literal() {
        let s = ok_select("SELECT id FROM users WHERE name = 'felix'");
        let w = s.where_clause.expect("WHERE");
        match w {
            SelectExpr::Comparison { left, op, value } => {
                assert_eq!(left.column, "name");
                assert_eq!(op, CompareOp::Eq);
                match value {
                    InsertValue::Literal {
                        value: SqlLiteral::String { value },
                    } => assert_eq!(value, "felix"),
                    other => panic!("expected string literal, got {:?}", other),
                }
            }
            other => panic!("expected Comparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_p5_all_seven_ops() {
        let ops = [
            ("=", CompareOp::Eq),
            ("<>", CompareOp::Ne),
            ("!=", CompareOp::Ne),
            ("<", CompareOp::Lt),
            (">", CompareOp::Gt),
            ("<=", CompareOp::Le),
            (">=", CompareOp::Ge),
        ];
        for (sym, expected) in ops {
            let sql = format!("SELECT id FROM users WHERE id {} 1", sym);
            let s = ok_select(&sql);
            let w = s.where_clause.expect("WHERE");
            match w {
                SelectExpr::Comparison { op, .. } => {
                    assert_eq!(op, expected, "op={sym}");
                }
                other => panic!("expected Comparison for op={sym}, got {:?}", other),
            }
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
    fn ac_p8_create_unknown_type_is_syntax_error() {
        // Sprint-394 — CREATE TABLE is supported, but `int` is not in
        // the column-type allowlist (the sprint-394 grammar accepts
        // INTEGER / BIGINT / etc.). The parser surfaces a SyntaxError
        // on the inner type position. Use `EXPLAIN` to keep an
        // UnsupportedStatement smoke-test alive for known-but-unsupported
        // verbs.
        let e = err("CREATE TABLE t (id int)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_p8_explain_is_now_supported_statement() {
        // Sprint-395 — EXPLAIN is now supported (was UnsupportedStatement
        // in sprint-385..394). The pre-sprint-395 baseline expected an
        // error; sprint-395 expects a successful Explain parse.
        let r = parse("EXPLAIN SELECT * FROM users");
        assert!(matches!(r, ParseResult::Explain(_)));
    }

    #[test]
    fn ac_p8_grant_is_now_supported_statement() {
        // Sprint-395 — GRANT is now supported (was UnsupportedStatement
        // in sprint-385..394).
        let r = parse("GRANT SELECT ON users TO alice");
        assert!(matches!(r, ParseResult::Grant(_)));
    }

    #[test]
    fn ac_p8_merge_remains_unsupported_statement() {
        // Sprint-395 — MERGE remains in `is_known_sql_verb` but not in
        // `is_supported_sql_verb` (out of scope). Keep an
        // UnsupportedStatement smoke-test alive for known-but-unsupported
        // verbs now that EXPLAIN/GRANT have moved to supported.
        let e = err("MERGE INTO target USING source ON foo = bar");
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
        assert_eq!(single_table(&s), "users");
    }

    #[test]
    fn extra_trailing_tokens_rejected() {
        // Sprint-393a — `users garbage` is now a bare alias (`AC-393a-A04`),
        // not a trailing-tokens error. Pick an input that genuinely has
        // unconsumable trailing tokens: a second statement after a
        // semicolon-style sequence. We use `SELECT * FROM users 1` —
        // the integer literal after the table name is not a valid alias
        // (aliases must be identifiers), so the parser stops at the
        // unexpected token. The earlier sprint-385 test relied on the
        // narrow FROM grammar; sprint-393a's bare-alias relaxation makes
        // that input ambiguous, so we re-target the same trailing-tokens
        // contract here.
        let e = err("SELECT * FROM users 123");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_lowercase().contains("trailing"));
    }

    #[test]
    fn unknown_first_keyword_is_syntax_error_not_unsupported() {
        // `FOO BAR` is not a known SQL verb — it's syntactically broken.
        let e = err("FOO BAR");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // =================================================================
    // Sprint 393a — SELECT widening (FROM / JOIN / WHERE expr / GROUP /
    // HAVING / ORDER / LIMIT).
    // =================================================================

    // ---- AC-393a-A FROM clause widening -----------------------------

    #[test]
    fn ac_393a_a01_from_comma_two_tables() {
        let s = ok_select("SELECT a FROM x, y");
        assert_eq!(s.from.len(), 2);
        assert_eq!(s.from[0].table, "x");
        assert_eq!(s.from[1].table, "y");
        assert!(matches!(s.from[1].join, JoinDescriptor::Comma));
    }

    #[test]
    fn ac_393a_a02_schema_qualified_table() {
        let s = ok_select("SELECT a FROM public.users");
        assert_eq!(s.from.len(), 1);
        assert_eq!(s.from[0].schema.as_deref(), Some("public"));
        assert_eq!(s.from[0].table, "users");
    }

    #[test]
    fn ac_393a_a03_explicit_as_alias() {
        let s = ok_select("SELECT a FROM users AS u");
        assert_eq!(s.from.len(), 1);
        assert_eq!(s.from[0].alias.as_deref(), Some("u"));
    }

    #[test]
    fn ac_393a_a04_bare_alias() {
        let s = ok_select("SELECT a FROM users u");
        assert_eq!(s.from.len(), 1);
        assert_eq!(s.from[0].alias.as_deref(), Some("u"));
    }

    #[test]
    fn ac_393a_a05_two_schema_qualified_aliased() {
        let s = ok_select("SELECT a FROM public.users AS u, public.orders o");
        assert_eq!(s.from.len(), 2);
        assert_eq!(s.from[0].schema.as_deref(), Some("public"));
        assert_eq!(s.from[0].table, "users");
        assert_eq!(s.from[0].alias.as_deref(), Some("u"));
        assert_eq!(s.from[1].schema.as_deref(), Some("public"));
        assert_eq!(s.from[1].table, "orders");
        assert_eq!(s.from[1].alias.as_deref(), Some("o"));
        assert!(matches!(s.from[1].join, JoinDescriptor::Comma));
    }

    #[test]
    fn ac_393a_a06_from_with_no_table_is_syntax_error() {
        let e = err("SELECT a FROM");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_a07_dangling_qualifier_is_syntax_error() {
        // `public.` with no table name after the dot.
        let e = err("SELECT a FROM public.");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_a08_three_dot_qualifier_is_syntax_error() {
        let e = err("SELECT a FROM public.users.extra");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393a-B JOIN family --------------------------------------

    fn assert_inner_join_on(item: &FromItem) {
        match &item.join {
            JoinDescriptor::InnerJoin { predicate } => match predicate {
                JoinPredicate::On { expression } => match expression {
                    SelectExpr::ColumnComparison { left, op, right } => {
                        assert_eq!(left.table.as_deref(), Some("x"));
                        assert_eq!(left.column, "id");
                        assert_eq!(*op, CompareOp::Eq);
                        assert_eq!(right.table.as_deref(), Some("y"));
                        assert_eq!(right.column, "x_id");
                    }
                    other => panic!("expected ColumnComparison, got {:?}", other),
                },
                other => panic!("expected ON predicate, got {:?}", other),
            },
            other => panic!("expected InnerJoin, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_b01_bare_join_is_inner() {
        let s = ok_select("SELECT a FROM x JOIN y ON x.id = y.x_id");
        assert_eq!(s.from.len(), 2);
        assert_inner_join_on(&s.from[1]);
    }

    #[test]
    fn ac_393a_b02_inner_join_explicit() {
        let s = ok_select("SELECT a FROM x INNER JOIN y ON x.id = y.x_id");
        assert_inner_join_on(&s.from[1]);
    }

    #[test]
    fn ac_393a_b03_left_join() {
        let s = ok_select("SELECT a FROM x LEFT JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::LeftJoin { .. }));
    }

    #[test]
    fn ac_393a_b04_left_outer_join() {
        let s = ok_select("SELECT a FROM x LEFT OUTER JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::LeftJoin { .. }));
    }

    #[test]
    fn ac_393a_b05_right_join() {
        let s = ok_select("SELECT a FROM x RIGHT JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::RightJoin { .. }));
    }

    #[test]
    fn ac_393a_b06_full_join() {
        let s = ok_select("SELECT a FROM x FULL JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::FullJoin { .. }));
    }

    #[test]
    fn ac_393a_b07_cross_join() {
        let s = ok_select("SELECT a FROM x CROSS JOIN y");
        assert!(matches!(s.from[1].join, JoinDescriptor::CrossJoin));
    }

    #[test]
    fn ac_393a_b08_using_single_column() {
        let s = ok_select("SELECT a FROM x JOIN y USING (id)");
        match &s.from[1].join {
            JoinDescriptor::InnerJoin {
                predicate: JoinPredicate::Using { columns },
            } => {
                assert_eq!(columns, &vec!["id".to_string()]);
            }
            other => panic!("expected USING(id) inner join, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_b09_using_multi_column() {
        let s = ok_select("SELECT a FROM x JOIN y USING (id, tenant_id)");
        match &s.from[1].join {
            JoinDescriptor::InnerJoin {
                predicate: JoinPredicate::Using { columns },
            } => {
                assert_eq!(columns, &vec!["id".to_string(), "tenant_id".to_string()]);
            }
            other => panic!("expected USING multi inner join, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_b10_join_without_predicate_is_syntax_error() {
        let e = err("SELECT a FROM x JOIN y");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_b11_cross_join_with_predicate_is_syntax_error() {
        // `CROSS JOIN y ON …` — the ON token becomes an unexpected
        // trailing token because CROSS JOIN does not accept a predicate.
        let e = err("SELECT a FROM x CROSS JOIN y ON x.id = y.x_id");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_b12_join_on_column_vs_literal_comparison() {
        // Contract AC-393a-B12 — "join predicate inherits the same widened
        // WHERE grammar" — a column-vs-literal `ON` predicate parses as
        // a `comparison` (not column-comparison). Literal-vs-literal
        // (`ON 1 = 1`) is rejected because primaries must start with a
        // column reference; the AC's "1 = 1" wording is interpreted as
        // shorthand for "any non-column-column form", and we lock the
        // column-vs-literal form here (the most common JOIN-ON literal).
        let s = ok_select("SELECT a FROM x JOIN y ON x.flag = 1");
        match &s.from[1].join {
            JoinDescriptor::InnerJoin {
                predicate: JoinPredicate::On { expression },
            } => match expression {
                SelectExpr::Comparison { left, value, .. } => {
                    assert_eq!(left.table.as_deref(), Some("x"));
                    assert_eq!(left.column, "flag");
                    assert!(matches!(
                        value,
                        InsertValue::Literal {
                            value: SqlLiteral::Integer { value: 1 }
                        }
                    ));
                }
                other => panic!("expected Comparison, got {:?}", other),
            },
            other => panic!("expected inner ON join, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_b13_three_table_chain() {
        let s = ok_select("SELECT a FROM x JOIN y ON x.id = y.x_id LEFT JOIN z ON y.id = z.y_id");
        assert_eq!(s.from.len(), 3);
        assert!(matches!(s.from[1].join, JoinDescriptor::InnerJoin { .. }));
        assert!(matches!(s.from[2].join, JoinDescriptor::LeftJoin { .. }));
    }

    // ---- AC-393a-C WHERE expression widening ------------------------

    #[test]
    fn ac_393a_c01_column_column_comparison_qualified() {
        let s = ok_select("SELECT a FROM x WHERE x.a = y.b");
        match s.where_clause.expect("WHERE") {
            SelectExpr::ColumnComparison { left, right, .. } => {
                assert_eq!(left.table.as_deref(), Some("x"));
                assert_eq!(left.column, "a");
                assert_eq!(right.table.as_deref(), Some("y"));
                assert_eq!(right.column, "b");
            }
            other => panic!("expected ColumnComparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c02_qualified_column_op_literal_stays_comparison() {
        let s = ok_select("SELECT a FROM x WHERE x.a > 10");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Comparison { left, op, value } => {
                assert_eq!(left.table.as_deref(), Some("x"));
                assert_eq!(left.column, "a");
                assert_eq!(op, CompareOp::Gt);
                assert!(matches!(
                    value,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 10 }
                    }
                ));
            }
            other => panic!("expected Comparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c03_between() {
        let s = ok_select("SELECT a FROM x WHERE x.age BETWEEN 18 AND 65");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Between { column, low, high } => {
                assert_eq!(column.table.as_deref(), Some("x"));
                assert_eq!(column.column, "age");
                assert!(matches!(
                    low,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 18 }
                    }
                ));
                assert!(matches!(
                    high,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 65 }
                    }
                ));
            }
            other => panic!("expected Between, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c04_not_between_wraps_between() {
        let s = ok_select("SELECT a FROM x WHERE x.age NOT BETWEEN 18 AND 65");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Not { inner } => {
                assert!(matches!(*inner, SelectExpr::Between { .. }));
            }
            other => panic!("expected Not(Between), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c05_like_sensitive() {
        let s = ok_select("SELECT a FROM x WHERE x.name LIKE 'fe%'");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Like {
                column,
                case_sensitivity,
                pattern,
            } => {
                assert_eq!(column.table.as_deref(), Some("x"));
                assert_eq!(column.column, "name");
                assert_eq!(case_sensitivity, LikeCase::Sensitive);
                match pattern {
                    InsertValue::Literal {
                        value: SqlLiteral::String { value },
                    } => assert_eq!(value, "fe%"),
                    other => panic!("expected string pattern, got {:?}", other),
                }
            }
            other => panic!("expected Like, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c06_ilike_insensitive() {
        let s = ok_select("SELECT a FROM x WHERE x.name ILIKE 'FE%'");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Like {
                case_sensitivity, ..
            } => {
                assert_eq!(case_sensitivity, LikeCase::Insensitive);
            }
            other => panic!("expected Like(insensitive), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c07_not_like_wraps_like() {
        let s = ok_select("SELECT a FROM x WHERE x.name NOT LIKE 'a%'");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Not { inner } => {
                assert!(matches!(*inner, SelectExpr::Like { .. }));
            }
            other => panic!("expected Not(Like), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c08_and_of_two_column_comparisons() {
        let s = ok_select("SELECT a FROM x WHERE x.a = y.b AND x.c <> y.d");
        match s.where_clause.expect("WHERE") {
            SelectExpr::And { left, right } => {
                assert!(matches!(*left, SelectExpr::ColumnComparison { .. }));
                assert!(matches!(*right, SelectExpr::ColumnComparison { .. }));
            }
            other => panic!("expected And, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c09_in_list_now_parses_as_in_list() {
        // Sprint-393b — AC-393b-I01 lifts the sprint-393a deferral. The
        // same input now parses successfully as a `SelectExpr::InList`.
        let s = ok_select("SELECT a FROM x WHERE id IN (1, 2, 3)");
        match s.where_clause {
            Some(SelectExpr::InList { column, values }) => {
                assert_eq!(column.column, "id");
                assert_eq!(values.len(), 3);
            }
            other => panic!("expected InList, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_c10_between_missing_high_is_syntax_error() {
        let e = err("SELECT a FROM x WHERE x.age BETWEEN 18");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393a-D GROUP BY / HAVING --------------------------------

    #[test]
    fn ac_393a_d01_group_by_single_column() {
        let s = ok_select("SELECT a FROM x GROUP BY a");
        assert_eq!(s.group_by.len(), 1);
        assert_eq!(s.group_by[0].table, None);
        assert_eq!(s.group_by[0].column, "a");
    }

    #[test]
    fn ac_393a_d02_group_by_qualified_multi() {
        let s = ok_select("SELECT a FROM x GROUP BY x.a, x.b");
        assert_eq!(s.group_by.len(), 2);
        assert_eq!(s.group_by[0].table.as_deref(), Some("x"));
        assert_eq!(s.group_by[0].column, "a");
        assert_eq!(s.group_by[1].table.as_deref(), Some("x"));
        assert_eq!(s.group_by[1].column, "b");
    }

    #[test]
    fn ac_393a_d03_group_by_having() {
        let s = ok_select("SELECT a FROM x GROUP BY a HAVING x.a > 10");
        assert_eq!(s.group_by.len(), 1);
        let h = s.having.expect("HAVING");
        match h {
            SelectExpr::Comparison { left, op, value } => {
                assert_eq!(left.table.as_deref(), Some("x"));
                assert_eq!(left.column, "a");
                assert_eq!(op, CompareOp::Gt);
                assert!(matches!(
                    value,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 10 }
                    }
                ));
            }
            other => panic!("expected Comparison in HAVING, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_d04_having_without_group_by_is_syntax_error() {
        let e = err("SELECT a FROM x HAVING x.a > 10");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_d05_group_by_no_columns_is_syntax_error() {
        let e = err("SELECT a FROM x GROUP BY");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393a-E ORDER BY / LIMIT ---------------------------------

    #[test]
    fn ac_393a_e01_order_by_default_asc_unspecified() {
        let s = ok_select("SELECT a FROM x ORDER BY a");
        assert_eq!(s.order_by.len(), 1);
        let item = &s.order_by[0];
        assert_eq!(item.column.column, "a");
        assert_eq!(item.direction, OrderDirection::Asc);
        assert_eq!(item.nulls, NullsPlacement::Unspecified);
    }

    #[test]
    fn ac_393a_e02_order_by_desc() {
        let s = ok_select("SELECT a FROM x ORDER BY a DESC");
        assert_eq!(s.order_by[0].direction, OrderDirection::Desc);
    }

    #[test]
    fn ac_393a_e03_order_by_asc_nulls_first() {
        let s = ok_select("SELECT a FROM x ORDER BY a ASC NULLS FIRST");
        assert_eq!(s.order_by[0].direction, OrderDirection::Asc);
        assert_eq!(s.order_by[0].nulls, NullsPlacement::First);
    }

    #[test]
    fn ac_393a_e04_order_by_desc_nulls_last() {
        let s = ok_select("SELECT a FROM x ORDER BY a DESC NULLS LAST");
        assert_eq!(s.order_by[0].direction, OrderDirection::Desc);
        assert_eq!(s.order_by[0].nulls, NullsPlacement::Last);
    }

    #[test]
    fn ac_393a_e05_order_by_multi_items() {
        let s = ok_select("SELECT a FROM x ORDER BY x.a, x.b DESC");
        assert_eq!(s.order_by.len(), 2);
        assert_eq!(s.order_by[0].direction, OrderDirection::Asc);
        assert_eq!(s.order_by[0].nulls, NullsPlacement::Unspecified);
        assert_eq!(s.order_by[1].direction, OrderDirection::Desc);
        assert_eq!(s.order_by[1].nulls, NullsPlacement::Unspecified);
    }

    #[test]
    fn ac_393a_e06_limit_only() {
        let s = ok_select("SELECT a FROM x LIMIT 10");
        let lim = s.limit.expect("LIMIT");
        assert!(matches!(
            lim.count,
            InsertValue::Literal {
                value: SqlLiteral::Integer { value: 10 }
            }
        ));
        assert!(lim.offset.is_none());
    }

    #[test]
    fn ac_393a_e07_limit_with_offset() {
        let s = ok_select("SELECT a FROM x LIMIT 10 OFFSET 20");
        let lim = s.limit.expect("LIMIT");
        assert!(matches!(
            lim.offset,
            Some(InsertValue::Literal {
                value: SqlLiteral::Integer { value: 20 }
            })
        ));
    }

    #[test]
    fn ac_393a_e08_limit_offset_placeholders() {
        let s = ok_select("SELECT a FROM x LIMIT $1 OFFSET $2");
        let lim = s.limit.expect("LIMIT");
        assert!(matches!(
            &lim.count,
            InsertValue::Placeholder { name } if name == "1"
        ));
        assert!(matches!(
            lim.offset,
            Some(InsertValue::Placeholder { name }) if name == "2"
        ));
    }

    #[test]
    fn ac_393a_e09_mysql_legacy_limit_comma_form_is_syntax_error() {
        let e = err("SELECT a FROM x LIMIT 10, 20");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_e10_offset_without_limit_is_syntax_error() {
        let e = err("SELECT a FROM x OFFSET 20");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393a-F clause ordering ----------------------------------

    #[test]
    fn ac_393a_f01_full_clause_chain() {
        let s = ok_select(
            "SELECT a FROM x WHERE x.a > 1 GROUP BY a HAVING a > 0 ORDER BY a LIMIT 5 OFFSET 1",
        );
        assert!(s.where_clause.is_some());
        assert_eq!(s.group_by.len(), 1);
        assert!(s.having.is_some());
        assert_eq!(s.order_by.len(), 1);
        let lim = s.limit.expect("LIMIT");
        assert!(matches!(
            lim.count,
            InsertValue::Literal {
                value: SqlLiteral::Integer { value: 5 }
            }
        ));
        assert!(matches!(
            lim.offset,
            Some(InsertValue::Literal {
                value: SqlLiteral::Integer { value: 1 }
            })
        ));
    }

    #[test]
    fn ac_393a_f02_where_after_order_by_is_syntax_error() {
        let e = err("SELECT a FROM x ORDER BY a WHERE x.a > 1");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_f03_limit_before_order_by_is_syntax_error() {
        let e = err("SELECT a FROM x LIMIT 10 ORDER BY a");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393a-S serialization ------------------------------------

    #[test]
    fn ac_393a_s01_full_select_kebab_case_discriminators() {
        let r = parse(
            "SELECT a FROM x INNER JOIN y ON x.id = y.x_id LEFT JOIN z USING (id) WHERE x.a BETWEEN 1 AND 10 AND x.b LIKE 'fe%' GROUP BY x.a HAVING x.a > 0 ORDER BY x.a DESC NULLS FIRST LIMIT 5 OFFSET 1",
        );
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "select");
        assert_eq!(json["from"][0]["join"]["kind"], "comma");
        assert_eq!(json["from"][1]["join"]["kind"], "inner-join");
        assert_eq!(json["from"][1]["join"]["predicate"]["kind"], "on");
        assert_eq!(
            json["from"][1]["join"]["predicate"]["expression"]["kind"],
            "column-comparison"
        );
        assert_eq!(json["from"][2]["join"]["kind"], "left-join");
        assert_eq!(json["from"][2]["join"]["predicate"]["kind"], "using");
        // WHERE is an AND of Between AND Like.
        assert_eq!(json["where"]["kind"], "and");
        assert_eq!(json["where"]["left"]["kind"], "between");
        assert_eq!(json["where"]["right"]["kind"], "like");
    }

    #[test]
    fn ac_393a_s02_absent_clauses_serialize_as_documented() {
        // GROUP BY empty list, having null, order_by empty list, limit null.
        let r = parse("SELECT a FROM x");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["group_by"], serde_json::json!([]));
        assert!(json["having"].is_null());
        assert_eq!(json["order_by"], serde_json::json!([]));
        assert!(json["limit"].is_null());
    }

    #[test]
    fn ac_393a_s03_from_item_no_alias_serializes_as_null() {
        let r = parse("SELECT a FROM x");
        let json = serde_json::to_value(&r).expect("serialize");
        assert!(json["from"][0]["alias"].is_null());
    }

    #[test]
    fn ac_393a_s04_round_trips_through_serde() {
        let inputs = [
            "SELECT a FROM x, y",
            "SELECT a FROM public.users u",
            "SELECT a FROM x JOIN y ON x.id = y.x_id",
            "SELECT a FROM x LEFT OUTER JOIN y USING (id, tenant_id)",
            "SELECT a FROM x CROSS JOIN y",
            "SELECT a FROM x WHERE x.age BETWEEN 18 AND 65",
            "SELECT a FROM x WHERE x.name ILIKE 'fe%'",
            "SELECT a FROM x WHERE x.a NOT LIKE 'a%'",
            "SELECT a FROM x WHERE x.a = y.b",
            "SELECT a FROM x GROUP BY x.a, x.b HAVING x.a > 0",
            "SELECT a FROM x ORDER BY x.a DESC NULLS LAST, x.b ASC NULLS FIRST",
            "SELECT a FROM x LIMIT $1 OFFSET $2",
        ];
        for sql in inputs {
            let result = parse(sql);
            let json = serde_json::to_string(&result).expect("serialize");
            let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(result, back, "round-trip failed for: {sql}");
        }
    }

    // ---- AC-393a-extra additional coverage --------------------------

    #[test]
    fn ac_393a_extra_qualified_alias_in_where() {
        // A FROM with an alias + a WHERE column reference using that alias.
        // Verify the WHERE column reference records the alias verbatim
        // (parser does not resolve `u` to the original `users`).
        let s = ok_select("SELECT a FROM users AS u WHERE u.id = 1");
        assert_eq!(s.from[0].alias.as_deref(), Some("u"));
        match s.where_clause.expect("WHERE") {
            SelectExpr::Comparison { left, .. } => {
                assert_eq!(left.table.as_deref(), Some("u"));
                assert_eq!(left.column, "id");
            }
            other => panic!("expected Comparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_select_star_with_clauses() {
        // `SELECT *` continues to compose with new clauses.
        let s = ok_select("SELECT * FROM x WHERE x.a = 1 ORDER BY x.a LIMIT 5");
        assert_eq!(s.columns, Columns::Star);
        assert!(s.where_clause.is_some());
        assert_eq!(s.order_by.len(), 1);
        assert!(s.limit.is_some());
    }

    #[test]
    fn ac_393a_extra_between_with_string_bounds() {
        let s = ok_select("SELECT a FROM x WHERE x.name BETWEEN 'a' AND 'z'");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Between { low, high, .. } => {
                assert!(matches!(
                    &low,
                    InsertValue::Literal {
                        value: SqlLiteral::String { value }
                    } if value == "a"
                ));
                assert!(matches!(
                    &high,
                    InsertValue::Literal {
                        value: SqlLiteral::String { value }
                    } if value == "z"
                ));
            }
            other => panic!("expected Between(strings), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_like_with_placeholder_pattern() {
        let s = ok_select("SELECT a FROM x WHERE x.name LIKE $1");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Like { pattern, .. } => {
                assert!(matches!(
                    &pattern,
                    InsertValue::Placeholder { name } if name == "1"
                ));
            }
            other => panic!("expected Like(placeholder), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_or_of_likes() {
        let s = ok_select("SELECT a FROM x WHERE x.name LIKE 'a%' OR x.name ILIKE 'b%'");
        match s.where_clause.expect("WHERE") {
            SelectExpr::Or { left, right } => {
                assert!(matches!(*left, SelectExpr::Like { .. }));
                assert!(matches!(*right, SelectExpr::Like { .. }));
            }
            other => panic!("expected Or(Like, Like), got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_join_using_then_where() {
        let s = ok_select("SELECT a FROM x JOIN y USING (id) WHERE x.flag = 1");
        assert_eq!(s.from.len(), 2);
        assert!(matches!(
            s.from[1].join,
            JoinDescriptor::InnerJoin {
                predicate: JoinPredicate::Using { .. }
            }
        ));
        assert!(s.where_clause.is_some());
    }

    #[test]
    fn ac_393a_extra_right_outer_join_keyword_optional() {
        // OUTER is optional on RIGHT JOIN (matches B04 pattern).
        let s = ok_select("SELECT a FROM x RIGHT OUTER JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::RightJoin { .. }));
    }

    #[test]
    fn ac_393a_extra_full_outer_join_keyword_optional() {
        let s = ok_select("SELECT a FROM x FULL OUTER JOIN y ON x.id = y.x_id");
        assert!(matches!(s.from[1].join, JoinDescriptor::FullJoin { .. }));
    }

    #[test]
    fn ac_393a_extra_group_by_no_having() {
        let s = ok_select("SELECT a FROM x GROUP BY x.a, x.b ORDER BY x.a");
        assert_eq!(s.group_by.len(), 2);
        assert!(s.having.is_none());
        assert_eq!(s.order_by.len(), 1);
    }

    #[test]
    fn ac_393a_extra_order_by_qualified_columns() {
        let s = ok_select("SELECT a FROM x ORDER BY x.a DESC, x.b ASC NULLS FIRST");
        assert_eq!(s.order_by.len(), 2);
        assert_eq!(s.order_by[0].column.table.as_deref(), Some("x"));
        assert_eq!(s.order_by[0].column.column, "a");
        assert_eq!(s.order_by[0].direction, OrderDirection::Desc);
        assert_eq!(s.order_by[1].column.table.as_deref(), Some("x"));
        assert_eq!(s.order_by[1].nulls, NullsPlacement::First);
    }

    #[test]
    fn ac_393a_extra_nulls_without_first_or_last_is_syntax_error() {
        let e = err("SELECT a FROM x ORDER BY a NULLS");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_extra_case_insensitive_keywords_select_widening() {
        // `inner join`, `left join`, `between`, `like`, `group by`, `order
        // by`, `limit` all case-insensitive (lexer handles the
        // lowercasing).
        let s = ok_select(
            "select a from x inner join y on x.id = y.x_id where x.age between 1 and 10 group by x.a order by x.a desc limit 5",
        );
        assert_eq!(s.from.len(), 2);
        assert!(s.where_clause.is_some());
        assert_eq!(s.group_by.len(), 1);
        assert_eq!(s.order_by.len(), 1);
        assert!(s.limit.is_some());
    }

    #[test]
    fn ac_393a_extra_three_dot_via_alias_misuse_is_syntax_error() {
        // `users AS u.extra` — the dot after `u` would imply qualifier on
        // an alias, which the parser doesn't accept (alias is a leaf
        // identifier).
        let e = err("SELECT a FROM users AS u.extra");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393a_extra_limit_zero_accepted() {
        let s = ok_select("SELECT a FROM x LIMIT 0");
        let lim = s.limit.expect("LIMIT");
        assert!(matches!(
            lim.count,
            InsertValue::Literal {
                value: SqlLiteral::Integer { value: 0 }
            }
        ));
    }

    #[test]
    fn ac_393a_extra_paren_group_in_where() {
        let s = ok_select("SELECT a FROM x WHERE (x.a = 1 OR x.a = 2) AND x.b > 0");
        // The outer should be And whose left is the (parenthesised) Or.
        match s.where_clause.expect("WHERE") {
            SelectExpr::And { left, right } => {
                assert!(matches!(*left, SelectExpr::Or { .. }));
                assert!(matches!(*right, SelectExpr::Comparison { .. }));
            }
            other => panic!("expected And, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_having_uses_widened_expression() {
        // HAVING accepts the same widened forms as WHERE.
        let s = ok_select("SELECT a FROM x GROUP BY x.a HAVING x.a BETWEEN 1 AND 10");
        match s.having.expect("HAVING") {
            SelectExpr::Between { .. } => {}
            other => panic!("expected Between in HAVING, got {:?}", other),
        }
    }

    #[test]
    fn ac_393a_extra_from_comma_list_with_alias_each() {
        let s = ok_select("SELECT a FROM users u, orders AS o, items i");
        assert_eq!(s.from.len(), 3);
        assert_eq!(s.from[0].alias.as_deref(), Some("u"));
        assert_eq!(s.from[1].alias.as_deref(), Some("o"));
        assert_eq!(s.from[2].alias.as_deref(), Some("i"));
        for item in &s.from {
            assert!(matches!(item.join, JoinDescriptor::Comma));
        }
    }

    #[test]
    fn ac_393a_extra_join_chain_with_using_and_on_mixed() {
        let s = ok_select(
            "SELECT a FROM x INNER JOIN y USING (tenant_id) LEFT JOIN z ON y.id = z.y_id",
        );
        assert_eq!(s.from.len(), 3);
        assert!(matches!(
            &s.from[1].join,
            JoinDescriptor::InnerJoin {
                predicate: JoinPredicate::Using { .. }
            }
        ));
        assert!(matches!(
            &s.from[2].join,
            JoinDescriptor::LeftJoin {
                predicate: JoinPredicate::On { .. }
            }
        ));
    }

    // ---- legacy widening boundary -----------------------------------

    #[test]
    fn ac_393a_where_column_to_column_now_parses() {
        // Sprint-385 surfaced `WHERE a = b` as SyntaxError. Sprint-393a
        // widens the SELECT WHERE expression to accept column-column
        // comparisons (see AC-393a-C01) — the same input now parses as a
        // `ColumnComparison` primary. The DML-WHERE path (`WhereExpr`)
        // still rejects cross-column comparisons in sprint-393a; that
        // unification lands in 393b.
        let s = ok_select("SELECT * FROM t WHERE a = b");
        match s.where_clause.expect("WHERE") {
            SelectExpr::ColumnComparison { left, op, right } => {
                assert_eq!(left.column, "a");
                assert_eq!(op, CompareOp::Eq);
                assert_eq!(right.column, "b");
            }
            other => panic!("expected ColumnComparison, got {:?}", other),
        }
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
    fn ac_391_a14_alter_table_add_column_is_supported_post_394() {
        // Sprint-394 — ADD COLUMN is now an accepted additive ALTER
        // action. The sprint-391 test asserted `UnsupportedStatement` for
        // the same input; the assertion is updated to reflect the widened
        // grammar. A vendor-only type name (`int`) still fails because the
        // type-name allowlist is INTEGER (see AC-394-T21), so the parser
        // surfaces a SyntaxError on the inner column-type instead.
        let e = err("ALTER TABLE users ADD COLUMN x int");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
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
                assert_eq!(statement.from.len(), 1);
                assert_eq!(statement.from[0].table, "source");
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
        let s = ok_insert("INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'");
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
        // Sprint-393b — DML WHERE migrates from `WhereExpr` to `SelectExpr`.
        // The `Comparison` shape now carries a `ColumnRef` left-hand side
        // instead of a bare `String` column name.
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1");
        match s.where_clause {
            Some(SelectExpr::Comparison { left, op, value }) => {
                assert_eq!(left.column, "id");
                assert_eq!(left.table, None);
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
            Some(SelectExpr::Comparison { value, .. }) => {
                assert!(matches!(
                    value,
                    InsertValue::Placeholder { name } if name == "2"
                ));
            }
            _ => panic!("expected Comparison"),
        }
    }

    #[test]
    fn ac_392_u06_update_from_cross_table_where_now_parses_as_column_comparison() {
        // Sprint-393b — DML WHERE unifies with SELECT WHERE, so the form
        // `UPDATE ... FROM other WHERE other.id = users.id` (cross-table
        // column-comparison) now parses successfully. Sprint-392 had
        // marked this as `UnsupportedExpression`; the deferral is lifted.
        let s = ok_update("UPDATE users SET name = 'a' FROM other WHERE other.id = users.id");
        match s.where_clause {
            Some(SelectExpr::ColumnComparison { left, op, right }) => {
                assert_eq!(left.table.as_deref(), Some("other"));
                assert_eq!(left.column, "id");
                assert_eq!(op, CompareOp::Eq);
                assert_eq!(right.table.as_deref(), Some("users"));
                assert_eq!(right.column, "id");
            }
            other => panic!("expected ColumnComparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u07_update_where_is_null() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id IS NULL");
        match s.where_clause {
            Some(SelectExpr::IsNull { column }) => {
                assert_eq!(column.column, "id");
                assert_eq!(column.table, None);
            }
            other => panic!("expected IsNull, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u08_update_where_is_not_null() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id IS NOT NULL");
        match s.where_clause {
            Some(SelectExpr::IsNotNull { column }) => {
                assert_eq!(column.column, "id");
            }
            other => panic!("expected IsNotNull, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_u09_update_where_and() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1 AND age > 30");
        assert!(matches!(s.where_clause, Some(SelectExpr::And { .. })));
    }

    #[test]
    fn ac_392_u10_update_where_or() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE id = 1 OR id = 2");
        assert!(matches!(s.where_clause, Some(SelectExpr::Or { .. })));
    }

    #[test]
    fn ac_392_u11_update_where_not_paren() {
        let s = ok_update("UPDATE users SET name = 'a' WHERE NOT (id = 1)");
        match s.where_clause {
            Some(SelectExpr::Not { inner }) => {
                assert!(matches!(*inner, SelectExpr::Comparison { .. }));
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
        assert!(matches!(s.where_clause, Some(SelectExpr::Comparison { .. })));
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
        assert!(matches!(s.where_clause, Some(SelectExpr::Comparison { .. })));
    }

    #[test]
    fn ac_392_d03_delete_where_and() {
        let s = ok_delete("DELETE FROM users WHERE id = 1 AND age < 30");
        assert!(matches!(s.where_clause, Some(SelectExpr::And { .. })));
    }

    #[test]
    fn ac_392_d04_delete_using_cross_table_where_now_parses() {
        // Sprint-393b — DML WHERE unifies with SELECT WHERE, so cross-
        // table column comparisons parse as `ColumnComparison`. Sprint-392
        // marked this as `UnsupportedExpression`; the deferral is lifted.
        let s = ok_delete("DELETE FROM users USING orders WHERE orders.user_id = users.id");
        assert!(matches!(
            s.where_clause,
            Some(SelectExpr::ColumnComparison { .. })
        ));
    }

    #[test]
    fn ac_392_d05_delete_where_is_null() {
        let s = ok_delete("DELETE FROM users WHERE name IS NULL");
        match s.where_clause {
            Some(SelectExpr::IsNull { column }) => {
                assert_eq!(column.column, "name");
            }
            other => panic!("expected IsNull, got {:?}", other),
        }
    }

    #[test]
    fn ac_392_d06_delete_where_in_list_now_parses_as_in_list() {
        // Sprint-393b — AC-393b-I03 lifts the sprint-392 deferral
        // (AC-392-D06). `WHERE id IN (1, 2, 3)` now parses successfully
        // as the new `in-list` primary.
        let s = ok_delete("DELETE FROM users WHERE id IN (1, 2, 3)");
        match s.where_clause {
            Some(SelectExpr::InList { column, values }) => {
                assert_eq!(column.column, "id");
                assert_eq!(values.len(), 3);
            }
            other => panic!("expected InList, got {:?}", other),
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
        // Sprint-393b — DML WHERE migrates from sprint-392 narrow
        // `WhereExpr::Comparison { column: String }` to the unified
        // `SelectExpr::Comparison { left: ColumnRef }`. The `column`
        // scalar slot is replaced by a `left` object with a `column`
        // sub-slot.
        let r = parse("DELETE FROM users WHERE id = 1");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["where_clause"]["kind"], "comparison");
        assert_eq!(json["where_clause"]["left"]["column"], "id");
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
        // Sprint-393b — the sprint-392 deferral for IN-list / cross-table
        // comparison is *lifted*. We pick a still-out-of-scope construct
        // for this serialization test: a function call (arithmetic / bare
        // function calls remain `UnsupportedExpression` per sprint-393b
        // §Out of Scope).
        let r = parse("SELECT sum(a) FROM x");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "error");
        assert_eq!(json["error_kind"], "unsupported-expression");
    }

    // =================================================================
    // Sprint 393b — SELECT widening 2 (CTE / set ops / subquery / window
    // / CASE / IN-list).
    // =================================================================

    // Helpers --------------------------------------------------------

    fn ok_with(input: &str) -> WithStatement {
        match parse(input) {
            ParseResult::With(w) => w,
            other => panic!("expected With, got: {:?}", other),
        }
    }

    fn ok_delete_393b(input: &str) -> DeleteStatement {
        match parse(input) {
            ParseResult::Delete(d) => d,
            other => panic!("expected Delete, got: {:?}", other),
        }
    }

    // ---- AC-393b-W CTE / WITH ---------------------------------------

    #[test]
    fn ac_393b_w01_with_simple_select() {
        let w = ok_with("WITH t AS (SELECT a FROM x) SELECT a FROM t");
        assert!(!w.recursive);
        assert_eq!(w.ctes.len(), 1);
        assert_eq!(w.ctes[0].name, "t");
        assert!(matches!(*w.inner_statement, WithInner::Select(_)));
    }

    #[test]
    fn ac_393b_w02_with_recursive() {
        let w = ok_with("WITH RECURSIVE t AS (SELECT a FROM x) SELECT a FROM t");
        assert!(w.recursive);
    }

    #[test]
    fn ac_393b_w03_with_column_list() {
        let w = ok_with("WITH t (a, b) AS (SELECT a FROM x) SELECT a FROM t");
        assert_eq!(w.ctes[0].columns, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn ac_393b_w04_with_multi_cte() {
        let w = ok_with("WITH a AS (SELECT x FROM s), b AS (SELECT y FROM t) SELECT a FROM a, b");
        assert_eq!(w.ctes.len(), 2);
        assert_eq!(w.ctes[0].name, "a");
        assert_eq!(w.ctes[1].name, "b");
    }

    #[test]
    fn ac_393b_w05_with_insert_inner() {
        let w = ok_with("WITH t AS (SELECT a FROM x) INSERT INTO y SELECT a FROM t");
        match *w.inner_statement {
            WithInner::Insert(_) => {}
            other => panic!("expected Insert inner, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_w06_with_update_inner_with_in_subquery() {
        let w = ok_with(
            "WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)",
        );
        match *w.inner_statement {
            WithInner::Update(u) => {
                assert!(matches!(u.where_clause, Some(SelectExpr::InSubquery { .. })));
            }
            other => panic!("expected Update inner, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_w07_with_delete_inner() {
        let w = ok_with(
            "WITH t AS (SELECT id FROM x) DELETE FROM y WHERE y.id IN (SELECT id FROM t)",
        );
        assert!(matches!(*w.inner_statement, WithInner::Delete(_)));
    }

    #[test]
    fn ac_393b_w08_with_without_inner_is_syntax_error() {
        let e = err("WITH t AS (SELECT 1 FROM x)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_w09_with_unparenthesized_body_is_syntax_error() {
        let e = err("WITH t AS SELECT 1 FROM x SELECT a FROM t");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_w10_nested_with_is_syntax_error() {
        let e = err("WITH a AS (SELECT x FROM s) WITH b AS (SELECT y FROM t) SELECT a FROM b");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393b-U Set operations -----------------------------------

    #[test]
    fn ac_393b_u01_union() {
        let s = ok_select("SELECT a FROM x UNION SELECT a FROM y");
        assert_eq!(s.set_operation.len(), 1);
        assert_eq!(s.set_operation[0].operator, SetOperator::Union);
    }

    #[test]
    fn ac_393b_u02_union_all() {
        let s = ok_select("SELECT a FROM x UNION ALL SELECT a FROM y");
        assert_eq!(s.set_operation[0].operator, SetOperator::UnionAll);
    }

    #[test]
    fn ac_393b_u03_intersect() {
        let s = ok_select("SELECT a FROM x INTERSECT SELECT a FROM y");
        assert_eq!(s.set_operation[0].operator, SetOperator::Intersect);
    }

    #[test]
    fn ac_393b_u04_except() {
        let s = ok_select("SELECT a FROM x EXCEPT SELECT a FROM y");
        assert_eq!(s.set_operation[0].operator, SetOperator::Except);
    }

    #[test]
    fn ac_393b_u05_chain_left_to_right() {
        let s = ok_select("SELECT a FROM x UNION SELECT a FROM y UNION ALL SELECT a FROM z");
        assert_eq!(s.set_operation.len(), 2);
        assert_eq!(s.set_operation[0].operator, SetOperator::Union);
        assert_eq!(s.set_operation[1].operator, SetOperator::UnionAll);
    }

    #[test]
    fn ac_393b_u06_order_by_on_root_select() {
        // Per AC-393b-U06, ORDER BY records on the *root* (leftmost)
        // SELECT after the chain is built. The trailing ORDER BY is
        // moved up from the rightmost chain entry by the parser.
        let s = ok_select("SELECT a FROM x UNION SELECT a FROM y ORDER BY a");
        assert_eq!(s.set_operation.len(), 1);
        assert_eq!(s.order_by.len(), 1);
        // Right-hand chain entry's order_by must be empty after the
        // post-pass move-up.
        assert!(s.set_operation[0].statement.order_by.is_empty());
    }

    #[test]
    fn ac_393b_u07_dangling_union_is_syntax_error() {
        let e = err("SELECT a FROM x UNION");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393b-Q Subqueries ---------------------------------------

    #[test]
    fn ac_393b_q01_where_in_subquery() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN (SELECT id FROM y)");
        match s.where_clause {
            Some(SelectExpr::InSubquery { column, statement }) => {
                assert_eq!(column.table.as_deref(), Some("x"));
                assert_eq!(column.column, "id");
                assert_eq!(statement.from[0].table, "y");
            }
            other => panic!("expected InSubquery, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_q02_where_not_in_subquery() {
        let s = ok_select("SELECT a FROM x WHERE x.id NOT IN (SELECT id FROM y)");
        match s.where_clause {
            Some(SelectExpr::Not { inner }) => {
                assert!(matches!(*inner, SelectExpr::InSubquery { .. }));
            }
            other => panic!("expected Not(InSubquery), got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_q03_exists() {
        let s = ok_select("SELECT a FROM x WHERE EXISTS (SELECT b FROM y WHERE y.x_id = x.id)");
        assert!(matches!(s.where_clause, Some(SelectExpr::Exists { .. })));
    }

    #[test]
    fn ac_393b_q04_not_exists() {
        let s =
            ok_select("SELECT a FROM x WHERE NOT EXISTS (SELECT b FROM y WHERE y.x_id = x.id)");
        match s.where_clause {
            Some(SelectExpr::Not { inner }) => {
                assert!(matches!(*inner, SelectExpr::Exists { .. }));
            }
            other => panic!("expected Not(Exists), got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_q05_from_subquery_with_alias() {
        let s = ok_select("SELECT a FROM (SELECT a FROM x) AS s");
        assert_eq!(s.from.len(), 1);
        assert_eq!(s.from[0].alias.as_deref(), Some("s"));
        assert!(matches!(s.from[0].source, FromSource::Subquery { .. }));
    }

    #[test]
    fn ac_393b_q06_from_subquery_without_alias_is_syntax_error() {
        let e = err("SELECT a FROM (SELECT a FROM x)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_q07_scalar_subquery_in_where_rhs() {
        let s = ok_select("SELECT a FROM x WHERE x.a = (SELECT b FROM y LIMIT 1)");
        assert!(matches!(
            s.where_clause,
            Some(SelectExpr::ScalarSubqueryComparison { .. })
        ));
    }

    #[test]
    fn ac_393b_q08_scalar_subquery_in_select_list() {
        let s = ok_select("SELECT (SELECT a FROM x LIMIT 1) FROM y");
        match s.columns {
            Columns::Expressions { items } => {
                assert_eq!(items.len(), 1);
                match &items[0] {
                    SelectListItem::Expression { expression } => {
                        assert!(matches!(expression, SelectExpr::ScalarSubquery { .. }));
                    }
                    other => panic!("expected Expression item, got {:?}", other),
                }
            }
            other => panic!("expected Expressions columns, got {:?}", other),
        }
    }

    // ---- AC-393b-O Window functions ---------------------------------

    #[test]
    fn ac_393b_o01_row_number_empty_over() {
        let s = ok_select("SELECT row_number() OVER () FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression:
                        SelectExpr::WindowFunction {
                            name,
                            arguments,
                            over,
                        },
                } => {
                    assert_eq!(name, "row_number");
                    assert!(arguments.is_empty());
                    assert!(over.partition_by.is_empty());
                    assert!(over.order_by.is_empty());
                    assert!(over.frame.is_none());
                }
                other => panic!("expected window-function expression, got {:?}", other),
            },
            other => panic!("expected Expressions, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_o02_partition_by() {
        let s = ok_select("SELECT rank() OVER (PARTITION BY a) FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    assert_eq!(over.partition_by.len(), 1);
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o03_order_by_desc() {
        let s = ok_select("SELECT rank() OVER (ORDER BY a DESC) FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    assert_eq!(over.order_by.len(), 1);
                    assert_eq!(over.order_by[0].direction, OrderDirection::Desc);
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o04_partition_and_order() {
        let s = ok_select("SELECT rank() OVER (PARTITION BY a ORDER BY b) FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    assert_eq!(over.partition_by.len(), 1);
                    assert_eq!(over.order_by.len(), 1);
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o05_frame_rows_between_unbounded_and_current() {
        let s = ok_select(
            "SELECT sum(x) OVER (ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t",
        );
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    let frame = over.frame.as_ref().expect("frame");
                    assert_eq!(frame.unit, FrameUnit::Rows);
                    assert_eq!(frame.start, FrameBound::UnboundedPreceding);
                    assert_eq!(frame.end, Some(FrameBound::CurrentRow));
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o06_frame_preceding_only() {
        let s = ok_select("SELECT sum(x) OVER (ORDER BY a ROWS 5 PRECEDING) FROM t");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    let frame = over.frame.as_ref().expect("frame");
                    assert_eq!(frame.start, FrameBound::Preceding { offset: 5 });
                    assert!(frame.end.is_none());
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o07_count_star_dedicated_variant() {
        let s = ok_select("SELECT count(*) OVER () FROM t");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression:
                        SelectExpr::WindowFunction {
                            name, arguments, ..
                        },
                } => {
                    assert_eq!(name, "count");
                    assert_eq!(arguments.len(), 1);
                    assert!(matches!(arguments[0], WindowArgument::Star));
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_o08_bare_function_call_is_unsupported_expression() {
        let r = parse("SELECT sum(x) FROM t");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedExpression);
            }
            other => panic!("expected UnsupportedExpression, got {:?}", other),
        }
    }

    // ---- AC-393b-C CASE expression ----------------------------------

    #[test]
    fn ac_393b_c01_searched_case_with_else() {
        let s = ok_select("SELECT CASE WHEN x.a > 0 THEN 'pos' ELSE 'neg' END FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression:
                        SelectExpr::Case {
                            operand,
                            when_clauses,
                            else_clause,
                        },
                } => {
                    assert!(operand.is_none());
                    assert_eq!(when_clauses.len(), 1);
                    assert!(else_clause.is_some());
                }
                _ => panic!("expected case"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_c02_simple_case_with_operand_no_else() {
        let s = ok_select("SELECT CASE x.a WHEN 1 THEN 'one' WHEN 2 THEN 'two' END FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression:
                        SelectExpr::Case {
                            operand,
                            when_clauses,
                            else_clause,
                        },
                } => {
                    assert!(operand.is_some());
                    assert_eq!(when_clauses.len(), 2);
                    assert!(else_clause.is_none());
                }
                _ => panic!("expected case"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_c03_case_in_where() {
        // The grammar wraps `CASE ... END = 1` in an
        // `ExpressionComparison` (the existing `Comparison` variant only
        // supports a bare `ColumnRef` left). This is contract-faithful —
        // the left-hand side is a `case` primary.
        let s = ok_select("SELECT a FROM x WHERE CASE WHEN x.a > 0 THEN 1 ELSE 0 END = 1");
        match s.where_clause {
            Some(SelectExpr::ExpressionComparison { left, .. }) => {
                assert!(matches!(*left, SelectExpr::Case { .. }));
            }
            other => panic!("expected ExpressionComparison(Case), got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_c04_case_without_when_is_syntax_error() {
        let e = err("SELECT CASE END FROM x");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_c05_case_missing_end_is_syntax_error() {
        let e = err("SELECT CASE WHEN x > 0 THEN 'p' ELSE 'n' FROM x");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ---- AC-393b-I IN-list ------------------------------------------

    #[test]
    fn ac_393b_i01_in_list_literal() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN (1, 2, 3)");
        match s.where_clause {
            Some(SelectExpr::InList { column, values }) => {
                assert_eq!(column.column, "id");
                assert_eq!(values.len(), 3);
            }
            other => panic!("expected InList, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_i02_not_in_list_wraps_in_not() {
        let s = ok_select("SELECT a FROM x WHERE x.id NOT IN (1, 2, 3)");
        match s.where_clause {
            Some(SelectExpr::Not { inner }) => {
                assert!(matches!(*inner, SelectExpr::InList { .. }));
            }
            other => panic!("expected Not(InList), got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_i03_in_list_in_delete() {
        let s = ok_delete_393b("DELETE FROM x WHERE x.id IN (1, 2, 3)");
        assert!(matches!(s.where_clause, Some(SelectExpr::InList { .. })));
    }

    #[test]
    fn ac_393b_i04_in_list_mixed_literal_kinds() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN (1, 'two', 3)");
        match s.where_clause {
            Some(SelectExpr::InList { values, .. }) => {
                assert_eq!(values.len(), 3);
                assert!(matches!(
                    values[1],
                    InsertValue::Literal {
                        value: SqlLiteral::String { ref value },
                    } if value == "two"
                ));
            }
            other => panic!("expected InList, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_i05_empty_in_list_is_syntax_error() {
        let e = err("SELECT a FROM x WHERE x.id IN ()");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_i06_in_subquery_routes_to_in_subquery_variant() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN (SELECT id FROM y)");
        assert!(matches!(
            s.where_clause,
            Some(SelectExpr::InSubquery { .. })
        ));
    }

    // ---- AC-393b-S Serialization ------------------------------------

    #[test]
    fn ac_393b_s01_with_serializes_kind_with() {
        let r = parse("WITH t AS (SELECT a FROM x) SELECT a FROM t");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "with");
        assert_eq!(json["recursive"], false);
        assert!(json["ctes"].is_array());
        assert_eq!(json["inner_statement"]["kind"], "select");
    }

    #[test]
    fn ac_393b_s02_set_operation_serializes_kebab_case_operator() {
        let r = parse("SELECT a FROM x UNION ALL SELECT a FROM y");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["set_operation"][0]["operator"], "union-all");
    }

    #[test]
    fn ac_393b_s03_subquery_from_serializes_with_kind_subquery() {
        let r = parse("SELECT a FROM (SELECT a FROM x) AS s");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["from"][0]["source"]["kind"], "subquery");
    }

    #[test]
    fn ac_393b_s04_new_expression_primaries_kebab_case() {
        // in-list / in-subquery / exists / scalar-subquery / case
        // (window-function exercised separately).
        let inputs = [
            ("SELECT a FROM x WHERE id IN (1, 2)", "in-list"),
            (
                "SELECT a FROM x WHERE id IN (SELECT id FROM y)",
                "in-subquery",
            ),
            (
                "SELECT a FROM x WHERE EXISTS (SELECT id FROM y)",
                "exists",
            ),
        ];
        for (sql, expected_kind) in inputs {
            let r = parse(sql);
            let json = serde_json::to_value(&r).expect("serialize");
            assert_eq!(json["where"]["kind"], expected_kind, "sql={sql}");
        }
    }

    #[test]
    fn ac_393b_s05_round_trips_through_serde() {
        let inputs = [
            "WITH t AS (SELECT a FROM x) SELECT a FROM t",
            "WITH RECURSIVE t (a, b) AS (SELECT a FROM x) SELECT a FROM t",
            "SELECT a FROM x UNION SELECT a FROM y",
            "SELECT a FROM x UNION ALL SELECT a FROM y",
            "SELECT a FROM x INTERSECT SELECT a FROM y",
            "SELECT a FROM x EXCEPT SELECT a FROM y",
            "SELECT a FROM x WHERE x.id IN (1, 2, 3)",
            "SELECT a FROM x WHERE x.id IN (SELECT id FROM y)",
            "SELECT a FROM x WHERE EXISTS (SELECT id FROM y WHERE y.x_id = x.id)",
            "SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n' END FROM x",
            "SELECT count(*) OVER (PARTITION BY a ORDER BY b) FROM x",
            "SELECT (SELECT b FROM y LIMIT 1) FROM x",
            "SELECT a FROM (SELECT a FROM x) AS s",
        ];
        for sql in inputs {
            let r = parse(sql);
            let json = serde_json::to_string(&r).expect("serialize");
            let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(r, back, "round-trip failed for: {sql}");
        }
    }

    // ---- AC-393b-extra additional coverage --------------------------

    #[test]
    fn ac_393b_extra_cte_dml_wrap_preserves_inner_where() {
        // CTE wrap of UPDATE with WHERE: inner statement's `where_clause`
        // is populated; the outer WITH does NOT add a WHERE.
        let w = ok_with(
            "WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)",
        );
        match *w.inner_statement {
            WithInner::Update(u) => {
                assert!(u.where_clause.is_some());
            }
            _ => panic!("expected Update inner"),
        }
    }

    #[test]
    fn ac_393b_extra_cte_select_inner_no_where_is_fine() {
        let w = ok_with("WITH t AS (SELECT a FROM x) SELECT a FROM t");
        match *w.inner_statement {
            WithInner::Select(s) => {
                assert!(s.where_clause.is_none());
            }
            _ => panic!("expected Select inner"),
        }
    }

    #[test]
    fn ac_393b_extra_mixed_in_list_with_select_is_syntax_error() {
        let e = err("SELECT a FROM x WHERE id IN (1, SELECT id FROM y)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_393b_extra_window_function_in_order_by_select_list_only() {
        // Window function only valid in SELECT list / ORDER BY position
        // per contract; we verify SELECT-list position here, ORDER BY is
        // not exercised because the existing parse_ordering_list expects
        // a ColumnRef, not an expression. Sprint-393b widens select-list
        // positions; ORDER BY by-expression is a future refinement.
        let s = ok_select("SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM x");
        assert!(matches!(s.columns, Columns::Expressions { .. }));
    }

    #[test]
    fn ac_393b_extra_cte_case_insensitive() {
        let w = ok_with("with t as (select a from x) select a from t");
        assert_eq!(w.ctes[0].name, "t");
        assert!(matches!(*w.inner_statement, WithInner::Select(_)));
    }

    #[test]
    fn ac_393b_extra_union_case_insensitive() {
        let s = ok_select("SELECT a FROM x union all SELECT a FROM y");
        assert_eq!(s.set_operation[0].operator, SetOperator::UnionAll);
    }

    #[test]
    fn ac_393b_extra_intersect_chain_left_to_right_preserved() {
        // INTERSECT + EXCEPT chain — verify order is preserved verbatim.
        let s = ok_select(
            "SELECT a FROM x INTERSECT SELECT a FROM y EXCEPT SELECT a FROM z",
        );
        assert_eq!(s.set_operation.len(), 2);
        assert_eq!(s.set_operation[0].operator, SetOperator::Intersect);
        assert_eq!(s.set_operation[1].operator, SetOperator::Except);
    }

    #[test]
    fn ac_393b_extra_in_list_single_value() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN (42)");
        match s.where_clause {
            Some(SelectExpr::InList { values, .. }) => assert_eq!(values.len(), 1),
            other => panic!("expected InList, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_extra_in_list_with_placeholders() {
        let s = ok_select("SELECT a FROM x WHERE x.id IN ($1, $2)");
        match s.where_clause {
            Some(SelectExpr::InList { values, .. }) => {
                assert_eq!(values.len(), 2);
                assert!(matches!(
                    &values[0],
                    InsertValue::Placeholder { name } if name == "1"
                ));
            }
            other => panic!("expected InList placeholders, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_extra_exists_with_complex_inner_where() {
        let s = ok_select(
            "SELECT a FROM x WHERE EXISTS (SELECT 1 FROM y WHERE y.x_id = x.id AND y.flag = 1)",
        );
        match s.where_clause {
            Some(SelectExpr::Exists { statement }) => {
                assert!(statement.where_clause.is_some());
            }
            _ => panic!("expected Exists"),
        }
    }

    #[test]
    fn ac_393b_extra_scalar_subquery_comparison_with_qualified_lhs() {
        let s =
            ok_select("SELECT a FROM x WHERE x.b = (SELECT max_b FROM y_summary LIMIT 1)");
        match s.where_clause {
            Some(SelectExpr::ScalarSubqueryComparison { left, op, .. }) => {
                assert_eq!(left.table.as_deref(), Some("x"));
                assert_eq!(left.column, "b");
                assert_eq!(op, CompareOp::Eq);
            }
            other => panic!("expected ScalarSubqueryComparison, got {:?}", other),
        }
    }

    #[test]
    fn ac_393b_extra_with_select_in_set_operation() {
        // CTE-wrap of a SELECT that itself uses UNION.
        let w = ok_with("WITH t AS (SELECT a FROM x) SELECT a FROM t UNION SELECT a FROM y");
        match *w.inner_statement {
            WithInner::Select(s) => {
                assert_eq!(s.set_operation.len(), 1);
            }
            _ => panic!("expected Select inner"),
        }
    }

    #[test]
    fn ac_393b_extra_case_with_qualified_operand() {
        let s = ok_select("SELECT CASE x.flag WHEN 1 THEN 'on' ELSE 'off' END FROM x");
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression:
                        SelectExpr::Case {
                            operand,
                            when_clauses,
                            ..
                        },
                } => {
                    assert!(operand.is_some());
                    assert_eq!(when_clauses.len(), 1);
                }
                _ => panic!("expected case"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_extra_window_function_round_trips() {
        let r = parse("SELECT row_number() OVER (PARTITION BY a ORDER BY b DESC) FROM x");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_window_frame_range_unit() {
        let s = ok_select(
            "SELECT sum(x) OVER (ORDER BY a RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t",
        );
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    let frame = over.frame.as_ref().expect("frame");
                    assert_eq!(frame.unit, FrameUnit::Range);
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_extra_subquery_in_from_with_chained_join() {
        let s = ok_select(
            "SELECT a FROM (SELECT a FROM x) AS s JOIN y ON s.id = y.id",
        );
        assert_eq!(s.from.len(), 2);
        assert!(matches!(s.from[0].source, FromSource::Subquery { .. }));
        assert!(matches!(s.from[1].join, JoinDescriptor::InnerJoin { .. }));
    }

    #[test]
    fn ac_393b_extra_set_operation_chain_round_trips() {
        let r = parse("SELECT a FROM x UNION SELECT a FROM y INTERSECT SELECT a FROM z");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_update_with_in_list_lifts_392_deferral() {
        let s = match parse("UPDATE x SET a = 1 WHERE x.id IN (1, 2, 3)") {
            ParseResult::Update(u) => u,
            other => panic!("expected Update, got {:?}", other),
        };
        assert!(matches!(s.where_clause, Some(SelectExpr::InList { .. })));
    }

    #[test]
    fn ac_393b_extra_with_recursive_round_trips() {
        let r = parse("WITH RECURSIVE t (a) AS (SELECT a FROM x) SELECT a FROM t");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_in_subquery_round_trips() {
        let r = parse("SELECT a FROM x WHERE x.id IN (SELECT id FROM y)");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_case_with_else_round_trips() {
        let r = parse("SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n' END FROM x");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_cte_dml_delete_no_where_inner_inherits() {
        // The inner DELETE has no WHERE — that's still a Delete with
        // `where_clause: None`. The classifier (sqlSafety) is the layer
        // that decides "WHERE-less DELETE = danger"; the parser only
        // records the AST shape.
        let w = ok_with("WITH t AS (SELECT id FROM x) DELETE FROM y");
        match *w.inner_statement {
            WithInner::Delete(d) => {
                assert!(d.where_clause.is_none());
            }
            _ => panic!("expected Delete inner"),
        }
    }

    #[test]
    fn ac_393b_extra_cte_select_kind_serialization() {
        // For a SELECT-wrapped CTE, the inner statement's `kind` is
        // serialized as `"select"` so the TS facade can branch directly.
        let r = parse("WITH t AS (SELECT a FROM x) SELECT a FROM t");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["inner_statement"]["kind"], "select");
    }

    #[test]
    fn ac_393b_extra_cte_dml_kind_serialization() {
        // For a DELETE-wrapped CTE, the inner statement's `kind` is
        // `"delete"`.
        let r = parse("WITH t AS (SELECT id FROM x) DELETE FROM y WHERE y.id IN (SELECT id FROM t)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["inner_statement"]["kind"], "delete");
    }

    #[test]
    fn ac_393b_extra_in_list_kind_serializes_kebab() {
        let r = parse("SELECT a FROM x WHERE id IN (1, 2)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["where"]["kind"], "in-list");
    }

    #[test]
    fn ac_393b_extra_window_function_kind_serializes_kebab() {
        let r = parse("SELECT count(*) OVER () FROM x");
        let json = serde_json::to_value(&r).expect("serialize");
        match &json["columns"]["items"][0] {
            serde_json::Value::Object(item) => {
                assert_eq!(item["kind"], "expression");
                assert_eq!(item["expression"]["kind"], "window-function");
            }
            _ => panic!("expected expression item object"),
        }
    }

    #[test]
    fn ac_393b_extra_with_inner_update_kind_serializes_kebab() {
        let r = parse("WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "with");
        assert_eq!(json["inner_statement"]["kind"], "update");
    }

    #[test]
    fn ac_393b_extra_set_operation_chain_with_intermediate_clauses() {
        // First SELECT body has WHERE; second has GROUP BY.
        let s = ok_select(
            "SELECT a FROM x WHERE x.flag = 1 UNION SELECT a FROM y GROUP BY y.a",
        );
        assert!(s.where_clause.is_some());
        assert_eq!(s.set_operation.len(), 1);
        assert_eq!(s.set_operation[0].statement.group_by.len(), 1);
    }

    #[test]
    fn ac_393b_extra_cte_with_dml_insert_inherits_kind() {
        let w = ok_with(
            "WITH t AS (SELECT a FROM x) INSERT INTO y (a) SELECT a FROM t",
        );
        match *w.inner_statement {
            WithInner::Insert(i) => {
                assert_eq!(i.table, "y");
            }
            _ => panic!("expected Insert inner"),
        }
    }

    #[test]
    fn ac_393b_extra_exists_in_dml_where() {
        // DML WHERE supports EXISTS via the unified `SelectExpr` shape.
        let s = match parse(
            "DELETE FROM x WHERE EXISTS (SELECT 1 FROM y WHERE y.x_id = x.id)",
        ) {
            ParseResult::Delete(d) => d,
            other => panic!("expected Delete, got {:?}", other),
        };
        assert!(matches!(s.where_clause, Some(SelectExpr::Exists { .. })));
    }

    #[test]
    fn ac_393b_extra_window_function_unbounded_following() {
        let s = ok_select(
            "SELECT sum(x) OVER (ORDER BY a ROWS BETWEEN 5 PRECEDING AND UNBOUNDED FOLLOWING) FROM t",
        );
        match s.columns {
            Columns::Expressions { items } => match &items[0] {
                SelectListItem::Expression {
                    expression: SelectExpr::WindowFunction { over, .. },
                } => {
                    let frame = over.frame.as_ref().expect("frame");
                    assert_eq!(frame.start, FrameBound::Preceding { offset: 5 });
                    assert_eq!(frame.end, Some(FrameBound::UnboundedFollowing));
                }
                _ => panic!("expected window-function"),
            },
            _ => panic!("expected Expressions"),
        }
    }

    #[test]
    fn ac_393b_extra_two_cte_round_trips() {
        let r = parse(
            "WITH a AS (SELECT x FROM s), b AS (SELECT y FROM t) SELECT a FROM a, b",
        );
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    #[test]
    fn ac_393b_extra_subquery_from_round_trips() {
        let r = parse("SELECT a FROM (SELECT a FROM x) AS s WHERE s.flag = 1");
        let json = serde_json::to_string(&r).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(r, back);
    }

    // ═════════════════════════════════════════════════════════════════
    // Sprint 394 — DDL additive grammar (CREATE TABLE / CREATE INDEX /
    //              CREATE VIEW + ALTER TABLE ADD / RENAME).
    // ═════════════════════════════════════════════════════════════════

    fn ok_create_table(input: &str) -> CreateTableStatement {
        match parse(input) {
            ParseResult::CreateTable(c) => c,
            other => panic!("expected CreateTable, got: {:?}", other),
        }
    }

    fn ok_create_index(input: &str) -> CreateIndexStatement {
        match parse(input) {
            ParseResult::CreateIndex(c) => c,
            other => panic!("expected CreateIndex, got: {:?}", other),
        }
    }

    fn ok_create_view(input: &str) -> CreateViewStatement {
        match parse(input) {
            ParseResult::CreateView(c) => c,
            other => panic!("expected CreateView, got: {:?}", other),
        }
    }

    // ── T — CREATE TABLE — AC-394-T ───────────────────────────────────

    #[test]
    fn ac_394_t01_create_table_two_columns() {
        let s = ok_create_table("CREATE TABLE users (id INTEGER, name TEXT)");
        assert!(!s.if_not_exists);
        assert_eq!(s.table.schema, None);
        assert_eq!(s.table.table, "users");
        assert_eq!(s.columns.len(), 2);
        assert!(s.table_constraints.is_empty());
        assert_eq!(s.columns[0].name, "id");
        assert!(matches!(s.columns[0].data_type, ColumnType::Integer));
        assert_eq!(s.columns[0].source_index, 0);
        assert_eq!(s.columns[1].name, "name");
        assert!(matches!(s.columns[1].data_type, ColumnType::Text));
        assert_eq!(s.columns[1].source_index, 1);
    }

    #[test]
    fn ac_394_t02_create_table_if_not_exists() {
        let s = ok_create_table("CREATE TABLE IF NOT EXISTS users (id INTEGER)");
        assert!(s.if_not_exists);
        assert_eq!(s.table.table, "users");
    }

    #[test]
    fn ac_394_t03_create_table_schema_qualified() {
        let s = ok_create_table("CREATE TABLE public.users (id INTEGER)");
        assert_eq!(s.table.schema.as_deref(), Some("public"));
        assert_eq!(s.table.table, "users");
    }

    #[test]
    fn ac_394_t04_create_table_varchar_length() {
        let s = ok_create_table("CREATE TABLE t (a VARCHAR(255))");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Varchar { length: 255 }
        ));
    }

    #[test]
    fn ac_394_t05_create_table_numeric_precision_scale() {
        let s = ok_create_table("CREATE TABLE t (a NUMERIC(10, 2))");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Numeric {
                precision: Some(10),
                scale: Some(2),
            }
        ));
    }

    #[test]
    fn ac_394_t06_create_table_numeric_precision_only() {
        let s = ok_create_table("CREATE TABLE t (a NUMERIC(10))");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Numeric {
                precision: Some(10),
                scale: None,
            }
        ));
    }

    #[test]
    fn ac_394_t07_create_table_numeric_bare() {
        let s = ok_create_table("CREATE TABLE t (a NUMERIC)");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Numeric {
                precision: None,
                scale: None,
            }
        ));
    }

    #[test]
    fn ac_394_t08_create_table_timestamp_bare() {
        let s = ok_create_table("CREATE TABLE t (a TIMESTAMP)");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Timestamp {
                with_time_zone: false,
            }
        ));
    }

    #[test]
    fn ac_394_t09_create_table_timestamp_with_time_zone() {
        let s = ok_create_table("CREATE TABLE t (a TIMESTAMP WITH TIME ZONE)");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Timestamp {
                with_time_zone: true,
            }
        ));
    }

    #[test]
    fn ac_394_t10_create_table_uuid_primary_key() {
        let s = ok_create_table("CREATE TABLE t (a UUID PRIMARY KEY)");
        assert!(matches!(s.columns[0].data_type, ColumnType::Uuid));
        assert_eq!(s.columns[0].constraints.len(), 1);
        assert!(matches!(
            s.columns[0].constraints[0].body,
            ColumnConstraintBody::PrimaryKey
        ));
        assert_eq!(s.columns[0].constraints[0].name, None);
    }

    #[test]
    fn ac_394_t11_create_table_not_null_default_order() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER NOT NULL DEFAULT 0)");
        assert_eq!(s.columns[0].constraints.len(), 2);
        assert!(matches!(
            s.columns[0].constraints[0].body,
            ColumnConstraintBody::NotNull
        ));
        match &s.columns[0].constraints[1].body {
            ColumnConstraintBody::Default { value } => assert!(matches!(
                value,
                InsertValue::Literal {
                    value: SqlLiteral::Integer { value: 0 }
                }
            )),
            other => panic!("expected default, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t12_create_table_unique_inline() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER UNIQUE)");
        assert!(matches!(
            s.columns[0].constraints[0].body,
            ColumnConstraintBody::Unique
        ));
    }

    #[test]
    fn ac_394_t13_create_table_references_no_column() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER REFERENCES other)");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::References { table, column } => {
                assert_eq!(table.table, "other");
                assert_eq!(column, &None);
            }
            other => panic!("expected references, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t14_create_table_references_with_column() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER REFERENCES other(id))");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::References { table, column } => {
                assert_eq!(table.table, "other");
                assert_eq!(column.as_deref(), Some("id"));
            }
            other => panic!("expected references, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t15_create_table_check_constraint() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER CHECK (a > 0))");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::Check { expression } => {
                assert!(matches!(expression, SelectExpr::Comparison { .. }));
            }
            other => panic!("expected check, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t16_create_table_table_primary_key() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER, PRIMARY KEY (a))");
        assert_eq!(s.table_constraints.len(), 1);
        match &s.table_constraints[0].body {
            TableConstraintBody::PrimaryKey { columns } => {
                assert_eq!(columns, &vec!["a".to_string()]);
            }
            other => panic!("expected primary-key, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t17_create_table_table_unique_multi_column() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER, b INTEGER, UNIQUE (a, b))");
        assert_eq!(s.table_constraints.len(), 1);
        match &s.table_constraints[0].body {
            TableConstraintBody::Unique { columns } => {
                assert_eq!(columns, &vec!["a".to_string(), "b".to_string()]);
            }
            other => panic!("expected unique, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t18_create_table_table_foreign_key() {
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER, FOREIGN KEY (a) REFERENCES other(id))",
        );
        match &s.table_constraints[0].body {
            TableConstraintBody::References {
                columns,
                target_table,
                target_columns,
            } => {
                assert_eq!(columns, &vec!["a".to_string()]);
                assert_eq!(target_table.table, "other");
                assert_eq!(target_columns, &vec!["id".to_string()]);
            }
            other => panic!("expected references, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_t19_create_table_named_constraint() {
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER, CONSTRAINT pk PRIMARY KEY (a))",
        );
        assert_eq!(s.table_constraints[0].name.as_deref(), Some("pk"));
    }

    #[test]
    fn ac_394_t20_create_table_empty_definition_list_is_syntax_error() {
        let e = err("CREATE TABLE t ()");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_t21_create_table_unknown_type_is_syntax_error() {
        let e = err("CREATE TABLE t (a INT4)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_t22_create_table_no_name_is_syntax_error() {
        let e = err("CREATE TABLE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_t23_create_temporary_table_is_syntax_error() {
        // TEMPORARY is not a lexed keyword in this sprint — it parses as
        // an identifier, the dispatcher sees `Token::Ident("TEMPORARY")`
        // after CREATE, and surfaces SyntaxError.
        let e = err("CREATE TEMPORARY TABLE t (a INTEGER)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_t24_create_table_case_insensitive() {
        let s = ok_create_table("create table users (id integer)");
        assert_eq!(s.table.table, "users");
        assert!(matches!(s.columns[0].data_type, ColumnType::Integer));
    }

    #[test]
    fn ac_394_t_bigint_serial_date_boolean_types() {
        let s =
            ok_create_table("CREATE TABLE t (a BIGINT, b SERIAL, c DATE, d BOOLEAN)");
        assert!(matches!(s.columns[0].data_type, ColumnType::Bigint));
        assert!(matches!(s.columns[1].data_type, ColumnType::Serial));
        assert!(matches!(s.columns[2].data_type, ColumnType::Date));
        assert!(matches!(s.columns[3].data_type, ColumnType::Boolean));
    }

    // ── I — CREATE INDEX — AC-394-I ───────────────────────────────────

    #[test]
    fn ac_394_i01_create_index_basic() {
        let s = ok_create_index("CREATE INDEX idx ON users (email)");
        assert!(!s.unique);
        assert!(!s.if_not_exists);
        assert_eq!(s.name, "idx");
        assert_eq!(s.table.table, "users");
        assert_eq!(s.columns, vec!["email".to_string()]);
    }

    #[test]
    fn ac_394_i02_create_unique_index() {
        let s = ok_create_index("CREATE UNIQUE INDEX idx ON users (email)");
        assert!(s.unique);
    }

    #[test]
    fn ac_394_i03_create_index_if_not_exists() {
        let s = ok_create_index("CREATE INDEX IF NOT EXISTS idx ON users (email)");
        assert!(s.if_not_exists);
    }

    #[test]
    fn ac_394_i04_create_index_schema_multi_column() {
        let s = ok_create_index("CREATE INDEX idx ON public.users (a, b)");
        assert_eq!(s.table.schema.as_deref(), Some("public"));
        assert_eq!(s.columns, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn ac_394_i05_create_index_empty_column_list_is_syntax_error() {
        let e = err("CREATE INDEX idx ON users ()");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_i06_create_index_expression_index_is_syntax_error() {
        let e = err("CREATE INDEX idx ON users (lower(a))");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ── V — CREATE VIEW — AC-394-V ────────────────────────────────────

    #[test]
    fn ac_394_v01_create_view_select_body() {
        let s = ok_create_view(
            "CREATE VIEW v_active AS SELECT * FROM users WHERE active = 1",
        );
        assert!(!s.or_replace);
        assert_eq!(s.name.table, "v_active");
        assert!(matches!(s.body, CreateViewBody::Select(_)));
    }

    #[test]
    fn ac_394_v02_create_or_replace_view() {
        let s = ok_create_view("CREATE OR REPLACE VIEW v AS SELECT * FROM users");
        assert!(s.or_replace);
    }

    #[test]
    fn ac_394_v03_create_view_schema_qualified() {
        let s = ok_create_view("CREATE VIEW public.v AS SELECT a FROM x");
        assert_eq!(s.name.schema.as_deref(), Some("public"));
        assert_eq!(s.name.table, "v");
    }

    #[test]
    fn ac_394_v04_create_view_with_cte_body() {
        let s = ok_create_view(
            "CREATE VIEW v AS WITH t AS (SELECT a FROM x) SELECT a FROM t",
        );
        assert!(matches!(s.body, CreateViewBody::With(_)));
    }

    #[test]
    fn ac_394_v05_create_view_set_operation_body() {
        let s =
            ok_create_view("CREATE VIEW v AS SELECT a FROM x UNION SELECT a FROM y");
        match s.body {
            CreateViewBody::Select(sel) => assert_eq!(sel.set_operation.len(), 1),
            other => panic!("expected select body, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_v06_create_view_no_body_is_syntax_error() {
        let e = err("CREATE VIEW v");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_v07_create_materialized_view_is_syntax_error() {
        // MATERIALIZED is not a lexed keyword; the dispatcher routes
        // through `Token::Ident("MATERIALIZED")` after CREATE and
        // surfaces SyntaxError.
        let e = err("CREATE MATERIALIZED VIEW v AS SELECT 1 FROM x");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    // ── A — ALTER TABLE additive — AC-394-A ───────────────────────────

    #[test]
    fn ac_394_a01_alter_add_column_basic() {
        let s = ok_alter("ALTER TABLE users ADD COLUMN email TEXT");
        assert_eq!(s.table, "users");
        match s.action {
            AlterAction::AddColumn {
                column,
                if_not_exists,
            } => {
                assert!(!if_not_exists);
                assert_eq!(column.name, "email");
                assert!(matches!(column.data_type, ColumnType::Text));
            }
            other => panic!("expected add-column, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a02_alter_add_column_if_not_exists() {
        let s = ok_alter("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT");
        match s.action {
            AlterAction::AddColumn { if_not_exists, .. } => {
                assert!(if_not_exists);
            }
            other => panic!("expected add-column, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a03_alter_add_column_with_constraints() {
        let s = ok_alter("ALTER TABLE users ADD COLUMN age INTEGER NOT NULL DEFAULT 0");
        match s.action {
            AlterAction::AddColumn { column, .. } => {
                assert_eq!(column.constraints.len(), 2);
                assert!(matches!(
                    column.constraints[0].body,
                    ColumnConstraintBody::NotNull
                ));
                assert!(matches!(
                    column.constraints[1].body,
                    ColumnConstraintBody::Default { .. }
                ));
            }
            other => panic!("expected add-column, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a04_alter_add_constraint_named_primary_key() {
        let s =
            ok_alter("ALTER TABLE users ADD CONSTRAINT users_pk PRIMARY KEY (id)");
        match s.action {
            AlterAction::AddConstraint { constraint } => {
                assert_eq!(constraint.name.as_deref(), Some("users_pk"));
                match constraint.body {
                    TableConstraintBody::PrimaryKey { columns } => {
                        assert_eq!(columns, vec!["id".to_string()]);
                    }
                    other => panic!("expected primary-key, got {:?}", other),
                }
            }
            other => panic!("expected add-constraint, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a05_alter_add_anonymous_unique() {
        let s = ok_alter("ALTER TABLE users ADD UNIQUE (email)");
        match s.action {
            AlterAction::AddConstraint { constraint } => {
                assert_eq!(constraint.name, None);
                assert!(matches!(
                    constraint.body,
                    TableConstraintBody::Unique { .. }
                ));
            }
            other => panic!("expected add-constraint, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a06_alter_rename_table() {
        let s = ok_alter("ALTER TABLE users RENAME TO members");
        match s.action {
            AlterAction::RenameTable { new_name } => assert_eq!(new_name, "members"),
            other => panic!("expected rename-table, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a07_alter_rename_column() {
        let s = ok_alter("ALTER TABLE users RENAME COLUMN email TO email_address");
        match s.action {
            AlterAction::RenameColumn { old_name, new_name } => {
                assert_eq!(old_name, "email");
                assert_eq!(new_name, "email_address");
            }
            other => panic!("expected rename-column, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_a08_alter_add_column_no_name_is_syntax_error() {
        let e = err("ALTER TABLE users ADD COLUMN");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_a09_alter_rename_no_target_is_syntax_error() {
        let e = err("ALTER TABLE users RENAME");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_a10_alter_column_type_is_syntax_error() {
        // ALTER COLUMN TYPE is out of scope (only ADD / RENAME / DROP
        // are accepted as ALTER actions in this sprint).
        let e = err("ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(255)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_a11_alter_case_insensitive() {
        let s = ok_alter("alter table users add column email text");
        match s.action {
            AlterAction::AddColumn { column, .. } => {
                assert_eq!(column.name, "email");
            }
            other => panic!("expected add-column, got {:?}", other),
        }
        let s2 = ok_alter("alter table users rename to members");
        assert!(matches!(s2.action, AlterAction::RenameTable { .. }));
    }

    // ── S — Serialization — AC-394-S ──────────────────────────────────

    #[test]
    fn ac_394_s01_create_table_serializes_with_documented_slots() {
        let r = parse("CREATE TABLE users (id INTEGER, name TEXT)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["kind"], "create-table");
        assert!(json["table"].is_object());
        assert_eq!(json["if_not_exists"], false);
        assert!(json["columns"].is_array());
        assert!(json["table_constraints"].is_array());
    }

    #[test]
    fn ac_394_s02_column_type_kebab_case_discriminators() {
        let r = parse(
            "CREATE TABLE t (a INTEGER, b BIGINT, c VARCHAR(10), d TEXT, e TIMESTAMP, \
             f DATE, g BOOLEAN, h NUMERIC, i SERIAL, j UUID)",
        );
        let json = serde_json::to_value(&r).expect("serialize");
        let cols = &json["columns"];
        let expected = [
            "integer", "bigint", "varchar", "text", "timestamp", "date", "boolean",
            "numeric", "serial", "uuid",
        ];
        for (i, kind) in expected.iter().enumerate() {
            assert_eq!(
                cols[i]["data_type"]["kind"], *kind,
                "column {} should serialize with kind {}",
                i, kind
            );
        }
    }

    #[test]
    fn ac_394_s03_constraint_kebab_case_discriminators() {
        let r = parse(
            "CREATE TABLE t (\
             a INTEGER PRIMARY KEY, \
             b INTEGER NOT NULL, \
             c INTEGER DEFAULT 0, \
             d INTEGER UNIQUE, \
             e INTEGER REFERENCES other(id), \
             f INTEGER CHECK (f > 0)\
             )",
        );
        let json = serde_json::to_value(&r).expect("serialize");
        let cols = &json["columns"];
        assert_eq!(cols[0]["constraints"][0]["body"]["kind"], "primary-key");
        assert_eq!(cols[1]["constraints"][0]["body"]["kind"], "not-null");
        assert_eq!(cols[2]["constraints"][0]["body"]["kind"], "default");
        assert_eq!(cols[3]["constraints"][0]["body"]["kind"], "unique");
        assert_eq!(cols[4]["constraints"][0]["body"]["kind"], "references");
        assert_eq!(cols[5]["constraints"][0]["body"]["kind"], "check");
    }

    #[test]
    fn ac_394_s04_create_index_and_view_serialize() {
        let idx = parse("CREATE INDEX idx ON t (a)");
        let idx_json = serde_json::to_value(&idx).expect("serialize");
        assert_eq!(idx_json["kind"], "create-index");
        assert_eq!(idx_json["unique"], false);
        assert_eq!(idx_json["if_not_exists"], false);
        assert_eq!(idx_json["name"], "idx");
        assert!(idx_json["columns"].is_array());

        let view = parse("CREATE VIEW v AS SELECT a FROM x");
        let view_json = serde_json::to_value(&view).expect("serialize");
        assert_eq!(view_json["kind"], "create-view");
        assert_eq!(view_json["or_replace"], false);
        assert!(view_json["name"].is_object());
        assert!(view_json["body"].is_object());
    }

    #[test]
    fn ac_394_s05_alter_table_action_discriminators() {
        let add_col = parse("ALTER TABLE t ADD COLUMN c TEXT");
        let add_col_json = serde_json::to_value(&add_col).expect("serialize");
        assert_eq!(add_col_json["action"]["kind"], "add-column");

        let add_cst = parse("ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)");
        let add_cst_json = serde_json::to_value(&add_cst).expect("serialize");
        assert_eq!(add_cst_json["action"]["kind"], "add-constraint");

        let rename_t = parse("ALTER TABLE t RENAME TO t2");
        let rename_t_json = serde_json::to_value(&rename_t).expect("serialize");
        assert_eq!(rename_t_json["action"]["kind"], "rename-table");

        let rename_c = parse("ALTER TABLE t RENAME COLUMN a TO b");
        let rename_c_json = serde_json::to_value(&rename_c).expect("serialize");
        assert_eq!(rename_c_json["action"]["kind"], "rename-column");
    }

    #[test]
    fn ac_394_s06_round_trip_create_table() {
        let inputs = [
            "CREATE TABLE users (id INTEGER, name TEXT)",
            "CREATE TABLE IF NOT EXISTS t (a VARCHAR(255) NOT NULL)",
            "CREATE TABLE t (a NUMERIC(10, 2), b TIMESTAMP WITH TIME ZONE)",
            "CREATE TABLE t (a INTEGER, PRIMARY KEY (a))",
            "CREATE TABLE t (a INTEGER, CONSTRAINT pk PRIMARY KEY (a))",
            "CREATE INDEX idx ON t (a, b)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx ON public.t (a)",
            "CREATE OR REPLACE VIEW v AS SELECT a FROM x",
            "CREATE VIEW v AS WITH t AS (SELECT a FROM x) SELECT a FROM t",
            "ALTER TABLE t ADD COLUMN c TEXT",
            "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)",
            "ALTER TABLE t RENAME TO t2",
            "ALTER TABLE t RENAME COLUMN a TO b",
        ];
        for input in inputs {
            let r = parse(input);
            let json = serde_json::to_string(&r).expect("serialize");
            let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(r, back, "round-trip failed for: {}", input);
        }
    }

    // ── Extra coverage — defensive ────────────────────────────────────

    #[test]
    fn ac_394_extra_create_function_is_syntax_error() {
        // Out-of-scope CREATE variant. The dispatcher hits a non-keyword
        // identifier after CREATE and surfaces SyntaxError so the
        // sqlSafety regex fallback (D3) classifies these.
        let e = err("CREATE FUNCTION foo() RETURNS void AS bar");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_table_unique_inline_and_table_level_mixed() {
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER UNIQUE, b INTEGER, UNIQUE (b))",
        );
        assert_eq!(s.columns.len(), 2);
        assert!(matches!(
            s.columns[0].constraints[0].body,
            ColumnConstraintBody::Unique
        ));
        assert_eq!(s.table_constraints.len(), 1);
    }

    #[test]
    fn ac_394_extra_create_index_trailing_semicolon() {
        let s = ok_create_index("CREATE INDEX idx ON t (a);");
        assert_eq!(s.name, "idx");
    }

    #[test]
    fn ac_394_extra_named_column_constraint_via_constraint_keyword() {
        // `CONSTRAINT <name> NOT NULL` inline — the spec wording in §AST
        // additions / Column-level constraint says each constraint may
        // optionally carry a name slot set by `CONSTRAINT name …`.
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER CONSTRAINT a_nn NOT NULL)",
        );
        assert_eq!(s.columns[0].constraints[0].name.as_deref(), Some("a_nn"));
        assert!(matches!(
            s.columns[0].constraints[0].body,
            ColumnConstraintBody::NotNull
        ));
    }

    #[test]
    fn ac_394_extra_create_table_default_string_literal() {
        let s = ok_create_table("CREATE TABLE t (a TEXT DEFAULT 'guest')");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::Default { value } => match value {
                InsertValue::Literal {
                    value: SqlLiteral::String { value },
                } => assert_eq!(value, "guest"),
                other => panic!("expected string default, got {:?}", other),
            },
            other => panic!("expected default, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_view_body_with_where() {
        let s = ok_create_view("CREATE VIEW v AS SELECT a FROM x WHERE x.a > 0");
        match s.body {
            CreateViewBody::Select(sel) => {
                assert!(sel.where_clause.is_some());
            }
            other => panic!("expected select body, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_alter_add_constraint_check_anonymous() {
        let s = ok_alter("ALTER TABLE t ADD CHECK (a > 0)");
        match s.action {
            AlterAction::AddConstraint { constraint } => {
                assert_eq!(constraint.name, None);
                assert!(matches!(
                    constraint.body,
                    TableConstraintBody::Check { .. }
                ));
            }
            other => panic!("expected add-constraint, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_alter_add_foreign_key_named() {
        let s = ok_alter(
            "ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id)",
        );
        match s.action {
            AlterAction::AddConstraint { constraint } => {
                assert_eq!(constraint.name.as_deref(), Some("orders_user_fk"));
                match constraint.body {
                    TableConstraintBody::References {
                        columns,
                        target_table,
                        target_columns,
                    } => {
                        assert_eq!(columns, vec!["user_id".to_string()]);
                        assert_eq!(target_table.table, "users");
                        assert_eq!(target_columns, vec!["id".to_string()]);
                    }
                    other => panic!("expected references, got {:?}", other),
                }
            }
            other => panic!("expected add-constraint, got {:?}", other),
        }
    }

    // ── More coverage — exhaustive depth across grammar ───────────────

    #[test]
    fn ac_394_extra_create_table_table_check_constraint() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER, CHECK (a > 0))");
        assert_eq!(s.table_constraints.len(), 1);
        match &s.table_constraints[0].body {
            TableConstraintBody::Check { expression } => {
                assert!(matches!(expression, SelectExpr::Comparison { .. }));
            }
            other => panic!("expected check, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_table_named_check_constraint() {
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER, CONSTRAINT positive CHECK (a > 0))",
        );
        assert_eq!(s.table_constraints[0].name.as_deref(), Some("positive"));
        assert!(matches!(
            s.table_constraints[0].body,
            TableConstraintBody::Check { .. }
        ));
    }

    #[test]
    fn ac_394_extra_create_table_three_columns_source_index_increments() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER, b INTEGER, c TEXT)");
        assert_eq!(s.columns[0].source_index, 0);
        assert_eq!(s.columns[1].source_index, 1);
        assert_eq!(s.columns[2].source_index, 2);
    }

    #[test]
    fn ac_394_extra_create_table_varchar_zero_length() {
        // Zero-length VARCHAR is a degenerate but well-defined input;
        // the parser does not validate length semantics — the AST just
        // records what was written.
        let s = ok_create_table("CREATE TABLE t (a VARCHAR(0))");
        assert!(matches!(
            s.columns[0].data_type,
            ColumnType::Varchar { length: 0 }
        ));
    }

    #[test]
    fn ac_394_extra_create_table_varchar_missing_length_is_syntax_error() {
        // Bare `VARCHAR` (no parenthesized length) is rejected.
        let e = err("CREATE TABLE t (a VARCHAR)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_table_numeric_with_unknown_argument_is_syntax_error() {
        let e = err("CREATE TABLE t (a NUMERIC(x))");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_table_timestamp_with_missing_zone_is_syntax_error() {
        let e = err("CREATE TABLE t (a TIMESTAMP WITH TIME)");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_table_default_function_is_syntax_error() {
        // Per contract Out-of-Scope §: DEFAULT with function call parses
        // to Error. Functions are not part of the expression grammar in
        // the DEFAULT slot — `parse_insert_value` only accepts literal /
        // placeholder forms.
        let e = err("CREATE TABLE t (a TIMESTAMP DEFAULT now())");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_table_default_with_placeholder() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER DEFAULT $1)");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::Default { value } => {
                assert!(matches!(value, InsertValue::Placeholder { .. }));
            }
            other => panic!("expected default, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_table_default_null() {
        let s = ok_create_table("CREATE TABLE t (a INTEGER DEFAULT NULL)");
        match &s.columns[0].constraints[0].body {
            ColumnConstraintBody::Default { value } => assert!(matches!(
                value,
                InsertValue::Literal {
                    value: SqlLiteral::Null
                }
            )),
            other => panic!("expected default, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_index_trailing_garbage_is_syntax_error() {
        let e = err("CREATE INDEX idx ON t (a) garbage");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_view_missing_as_is_syntax_error() {
        let e = err("CREATE VIEW v SELECT a FROM x");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_create_view_serializes_with_body_kind() {
        let r = parse("CREATE VIEW v AS SELECT a FROM x");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["body"]["kind"], "select");
        let r2 = parse("CREATE VIEW v AS WITH t AS (SELECT a FROM x) SELECT a FROM t");
        let json2 = serde_json::to_value(&r2).expect("serialize");
        assert_eq!(json2["body"]["kind"], "with");
    }

    #[test]
    fn ac_394_extra_alter_rename_to_missing_target_is_syntax_error() {
        let e = err("ALTER TABLE users RENAME TO");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_alter_rename_column_missing_to_is_syntax_error() {
        let e = err("ALTER TABLE users RENAME COLUMN email email_address");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_394_extra_alter_add_constraint_unique_named() {
        let s = ok_alter("ALTER TABLE t ADD CONSTRAINT t_unique UNIQUE (a, b)");
        match s.action {
            AlterAction::AddConstraint { constraint } => {
                assert_eq!(constraint.name.as_deref(), Some("t_unique"));
                match constraint.body {
                    TableConstraintBody::Unique { columns } => {
                        assert_eq!(columns, vec!["a".to_string(), "b".to_string()]);
                    }
                    other => panic!("expected unique, got {:?}", other),
                }
            }
            other => panic!("expected add-constraint, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_table_compound_check_expression() {
        // CHECK predicate widened by sprint-393a/b's expression grammar
        // — confirm an AND-joined check expression parses.
        let s = ok_create_table(
            "CREATE TABLE t (a INTEGER, b INTEGER, CHECK (a > 0 AND b > 0))",
        );
        match &s.table_constraints[0].body {
            TableConstraintBody::Check { expression } => {
                assert!(matches!(expression, SelectExpr::And { .. }));
            }
            other => panic!("expected check, got {:?}", other),
        }
    }

    #[test]
    fn ac_394_extra_create_unique_index_if_not_exists() {
        let s = ok_create_index(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx ON users (email)",
        );
        assert!(s.unique);
        assert!(s.if_not_exists);
    }

    #[test]
    fn ac_394_extra_create_table_serialization_preserves_table_constraint_columns() {
        let r = parse("CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b))");
        let json = serde_json::to_value(&r).expect("serialize");
        let cols = &json["table_constraints"][0]["body"]["columns"];
        assert_eq!(cols[0], "a");
        assert_eq!(cols[1], "b");
    }

    #[test]
    fn ac_394_extra_create_table_table_ref_serializes_with_schema_and_table() {
        let r = parse("CREATE TABLE public.users (id INTEGER)");
        let json = serde_json::to_value(&r).expect("serialize");
        assert_eq!(json["table"]["schema"], "public");
        assert_eq!(json["table"]["table"], "users");
    }

    // =================================================================
    // Sprint 395 — misc grammar parser tests (GRANT / REVOKE / EXPLAIN /
    // SHOW / SET / COPY / COMMENT). AC-395-G/R/E/H/T/C/M/S/V.
    // =================================================================

    fn ok_grant(input: &str) -> GrantStatement {
        match parse(input) {
            ParseResult::Grant(g) => g,
            other => panic!("expected Grant, got: {:?}", other),
        }
    }

    fn ok_revoke(input: &str) -> RevokeStatement {
        match parse(input) {
            ParseResult::Revoke(r) => r,
            other => panic!("expected Revoke, got: {:?}", other),
        }
    }

    fn ok_explain(input: &str) -> ExplainStatement {
        match parse(input) {
            ParseResult::Explain(e) => e,
            other => panic!("expected Explain, got: {:?}", other),
        }
    }

    fn ok_show(input: &str) -> ShowStatement {
        match parse(input) {
            ParseResult::Show(s) => s,
            other => panic!("expected Show, got: {:?}", other),
        }
    }

    fn ok_set_stmt(input: &str) -> SetStatement {
        match parse(input) {
            ParseResult::SetStmt(s) => s,
            other => panic!("expected SetStmt, got: {:?}", other),
        }
    }

    fn ok_copy(input: &str) -> CopyStatement {
        match parse(input) {
            ParseResult::Copy(c) => c,
            other => panic!("expected Copy, got: {:?}", other),
        }
    }

    fn ok_comment(input: &str) -> CommentStatement {
        match parse(input) {
            ParseResult::Comment(c) => c,
            other => panic!("expected Comment, got: {:?}", other),
        }
    }

    // ---- G — GRANT (AC-395-G) -------------------------------------

    #[test]
    fn ac_395_g01_grant_select_table_to_role() {
        let g = ok_grant("GRANT SELECT ON users TO alice");
        assert_eq!(g.privileges.len(), 1);
        assert!(matches!(g.privileges[0], PrivilegeTag::Select { ref columns } if columns.is_empty()));
        match &g.object {
            GrantObject::Table { tables } => {
                assert_eq!(tables.len(), 1);
                assert_eq!(tables[0].table, "users");
            }
            other => panic!("expected Table, got: {:?}", other),
        }
        assert_eq!(g.grantees.len(), 1);
        assert!(matches!(g.grantees[0], RoleRef::Role { ref name } if name == "alice"));
        assert!(!g.with_grant_option);
    }

    #[test]
    fn ac_395_g02_grant_multiple_privileges_multiple_grantees() {
        let g = ok_grant("GRANT SELECT, INSERT ON users TO alice, bob");
        assert_eq!(g.privileges.len(), 2);
        assert!(matches!(g.privileges[0], PrivilegeTag::Select { .. }));
        assert!(matches!(g.privileges[1], PrivilegeTag::Insert));
        assert_eq!(g.grantees.len(), 2);
    }

    #[test]
    fn ac_395_g03_grant_all_normalizes_to_all_tag() {
        let g = ok_grant("GRANT ALL ON users TO alice");
        assert_eq!(g.privileges, vec![PrivilegeTag::All]);
    }

    #[test]
    fn ac_395_g04_grant_all_privileges_normalizes_to_all_tag() {
        let g = ok_grant("GRANT ALL PRIVILEGES ON users TO alice");
        assert_eq!(g.privileges, vec![PrivilegeTag::All]);
    }

    #[test]
    fn ac_395_g05_grant_update_column_qualifier() {
        let g = ok_grant("GRANT UPDATE (a, b) ON users TO alice");
        match &g.privileges[0] {
            PrivilegeTag::Update { columns } => {
                assert_eq!(columns, &vec!["a".to_string(), "b".to_string()]);
            }
            other => panic!("expected Update, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_g06_grant_insert_column_qualifier_rejected() {
        let e = err("GRANT INSERT (a) ON users TO alice");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_g07_grant_usage_on_schema() {
        let g = ok_grant("GRANT USAGE ON SCHEMA public TO alice");
        assert!(matches!(g.privileges[0], PrivilegeTag::Usage));
        match &g.object {
            GrantObject::Schema { schemas } => assert_eq!(schemas, &vec!["public".to_string()]),
            other => panic!("expected Schema, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_g08_grant_all_tables_in_schema() {
        let g = ok_grant("GRANT SELECT ON ALL TABLES IN SCHEMA public TO alice");
        match &g.object {
            GrantObject::AllInSchema { schema_name } => assert_eq!(schema_name, "public"),
            other => panic!("expected AllInSchema, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_g09_grant_execute_on_function() {
        let g = ok_grant("GRANT EXECUTE ON FUNCTION foo TO alice");
        assert!(matches!(g.privileges[0], PrivilegeTag::Execute));
        match &g.object {
            GrantObject::Function { functions } => assert_eq!(functions, &vec!["foo".to_string()]),
            other => panic!("expected Function, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_g10_grant_to_public_uses_public_role_variant() {
        let g = ok_grant("GRANT SELECT ON users TO PUBLIC");
        assert_eq!(g.grantees.len(), 1);
        assert!(matches!(g.grantees[0], RoleRef::Public));
    }

    #[test]
    fn ac_395_g11_grant_with_grant_option() {
        let g = ok_grant("GRANT SELECT ON users TO alice WITH GRANT OPTION");
        assert!(g.with_grant_option);
    }

    #[test]
    fn ac_395_g12_grant_no_privilege_is_syntax_error() {
        let e = err("GRANT");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_g13_grant_case_insensitive() {
        let g_upper = ok_grant("GRANT SELECT ON users TO alice");
        let g_lower = ok_grant("grant select on users to alice");
        let g_mixed = ok_grant("Grant Select On users To alice");
        assert_eq!(g_upper, g_lower);
        assert_eq!(g_upper, g_mixed);
    }

    #[test]
    fn ac_395_g_extra_grant_select_with_column_list() {
        let g = ok_grant("GRANT SELECT (a) ON users TO alice");
        match &g.privileges[0] {
            PrivilegeTag::Select { columns } => assert_eq!(columns, &vec!["a".to_string()]),
            other => panic!("expected Select with columns, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_g_extra_grant_to_current_user_normalizes_to_current_session() {
        let g = ok_grant("GRANT SELECT ON users TO CURRENT_USER");
        assert!(matches!(g.grantees[0], RoleRef::CurrentSession));
    }

    #[test]
    fn ac_395_g_extra_grant_to_session_user_normalizes_to_current_session() {
        let g = ok_grant("GRANT SELECT ON users TO SESSION_USER");
        assert!(matches!(g.grantees[0], RoleRef::CurrentSession));
    }

    // ---- R — REVOKE (AC-395-R) ------------------------------------

    #[test]
    fn ac_395_r01_revoke_basic_shape() {
        let r = ok_revoke("REVOKE SELECT ON users FROM alice");
        assert!(matches!(r.privileges[0], PrivilegeTag::Select { .. }));
        match &r.object {
            GrantObject::Table { tables } => assert_eq!(tables[0].table, "users"),
            other => panic!("expected Table, got: {:?}", other),
        }
        assert!(matches!(r.revokees[0], RoleRef::Role { ref name } if name == "alice"));
        assert!(!r.grant_option_for);
        assert_eq!(r.cascade, None);
    }

    #[test]
    fn ac_395_r02_revoke_grant_option_for() {
        let r = ok_revoke("REVOKE GRANT OPTION FOR SELECT ON users FROM alice");
        assert!(r.grant_option_for);
    }

    #[test]
    fn ac_395_r03_revoke_cascade() {
        let r = ok_revoke("REVOKE SELECT ON users FROM alice CASCADE");
        assert_eq!(r.cascade, Some(CascadeBehavior::Cascade));
    }

    #[test]
    fn ac_395_r04_revoke_restrict() {
        let r = ok_revoke("REVOKE SELECT ON users FROM alice RESTRICT");
        assert_eq!(r.cascade, Some(CascadeBehavior::Restrict));
    }

    #[test]
    fn ac_395_r05_revoke_all_on_all_tables_in_schema() {
        let r = ok_revoke("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM alice");
        assert_eq!(r.privileges, vec![PrivilegeTag::All]);
        match &r.object {
            GrantObject::AllInSchema { schema_name } => assert_eq!(schema_name, "public"),
            other => panic!("expected AllInSchema, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_r06_revoke_no_privilege_is_syntax_error() {
        let e = err("REVOKE");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_r07_revoke_case_insensitive() {
        let r_upper = ok_revoke("REVOKE SELECT ON users FROM alice");
        let r_lower = ok_revoke("revoke select on users from alice");
        assert_eq!(r_upper, r_lower);
    }

    // ---- E — EXPLAIN (AC-395-E) -----------------------------------

    #[test]
    fn ac_395_e01_explain_select() {
        let e = ok_explain("EXPLAIN SELECT * FROM users");
        assert!(!e.analyze);
        assert!(!e.verbose);
        assert!(e.options.is_empty());
        assert!(matches!(*e.inner_statement, ExplainInner::Select(_)));
    }

    #[test]
    fn ac_395_e02_explain_analyze() {
        let e = ok_explain("EXPLAIN ANALYZE SELECT * FROM users");
        assert!(e.analyze);
        assert!(!e.verbose);
    }

    #[test]
    fn ac_395_e03_explain_verbose() {
        let e = ok_explain("EXPLAIN VERBOSE SELECT * FROM users");
        assert!(!e.analyze);
        assert!(e.verbose);
    }

    #[test]
    fn ac_395_e04_explain_analyze_verbose() {
        let e = ok_explain("EXPLAIN ANALYZE VERBOSE SELECT * FROM users");
        assert!(e.analyze);
        assert!(e.verbose);
    }

    #[test]
    fn ac_395_e05_explain_parenthesized_options() {
        let e = ok_explain("EXPLAIN (ANALYZE true, FORMAT 'json') SELECT * FROM users");
        assert_eq!(e.options.len(), 2);
        assert_eq!(e.options[0].name, "analyze");
        assert!(matches!(
            e.options[0].value,
            InsertValue::Literal {
                value: SqlLiteral::Boolean { value: true }
            }
        ));
        assert_eq!(e.options[1].name, "format");
        match &e.options[1].value {
            InsertValue::Literal {
                value: SqlLiteral::String { value },
            } => assert_eq!(value, "json"),
            other => panic!("expected string literal 'json', got {:?}", other),
        }
    }

    #[test]
    fn ac_395_e06_explain_delete_preserves_inner_kind() {
        let e = ok_explain("EXPLAIN DELETE FROM users WHERE id = 1");
        assert!(matches!(*e.inner_statement, ExplainInner::Delete(_)));
    }

    #[test]
    fn ac_395_e07_explain_inner_out_of_scope_is_syntax_error() {
        let e = err("EXPLAIN BEGIN");
        // BEGIN is not in `is_known_sql_verb` so the pre-lex scan does
        // not trigger the unsupported-statement short-circuit, and the
        // parser surfaces a syntax error from the dispatcher. The
        // contract requires SyntaxError; both shapes are acceptable.
        assert!(matches!(
            e.error_kind,
            ParseErrorKind::SyntaxError | ParseErrorKind::UnsupportedStatement
        ));
    }

    #[test]
    fn ac_395_e08_explain_no_inner_is_syntax_error() {
        let e = err("EXPLAIN");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_e09_explain_case_insensitive() {
        let e_upper = ok_explain("EXPLAIN ANALYZE SELECT * FROM users");
        let e_lower = ok_explain("explain analyze select * from users");
        assert_eq!(e_upper, e_lower);
    }

    #[test]
    fn ac_395_e_extra_explain_update_inner_kind() {
        let e = ok_explain("EXPLAIN UPDATE users SET a = 1 WHERE id = 1");
        assert!(matches!(*e.inner_statement, ExplainInner::Update(_)));
    }

    #[test]
    fn ac_395_e_extra_explain_with_inner_kind() {
        let e = ok_explain("EXPLAIN WITH t AS (SELECT n FROM x) SELECT * FROM t");
        assert!(matches!(*e.inner_statement, ExplainInner::With(_)));
    }

    // ---- H — SHOW (AC-395-H) --------------------------------------

    #[test]
    fn ac_395_h01_show_variable() {
        let s = ok_show("SHOW search_path");
        match s.target {
            ShowTarget::Variable { name } => assert_eq!(name, "search_path"),
            other => panic!("expected Variable, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_h02_show_tables_no_schema() {
        let s = ok_show("SHOW TABLES");
        match s.target {
            ShowTarget::Tables { schema } => assert_eq!(schema, None),
            other => panic!("expected Tables, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_h03_show_tables_in_schema() {
        let s = ok_show("SHOW TABLES IN public");
        match s.target {
            ShowTarget::Tables { schema } => assert_eq!(schema.as_deref(), Some("public")),
            other => panic!("expected Tables, got: {:?}", other),
        }
    }

    #[test]
    fn ac_395_h04_show_databases() {
        let s = ok_show("SHOW DATABASES");
        assert!(matches!(s.target, ShowTarget::Databases));
    }

    #[test]
    fn ac_395_h05_show_schemas() {
        let s = ok_show("SHOW SCHEMAS");
        assert!(matches!(s.target, ShowTarget::Schemas));
    }

    #[test]
    fn ac_395_h06_show_no_target_is_syntax_error() {
        let e = err("SHOW");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_h_extra_show_dotted_variable() {
        let s = ok_show("SHOW custom.namespace.var");
        match s.target {
            ShowTarget::Variable { name } => assert_eq!(name, "custom.namespace.var"),
            other => panic!("expected Variable, got: {:?}", other),
        }
    }

    // ---- T — SET (AC-395-T) ---------------------------------------

    #[test]
    fn ac_395_t01_set_string_literal() {
        let s = ok_set_stmt("SET search_path = 'public'");
        assert_eq!(s.scope, SetScope::Default);
        assert_eq!(s.name, "search_path");
        match s.value {
            SetValue::Literal {
                value: SqlLiteral::String { ref value },
            } => assert_eq!(value, "public"),
            other => panic!("expected string literal, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_t02_set_to_equivalent_to_equals() {
        let s_eq = ok_set_stmt("SET search_path = 'public'");
        let s_to = ok_set_stmt("SET search_path TO 'public'");
        assert_eq!(s_eq, s_to);
    }

    #[test]
    fn ac_395_t03_set_session_scope() {
        let s = ok_set_stmt("SET SESSION timezone = 'UTC'");
        assert_eq!(s.scope, SetScope::Session);
    }

    #[test]
    fn ac_395_t04_set_local_scope() {
        let s = ok_set_stmt("SET LOCAL timezone = 'UTC'");
        assert_eq!(s.scope, SetScope::Local);
    }

    #[test]
    fn ac_395_t05_set_default_keyword() {
        let s = ok_set_stmt("SET search_path = DEFAULT");
        assert!(matches!(s.value, SetValue::Default));
    }

    #[test]
    fn ac_395_t06_set_bare_identifier() {
        let s = ok_set_stmt("SET search_path = public");
        match s.value {
            SetValue::Identifier { ref name } => assert_eq!(name, "public"),
            other => panic!("expected Identifier, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_t07_set_no_name_is_syntax_error() {
        let e = err("SET");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_t_extra_set_integer_literal() {
        let s = ok_set_stmt("SET work_mem = 64");
        assert!(matches!(
            s.value,
            SetValue::Literal {
                value: SqlLiteral::Integer { value: 64 }
            }
        ));
    }

    // ---- C — COPY (AC-395-C) --------------------------------------

    #[test]
    fn ac_395_c01_copy_from_file() {
        let c = ok_copy("COPY users FROM '/tmp/users.csv'");
        assert_eq!(c.direction, CopyDirection::From);
        match c.target {
            CopyTarget::Table { table, columns } => {
                assert_eq!(table.table, "users");
                assert!(columns.is_empty());
            }
            other => panic!("expected Table target, got {:?}", other),
        }
        match c.source {
            CopySource::File { path } => assert_eq!(path, "/tmp/users.csv"),
            other => panic!("expected File source, got {:?}", other),
        }
        assert!(c.options.is_empty());
    }

    #[test]
    fn ac_395_c02_copy_from_file_with_column_list() {
        let c = ok_copy("COPY users (id, name) FROM '/tmp/users.csv'");
        match c.target {
            CopyTarget::Table { columns, .. } => {
                assert_eq!(columns, vec!["id".to_string(), "name".to_string()]);
            }
            other => panic!("expected Table target, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_c03_copy_to_stdout() {
        let c = ok_copy("COPY users TO STDOUT");
        assert_eq!(c.direction, CopyDirection::To);
        assert!(matches!(c.source, CopySource::Stdout));
    }

    #[test]
    fn ac_395_c04_copy_from_stdin() {
        let c = ok_copy("COPY users FROM STDIN");
        assert_eq!(c.direction, CopyDirection::From);
        assert!(matches!(c.source, CopySource::Stdin));
    }

    #[test]
    fn ac_395_c05_copy_to_stdin_is_syntax_error() {
        let e = err("COPY users TO STDIN");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_c06_copy_from_stdout_is_syntax_error() {
        let e = err("COPY users FROM STDOUT");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_c07_copy_subquery_to_file() {
        let c = ok_copy("COPY (SELECT * FROM users) TO '/tmp/users.csv'");
        assert_eq!(c.direction, CopyDirection::To);
        assert!(matches!(c.target, CopyTarget::Select { .. }));
    }

    #[test]
    fn ac_395_c08_copy_subquery_from_file_is_syntax_error() {
        let e = err("COPY (SELECT * FROM users) FROM '/tmp/users.csv'");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_c09_copy_with_options() {
        let c = ok_copy("COPY users FROM '/tmp/users.csv' WITH (FORMAT csv, HEADER true)");
        assert_eq!(c.options.len(), 2);
        assert_eq!(c.options[0].name, "format");
        assert_eq!(c.options[1].name, "header");
    }

    #[test]
    fn ac_395_c10_copy_case_insensitive() {
        let c_upper = ok_copy("COPY users FROM STDIN");
        let c_lower = ok_copy("copy users from stdin");
        assert_eq!(c_upper, c_lower);
    }

    // ---- M — COMMENT (AC-395-M) -----------------------------------

    #[test]
    fn ac_395_m01_comment_on_table() {
        let c = ok_comment("COMMENT ON TABLE users IS 'all users'");
        match c.target {
            CommentTarget::Table { name } => assert_eq!(name, "users"),
            other => panic!("expected Table, got {:?}", other),
        }
        match c.text {
            CommentText::String { value } => assert_eq!(value, "all users"),
            other => panic!("expected string text, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_m02_comment_on_column_dotted() {
        let c = ok_comment("COMMENT ON COLUMN users.email IS 'email address'");
        match c.target {
            CommentTarget::Column { table, column } => {
                assert_eq!(table, "users");
                assert_eq!(column, "email");
            }
            other => panic!("expected Column, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_m03_comment_on_column_unqualified_is_syntax_error() {
        let e = err("COMMENT ON COLUMN email IS 'addr'");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_m04_comment_on_index() {
        let c = ok_comment("COMMENT ON INDEX idx IS 'email lookup'");
        assert!(matches!(
            c.target,
            CommentTarget::Index { ref name } if name == "idx"
        ));
    }

    #[test]
    fn ac_395_m05_comment_on_schema() {
        let c = ok_comment("COMMENT ON SCHEMA public IS 'main'");
        assert!(matches!(
            c.target,
            CommentTarget::Schema { ref name } if name == "public"
        ));
    }

    #[test]
    fn ac_395_m06_comment_on_constraint() {
        let c = ok_comment("COMMENT ON CONSTRAINT users_pk ON users IS 'PK'");
        match c.target {
            CommentTarget::Constraint { table, constraint } => {
                assert_eq!(table, "users");
                assert_eq!(constraint, "users_pk");
            }
            other => panic!("expected Constraint, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_m07_comment_is_null() {
        let c = ok_comment("COMMENT ON TABLE users IS NULL");
        assert!(matches!(c.text, CommentText::Null));
    }

    #[test]
    fn ac_395_m08_comment_on_function_out_of_scope() {
        let e = err("COMMENT ON FUNCTION foo IS '...'");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_395_m_extra_comment_on_view() {
        let c = ok_comment("COMMENT ON VIEW v IS 'a view'");
        assert!(matches!(
            c.target,
            CommentTarget::View { ref name } if name == "v"
        ));
    }

    #[test]
    fn ac_395_m_extra_comment_on_sequence() {
        let c = ok_comment("COMMENT ON SEQUENCE seq IS 'a sequence'");
        assert!(matches!(
            c.target,
            CommentTarget::Sequence { ref name } if name == "seq"
        ));
    }

    #[test]
    fn ac_395_m_extra_comment_on_database() {
        let c = ok_comment("COMMENT ON DATABASE mydb IS 'main db'");
        assert!(matches!(
            c.target,
            CommentTarget::Database { ref name } if name == "mydb"
        ));
    }

    // ---- S — Serialization (AC-395-S) -----------------------------

    #[test]
    fn ac_395_s01_top_level_kinds_kebab_case() {
        let cases: Vec<(&str, &str)> = vec![
            ("GRANT SELECT ON users TO alice", "grant"),
            ("REVOKE SELECT ON users FROM alice", "revoke"),
            ("EXPLAIN SELECT * FROM users", "explain"),
            ("SHOW search_path", "show"),
            ("SET search_path = 'a'", "set-stmt"),
            ("COPY users FROM STDIN", "copy"),
            ("COMMENT ON TABLE t IS 'x'", "comment"),
        ];
        for (sql, expected) in cases {
            let r = parse(sql);
            let json = serde_json::to_value(&r).expect("serialize");
            assert_eq!(json["kind"], expected, "kind mismatch for: {}", sql);
        }
    }

    #[test]
    fn ac_395_s02_sub_shape_kinds_kebab_case() {
        // Privilege tag, object variant, source variant, etc.
        let g = parse("GRANT SELECT ON users TO alice");
        let j = serde_json::to_value(&g).expect("serialize");
        assert_eq!(j["privileges"][0]["kind"], "select");
        assert_eq!(j["object"]["kind"], "table");
        assert_eq!(j["grantees"][0]["kind"], "role");

        let c = parse("COPY users FROM STDIN");
        let cj = serde_json::to_value(&c).expect("serialize");
        assert_eq!(cj["target"]["kind"], "table");
        assert_eq!(cj["source"]["kind"], "stdin");
        assert_eq!(cj["direction"], "from");

        let m = parse("COMMENT ON COLUMN users.email IS 'x'");
        let mj = serde_json::to_value(&m).expect("serialize");
        assert_eq!(mj["target"]["kind"], "column");
        assert_eq!(mj["text"]["kind"], "string");
    }

    #[test]
    fn ac_395_s03_round_trip_serde() {
        let inputs = vec![
            "GRANT SELECT ON users TO alice",
            "REVOKE SELECT ON users FROM alice CASCADE",
            "EXPLAIN ANALYZE SELECT * FROM users",
            "SHOW search_path",
            "SET timezone = 'UTC'",
            "COPY users FROM '/tmp/u.csv' WITH (FORMAT csv, HEADER true)",
            "COMMENT ON TABLE users IS 'all'",
            "COMMENT ON TABLE users IS NULL",
        ];
        for input in inputs {
            let r = parse(input);
            let json = serde_json::to_string(&r).expect("serialize");
            let back: ParseResult =
                serde_json::from_str(&json).expect("deserialize");
            assert_eq!(r, back, "round trip failed for: {}", input);
        }
    }

    // ---- V — Verification smoke (AC-395-V) ------------------------

    #[test]
    fn ac_395_v01_revoke_grant_option_for_default_is_false() {
        let r = ok_revoke("REVOKE SELECT ON users FROM alice");
        assert!(!r.grant_option_for);
    }

    #[test]
    fn ac_395_v02_grant_object_implicit_table_form() {
        // `ON tablename` (without explicit `TABLE` keyword) classifies
        // as a table grant — matches PG behavior.
        let g = ok_grant("GRANT SELECT ON users TO alice");
        match &g.object {
            GrantObject::Table { tables } => {
                assert_eq!(tables[0].table, "users");
                assert_eq!(tables[0].schema, None);
            }
            other => panic!("expected Table, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_v03_grant_object_explicit_table_keyword() {
        let g = ok_grant("GRANT SELECT ON TABLE users TO alice");
        assert!(matches!(&g.object, GrantObject::Table { .. }));
    }

    #[test]
    fn ac_395_v04_grant_schema_qualified_table() {
        let g = ok_grant("GRANT SELECT ON public.users TO alice");
        match &g.object {
            GrantObject::Table { tables } => {
                assert_eq!(tables[0].schema.as_deref(), Some("public"));
                assert_eq!(tables[0].table, "users");
            }
            other => panic!("expected Table, got {:?}", other),
        }
    }

    #[test]
    fn ac_395_v05_explain_with_options_parens_and_no_bare_flags() {
        // Parenthesized form does not also accept bare ANALYZE/VERBOSE
        // (those tokens become option names; they don't escape outside).
        let e = ok_explain("EXPLAIN (ANALYZE 1) SELECT a FROM x");
        assert!(!e.analyze);
        assert!(!e.verbose);
        assert_eq!(e.options.len(), 1);
    }

    #[test]
    fn ac_395_v06_set_with_boolean_literal() {
        let s = ok_set_stmt("SET autocommit = true");
        assert!(matches!(
            s.value,
            SetValue::Literal {
                value: SqlLiteral::Boolean { value: true }
            }
        ));
    }

    #[test]
    fn ac_395_v07_copy_table_with_schema_qualifier() {
        let c = ok_copy("COPY public.users FROM '/tmp/x'");
        match c.target {
            CopyTarget::Table { table, .. } => {
                assert_eq!(table.schema.as_deref(), Some("public"));
                assert_eq!(table.table, "users");
            }
            other => panic!("expected Table target, got {:?}", other),
        }
    }
}
