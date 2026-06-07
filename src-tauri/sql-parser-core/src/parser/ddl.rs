use super::*;

impl Parser<'_> {
    // ---------------------------------------------------------------
    // Sprint 391 — DDL destructive sub-parsers.
    // ---------------------------------------------------------------

    /// `DROP <object-type> [IF EXISTS] <name> [CASCADE|RESTRICT]`.
    /// Assumes the `DROP` token has already been consumed.
    pub(super) fn parse_drop(&mut self) -> Result<DropStatement, ParseError> {
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
        let name = self.parse_qualified_ident_string("expected object name")?;

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
    pub(super) fn parse_truncate(&mut self) -> Result<TruncateStatement, ParseError> {
        // Optional TABLE keyword.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Table)) {
            self.advance();
        }

        // table name
        let table = self.parse_qualified_ident_string("expected table name")?;

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
    pub(super) fn parse_alter_table(&mut self) -> Result<AlterTableStatement, ParseError> {
        // TABLE
        self.expect_keyword(Token::Table, "expected TABLE")?;

        // table name
        let table = self.parse_qualified_ident_string("expected table name")?;

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
    ///
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
    ///
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
    ///
    /// Any other follow-up token (FUNCTION / TRIGGER / EXTENSION /
    /// TEMPORARY / MATERIALIZED / …) parses to `SyntaxError` per the
    /// sprint-394 out-of-scope list.
    pub(super) fn parse_create_dispatch(&mut self) -> Result<ParseResult, ParseError> {
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
    pub(super) fn parse_table_ref(&mut self) -> Result<TableRef, ParseError> {
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
    /// `BOOLEAN`, `NUMERIC`, `SERIAL`, `UUID`) is the source of truth
    /// for shared SQL types; a narrow Oracle static-safety DDL type slice
    /// (`NUMBER`, `VARCHAR2`, `CLOB`, `BLOB`) is accepted in identifier
    /// position. Any other token in type position parses to `SyntaxError`
    /// (AC-394-T21). `VARCHAR(n)` / `VARCHAR2(n)` require a parenthesized
    /// integer; `NUMERIC` / `NUMBER` accept zero, one, or two integer
    /// arguments; `TIMESTAMP WITH TIME ZONE` is recognized as a three-token
    /// sequence.
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
                let with_time_zone = if matches!(self.peek().map(|t| &t.token), Some(Token::With)) {
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
                let (precision, scale) = self.parse_precision_scale("NUMERIC")?;
                Ok(ColumnType::Numeric {
                    precision,
                    scale,
                })
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("number") => {
                self.advance();
                let (precision, scale) = self.parse_precision_scale("NUMBER")?;
                Ok(ColumnType::Number { precision, scale })
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("varchar2") => {
                self.advance();
                self.expect_token(Token::LParen, "VARCHAR2 requires '(<length>)'")?;
                let length = self.parse_type_length("VARCHAR2")?;
                self.expect_token(Token::RParen, "expected ')'")?;
                Ok(ColumnType::Varchar2 { length })
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("clob") => {
                self.advance();
                Ok(ColumnType::Clob)
            }
            Token::Ident(name) if name.eq_ignore_ascii_case("blob") => {
                self.advance();
                Ok(ColumnType::Blob)
            }
            Token::Ident(name) if is_known_postgres_extension_type(&name) => {
                self.advance();
                let modifiers = self.parse_extension_type_modifiers()?;
                Ok(ColumnType::Extension { name, modifiers })
            }
            // Bare identifier in type position — vendor synonym like
            // INT4 / STRING / DATETIME — out of scope (AC-394-T21).
            Token::Ident(_) => Err(syntax_err(
                Some(tok.at),
                "unsupported column type — allowlist is INTEGER/BIGINT/VARCHAR/TEXT/TIMESTAMP/DATE/BOOLEAN/NUMERIC/SERIAL/UUID, bounded Oracle NUMBER/VARCHAR2/CLOB/BLOB, plus known PostgreSQL extension types",
            )),
            _ => Err(syntax_err(Some(tok.at), "expected column type")),
        }
    }

    fn parse_type_length(&mut self, type_name: &str) -> Result<i64, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected length integer"))?
            .clone();
        let length = match tok.token {
            Token::Integer(v) => v,
            _ => {
                return Err(syntax_err(
                    Some(tok.at),
                    &format!("{type_name} length must be an integer literal"),
                ));
            }
        };
        self.advance();
        Ok(length)
    }

    fn parse_precision_scale(
        &mut self,
        type_name: &str,
    ) -> Result<(Option<i64>, Option<i64>), ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            return Ok((None, None));
        }
        self.advance();
        let precision = self.parse_precision_scale_integer(type_name, "precision")?;
        let scale = if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
            self.advance();
            Some(self.parse_precision_scale_integer(type_name, "scale")?)
        } else {
            None
        };
        self.expect_token(Token::RParen, "expected ')'")?;
        Ok((Some(precision), scale))
    }

    fn parse_precision_scale_integer(
        &mut self,
        type_name: &str,
        label: &str,
    ) -> Result<i64, ParseError> {
        let tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, &format!("expected {label} integer")))?
            .clone();
        let value = match tok.token {
            Token::Integer(v) => v,
            _ => {
                return Err(syntax_err(
                    Some(tok.at),
                    &format!("{type_name} {label} must be an integer literal"),
                ));
            }
        };
        self.advance();
        Ok(value)
    }

    fn parse_extension_type_modifiers(&mut self) -> Result<Vec<ExtensionTypeModifier>, ParseError> {
        if !matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
            return Ok(Vec::new());
        }
        self.advance();
        if matches!(self.peek().map(|t| &t.token), Some(Token::RParen)) {
            let at = self.peek().map(|t| t.at);
            return Err(syntax_err(
                at,
                "extension type modifier list cannot be empty",
            ));
        }
        let mut modifiers = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected extension type modifier"))?
                .clone();
            let modifier = match tok.token {
                Token::Ident(value) => ExtensionTypeModifier::Identifier { value },
                Token::Integer(value) => ExtensionTypeModifier::Integer { value },
                Token::Float(value) => ExtensionTypeModifier::Float { value },
                Token::String(value) => ExtensionTypeModifier::String { value },
                _ => return Err(syntax_err(Some(tok.at), "expected extension type modifier")),
            };
            self.advance();
            modifiers.push(modifier);
            match self.peek().map(|t| &t.token) {
                Some(Token::Comma) => {
                    self.advance();
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
        Ok(modifiers)
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
                    let column = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen)) {
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
    ///
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
                let target_columns = if matches!(self.peek().map(|t| &t.token), Some(Token::LParen))
                {
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
}

fn is_known_postgres_extension_type(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "citext" | "hstore" | "vector" | "halfvec" | "sparsevec" | "geometry" | "geography"
    )
}
