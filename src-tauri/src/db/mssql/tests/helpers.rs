use std::collections::HashSet;

use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::{ColumnCategory, FilterCondition, FilterOperator, QueryType};

use super::super::query::{
    build_order_clause, build_where_clause, classify_mutation, is_select_like,
    strip_leading_comments, strip_trailing_terminator, validate_raw_where,
};
use super::super::support::{
    format_mssql_data_type, json_bool, json_i64, json_string, map_mssql_data_type, mssql_db_error,
    mssql_error, qualified_table, quote_ident, sql_string, validate_identifier,
};
use super::column_info;

#[test]
fn data_type_mapping_covers_supported_mssql_families() {
    for (data_type, expected) in [
        ("bit", ColumnCategory::Bool),
        ("tinyint", ColumnCategory::Int),
        ("smallint", ColumnCategory::Int),
        ("int", ColumnCategory::Int),
        ("bigint", ColumnCategory::Int),
        ("intn", ColumnCategory::Int),
        ("decimal(10,2)", ColumnCategory::Float),
        ("numeric", ColumnCategory::Float),
        ("money", ColumnCategory::Float),
        ("floatn", ColumnCategory::Float),
        ("datetimeoffset", ColumnCategory::Datetime),
        ("daten", ColumnCategory::Datetime),
        ("timen", ColumnCategory::Datetime),
        ("guid", ColumnCategory::Uuid),
        ("binary", ColumnCategory::Binary),
        ("bigvarbin", ColumnCategory::Binary),
        ("xml", ColumnCategory::Object),
        ("json", ColumnCategory::Object),
        ("udt", ColumnCategory::Object),
        ("varchar(255)", ColumnCategory::Text),
        ("ntext", ColumnCategory::Text),
        ("geography", ColumnCategory::Unknown),
    ] {
        assert_eq!(map_mssql_data_type(data_type), expected, "{data_type}");
    }
}

#[test]
fn formatting_json_and_identifier_helpers_cover_edge_cases() {
    assert_eq!(quote_ident("a]b"), "[a]]b]");
    assert_eq!(qualified_table("dbo", "users"), "[dbo].[users]");
    assert_eq!(sql_string("O'Brien"), "N'O''Brien'");

    assert_eq!(
        format_mssql_data_type("varchar", Some(32), None, None),
        "varchar(32)"
    );
    assert_eq!(
        format_mssql_data_type("binary", Some(-1), None, None),
        "binary(max)"
    );
    assert_eq!(
        format_mssql_data_type("nvarchar", Some(20), None, None),
        "nvarchar(10)"
    );
    assert_eq!(
        format_mssql_data_type("nchar", Some(-1), None, None),
        "nchar(max)"
    );
    assert_eq!(
        format_mssql_data_type("numeric", None, Some(12), Some(4)),
        "numeric(12,4)"
    );
    assert_eq!(
        format_mssql_data_type("decimal", None, None, None),
        "decimal"
    );
    assert_eq!(format_mssql_data_type("char", Some(0), None, None), "char");
    assert_eq!(
        format_mssql_data_type("nvarchar", Some(0), None, None),
        "nvarchar"
    );
    assert_eq!(
        format_mssql_data_type("numeric", None, Some(0), Some(0)),
        "numeric"
    );
    assert_eq!(
        format_mssql_data_type("datetime2", Some(8), Some(7), Some(0)),
        "datetime2"
    );

    assert_eq!(json_string(None), None);
    assert_eq!(json_string(Some(&json!("x"))).as_deref(), Some("x"));
    assert_eq!(json_string(Some(&json!(42))).as_deref(), Some("42"));
    assert_eq!(json_string(Some(&json!(false))).as_deref(), Some("false"));
    assert_eq!(json_string(Some(&json!({}))), None);
    assert_eq!(json_i64(None), None);
    assert_eq!(json_i64(Some(&json!(7))), Some(7));
    assert_eq!(json_i64(Some(&json!("bad"))), None);
    assert_eq!(json_i64(Some(&json!(true))), None);
    assert_eq!(json_bool(None), None);
    assert_eq!(json_bool(Some(&Value::Bool(true))), Some(true));
    assert_eq!(json_bool(Some(&json!(0))), Some(false));
    assert_eq!(json_bool(Some(&json!(2))), Some(true));
    assert_eq!(json_bool(Some(&json!("1"))), Some(true));
    assert_eq!(json_bool(Some(&json!("false"))), Some(false));
    assert_eq!(json_bool(Some(&json!("TRUE"))), Some(true));
    assert_eq!(json_bool(Some(&json!("FALSE"))), Some(false));
    assert_eq!(json_bool(Some(&json!("maybe"))), None);
    assert_eq!(json_bool(Some(&json!({}))), None);

    assert!(validate_identifier("valid_name", "Identifier").is_ok());
    assert!(validate_identifier("", "Identifier").is_err());
    assert!(validate_identifier(&"a".repeat(129), "Identifier").is_err());
    assert!(validate_identifier("1bad", "Identifier").is_err());
    assert!(validate_identifier("bad-name", "Identifier").is_err());

    assert!(matches!(mssql_error("ctx", "err"), AppError::Connection(_)));
    assert!(matches!(
        mssql_db_error("ctx", "err"),
        AppError::Database(_)
    ));
}

#[test]
fn query_helpers_cover_comments_classification_where_and_order_branches() {
    assert_eq!(strip_leading_comments("-- only comment"), "");
    assert_eq!(strip_leading_comments("/* unterminated"), "");
    assert_eq!(strip_leading_comments("-- a\n/* b */ SELECT 1"), "SELECT 1");
    assert_eq!(strip_trailing_terminator("SELECT 1;;; \n"), "SELECT 1");

    assert!(is_select_like("SELECT 1"));
    assert!(is_select_like("EXEC dbo.proc"));
    assert!(is_select_like("DECLARE @x int"));
    assert!(!is_select_like("SELECTED = 1"));
    assert!(!is_select_like("EXECUTE dbo.proc"));
    assert!(!is_select_like("UPDATE t SET id = id"));

    for sql in [
        "INSERT INTO t VALUES (1)",
        "UPDATE t SET id = 1",
        "DELETE FROM t",
        "MERGE t USING s ON 1=1",
    ] {
        assert!(matches!(
            classify_mutation(sql, 9),
            QueryType::Dml { rows_affected: 9 }
        ));
    }
    assert!(matches!(
        classify_mutation("CREATE TABLE t(id int)", 0),
        QueryType::Ddl
    ));

    assert!(validate_raw_where("id > 1").is_ok());
    for raw in [
        "id > 1;",
        "id > 1 -- comment",
        "id > 1 /* comment */",
        "DROP TABLE users",
        "DELETE FROM users",
        "INSERT INTO users VALUES (1)",
        "UPDATE users SET id = 1",
        "ALTER TABLE users ADD id int",
        "CREATE TABLE users(id int)",
        "TRUNCATE TABLE users",
        "GRANT SELECT TO user",
        "REVOKE SELECT FROM user",
    ] {
        assert!(validate_raw_where(raw).is_err(), "{raw}");
    }

    let valid_columns: HashSet<&str> = ["id", "email", "age", "active"].into_iter().collect();
    assert_eq!(
        build_where_clause(&valid_columns, None, Some(" age >= 18 ")).unwrap(),
        " WHERE age >= 18"
    );
    assert_eq!(
        build_where_clause(&valid_columns, None, Some("   ")).unwrap(),
        ""
    );
    assert_eq!(build_where_clause(&valid_columns, None, None).unwrap(), "");

    let filters = vec![
        FilterCondition {
            column: "id".into(),
            operator: FilterOperator::Eq,
            value: Some("1".into()),
        },
        FilterCondition {
            column: "email".into(),
            operator: FilterOperator::Neq,
            value: Some("root@example.com".into()),
        },
        FilterCondition {
            column: "age".into(),
            operator: FilterOperator::Gt,
            value: Some("18".into()),
        },
        FilterCondition {
            column: "age".into(),
            operator: FilterOperator::Lt,
            value: Some("65".into()),
        },
        FilterCondition {
            column: "age".into(),
            operator: FilterOperator::Gte,
            value: Some("21".into()),
        },
        FilterCondition {
            column: "age".into(),
            operator: FilterOperator::Lte,
            value: Some("64".into()),
        },
        FilterCondition {
            column: "email".into(),
            operator: FilterOperator::Like,
            value: Some("%@example.com".into()),
        },
        FilterCondition {
            column: "active".into(),
            operator: FilterOperator::IsNull,
            value: None,
        },
        FilterCondition {
            column: "active".into(),
            operator: FilterOperator::IsNotNull,
            value: None,
        },
        FilterCondition {
            column: "missing".into(),
            operator: FilterOperator::Eq,
            value: Some("ignored".into()),
        },
        FilterCondition {
            column: "email".into(),
            operator: FilterOperator::Eq,
            value: None,
        },
    ];
    assert_eq!(
        build_where_clause(&valid_columns, Some(&filters), None).unwrap(),
        " WHERE [id] = N'1' AND [email] <> N'root@example.com' AND [age] > N'18' AND [age] < N'65' AND [age] >= N'21' AND [age] <= N'64' AND [email] LIKE N'%@example.com' AND [active] IS NULL AND [active] IS NOT NULL"
    );

    let columns = [
        column_info("id", true),
        column_info("email", false),
        column_info("age", false),
    ];
    assert_eq!(
        build_order_clause(Some("email, age ASC, id DESC, bad WRONG"), &columns),
        " ORDER BY [email] ASC, [age] ASC, [id] DESC"
    );
    assert_eq!(
        build_order_clause(Some("missing DESC"), &columns),
        " ORDER BY [id] ASC"
    );
    assert_eq!(
        build_order_clause(None, &[column_info("email", false)]),
        " ORDER BY (SELECT NULL)"
    );
}
