use std::collections::HashSet;

use oracle_rs::{
    types::{LobValue, OracleDate, OracleNumber, OracleTimestamp, RowId},
    OracleType, Value as OracleValue,
};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnDefinition, ConstraintDefinition, FilterCondition, FilterOperator,
    QueryType,
};

use super::super::common::{
    build_order_clause, build_where_clause, classify_mutation, format_oracle_dictionary_type,
    is_oracle_ddl, is_select_like, json_i64, json_string, map_oracle_data_type,
    oracle_canonical_name, oracle_column_definition, oracle_constraint_definition,
    oracle_constraint_type, oracle_db_error, oracle_error, oracle_name_literal, oracle_type_name,
    oracle_value_to_json, qualified_object, qualified_table, quote_ident, referential_action,
    sql_string, starts_with_keyword, strip_leading_comments, strip_trailing_terminator,
    validate_identifier, validate_raw_where,
};
use super::column_info;

#[test]
fn value_and_type_helpers_cover_supported_oracle_variants() {
    assert_eq!(oracle_value_to_json(&OracleValue::Null), Value::Null);
    assert_eq!(
        oracle_value_to_json(&OracleValue::String("x".into())),
        json!("x")
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Bytes(vec![1, 2, 3])),
        json!("AQID")
    );
    assert_eq!(oracle_value_to_json(&OracleValue::Integer(7)), json!(7));
    assert_eq!(oracle_value_to_json(&OracleValue::Float(1.5)), json!(1.5));
    assert_eq!(
        oracle_value_to_json(&OracleValue::Float(f64::NAN)),
        Value::Null
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Number(OracleNumber::new("123.45"))),
        json!("123.45")
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Date(OracleDate::date(2026, 6, 6))),
        json!("2026-06-06 00:00:00")
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Timestamp(OracleTimestamp::new(
            2026, 6, 6, 1, 2, 3, 4000
        ))),
        json!("2026-06-06 01:02:03.004000")
    );
    assert!(oracle_value_to_json(&OracleValue::RowId(RowId::new(1, 1, 1, 1))).is_string());
    assert_eq!(
        oracle_value_to_json(&OracleValue::Lob(LobValue::Null)),
        json!("NULL")
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Lob(LobValue::Empty)),
        json!("<empty LOB>")
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Boolean(false)),
        json!(false)
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Json(json!({"a": 1}))),
        json!({"a": 1})
    );

    for (oracle_type, precision, scale, expected) in [
        (OracleType::Varchar, 0, 0, "varchar2"),
        (OracleType::Number, 10, 2, "number(10,2)"),
        (OracleType::Number, 0, 0, "number"),
        (OracleType::BinaryInteger, 0, 0, "binary_integer"),
        (OracleType::Long, 0, 0, "long"),
        (OracleType::Rowid, 0, 0, "rowid"),
        (OracleType::Date, 0, 0, "date"),
        (OracleType::Raw, 0, 0, "raw"),
        (OracleType::LongRaw, 0, 0, "long raw"),
        (OracleType::Char, 0, 0, "char"),
        (OracleType::BinaryFloat, 0, 0, "binary_float"),
        (OracleType::BinaryDouble, 0, 0, "binary_double"),
        (OracleType::Cursor, 0, 0, "ref cursor"),
        (OracleType::Object, 0, 0, "object"),
        (OracleType::Clob, 0, 0, "clob"),
        (OracleType::Blob, 0, 0, "blob"),
        (OracleType::Bfile, 0, 0, "bfile"),
        (OracleType::Json, 0, 0, "json"),
        (OracleType::Vector, 0, 0, "vector"),
        (OracleType::Timestamp, 0, 0, "timestamp"),
        (OracleType::TimestampTz, 0, 0, "timestamp with time zone"),
        (OracleType::IntervalYm, 0, 0, "interval year to month"),
        (OracleType::IntervalDs, 0, 0, "interval day to second"),
        (OracleType::Urowid, 0, 0, "urowid"),
        (
            OracleType::TimestampLtz,
            0,
            0,
            "timestamp with local time zone",
        ),
        (OracleType::Boolean, 0, 0, "boolean"),
    ] {
        assert_eq!(oracle_type_name(oracle_type, precision, scale), expected);
    }

    for (data_type, expected) in [
        ("NUMBER(10,2)", ColumnCategory::Float),
        ("binary_double", ColumnCategory::Float),
        ("timestamp with time zone", ColumnCategory::Datetime),
        ("interval day to second", ColumnCategory::Datetime),
        ("nvarchar2(20)", ColumnCategory::Text),
        ("long", ColumnCategory::Text),
        ("blob", ColumnCategory::Binary),
        ("json", ColumnCategory::Object),
        ("object", ColumnCategory::Object),
        ("vector", ColumnCategory::Object),
        ("cursor", ColumnCategory::Object),
        ("boolean", ColumnCategory::Bool),
        ("sdo_geometry", ColumnCategory::Unknown),
    ] {
        assert_eq!(map_oracle_data_type(data_type), expected, "{data_type}");
    }
}

#[test]
fn oracle_format_identifier_and_constraint_helpers_cover_edge_cases() {
    assert_eq!(oracle_canonical_name(" mixed "), "MIXED");
    assert_eq!(quote_ident("a\"b"), "\"A\"\"B\"");
    assert_eq!(qualified_table("app", "users"), "\"APP\".\"USERS\"");
    assert_eq!(qualified_object("app", "idx"), "\"APP\".\"IDX\"");
    assert_eq!(sql_string("O'Brien"), "'O''Brien'");
    assert_eq!(oracle_name_literal("mixed"), "'MIXED'");

    assert_eq!(
        format_oracle_dictionary_type("VARCHAR2", Some(20), None, None),
        "VARCHAR2(20)"
    );
    assert_eq!(
        format_oracle_dictionary_type("VARCHAR2", Some(0), None, None),
        "VARCHAR2"
    );
    assert_eq!(
        format_oracle_dictionary_type("RAW", Some(16), None, None),
        "RAW(16)"
    );
    assert_eq!(
        format_oracle_dictionary_type("NUMBER", None, Some(12), Some(4)),
        "NUMBER(12,4)"
    );
    assert_eq!(
        format_oracle_dictionary_type("NUMBER", None, Some(12), None),
        "NUMBER(12)"
    );
    assert_eq!(
        format_oracle_dictionary_type("NUMBER", None, Some(0), Some(0)),
        "NUMBER"
    );
    assert_eq!(
        format_oracle_dictionary_type("NUMBER", None, None, None),
        "NUMBER"
    );
    assert_eq!(
        format_oracle_dictionary_type("DATE", Some(7), Some(1), Some(0)),
        "DATE"
    );

    assert_eq!(json_string(None), None);
    assert_eq!(json_string(Some(&json!("x"))).as_deref(), Some("x"));
    assert_eq!(json_string(Some(&json!(42))).as_deref(), Some("42"));
    assert_eq!(json_string(Some(&json!(true))).as_deref(), Some("true"));
    assert_eq!(json_string(Some(&json!({}))), None);
    assert_eq!(json_i64(None), None);
    assert_eq!(json_i64(Some(&json!(7))), Some(7));
    assert_eq!(json_i64(Some(&json!("bad"))), None);
    assert_eq!(json_i64(Some(&json!(false))), None);

    assert!(validate_identifier("valid_name", "Identifier").is_ok());
    assert!(validate_identifier("", "Identifier").is_err());
    assert!(validate_identifier(&"a".repeat(129), "Identifier").is_err());
    assert!(validate_identifier("1BAD", "Identifier").is_err());
    assert!(validate_identifier("BAD-NAME", "Identifier").is_err());

    let identity = ColumnDefinition {
        name: "id".into(),
        data_type: "NUMBER".into(),
        nullable: true,
        default_value: Some("1".into()),
        comment: None,
        is_identity: true,
    };
    assert_eq!(
        oracle_column_definition(&identity).unwrap(),
        "\"ID\" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL"
    );
    assert!(oracle_column_definition(&ColumnDefinition {
        name: "bad-name".into(),
        data_type: "NUMBER".into(),
        nullable: false,
        default_value: None,
        comment: None,
        is_identity: false,
    })
    .is_err());
    assert!(oracle_column_definition(&ColumnDefinition {
        name: "id".into(),
        data_type: " ".into(),
        nullable: false,
        default_value: None,
        comment: None,
        is_identity: false,
    })
    .is_err());

    assert!(
        oracle_constraint_definition(&ConstraintDefinition::PrimaryKey { columns: vec![] })
            .is_err()
    );
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::PrimaryKey {
            columns: vec!["bad-name".into()],
        })
        .is_err()
    );
    assert_eq!(
        oracle_constraint_definition(&ConstraintDefinition::PrimaryKey {
            columns: vec!["id".into(), "tenant_id".into()],
        })
        .unwrap(),
        "PRIMARY KEY (\"ID\", \"TENANT_ID\")"
    );
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::Unique { columns: vec![] }).is_err()
    );
    assert!(oracle_constraint_definition(&ConstraintDefinition::Unique {
        columns: vec!["bad-name".into()],
    })
    .is_err());
    assert_eq!(
        oracle_constraint_definition(&ConstraintDefinition::Check {
            expression: " amount >= 0 ".into(),
        })
        .unwrap(),
        "CHECK (amount >= 0)"
    );
    assert!(oracle_constraint_definition(&ConstraintDefinition::Check {
        expression: " ".into(),
    })
    .is_err());
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: Some("CASCADE".into()),
        })
        .is_err()
    );
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::ForeignKey {
            columns: vec![],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: None,
            on_update: None,
        })
        .is_err()
    );
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "bad-name".into(),
            reference_columns: vec!["id".into()],
            on_delete: None,
            on_update: None,
        })
        .is_err()
    );
    assert!(
        oracle_constraint_definition(&ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["bad-name".into()],
            on_delete: None,
            on_update: None,
        })
        .is_err()
    );
    assert_eq!(
        oracle_constraint_definition(&ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("NO ACTION".into()),
            on_update: None,
        })
        .unwrap(),
        "FOREIGN KEY (\"USER_ID\") REFERENCES \"USERS\" (\"ID\") ON DELETE NO ACTION"
    );
    assert_eq!(referential_action(None, "ON DELETE").unwrap(), "");
    assert_eq!(
        referential_action(Some("SET NULL"), "ON DELETE").unwrap(),
        " ON DELETE SET NULL"
    );
    assert!(referential_action(Some("RESTRICT"), "ON DELETE").is_err());

    assert_eq!(oracle_constraint_type(Some("P")), "PRIMARY KEY");
    assert_eq!(oracle_constraint_type(Some("U")), "UNIQUE");
    assert_eq!(oracle_constraint_type(Some("R")), "FOREIGN KEY");
    assert_eq!(oracle_constraint_type(Some("C")), "CHECK");
    assert_eq!(oracle_constraint_type(Some("X")), "X");
    assert_eq!(oracle_constraint_type(None), "");

    assert!(matches!(
        oracle_error("ctx", "err"),
        AppError::Connection(_)
    ));
    assert!(matches!(
        oracle_db_error("ctx", "err"),
        AppError::Database(_)
    ));
}

#[test]
fn oracle_query_helpers_cover_comments_classification_where_and_order_branches() {
    assert_eq!(strip_leading_comments("-- only comment"), "");
    assert_eq!(strip_leading_comments("/* unterminated"), "");
    assert_eq!(
        strip_leading_comments("-- a\n/* b */ SELECT 1 FROM dual"),
        "SELECT 1 FROM dual"
    );
    assert_eq!(strip_trailing_terminator("SELECT 1;;; \n"), "SELECT 1");
    assert!(starts_with_keyword("SELECT", "SELECT"));
    assert!(starts_with_keyword("SELECT *", "SELECT"));
    assert!(!starts_with_keyword("SELECT1", "SELECT"));
    assert!(!starts_with_keyword("SELECTED", "SELECT"));
    assert!(is_select_like(
        "WITH q AS (SELECT 1 FROM dual) SELECT * FROM q"
    ));
    assert!(!is_select_like("UPDATE USERS SET ID = ID"));
    assert!(!is_select_like("WITHIN GROUP"));

    for sql in [
        "CREATE TABLE T(ID NUMBER)",
        "ALTER TABLE T ADD NAME VARCHAR2(1)",
        "DROP TABLE T",
        "TRUNCATE TABLE T",
        "RENAME T TO T2",
    ] {
        assert!(is_oracle_ddl(sql), "{sql}");
    }
    assert!(!is_oracle_ddl("GRANT SELECT ON T TO U"));
    assert!(!is_oracle_ddl("-- comment only"));

    for sql in [
        "INSERT INTO T VALUES (1)",
        "UPDATE T SET ID = 1",
        "DELETE FROM T",
        "MERGE INTO T USING S ON (1=1)",
    ] {
        assert!(matches!(
            classify_mutation(sql, 9),
            QueryType::Dml { rows_affected: 9 }
        ));
    }
    assert!(matches!(
        classify_mutation("CREATE TABLE T(ID NUMBER)", 0),
        QueryType::Ddl
    ));

    assert!(validate_raw_where("ID > 1").is_ok());
    for raw in [
        "ID > 1;",
        "ID > 1 -- comment",
        "ID > 1 /* comment */",
        "DROP TABLE USERS",
        "DELETE FROM USERS",
        "INSERT INTO USERS VALUES (1)",
        "UPDATE USERS SET ID = 1",
        "ALTER TABLE USERS ADD ID NUMBER",
        "CREATE TABLE USERS(ID NUMBER)",
        "TRUNCATE TABLE USERS",
        "GRANT SELECT TO USER",
        "REVOKE SELECT FROM USER",
    ] {
        assert!(validate_raw_where(raw).is_err(), "{raw}");
    }

    let valid_columns: HashSet<&str> = ["ID", "EMAIL", "AGE", "ACTIVE"].into_iter().collect();
    assert_eq!(
        build_where_clause(&valid_columns, None, Some(" AGE >= 18 ")).unwrap(),
        " WHERE AGE >= 18"
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
        " WHERE \"ID\" = '1' AND \"EMAIL\" <> 'root@example.com' AND \"AGE\" > '18' AND \"AGE\" < '65' AND \"AGE\" >= '21' AND \"AGE\" <= '64' AND \"EMAIL\" LIKE '%@example.com' AND \"ACTIVE\" IS NULL AND \"ACTIVE\" IS NOT NULL"
    );

    let columns = [
        column_info("id", true),
        column_info("email", false),
        column_info("age", false),
    ];
    assert_eq!(
        build_order_clause(Some("email, age ASC, id DESC, bad WRONG"), &columns),
        " ORDER BY \"EMAIL\" ASC, \"AGE\" ASC, \"ID\" DESC"
    );
    assert_eq!(
        build_order_clause(Some("missing DESC"), &columns),
        " ORDER BY \"ID\" ASC"
    );
    assert_eq!(
        build_order_clause(None, &[column_info("email", false)]),
        " ORDER BY 1"
    );
}
