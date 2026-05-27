use super::*;

impl Parser<'_> {
    // ---------------------------------------------------------------
    // Sprint 392 — DML write triad sub-parsers (INSERT / UPDATE / DELETE).
    // ---------------------------------------------------------------

    /// `INSERT INTO <table> [(cols)] (VALUES … | DEFAULT VALUES | SELECT …)
    ///  [ON CONFLICT …] [ON DUPLICATE KEY UPDATE …] [RETURNING …]`.
    /// Assumes `INSERT` has been consumed.
    pub(super) fn parse_insert(&mut self) -> Result<InsertStatement, ParseError> {
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

        // optional ON CONFLICT / ON DUPLICATE KEY UPDATE
        let mut on_conflict = None;
        let mut on_duplicate_key_update = None;
        if matches!(self.peek().map(|t| &t.token), Some(Token::On)) {
            self.advance();
            match self.peek().map(|t| &t.token) {
                Some(Token::Conflict) => {
                    self.advance();
                    on_conflict = Some(self.parse_on_conflict_action()?);
                }
                Some(Token::Ident(name)) if name.eq_ignore_ascii_case("duplicate") => {
                    on_duplicate_key_update = Some(self.parse_on_duplicate_key_update()?);
                }
                Some(_) | None => {
                    let at = self.peek().map(|t| t.at);
                    return Err(syntax_err(at, "expected CONFLICT or DUPLICATE"));
                }
            }
        }

        // optional RETURNING
        let returning = self.parse_optional_returning()?;

        Ok(InsertStatement {
            table,
            columns,
            source,
            on_conflict,
            on_duplicate_key_update,
            returning,
        })
    }

    /// `UPDATE <table> SET <col> = <value>[, …] [FROM …] [WHERE …]
    ///  [RETURNING …]`. Assumes `UPDATE` has been consumed.
    pub(super) fn parse_update(&mut self) -> Result<UpdateStatement, ParseError> {
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
    pub(super) fn parse_delete(&mut self) -> Result<DeleteStatement, ParseError> {
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

    /// PostgreSQL `MERGE INTO <target> [AS alias] USING <source> [AS alias]
    /// ON <predicate> WHEN ... THEN ...`. This first slice accepts only table
    /// sources and UPDATE / INSERT / DO NOTHING actions.
    pub(super) fn parse_merge(&mut self) -> Result<MergeStatement, ParseError> {
        self.expect_keyword(Token::Into, "expected INTO")?;
        let (target, target_alias) = self.parse_merge_relation()?;
        self.expect_keyword(Token::Using, "expected USING")?;
        let (source, source_alias) = self.parse_merge_relation()?;
        self.expect_keyword(Token::On, "expected ON")?;
        let on = self.parse_select_expr_or()?;

        let mut clauses: Vec<MergeWhenClause> = Vec::new();
        loop {
            if !matches!(self.peek().map(|t| &t.token), Some(Token::When)) {
                break;
            }
            clauses.push(self.parse_merge_when_clause()?);
        }
        if clauses.is_empty() {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(at, "MERGE requires at least one WHEN clause"));
        }

        Ok(MergeStatement {
            target,
            target_alias,
            source,
            source_alias,
            on,
            clauses,
        })
    }

    fn parse_merge_relation(&mut self) -> Result<(TableRef, Option<String>), ParseError> {
        let table = self.parse_table_ref()?;
        let alias = if matches!(self.peek().map(|t| &t.token), Some(Token::As)) {
            self.advance();
            Some(self.expect_ident("expected alias after AS")?)
        } else if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_))) {
            Some(self.expect_ident("expected alias")?)
        } else {
            None
        };
        Ok((table, alias))
    }

    fn parse_merge_when_clause(&mut self) -> Result<MergeWhenClause, ParseError> {
        self.expect_keyword(Token::When, "expected WHEN")?;
        let not_matched = if matches!(self.peek().map(|t| &t.token), Some(Token::Not)) {
            self.advance();
            true
        } else {
            false
        };
        self.expect_ident_kw("matched", "expected MATCHED")?;
        if not_matched && self.peek_ident_kw("by") {
            return Err(syntax_err(
                self.peek().map(|t| t.at),
                "WHEN NOT MATCHED BY SOURCE unsupported",
            ));
        }
        self.expect_keyword(Token::Then, "expected THEN")?;
        self.parse_merge_action(not_matched)
    }

    fn parse_merge_action(&mut self, not_matched: bool) -> Result<MergeWhenClause, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected MERGE action"))?
            .clone();
        match tok.token {
            Token::Update => {
                if not_matched {
                    return Err(syntax_err(Some(tok.at), "NOT MATCHED cannot UPDATE"));
                }
                self.advance();
                self.expect_keyword(Token::Set, "expected SET")?;
                Ok(MergeWhenClause {
                    not_matched,
                    action: "update".to_string(),
                    assignments: self.parse_merge_assignment_list()?,
                    columns: Vec::new(),
                    values: Vec::new(),
                })
            }
            Token::Insert => {
                if !not_matched {
                    return Err(syntax_err(Some(tok.at), "MATCHED cannot INSERT"));
                }
                self.advance();
                self.expect_token(Token::LParen, "expected '(' after INSERT")?;
                let columns = self.parse_ident_list("expected column name")?;
                self.expect_token(Token::RParen, "expected ')'")?;
                self.expect_keyword(Token::Values, "expected VALUES")?;
                self.expect_token(Token::LParen, "expected '(' after VALUES")?;
                let values = self.parse_merge_value_list()?;
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(MergeWhenClause {
                    not_matched,
                    action: "insert".to_string(),
                    assignments: Vec::new(),
                    columns,
                    values,
                })
            }
            Token::Do => {
                self.advance();
                self.expect_keyword(Token::Nothing, "expected NOTHING")?;
                Ok(MergeWhenClause {
                    not_matched,
                    action: "do-nothing".to_string(),
                    assignments: Vec::new(),
                    columns: Vec::new(),
                    values: Vec::new(),
                })
            }
            Token::Delete => Err(syntax_err(Some(tok.at), "MERGE DELETE action unsupported")),
            _ => Err(syntax_err(
                Some(tok.at),
                "expected UPDATE/INSERT/DO NOTHING",
            )),
        }
    }

    fn parse_merge_assignment_list(&mut self) -> Result<Vec<(String, SelectExpr)>, ParseError> {
        let mut out: Vec<(String, SelectExpr)> = Vec::new();
        loop {
            let column = self.expect_ident("expected column name")?;
            self.expect_token(Token::Eq, "expected '='")?;
            let value = self.parse_merge_value()?;
            out.push((column, value));
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    fn parse_merge_value_list(&mut self) -> Result<Vec<SelectExpr>, ParseError> {
        let mut out: Vec<SelectExpr> = Vec::new();
        loop {
            out.push(self.parse_merge_value()?);
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    fn parse_merge_value(&mut self) -> Result<SelectExpr, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_))) {
            return Ok(SelectExpr::ColumnRefExpr {
                column: self.parse_column_ref()?,
            });
        }
        self.parse_insert_value()
            .map(|value| SelectExpr::Literal { value })
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
    pub(super) fn parse_insert_value(&mut self) -> Result<InsertValue, ParseError> {
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

    /// Parse a MySQL/MariaDB `CALL` statement after the `CALL` verb.
    pub(super) fn parse_call(&mut self) -> Result<CallStatement, ParseError> {
        let procedure = self.parse_procedure_ref()?;
        self.expect_token(Token::LParen, "expected '(' after procedure name")?;

        let mut arguments: Vec<CallArgument> = Vec::new();
        if matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
            self.advance();
            return Ok(CallStatement {
                procedure,
                arguments,
            });
        }

        loop {
            arguments.push(self.parse_call_argument()?);
            match self.peek().map(|t| &t.token) {
                Some(Token::Comma) => {
                    self.advance();
                }
                Some(Token::RParen) => {
                    self.advance();
                    break;
                }
                Some(_) => {
                    let at = self.peek().map(|t| t.at);
                    return Err(syntax_err(at, "expected ',' or ')'"));
                }
                None => return Err(syntax_err(None, "expected ')'")),
            }
        }

        Ok(CallStatement {
            procedure,
            arguments,
        })
    }

    fn parse_call_argument(&mut self) -> Result<CallArgument, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected CALL argument"))?
            .clone();

        match tok.token {
            Token::UserVariable(name) => {
                self.advance();
                Ok(CallArgument::UserVariable { name })
            }
            _ => self.parse_insert_value().map(Into::into),
        }
    }

    /// Bare or schema-qualified procedure reference. Three-part names and
    /// quoted identifiers remain outside the local parser subset.
    fn parse_procedure_ref(&mut self) -> Result<ProcedureRef, ParseError> {
        let first = self.expect_ident("expected procedure name")?;
        if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
            self.advance();
            let name = self.expect_ident("expected procedure name after '.'")?;
            if matches!(self.peek().map(|t| &t.token), Some(Token::Dot)) {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "three-dot procedure qualifier unsupported"));
            }
            Ok(ProcedureRef {
                schema: Some(first),
                name,
            })
        } else {
            Ok(ProcedureRef {
                schema: None,
                name: first,
            })
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

    /// Parse `DUPLICATE KEY UPDATE <col> = <value>[, …]` after `ON`.
    /// The `ON` token has been consumed and the cursor is on `DUPLICATE`.
    fn parse_on_duplicate_key_update(&mut self) -> Result<OnDuplicateKeyUpdate, ParseError> {
        self.expect_ident_kw("duplicate", "expected DUPLICATE")?;
        self.expect_keyword(Token::Key, "expected KEY")?;
        self.expect_keyword(Token::Update, "expected UPDATE")?;
        let assignments = self.parse_on_duplicate_key_update_assignments()?;
        Ok(OnDuplicateKeyUpdate { assignments })
    }

    /// `<col> = <value>[, <col> = <value>]*` for MySQL/MariaDB upsert.
    fn parse_on_duplicate_key_update_assignments(
        &mut self,
    ) -> Result<Vec<OnDuplicateKeyUpdateAssignment>, ParseError> {
        let mut out: Vec<OnDuplicateKeyUpdateAssignment> = Vec::new();
        loop {
            let column = self.expect_ident("expected column name")?;
            self.expect_token(Token::Eq, "expected '='")?;
            let value = self.parse_on_duplicate_key_update_value()?;
            out.push(OnDuplicateKeyUpdateAssignment { column, value });
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(out)
    }

    /// Literal/default/placeholder RHS plus MySQL's `VALUES(column)`.
    fn parse_on_duplicate_key_update_value(
        &mut self,
    ) -> Result<OnDuplicateKeyUpdateValue, ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::Values)) {
            self.advance();
            self.expect_token(Token::LParen, "expected '('")?;
            let column = self.expect_ident("expected column name")?;
            self.expect_token(Token::RParen, "expected ')'")?;
            return Ok(OnDuplicateKeyUpdateValue::ValuesColumn { column });
        }

        self.parse_insert_value().map(Into::into)
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
}
