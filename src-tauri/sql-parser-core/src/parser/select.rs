use super::*;

impl Parser<'_> {
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
    pub(super) fn parse_select(&mut self) -> Result<SelectStatement, ParseError> {
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

        let from = if matches!(self.peek().map(|t| &t.token), Some(Token::From)) {
            self.advance();
            self.parse_from_list()?
        } else {
            Vec::new()
        };

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
    pub(super) fn parse_column_ref_list(&mut self) -> Result<Vec<ColumnRef>, ParseError> {
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
    pub(super) fn parse_column_ref(&mut self) -> Result<ColumnRef, ParseError> {
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

    /// `LIMIT <count> [ OFFSET <offset> ]` or MySQL-family
    /// `LIMIT <offset>, <count>`. The `LIMIT` keyword has been consumed by
    /// the caller.
    fn parse_limit_clause(&mut self) -> Result<LimitClause, ParseError> {
        // `LIMIT` requires a value — `parse_insert_value` surfaces the
        // SyntaxError if the next token is not a literal/placeholder.
        let first = self.parse_insert_value()?;
        if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
            self.advance();
            let count = self.parse_insert_value()?;
            return Ok(LimitClause {
                count,
                offset: Some(first),
            });
        }
        let offset = if matches!(self.peek().map(|t| &t.token), Some(Token::Offset)) {
            self.advance();
            Some(self.parse_insert_value()?)
        } else {
            None
        };
        Ok(LimitClause {
            count: first,
            offset,
        })
    }

    // ----- widened expression parser (SELECT WHERE / HAVING / JOIN ON) ----

    /// OR — lowest precedence.
    pub(super) fn parse_select_expr_or(&mut self) -> Result<SelectExpr, ParseError> {
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

        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_)))
            && matches!(
                self.tokens.get(self.cursor + 1).map(|t| &t.token),
                Some(Token::LParen)
            )
        {
            let expression = self.parse_function_or_window()?;
            if matches!(expression, SelectExpr::WindowFunction { .. }) {
                let at = self.peek().map(|t| t.at);
                return Err(syntax_err(at, "window function unsupported in predicate"));
            }
            if let Some(op) = self.peek_compare_op() {
                self.advance();
                let value = self.parse_insert_value()?;
                return Ok(SelectExpr::ExpressionComparison {
                    left: Box::new(expression),
                    op,
                    value,
                });
            }
            return Ok(expression);
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
            // For simple CASE the condition is a value compared against
            // the operand (literal/column/expr); for searched CASE the
            // condition is a boolean expression. Both flow through the
            // same value-or-expression parser because the boolean form
            // is a superset.
            self.advance(); // consume WHEN
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
    pub(super) fn parse_with(&mut self) -> Result<WithStatement, ParseError> {
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
            if Self::is_select_list_boundary(after) {
                names.push(name);
                self.advance();
            } else {
                return None;
            }
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
                continue;
            }
            break;
        }
        Some(names)
    }

    fn is_select_list_boundary(token: Option<&Token>) -> bool {
        matches!(
            token,
            None | Some(
                Token::Comma
                    | Token::From
                    | Token::Where
                    | Token::Group
                    | Token::Having
                    | Token::Order
                    | Token::Limit
                    | Token::Union
                    | Token::Intersect
                    | Token::Except
                    | Token::RParen
            )
        )
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
                self.parse_optional_select_item_alias()?;
                return Ok(SelectListItem::Expression { expression: expr });
            }
            // Plain column ref (followed by `,` / `FROM` / clause kw).
            if Self::is_select_list_boundary(self.peek().map(|t| &t.token)) {
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

    fn parse_optional_select_item_alias(&mut self) -> Result<(), ParseError> {
        if matches!(self.peek().map(|t| &t.token), Some(Token::As)) {
            self.advance();
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected alias after AS"))?
                .clone();
            match tok.token {
                Token::Ident(_) => {
                    self.advance();
                    return Ok(());
                }
                _ => return Err(syntax_err(Some(tok.at), "expected alias ident after AS")),
            }
        }
        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_)))
            && Self::is_select_list_boundary(self.tokens.get(self.cursor + 1).map(|t| &t.token))
        {
            self.advance();
        }
        Ok(())
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
        // Identifier followed by `(` → function call / window function.
        if matches!(self.peek().map(|t| &t.token), Some(Token::Ident(_))) {
            return self.parse_function_or_window();
        }
        let at = self.peek().map(|t| t.at);
        Err(syntax_err(at, "expected expression in SELECT list"))
    }

    /// Sprint-482 — `<ident>(args)` in SELECT-list position; optional
    /// `OVER (...)` keeps the sprint-393b window-function shape.
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

        if !matches!(self.peek().map(|t| &t.token), Some(Token::Over)) {
            return Ok(SelectExpr::FunctionCall { name, arguments });
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
}
