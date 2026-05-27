use super::*;

impl Parser<'_> {
    /// `GRANT priv [, priv]* ON object TO grantee [, grantee]* [WITH GRANT
    /// OPTION]`. The `GRANT` keyword has been consumed.
    pub(super) fn parse_grant(&mut self) -> Result<GrantStatement, ParseError> {
        let privileges = self.parse_privilege_list()?;
        self.expect_keyword(Token::On, "expected ON")?;
        let object = self.parse_grant_object()?;
        self.expect_keyword(Token::To, "expected TO")?;
        let grantees = self.parse_role_list()?;
        let with_grant_option = if matches!(self.peek().map(|t| &t.token), Some(Token::With)) {
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
    pub(super) fn parse_revoke(&mut self) -> Result<RevokeStatement, ParseError> {
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
            Token::Select => (
                PrivilegeTag::Select {
                    columns: Vec::new(),
                },
                true,
            ),
            Token::Insert => (PrivilegeTag::Insert, false),
            Token::Update => (
                PrivilegeTag::Update {
                    columns: Vec::new(),
                },
                true,
            ),
            Token::Delete => (PrivilegeTag::Delete, false),
            Token::Truncate => (PrivilegeTag::Truncate, false),
            Token::References => (
                PrivilegeTag::References {
                    columns: Vec::new(),
                },
                true,
            ),
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
                PrivilegeTag::References { .. } => PrivilegeTag::References { columns: cols },
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
    pub(super) fn parse_explain(&mut self) -> Result<ExplainStatement, ParseError> {
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
        let inner = self.parse_statement()?;
        let inner_kind = match inner {
            ParseResult::Select(s) => ExplainInner::Select(s),
            ParseResult::Insert(i) => ExplainInner::Insert(i),
            ParseResult::Update(u) => ExplainInner::Update(u),
            ParseResult::Delete(d) => ExplainInner::Delete(d),
            ParseResult::Merge(m) => ExplainInner::Merge(m),
            ParseResult::With(w) => ExplainInner::With(w),
            ParseResult::Error(e) => return Err(e),
            _ => {
                return Err(syntax_err(
                    at,
                    "EXPLAIN inner statement must be SELECT / INSERT / UPDATE / DELETE / MERGE / WITH",
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
            let name_text = token_word(&name_tok.token)
                .ok_or_else(|| syntax_err(Some(name_tok.at), "expected option name"))?;
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
    pub(super) fn parse_show(&mut self) -> Result<ShowStatement, ParseError> {
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
    pub(super) fn parse_set_stmt(&mut self) -> Result<SetStatement, ParseError> {
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
    pub(super) fn parse_copy(&mut self) -> Result<CopyStatement, ParseError> {
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
                    return Err(syntax_err(
                        Some(src_tok.at),
                        "STDIN is only valid with FROM",
                    ));
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
            _ => {
                return Err(syntax_err(
                    Some(src_tok.at),
                    "expected source path / STDIN / STDOUT",
                ))
            }
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
    pub(super) fn parse_comment(&mut self) -> Result<CommentStatement, ParseError> {
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
