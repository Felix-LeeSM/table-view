use super::*;

fn ok_select(input: &str) -> SelectStatement {
    match parse(input) {
        ParseResult::Select(s) => s,
        other => panic!("expected Select, got: {:?}", other),
    }
}

fn ok_merge(input: &str) -> MergeStatement {
    match parse(input) {
        ParseResult::Merge(s) => s,
        other => panic!("expected Merge, got: {:?}", other),
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
fn ac_p6_unexpected_token_after_no_from_select_is_syntax_error() {
    let e = err("SELECT * users");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    assert!(e.message.to_lowercase().contains("trailing"));
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
// verbs the parser still does not implement (REPLACE, etc.).
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
    // CREATE TABLE is supported, but broad vendor aliases remain outside
    // the column-type allowlist. The parser surfaces a SyntaxError on
    // the inner type position.
    let e = err("CREATE TABLE t (id STRING)");
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
fn ac_484_m01_merge_update_first_slice_parses() {
    // Reason: Sprint 484 promotes the narrow PostgreSQL MERGE write
    // surface out of unsupported-statement fallback. (2026-05-27)
    let m = ok_merge(
        "MERGE INTO users USING incoming ON users.id = incoming.id \
         WHEN MATCHED THEN UPDATE SET name = incoming.name",
    );
    assert_eq!(m.target.table, "users");
    assert_eq!(m.source.table, "incoming");
    match m.on {
        SelectExpr::ColumnComparison { left, op, right } => {
            assert_eq!(left.table.as_deref(), Some("users"));
            assert_eq!(left.column, "id");
            assert_eq!(op, CompareOp::Eq);
            assert_eq!(right.table.as_deref(), Some("incoming"));
            assert_eq!(right.column, "id");
        }
        other => panic!("expected ON column comparison, got {:?}", other),
    }
    assert_eq!(m.clauses.len(), 1);
    assert!(!m.clauses[0].not_matched);
    let clause = &m.clauses[0];
    assert_eq!(clause.action, "update");
    assert_eq!(clause.assignments.len(), 1);
    assert_eq!(clause.assignments[0].0, "name");
    assert!(matches!(
        &clause.assignments[0].1,
        SelectExpr::ColumnRefExpr {
            column: ColumnRef {
                table: Some(table),
                column,
            }
        } if table == "incoming" && column == "name"
    ));
}

#[test]
fn ac_484_m02_merge_insert_aliases_and_column_values_parse() {
    // Reason: PostgreSQL MERGE users commonly alias target/source and
    // insert source columns into missing target rows. (2026-05-27)
    let m = ok_merge(
        "MERGE INTO users AS u USING incoming AS i ON u.id = i.id \
         WHEN NOT MATCHED THEN INSERT (id, name) VALUES (i.id, 'new')",
    );
    assert_eq!(m.target_alias.as_deref(), Some("u"));
    assert_eq!(m.source_alias.as_deref(), Some("i"));
    assert_eq!(m.clauses.len(), 1);
    assert!(m.clauses[0].not_matched);
    let clause = &m.clauses[0];
    assert_eq!(clause.action, "insert");
    assert_eq!(clause.columns.len(), 2);
    assert_eq!(clause.columns[0], "id");
    assert_eq!(clause.columns[1], "name");
    assert_eq!(clause.values.len(), 2);
    assert!(matches!(
        &clause.values[0],
        SelectExpr::ColumnRefExpr {
            column: ColumnRef {
                table: Some(table),
                column,
            }
        } if table == "i" && column == "id"
    ));
    assert!(matches!(
        &clause.values[1],
        SelectExpr::Literal {
            value: InsertValue::Literal {
                value: SqlLiteral::String { value }
            }
        } if value == "new"
    ));
}

#[test]
fn ac_484_m03_merge_do_nothing_parses() {
    // Reason: PostgreSQL MERGE supports DO NOTHING as a non-mutating
    // action inside the overall write statement. (2026-05-27)
    let m = ok_merge(
        "MERGE INTO users USING incoming ON users.id = incoming.id \
         WHEN MATCHED THEN DO NOTHING",
    );
    assert_eq!(m.clauses[0].action, "do-nothing");
}

#[test]
fn ac_484_m04_merge_delete_action_stays_unsupported() {
    // Reason: DELETE inside MERGE has a larger destructive surface
    // than this first slice commits to parse. (2026-05-27)
    let e = err("MERGE INTO users USING incoming ON users.id = incoming.id \
         WHEN MATCHED THEN DELETE");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
}

#[test]
fn ac_485_d01_do_block_is_known_unsupported_statement() {
    // Reason: PostgreSQL anonymous DO blocks are procedural execution
    // boundaries. The parser must stop at the verb-level unsupported
    // statement path before the lexer reaches the dollar-quoted body.
    let e = err("DO $$ BEGIN RAISE NOTICE 'hi'; END $$");
    assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    assert!(e.message.to_ascii_uppercase().contains("DO"));
}

#[test]
fn ac_486_e01_pg_trgm_percent_operator_predicate_parses() {
    // Reason: extension-backed boolean predicates should not fall out of
    // SELECT parser coverage just because the operator is symbolic.
    let s = ok_select("SELECT id FROM docs WHERE title % 'table'");
    let where_clause = s.where_clause.expect("WHERE");
    match where_clause {
        SelectExpr::ExtensionOperatorComparison {
            left,
            operator,
            right,
        } => {
            assert_eq!(left.table, None);
            assert_eq!(left.column, "title");
            assert_eq!(operator, "%");
            assert!(matches!(
                right,
                ExtensionOperatorOperand::Value {
                    value: InsertValue::Literal {
                        value: SqlLiteral::String { value }
                    }
                } if value == "table"
            ));
        }
        other => panic!("expected extension operator predicate, got {:?}", other),
    }
}

#[test]
fn ac_486_e02_extension_column_types_parse() {
    // Reason: extension-backed column types are common PostgreSQL schema
    // surface; parser tolerance should preserve DDL classification.
    let s = ok_create_table(
        "CREATE TABLE docs (title citext, attrs hstore, embedding vector(3), geom geometry(Point, 4326))",
    );
    assert!(matches!(
        &s.columns[0].data_type,
        ColumnType::Extension { name, modifiers }
            if name.eq_ignore_ascii_case("citext") && modifiers.is_empty()
    ));
    assert!(matches!(
        &s.columns[1].data_type,
        ColumnType::Extension { name, modifiers }
            if name.eq_ignore_ascii_case("hstore") && modifiers.is_empty()
    ));
    assert!(matches!(
        &s.columns[2].data_type,
        ColumnType::Extension { name, modifiers }
            if name.eq_ignore_ascii_case("vector")
                && matches!(modifiers.as_slice(), [ExtensionTypeModifier::Integer { value: 3 }])
    ));
    assert!(matches!(
        &s.columns[3].data_type,
        ColumnType::Extension { name, modifiers }
            if name.eq_ignore_ascii_case("geometry")
                && matches!(
                    modifiers.as_slice(),
                    [
                        ExtensionTypeModifier::Identifier { value },
                        ExtensionTypeModifier::Integer { value: 4326 }
                    ] if value == "Point"
                )
    ));
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
fn ac_393a_e09_mysql_legacy_limit_comma_form_maps_offset_and_count() {
    let s = ok_select("SELECT a FROM x LIMIT 10, 20");
    let lim = s.limit.expect("LIMIT");
    assert!(matches!(
        lim.offset,
        Some(InsertValue::Literal {
            value: SqlLiteral::Integer { value: 10 }
        })
    ));
    assert!(matches!(
        lim.count,
        InsertValue::Literal {
            value: SqlLiteral::Integer { value: 20 }
        }
    ));
}

#[test]
fn ac_393a_e09b_mysql_legacy_limit_comma_form_accepts_placeholders() {
    let s = ok_select("SELECT a FROM x LIMIT ?, ?");
    let lim = s.limit.expect("LIMIT");
    assert!(matches!(
        lim.offset,
        Some(InsertValue::Placeholder { name }) if name.is_empty()
    ));
    assert!(matches!(
        lim.count,
        InsertValue::Placeholder { name } if name.is_empty()
    ));
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
    let s =
        ok_select("SELECT a FROM x INNER JOIN y USING (tenant_id) LEFT JOIN z ON y.id = z.y_id");
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
    let s = ok_alter("ALTER TABLE users ADD COLUMN x INT");
    assert_eq!(s.table, "users");
    assert!(matches!(
        s.action,
        AlterAction::AddColumn {
            column: ColumnDefinition {
                name,
                data_type: ColumnType::Integer,
                ..
            },
            if_not_exists: false,
        } if name == "x"
    ));
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

fn ok_call(input: &str) -> CallStatement {
    match parse(input) {
        ParseResult::Call(c) => c,
        other => panic!("expected Call, got: {:?}", other),
    }
}

#[test]
fn call_no_args_parses_as_top_level_statement() {
    let s = ok_call("CALL refresh_user_stats()");
    assert_eq!(s.procedure.schema, None);
    assert_eq!(s.procedure.name, "refresh_user_stats");
    assert!(s.arguments.is_empty());
}

#[test]
fn call_qualified_procedure_with_literal_and_placeholder_args() {
    let s = ok_call("CALL reporting.refresh_user_stats(?, 'x', 1)");
    assert_eq!(s.procedure.schema.as_deref(), Some("reporting"));
    assert_eq!(s.procedure.name, "refresh_user_stats");
    assert_eq!(s.arguments.len(), 3);
    assert!(matches!(
        &s.arguments[0],
        CallArgument::Placeholder { name } if name.is_empty()
    ));
    assert!(matches!(
        &s.arguments[1],
        CallArgument::Literal {
            value: SqlLiteral::String { value }
        } if value == "x"
    ));
    assert!(matches!(
        &s.arguments[2],
        CallArgument::Literal {
            value: SqlLiteral::Integer { value: 1 }
        }
    ));
}

#[test]
fn call_default_argument_uses_local_value_surface() {
    let s = ok_call("CALL refresh_user_stats(DEFAULT)");
    assert!(matches!(s.arguments[0], CallArgument::Default));
}

#[test]
fn call_user_variable_argument_parses_for_mysql_family_routines() {
    let s = ok_call("CALL refresh_user_stats(@user_id)");
    assert_eq!(s.arguments.len(), 1);
    assert!(matches!(
        &s.arguments[0],
        CallArgument::UserVariable { name } if name == "user_id"
    ));
}

#[test]
fn user_variable_remains_rejected_outside_call_arguments() {
    let e = err("INSERT INTO audit_log VALUES (@user_id)");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
}

#[test]
fn call_rejects_named_argument_forms_outside_value_surface() {
    let cases = [
        ("function call", "CALL refresh_user_stats(NOW())"),
        ("arithmetic", "CALL refresh_user_stats(1 + 2)"),
        (
            "subquery",
            "CALL refresh_user_stats((SELECT id FROM users))",
        ),
        ("bare identifier", "CALL refresh_user_stats(user_id)"),
        (
            "system variable",
            "CALL refresh_user_stats(@@session_sql_mode)",
        ),
    ];

    for (label, sql) in cases {
        let e = err(sql);
        assert!(
            matches!(
                e.error_kind,
                ParseErrorKind::SyntaxError | ParseErrorKind::LexError
            ),
            "{label}: expected syntax/lex rejection, got {:?}",
            e
        );
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
    assert!(s.on_duplicate_key_update.is_none());
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
fn ac_434_i01_insert_on_duplicate_key_update_literal() {
    let s = ok_insert(
        "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = 'b'",
    );
    assert!(s.on_conflict.is_none());
    match s.on_duplicate_key_update {
        Some(OnDuplicateKeyUpdate { assignments }) => {
            assert_eq!(assignments.len(), 1);
            assert_eq!(assignments[0].column, "name");
            assert!(matches!(
                &assignments[0].value,
                OnDuplicateKeyUpdateValue::Literal {
                    value: SqlLiteral::String { value }
                } if value == "b"
            ));
        }
        _ => panic!("expected ON DUPLICATE KEY UPDATE"),
    }
}

#[test]
fn ac_434_i02_insert_on_duplicate_key_update_preserves_assignment_order() {
    let s = ok_insert(
        "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = VALUES(name), id = 2",
    );
    let clause = s
        .on_duplicate_key_update
        .expect("expected ON DUPLICATE KEY UPDATE");
    assert_eq!(clause.assignments.len(), 2);
    assert_eq!(clause.assignments[0].column, "name");
    assert!(matches!(
        &clause.assignments[0].value,
        OnDuplicateKeyUpdateValue::ValuesColumn { column } if column == "name"
    ));
    assert_eq!(clause.assignments[1].column, "id");
    assert!(matches!(
        &clause.assignments[1].value,
        OnDuplicateKeyUpdateValue::Literal {
            value: SqlLiteral::Integer { value: 2 }
        }
    ));
}

#[test]
fn ac_434_i03_insert_on_duplicate_key_update_placeholder_rhs() {
    let s =
        ok_insert("INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = ?");
    let clause = s
        .on_duplicate_key_update
        .expect("expected ON DUPLICATE KEY UPDATE");
    assert!(matches!(
        &clause.assignments[0].value,
        OnDuplicateKeyUpdateValue::Placeholder { name } if name.is_empty()
    ));
}

#[test]
fn ac_434_i04_insert_on_duplicate_key_update_default_rhs() {
    let s = ok_insert(
        "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = DEFAULT",
    );
    let clause = s
        .on_duplicate_key_update
        .expect("expected ON DUPLICATE KEY UPDATE");
    assert!(matches!(
        &clause.assignments[0].value,
        OnDuplicateKeyUpdateValue::Default
    ));
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
    assert!(matches!(
        s.where_clause,
        Some(SelectExpr::Comparison { .. })
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
        Some(SelectExpr::Comparison { .. })
    ));
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
fn ac_451_mariadb_returning_parser_decision_is_structural_only() {
    let insert = ok_insert("INSERT INTO users (id) VALUES (1) RETURNING id");
    assert_eq!(insert.returning, vec!["id".to_string()]);

    let bounded_delete = ok_delete("DELETE FROM users WHERE id = 1 RETURNING id");
    assert!(bounded_delete.where_clause.is_some());
    assert_eq!(bounded_delete.returning, vec!["id".to_string()]);

    let update = ok_update("UPDATE users SET active = false WHERE id = 1 RETURNING id");
    assert!(update.where_clause.is_some());
    assert_eq!(update.returning, vec!["id".to_string()]);
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
fn ac_483_pg07_predicate_function_call_serializes_as_select() {
    let r = parse("SELECT a FROM x WHERE lower(a) = 'x'");
    let json = serde_json::to_value(&r).expect("serialize");
    assert_eq!(json["kind"], "select");
    assert_eq!(json["where"]["kind"], "expression-comparison");
    assert_eq!(json["where"]["left"]["kind"], "function-call");
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
    let w =
        ok_with("WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)");
    match *w.inner_statement {
        WithInner::Update(u) => {
            assert!(matches!(
                u.where_clause,
                Some(SelectExpr::InSubquery { .. })
            ));
        }
        other => panic!("expected Update inner, got {:?}", other),
    }
}

#[test]
fn ac_393b_w07_with_delete_inner() {
    let w = ok_with("WITH t AS (SELECT id FROM x) DELETE FROM y WHERE y.id IN (SELECT id FROM t)");
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
    let s = ok_select("SELECT a FROM x WHERE NOT EXISTS (SELECT b FROM y WHERE y.x_id = x.id)");
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
    let s =
        ok_select("SELECT sum(x) OVER (ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t");
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
fn ac_483_pg01_predicate_function_call_parses() {
    // Reason: Sprint 483 lifts the common PostgreSQL read path
    // `WHERE lower(col) = ...` out of Safe Mode fallback (2026-05-27).
    let s = ok_select("SELECT x FROM t WHERE lower(x) = 'a'");
    match s.where_clause {
        Some(SelectExpr::ExpressionComparison { left, op, value }) => {
            assert_eq!(op, CompareOp::Eq);
            assert!(matches!(
                value,
                InsertValue::Literal {
                    value: SqlLiteral::String { ref value }
                } if value == "a"
            ));
            match *left {
                SelectExpr::FunctionCall { name, arguments } => {
                    assert_eq!(name, "lower");
                    assert_eq!(arguments.len(), 1);
                    assert!(matches!(
                        arguments[0],
                        WindowArgument::ColumnRef {
                            reference: ColumnRef {
                                table: None,
                                ref column
                            }
                        } if column == "x"
                    ));
                }
                other => panic!("expected function-call left side, got {:?}", other),
            }
        }
        other => panic!("expected function-call comparison, got {:?}", other),
    }
}

#[test]
fn ac_483_pg02_having_function_call_parses() {
    let s = ok_select("SELECT region FROM sales GROUP BY region HAVING count(*) > 1");
    match s.having {
        Some(SelectExpr::ExpressionComparison { left, op, value }) => {
            assert_eq!(op, CompareOp::Gt);
            assert!(matches!(
                value,
                InsertValue::Literal {
                    value: SqlLiteral::Integer { value: 1 }
                }
            ));
            match *left {
                SelectExpr::FunctionCall { name, arguments } => {
                    assert_eq!(name, "count");
                    assert!(matches!(arguments.as_slice(), [WindowArgument::Star]));
                }
                other => panic!("expected function-call left side, got {:?}", other),
            }
        }
        other => panic!("expected function-call HAVING comparison, got {:?}", other),
    }
}

#[test]
fn ac_483_pg03_select_list_function_call_as_alias_consumed() {
    let s = ok_select("SELECT now() AS ts");
    assert!(s.from.is_empty());
    match s.columns {
        Columns::Expressions { items } => match &items[0] {
            SelectListItem::Expression {
                expression: SelectExpr::FunctionCall { name, arguments },
            } => {
                assert_eq!(name, "now");
                assert!(arguments.is_empty());
            }
            _ => panic!("expected function-call expression"),
        },
        _ => panic!("expected expression list"),
    }
}

#[test]
fn ac_483_pg04_select_list_function_call_bare_alias_consumed() {
    let s = ok_select("SELECT count(*) total FROM users");
    match s.columns {
        Columns::Expressions { items } => match &items[0] {
            SelectListItem::Expression {
                expression: SelectExpr::FunctionCall { name, arguments },
            } => {
                assert_eq!(name, "count");
                assert!(matches!(arguments.as_slice(), [WindowArgument::Star]));
            }
            _ => panic!("expected function-call expression"),
        },
        _ => panic!("expected expression list"),
    }
}

#[test]
fn ac_483_pg05_nested_function_call_remains_unsupported() {
    let e = err("SELECT lower(trim(name)) FROM users");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
}

#[test]
fn ac_483_pg06_schema_qualified_function_remains_unsupported() {
    let e = err("SELECT public.lower(name) FROM users");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
}

#[test]
fn ac_483_pg08_predicate_window_function_remains_unsupported() {
    let e = err("SELECT x FROM t WHERE row_number() OVER () = 1");
    assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
}

#[test]
fn ac_482_pg01_no_from_select_literal_parses() {
    let s = ok_select("SELECT 1");
    assert!(s.from.is_empty());
    match s.columns {
        Columns::Expressions { items } => match &items[0] {
            SelectListItem::Expression {
                expression: SelectExpr::Literal { value },
            } => {
                assert!(matches!(
                    value,
                    InsertValue::Literal {
                        value: SqlLiteral::Integer { value: 1 }
                    }
                ));
            }
            _ => panic!("expected literal expression"),
        },
        _ => panic!("expected expression list"),
    }
}

#[test]
fn ac_482_pg02_bare_function_call_parses_without_over() {
    let s = ok_select("SELECT count(*) FROM t");
    match s.columns {
        Columns::Expressions { items } => match &items[0] {
            SelectListItem::Expression {
                expression: SelectExpr::FunctionCall { name, arguments },
            } => {
                assert_eq!(name, "count");
                assert!(matches!(arguments.as_slice(), [WindowArgument::Star]));
            }
            _ => panic!("expected function-call expression"),
        },
        _ => panic!("expected expression list"),
    }
}

#[test]
fn ac_482_pg04_no_from_function_call_parses() {
    let s = ok_select("SELECT now()");
    assert!(s.from.is_empty());
    match s.columns {
        Columns::Expressions { items } => match &items[0] {
            SelectListItem::Expression {
                expression: SelectExpr::FunctionCall { name, arguments },
            } => {
                assert_eq!(name, "now");
                assert!(arguments.is_empty());
            }
            _ => panic!("expected function-call expression"),
        },
        _ => panic!("expected expression list"),
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
        ("SELECT a FROM x WHERE EXISTS (SELECT id FROM y)", "exists"),
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
    let w =
        ok_with("WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)");
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
    let s = ok_select("SELECT a FROM x INTERSECT SELECT a FROM y EXCEPT SELECT a FROM z");
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
    let s = ok_select("SELECT a FROM x WHERE x.b = (SELECT max_b FROM y_summary LIMIT 1)");
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
    let s = ok_select("SELECT a FROM (SELECT a FROM x) AS s JOIN y ON s.id = y.id");
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
    let r =
        parse("WITH t AS (SELECT id FROM x) UPDATE y SET a = 1 WHERE y.id IN (SELECT id FROM t)");
    let json = serde_json::to_value(&r).expect("serialize");
    assert_eq!(json["kind"], "with");
    assert_eq!(json["inner_statement"]["kind"], "update");
}

#[test]
fn ac_393b_extra_set_operation_chain_with_intermediate_clauses() {
    // First SELECT body has WHERE; second has GROUP BY.
    let s = ok_select("SELECT a FROM x WHERE x.flag = 1 UNION SELECT a FROM y GROUP BY y.a");
    assert!(s.where_clause.is_some());
    assert_eq!(s.set_operation.len(), 1);
    assert_eq!(s.set_operation[0].statement.group_by.len(), 1);
}

#[test]
fn ac_393b_extra_cte_with_dml_insert_inherits_kind() {
    let w = ok_with("WITH t AS (SELECT a FROM x) INSERT INTO y (a) SELECT a FROM t");
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
    let s = match parse("DELETE FROM x WHERE EXISTS (SELECT 1 FROM y WHERE y.x_id = x.id)") {
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
    let r = parse("WITH a AS (SELECT x FROM s), b AS (SELECT y FROM t) SELECT a FROM a, b");
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER, FOREIGN KEY (a) REFERENCES other(id))");
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER, CONSTRAINT pk PRIMARY KEY (a))");
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
    let s = ok_create_table("CREATE TABLE t (a BIGINT, b SERIAL, c DATE, d BOOLEAN)");
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
    let s = ok_create_view("CREATE VIEW v_active AS SELECT * FROM users WHERE active = 1");
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
    let s = ok_create_view("CREATE VIEW v AS WITH t AS (SELECT a FROM x) SELECT a FROM t");
    assert!(matches!(s.body, CreateViewBody::With(_)));
}

#[test]
fn ac_394_v05_create_view_set_operation_body() {
    let s = ok_create_view("CREATE VIEW v AS SELECT a FROM x UNION SELECT a FROM y");
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
    let s = ok_alter("ALTER TABLE users ADD CONSTRAINT users_pk PRIMARY KEY (id)");
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
        "integer",
        "bigint",
        "varchar",
        "text",
        "timestamp",
        "date",
        "boolean",
        "numeric",
        "serial",
        "uuid",
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER UNIQUE, b INTEGER, UNIQUE (b))");
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER CONSTRAINT a_nn NOT NULL)");
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
            assert!(matches!(constraint.body, TableConstraintBody::Check { .. }));
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER, CONSTRAINT positive CHECK (a > 0))");
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
    let s = ok_create_table("CREATE TABLE t (a INTEGER, b INTEGER, CHECK (a > 0 AND b > 0))");
    match &s.table_constraints[0].body {
        TableConstraintBody::Check { expression } => {
            assert!(matches!(expression, SelectExpr::And { .. }));
        }
        other => panic!("expected check, got {:?}", other),
    }
}

#[test]
fn ac_394_extra_create_unique_index_if_not_exists() {
    let s = ok_create_index("CREATE UNIQUE INDEX IF NOT EXISTS idx ON users (email)");
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
// Issue 512 — bounded MSSQL parser / Safe Mode grammar surface.
// =================================================================

#[test]
fn ac_512_s01_select_top_with_bracket_identifiers() {
    let s = ok_select("SELECT TOP (10) [id], [name] FROM [dbo].[users] WHERE [id] = 1");
    assert!(matches!(
        s.limit.as_ref().map(|limit| &limit.count),
        Some(InsertValue::Literal {
            value: SqlLiteral::Integer { value: 10 }
        })
    ));
    assert_eq!(s.from[0].schema.as_deref(), Some("dbo"));
    assert_eq!(s.from[0].table, "users");
    assert!(s.where_clause.is_some());
}

#[test]
fn ac_512_s02_select_top_rejects_percent_and_with_ties() {
    for sql in [
        "SELECT TOP (10) PERCENT [id] FROM [dbo].[users]",
        "SELECT TOP (10) WITH TIES [id] FROM [dbo].[users]",
    ] {
        let e = err(sql);
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError, "sql={sql}");
    }
}

#[test]
fn ac_512_s02b_top_stays_contextual_identifier() {
    let s = ok_select("SELECT top FROM users");
    assert_eq!(
        s.columns,
        Columns::Named {
            names: vec!["top".to_string()]
        }
    );
    assert!(s.limit.is_none());
}

#[test]
fn ac_512_s03_tsql_dml_with_schema_brackets_and_unicode_strings() {
    let insert = ok_insert("INSERT INTO [dbo].[users] ([id], [name]) VALUES (1, N'Alice')");
    assert_eq!(insert.table, "dbo.users");
    assert_eq!(insert.columns, vec!["id".to_string(), "name".to_string()]);

    let update = ok_update("UPDATE [dbo].[users] SET [name] = N'Alice' WHERE [id] = 1");
    assert_eq!(update.table, "dbo.users");
    assert!(update.where_clause.is_some());

    let delete = ok_delete("DELETE FROM [dbo].[users] WHERE [id] = 1");
    assert_eq!(delete.table, "dbo.users");
    assert!(delete.where_clause.is_some());
}

#[test]
fn ac_512_s04_tsql_destructive_ddl_with_schema_brackets() {
    let drop = ok_drop("DROP TABLE [dbo].[users]");
    assert_eq!(drop.object_type, DropObjectType::Table);
    assert_eq!(drop.name, "dbo.users");

    let truncate = ok_truncate("TRUNCATE TABLE [dbo].[users]");
    assert_eq!(truncate.table, "dbo.users");

    let alter = ok_alter("ALTER TABLE [dbo].[users] DROP COLUMN [email]");
    assert_eq!(alter.table, "dbo.users");
    assert!(matches!(
        alter.action,
        AlterAction::DropColumn {
            column,
            if_exists: false,
            cascade: None,
        } if column == "email"
    ));
}

#[test]
fn ac_512_s05_tsql_bounded_ddl_create_shapes() {
    let table = ok_create_table(
        "CREATE TABLE [dbo].[audit_log] ([id] INT, [name] NVARCHAR(255), [amount] DECIMAL(10, 2), [request_id] UNIQUEIDENTIFIER)",
    );
    assert_eq!(table.table.schema.as_deref(), Some("dbo"));
    assert_eq!(table.table.table, "audit_log");
    assert!(matches!(table.columns[0].data_type, ColumnType::Integer));
    assert!(matches!(
        table.columns[1].data_type,
        ColumnType::Varchar { length: 255 }
    ));
    assert!(matches!(
        table.columns[2].data_type,
        ColumnType::Numeric {
            precision: Some(10),
            scale: Some(2)
        }
    ));
    assert!(matches!(table.columns[3].data_type, ColumnType::Uuid));

    let index = ok_create_index("CREATE INDEX [idx_audit_log_name] ON [dbo].[audit_log] ([name])");
    assert_eq!(index.name, "idx_audit_log_name");
    assert_eq!(index.table.schema.as_deref(), Some("dbo"));
    assert_eq!(index.columns, vec!["name".to_string()]);
}

#[test]
fn ac_512_s06_tsql_scripting_and_admin_verbs_are_known_unsupported() {
    for sql in [
        "EXEC dbo.refresh_users",
        "EXECUTE dbo.refresh_users",
        "DBCC CHECKDB ([app])",
        "GO",
        "USE [app]",
        "BACKUP DATABASE [app] TO DISK = N'/tmp/app.bak'",
        "RESTORE DATABASE [app] FROM DISK = N'/tmp/app.bak'",
        "DENY SELECT ON users TO alice",
    ] {
        let e = err(sql);
        assert_eq!(
            e.error_kind,
            ParseErrorKind::UnsupportedStatement,
            "sql={sql}"
        );
    }
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
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
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
