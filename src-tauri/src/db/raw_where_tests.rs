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
