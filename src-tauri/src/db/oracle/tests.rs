use oracle_rs::{OracleType, Value as OracleValue};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::db::{DbAdapter, RdbAdapter};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnCategory, ColumnChange,
    ColumnDefinition, ColumnInfo, ConnectionConfig, ConstraintDefinition, CreateIndexRequest,
    CreateTableRequest, DatabaseType, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, FilterCondition, FilterOperator, QueryType, RenameTableRequest,
};

use super::common::{
    build_order_clause, build_where_clause, classify_mutation, format_oracle_dictionary_type,
    is_oracle_ddl, is_select_like, json_i64, json_string, map_oracle_data_type,
    oracle_canonical_name, oracle_column_definition, oracle_constraint_definition,
    oracle_constraint_type, oracle_name_literal, oracle_type_name, oracle_value_to_json,
    qualified_object, qualified_table, quote_ident, referential_action, sql_string,
    strip_leading_comments, strip_trailing_terminator, validate_identifier, validate_raw_where,
};
use super::OracleAdapter;

mod helpers;
mod row_mappers;

fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: "conn".into(),
        name: "oracle".into(),
        db_type: DatabaseType::Oracle,
        host: "localhost".into(),
        port: 1521,
        user: "testuser".into(),
        password: "testpass".into(),
        database: "XEPDB1".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

fn col(name: &str, data_type: &str) -> ColumnDefinition {
    ColumnDefinition {
        name: name.into(),
        data_type: data_type.into(),
        nullable: false,
        default_value: None,
        comment: None,
        is_identity: false,
    }
}

fn nullable_col(name: &str, data_type: &str) -> ColumnDefinition {
    ColumnDefinition {
        nullable: true,
        default_value: Some("'n/a'".into()),
        ..col(name, data_type)
    }
}

fn column_info(name: &str, primary: bool) -> ColumnInfo {
    ColumnInfo {
        name: name.into(),
        data_type: "NUMBER".into(),
        nullable: false,
        default_value: None,
        is_primary_key: primary,
        is_foreign_key: false,
        fk_reference: None,
        comment: None,
        check_clauses: Vec::new(),
        category: ColumnCategory::Float,
    }
}

#[test]
fn connection_config_validation_and_trait_identity_are_local() {
    let adapter = OracleAdapter::default();
    assert!(matches!(adapter.kind(), DatabaseType::Oracle));
    assert!(matches!(
        adapter.namespace_label(),
        crate::db::NamespaceLabel::Schema
    ));

    let err = OracleAdapter::build_oracle_config(&ConnectionConfig {
        host: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));

    let err = OracleAdapter::build_oracle_config(&ConnectionConfig {
        user: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));

    let err = OracleAdapter::build_oracle_config(&ConnectionConfig {
        database: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
}

#[tokio::test]
async fn disconnected_and_cancelled_paths_fail_before_network_work() {
    let adapter = OracleAdapter::new();
    assert!(matches!(
        adapter.connected_config().await.unwrap_err(),
        AppError::Connection(_)
    ));

    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(
        adapter
            .execute_sql("SELECT 1 FROM dual", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .execute_sql_batch(&["UPDATE USERS SET ID = ID".into()], Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .dry_run_sql_batch(&["UPDATE USERS SET ID = ID".into()], Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .query_table_data("APP", "USERS", 1, 10, None, None, None, Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_columns("APP", "USERS", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_table_indexes("APP", "USERS", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_table_constraints("APP", "USERS", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(adapter
        .execute_sql_batch(&[], None)
        .await
        .unwrap()
        .is_empty());
    assert!(matches!(
        adapter
            .dry_run_sql_batch(&["CREATE TABLE t(id NUMBER)".into()], None)
            .await
            .unwrap_err(),
        AppError::Unsupported(_)
    ));
}

#[tokio::test]
async fn connected_with_invalid_config_exercises_metadata_and_query_entrypoints() {
    let adapter = OracleAdapter::new();
    {
        let mut guard = adapter.connected_config.lock().await;
        *guard = Some(ConnectionConfig {
            host: String::new(),
            ..config()
        });
    }
    let bad_config = ConnectionConfig {
        host: String::new(),
        ..config()
    };

    for result in [
        adapter.list_namespaces().await.map(|_| ()),
        adapter.current_database().await.map(|_| ()),
        adapter.list_tables("APP").await.map(|_| ()),
        adapter.get_columns("APP", "USERS", None).await.map(|_| ()),
        adapter
            .count_null_rows("APP", "USERS", "EMAIL")
            .await
            .map(|_| ()),
        adapter
            .get_table_indexes("APP", "USERS", None)
            .await
            .map(|_| ()),
        adapter
            .get_table_constraints("APP", "USERS", None)
            .await
            .map(|_| ()),
        adapter.list_views("APP").await.map(|_| ()),
        adapter.list_functions("APP").await.map(|_| ()),
        adapter
            .get_view_definition("APP", "ACTIVE_USERS")
            .await
            .map(|_| ()),
        adapter
            .get_view_columns("APP", "ACTIVE_USERS")
            .await
            .map(|_| ()),
        adapter.list_schema_columns("APP").await.map(|_| ()),
        adapter
            .get_function_source("APP", "FN_USERS")
            .await
            .map(|_| ()),
        adapter
            .execute_sql("UPDATE USERS SET ID = ID", None)
            .await
            .map(|_| ()),
        adapter
            .execute_sql_batch(&["UPDATE USERS SET ID = ID".into()], None)
            .await
            .map(|_| ()),
        adapter
            .dry_run_sql_batch(&["UPDATE USERS SET ID = ID".into()], None)
            .await
            .map(|_| ()),
        adapter
            .query_table_data("APP", "USERS", 1, 10, None, None, None, None)
            .await
            .map(|_| ()),
    ] {
        assert!(result.is_err());
    }

    assert!(matches!(
        adapter
            .query_table_data("1BAD", "USERS", 1, 10, None, None, None, None)
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter.switch_database("OTHER").await,
        Err(AppError::Unsupported(_))
    ));
    assert!(matches!(
        OracleAdapter::execute_statement(&bad_config, "").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        OracleAdapter::execute_statement(&bad_config, "SELECT 1 FROM dual").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        OracleAdapter::execute_statement(&bad_config, "UPDATE USERS SET ID = ID").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        OracleAdapter::query_select(&bad_config, "SELECT 1 FROM dual").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        OracleAdapter::schema_rows(&bad_config, "SELECT 1 FROM dual").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        OracleAdapter::table_columns_inner(&bad_config, "APP", "USERS").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter
            .run_schema_sql("ALTER TABLE USERS ADD EMAIL VARCHAR2(320)", false)
            .await,
        Err(AppError::Validation(_))
    ));
}

#[tokio::test]
async fn preview_table_ddl_emits_oracle_sql_without_connection() {
    let adapter = OracleAdapter::new();
    let mut id = col("id", "NUMBER");
    id.is_identity = true;
    let req = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        name: "users".into(),
        columns: vec![id, nullable_col("email", "VARCHAR2(320)")],
        primary_key: Some(vec!["id".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let sql = adapter.create_table(&req).await.unwrap().sql;
    assert_eq!(
        sql,
        "CREATE TABLE \"APP\".\"USERS\" (\"ID\" NUMBER GENERATED BY DEFAULT AS IDENTITY NOT NULL, \"EMAIL\" VARCHAR2(320) DEFAULT 'n/a', PRIMARY KEY (\"ID\"))"
    );

    let rename = RenameTableRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        new_name: "people".into(),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.rename_table(&rename).await.unwrap().sql,
        "ALTER TABLE \"APP\".\"USERS\" RENAME TO \"PEOPLE\""
    );

    let drop = DropTableRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "people".into(),
        cascade: true,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_table(&drop).await.unwrap().sql,
        "DROP TABLE \"APP\".\"PEOPLE\" CASCADE CONSTRAINTS"
    );
}

#[tokio::test]
async fn preview_column_and_alter_ddl_cover_add_modify_drop() {
    let adapter = OracleAdapter::new();
    let add = AddColumnRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        column: nullable_col("email", "VARCHAR2(320)"),
        check_expression: Some("LENGTH(email) > 3".into()),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.add_column(&add).await.unwrap().sql,
        "ALTER TABLE \"APP\".\"USERS\" ADD (\"EMAIL\" VARCHAR2(320) DEFAULT 'n/a' CHECK (LENGTH(email) > 3))"
    );

    let alter = AlterTableRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        changes: vec![
            ColumnChange::Add {
                name: "age".into(),
                data_type: "NUMBER".into(),
                nullable: false,
                default_value: Some("0".into()),
            },
            ColumnChange::Modify {
                name: "email".into(),
                new_data_type: Some("VARCHAR2(400)".into()),
                new_nullable: Some(false),
                new_default_value: Some("''".into()),
                using_expression: None,
            },
            ColumnChange::Drop { name: "age".into() },
        ],
        preview_only: true,
        expected_database: None,
    };
    let sql = adapter.alter_table(&alter).await.unwrap().sql;
    assert!(sql.contains("ALTER TABLE \"APP\".\"USERS\" ADD (\"AGE\" NUMBER DEFAULT 0 NOT NULL)"));
    assert!(sql.contains(
        "ALTER TABLE \"APP\".\"USERS\" MODIFY (\"EMAIL\" VARCHAR2(400) DEFAULT '' NOT NULL)"
    ));
    assert!(sql.contains("ALTER TABLE \"APP\".\"USERS\" DROP COLUMN \"AGE\""));

    let drop = DropColumnRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        column_name: "email".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_column(&drop).await.unwrap().sql,
        "ALTER TABLE \"APP\".\"USERS\" DROP COLUMN \"EMAIL\""
    );
}

#[tokio::test]
async fn preview_index_and_constraint_ddl_cover_supported_shapes() {
    let adapter = OracleAdapter::new();
    let index = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        columns: vec!["email".into()],
        index_type: "bitmap".into(),
        is_unique: false,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.create_index(&index).await.unwrap().sql,
        "CREATE BITMAP INDEX \"APP\".\"IDX_USERS_EMAIL\" ON \"APP\".\"USERS\" (\"EMAIL\")"
    );

    let drop_index = DropIndexRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        if_exists: true,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_index(&drop_index).await.unwrap().sql,
        "DROP INDEX IF EXISTS \"APP\".\"IDX_USERS_EMAIL\""
    );

    let fk = AddConstraintRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: None,
        },
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.add_constraint(&fk).await.unwrap().sql,
        "ALTER TABLE \"APP\".\"ORDERS\" ADD CONSTRAINT \"FK_ORDERS_USER\" FOREIGN KEY (\"USER_ID\") REFERENCES \"USERS\" (\"ID\") ON DELETE CASCADE"
    );

    for (definition, expected) in [
        (
            ConstraintDefinition::PrimaryKey {
                columns: vec!["id".into()],
            },
            "PRIMARY KEY (\"ID\")",
        ),
        (
            ConstraintDefinition::Unique {
                columns: vec!["email".into()],
            },
            "UNIQUE (\"EMAIL\")",
        ),
        (
            ConstraintDefinition::Check {
                expression: "age >= 0".into(),
            },
            "CHECK (age >= 0)",
        ),
    ] {
        let req = AddConstraintRequest {
            connection_id: "conn".into(),
            schema: "app".into(),
            table: "users".into(),
            constraint_name: "constraint_name".into(),
            definition,
            preview_only: true,
            expected_database: None,
        };
        assert!(adapter
            .add_constraint(&req)
            .await
            .unwrap()
            .sql
            .contains(expected));
    }

    let drop_constraint = DropConstraintRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_constraint(&drop_constraint).await.unwrap().sql,
        "ALTER TABLE \"APP\".\"ORDERS\" DROP CONSTRAINT \"FK_ORDERS_USER\""
    );
}

#[tokio::test]
async fn validation_rejects_unsupported_preview_shapes_before_connection() {
    let adapter = OracleAdapter::new();
    let alter = AlterTableRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        changes: vec![ColumnChange::Modify {
            name: "email".into(),
            new_data_type: None,
            new_nullable: None,
            new_default_value: None,
            using_expression: None,
        }],
        preview_only: true,
        expected_database: None,
    };
    assert!(matches!(
        adapter.alter_table(&alter).await.unwrap_err(),
        AppError::Validation(_)
    ));

    let bad_index = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "app".into(),
        table: "users".into(),
        index_name: "idx".into(),
        columns: vec!["email".into()],
        index_type: "gist".into(),
        is_unique: false,
        preview_only: true,
        expected_database: None,
    };
    assert!(matches!(
        adapter.create_index(&bad_index).await.unwrap_err(),
        AppError::Validation(_)
    ));
}

#[test]
fn common_helpers_cover_value_type_identifier_and_where_logic() {
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
        oracle_value_to_json(&OracleValue::Boolean(true)),
        json!(true)
    );
    assert_eq!(
        oracle_value_to_json(&OracleValue::Json(json!({"a": 1}))),
        json!({"a": 1})
    );

    assert_eq!(oracle_type_name(OracleType::Varchar, 0, 0), "varchar2");
    assert_eq!(oracle_type_name(OracleType::Number, 10, 2), "number(10,2)");
    assert_eq!(oracle_type_name(OracleType::Blob, 0, 0), "blob");
    assert_eq!(map_oracle_data_type("VARCHAR2(20)"), ColumnCategory::Text);
    assert_eq!(map_oracle_data_type("RAW(16)"), ColumnCategory::Binary);
    assert_eq!(map_oracle_data_type("BOOLEAN"), ColumnCategory::Bool);
    assert_eq!(
        format_oracle_dictionary_type("NUMBER", None, Some(10), Some(2)),
        "NUMBER(10,2)"
    );
    assert_eq!(
        format_oracle_dictionary_type("VARCHAR2", Some(20), None, None),
        "VARCHAR2(20)"
    );

    assert_eq!(
        strip_leading_comments("-- x\nSELECT 1 FROM dual"),
        "SELECT 1 FROM dual"
    );
    assert_eq!(
        strip_leading_comments("/* x */ SELECT 1 FROM dual"),
        "SELECT 1 FROM dual"
    );
    assert_eq!(strip_trailing_terminator("SELECT 1; \n"), "SELECT 1");
    assert!(is_select_like(
        "WITH q AS (SELECT 1 FROM dual) SELECT * FROM q"
    ));
    assert!(is_oracle_ddl("/* x */ CREATE TABLE t(id NUMBER)"));
    assert!(matches!(
        classify_mutation("MERGE INTO t USING s ON (1=1)", 4),
        QueryType::Dml { rows_affected: 4 }
    ));
    assert!(validate_identifier("valid_name", "Identifier").is_ok());
    assert!(validate_identifier("bad-name", "Identifier").is_err());
    assert_eq!(oracle_canonical_name("mixed"), "MIXED");
    assert_eq!(quote_ident("mixed"), "\"MIXED\"");
    assert_eq!(qualified_table("app", "users"), "\"APP\".\"USERS\"");
    assert_eq!(qualified_object("app", "idx"), "\"APP\".\"IDX\"");
    assert_eq!(sql_string("O'Brien"), "'O''Brien'");
    assert_eq!(oracle_name_literal("mixed"), "'MIXED'");
    assert_eq!(json_string(Some(&json!(42))).as_deref(), Some("42"));
    assert_eq!(json_i64(Some(&json!("42"))), Some(42));
    assert!(validate_raw_where("DELETE FROM users").is_err());

    let valid_columns = ["ID", "EMAIL"].into_iter().collect();
    let filters = vec![
        FilterCondition {
            column: "email".into(),
            operator: FilterOperator::Like,
            value: Some("%@example.com".into()),
        },
        FilterCondition {
            column: "id".into(),
            operator: FilterOperator::IsNull,
            value: None,
        },
    ];
    assert_eq!(
        build_where_clause(&valid_columns, Some(&filters), None).unwrap(),
        " WHERE \"EMAIL\" LIKE '%@example.com' AND \"ID\" IS NULL"
    );
    assert_eq!(
        build_order_clause(
            Some("email DESC, missing ASC"),
            &[column_info("id", true), column_info("email", false)]
        ),
        " ORDER BY \"EMAIL\" DESC"
    );
    assert_eq!(
        build_order_clause(None, &[column_info("id", true)]),
        " ORDER BY \"ID\" ASC"
    );

    assert_eq!(
        oracle_column_definition(&nullable_col("email", "VARCHAR2(320)")).unwrap(),
        "\"EMAIL\" VARCHAR2(320) DEFAULT 'n/a'"
    );
    assert_eq!(
        oracle_constraint_definition(&ConstraintDefinition::Unique {
            columns: vec!["email".into()],
        })
        .unwrap(),
        "UNIQUE (\"EMAIL\")"
    );
    assert_eq!(
        referential_action(Some("SET NULL"), "ON DELETE").unwrap(),
        " ON DELETE SET NULL"
    );
    assert!(referential_action(Some("RESTRICT"), "ON DELETE").is_err());
    assert_eq!(oracle_constraint_type(Some("P")), "PRIMARY KEY");
    assert_eq!(oracle_constraint_type(Some("R")), "FOREIGN KEY");
    assert_eq!(oracle_constraint_type(Some("U")), "UNIQUE");
    assert_eq!(oracle_constraint_type(Some("C")), "CHECK");
}
