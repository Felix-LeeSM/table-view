use super::*;

#[test]
fn accepts_plain_boolean_filter() {
    assert!(
        validate_raw_where_clause(RawWhereDialect::Sqlite, "status = 'active' AND age > 18",)
            .is_ok()
    );
}

#[test]
fn accepts_dialect_quoted_identifiers() {
    assert!(validate_raw_where_clause(RawWhereDialect::Postgres, r#""status" = 'active'"#).is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Mysql, "`status` = 'active'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Mssql, "[status] = 'active'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Oracle, r#""STATUS" = 'active'"#).is_ok());
}

#[test]
fn accepts_booleanish_value_expressions() {
    assert!(validate_raw_where_clause(RawWhereDialect::Postgres, "is_active").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "json_valid(payload)").is_ok());
}

#[test]
fn accepts_dialect_specific_binary_predicates() {
    assert!(validate_raw_where_clause(RawWhereDialect::Postgres, "payload ? 'enabled'").is_ok());
    assert!(validate_raw_where_clause(
        RawWhereDialect::Postgres,
        "payload @> '{\"enabled\": true}'"
    )
    .is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name GLOB 'A*'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name NOT GLOB 'A*'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name REGEXP '^A'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name NOT REGEXP '^A'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name MATCH 'alpha'").is_ok());
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "name NOT MATCH 'alpha'").is_ok());
}

#[test]
fn accepts_oracle_predicate_shapes_used_by_table_browse() {
    for clause in [
        r#""AGE" BETWEEN 18 AND 65"#,
        r#""ID" IN (1, 2, 3)"#,
        r#"NOT ("STATUS" IS NULL OR "STATUS" IS NOT NULL)"#,
        r#"LOWER("NAME") = 'ada'"#,
        r#"CAST("AGE" AS NUMBER) >= 21"#,
        r#"CASE WHEN "AGE" > 18 THEN "AGE" ELSE 0 END > 0"#,
    ] {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Oracle, clause).is_ok(),
            "{clause}"
        );
    }
}

#[test]
fn rejects_oracle_raw_where_query_tails_and_subqueries() {
    for clause in [
        r#""ACTIVE" = 1 ORDER BY "ID""#,
        r#""ACTIVE" = 1 GROUP BY "ACTIVE""#,
        r#"EXISTS (SELECT 1 FROM DUAL)"#,
        r#""ID" IN (SELECT "ID" FROM "ADMINS")"#,
    ] {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Oracle, clause).is_err(),
            "{clause}"
        );
    }
}

#[test]
fn accepts_nested_value_expressions_without_query_clauses() {
    for clause in [
        "(age + 1) > 18",
        "name IS NOT TRUE",
        "name IS NOT DISTINCT FROM alias",
        "COALESCE(name, 'unknown') = 'Ada'",
        "CASE WHEN age > 18 THEN age ELSE 0 END > 0",
    ] {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Postgres, clause).is_ok(),
            "{clause}"
        );
    }
}

#[test]
fn rejects_value_expressions_with_embedded_subqueries() {
    for clause in [
        "id = ANY (SELECT id FROM admins)",
        "id = ALL (SELECT id FROM admins)",
        "CASE WHEN EXISTS (SELECT 1) THEN 1 ELSE 0 END = 1",
    ] {
        assert!(
            validate_raw_where_clause(RawWhereDialect::Postgres, clause).is_err(),
            "{clause}"
        );
    }
}

#[test]
fn accepts_comment_marker_inside_string_literal() {
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "note = '--literal'").is_ok());
}

#[test]
fn accepts_identifier_starting_with_dangerous_keyword() {
    assert!(validate_raw_where_clause(RawWhereDialect::Sqlite, "updated_at IS NOT NULL").is_ok());
}

#[test]
fn rejects_union_select_tail() {
    assert!(validate_raw_where_clause(
        RawWhereDialect::Sqlite,
        "active = 1 UNION SELECT password FROM users",
    )
    .is_err());
}

#[test]
fn rejects_line_comment_smuggling() {
    assert!(validate_raw_where_clause(
        RawWhereDialect::Sqlite,
        "active = 1 -- hide the rest\n OR 1 = 1",
    )
    .is_err());
}

#[test]
fn keeps_dangerous_prefix_error_copy() {
    let err = validate_raw_where_clause(RawWhereDialect::Mysql, "DROP TABLE users")
        .expect_err("dangerous prefix should be rejected");
    match err {
        AppError::Validation(message) => assert!(message.contains("DROP")),
        other => panic!("expected validation error, got {other:?}"),
    }
}

#[test]
fn rejects_subqueries() {
    assert!(
        validate_raw_where_clause(RawWhereDialect::Sqlite, "id IN (SELECT id FROM admins)",)
            .is_err()
    );
}

#[test]
fn keeps_semicolon_error_copy() {
    let err = validate_raw_where_clause(RawWhereDialect::Sqlite, "a = 1; DROP TABLE users")
        .expect_err("semicolon should be rejected");
    match err {
        AppError::Validation(message) => assert!(message.contains("semicolons")),
        other => panic!("expected validation error, got {other:?}"),
    }
}
