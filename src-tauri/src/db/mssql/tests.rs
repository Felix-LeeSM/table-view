use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::db::{DbAdapter, RdbAdapter};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnCategory, ColumnChange,
    ColumnDefinition, ColumnInfo, ConnectionConfig, ConstraintDefinition, CreateIndexRequest,
    CreateTableRequest, DatabaseType, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, FilterCondition, FilterOperator, QueryType, RenameTableRequest,
};

use super::query::{
    build_order_clause, build_where_clause, classify_mutation, is_select_like,
    strip_leading_comments, strip_trailing_terminator, validate_raw_where,
};
use super::support::{
    format_mssql_data_type, json_bool, json_i64, json_string, map_mssql_data_type, qualified_table,
    quote_ident, sql_string, validate_identifier,
};
use super::MssqlAdapter;

mod helpers;
mod row_mappers;

fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: "conn".into(),
        name: "mssql".into(),
        db_type: DatabaseType::Mssql,
        host: "localhost".into(),
        port: 1433,
        user: "sa".into(),
        password: "secret".into(),
        database: "master".into(),
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
        data_type: "int".into(),
        nullable: false,
        default_value: None,
        is_primary_key: primary,
        is_foreign_key: false,
        fk_reference: None,
        comment: None,
        check_clauses: Vec::new(),
        category: ColumnCategory::Int,
    }
}

#[test]
fn connection_config_validation_and_lifecycle_errors_are_local() {
    let adapter = MssqlAdapter::default();
    assert!(matches!(adapter.kind(), DatabaseType::Mssql));
    assert!(matches!(
        adapter.namespace_label(),
        crate::db::NamespaceLabel::Schema
    ));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        host: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        user: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
}

#[tokio::test]
async fn disconnected_paths_fail_before_network_work() {
    let adapter = MssqlAdapter::new();
    let err = adapter.connected_config().await.unwrap_err();
    assert!(matches!(err, AppError::Connection(_)));

    let token = CancellationToken::new();
    token.cancel();
    let err = adapter
        .execute_sql("SELECT 1", Some(&token))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Database(_)));
    assert!(matches!(
        adapter
            .execute_sql_batch(&["UPDATE users SET id = id".into()], Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .dry_run_sql_batch(&["UPDATE users SET id = id".into()], Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .query_table_data("dbo", "users", 1, 10, None, None, None, Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_columns("dbo", "users", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_table_indexes("dbo", "users", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(matches!(
        adapter
            .get_table_constraints("dbo", "users", Some(&token))
            .await
            .unwrap_err(),
        AppError::Database(_)
    ));
    assert!(adapter
        .execute_sql_batch(&[], None)
        .await
        .unwrap()
        .is_empty());
    assert!(adapter
        .dry_run_sql_batch(&[], None)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn connected_with_invalid_config_exercises_catalog_and_query_entrypoints() {
    let adapter = MssqlAdapter::new();
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
        adapter.list_databases().await.map(|_| ()),
        adapter.current_database().await.map(|_| ()),
        adapter.list_tables("dbo").await.map(|_| ()),
        adapter.get_columns("dbo", "users", None).await.map(|_| ()),
        adapter
            .count_null_rows("dbo", "users", "email")
            .await
            .map(|_| ()),
        adapter
            .get_table_indexes("dbo", "users", None)
            .await
            .map(|_| ()),
        adapter
            .get_table_constraints("dbo", "users", None)
            .await
            .map(|_| ()),
        adapter.list_views("dbo").await.map(|_| ()),
        adapter.list_functions("dbo").await.map(|_| ()),
        adapter
            .get_view_definition("dbo", "active_users")
            .await
            .map(|_| ()),
        adapter
            .get_view_columns("dbo", "active_users")
            .await
            .map(|_| ()),
        adapter.list_schema_columns("dbo").await.map(|_| ()),
        adapter
            .get_function_source("dbo", "fn_users")
            .await
            .map(|_| ()),
        adapter
            .execute_sql("UPDATE users SET id = id", None)
            .await
            .map(|_| ()),
        adapter
            .execute_sql_batch(&["UPDATE users SET id = id".into()], None)
            .await
            .map(|_| ()),
        adapter
            .dry_run_sql_batch(&["UPDATE users SET id = id".into()], None)
            .await
            .map(|_| ()),
        adapter
            .query_table_data("dbo", "users", 1, 10, None, None, None, None)
            .await
            .map(|_| ()),
    ] {
        assert!(result.is_err());
    }

    assert!(matches!(
        adapter
            .query_table_data("1bad", "users", 1, 10, None, None, None, None)
            .await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        adapter.switch_database("1bad").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::execute_statement(&bad_config, "").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::execute_statement(&bad_config, "SELECT 1").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::execute_statement(&bad_config, "UPDATE users SET id = id").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::query_select(&bad_config, "SELECT 1").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::schema_rows(&bad_config, "SELECT 1").await,
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        MssqlAdapter::table_columns_inner(&bad_config, "dbo", "users").await,
        Err(AppError::Validation(_))
    ));
}

#[tokio::test]
async fn preview_table_ddl_emits_tsql_without_connection() {
    let adapter = MssqlAdapter::new();
    let mut id = col("id", "int");
    id.is_identity = true;
    let req = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        name: "users".into(),
        columns: vec![id, nullable_col("email", "nvarchar(255)")],
        primary_key: Some(vec!["id".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let sql = adapter.create_table(&req).await.unwrap().sql;
    assert_eq!(
        sql,
        "CREATE TABLE [dbo].[users] ([id] int IDENTITY(1,1) NOT NULL, [email] nvarchar(255) DEFAULT 'n/a', PRIMARY KEY ([id]))"
    );

    let rename = RenameTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        new_name: "people".into(),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.rename_table(&rename).await.unwrap().sql,
        "EXEC sp_rename N'dbo.users', N'people'"
    );

    let drop = DropTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "people".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_table(&drop).await.unwrap().sql,
        "DROP TABLE [dbo].[people]"
    );
}

#[tokio::test]
async fn preview_column_and_alter_ddl_cover_add_modify_drop() {
    let adapter = MssqlAdapter::new();
    let add = AddColumnRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        column: nullable_col("email", "nvarchar(255)"),
        check_expression: Some("LEN(email) > 3".into()),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.add_column(&add).await.unwrap().sql,
        "ALTER TABLE [dbo].[users] ADD [email] nvarchar(255) DEFAULT 'n/a' CHECK (LEN(email) > 3)"
    );

    let alter = AlterTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        changes: vec![
            ColumnChange::Add {
                name: "age".into(),
                data_type: "int".into(),
                nullable: false,
                default_value: Some("0".into()),
            },
            ColumnChange::Modify {
                name: "email".into(),
                new_data_type: Some("nvarchar(320)".into()),
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
    assert!(sql.contains("ALTER TABLE [dbo].[users] ADD [age] int NOT NULL DEFAULT 0"));
    assert!(sql.contains("ALTER TABLE [dbo].[users] ALTER COLUMN [email] nvarchar(320) NOT NULL"));
    assert!(sql.contains("ALTER TABLE [dbo].[users] ADD DEFAULT '' FOR [email]"));
    assert!(sql.contains("ALTER TABLE [dbo].[users] DROP COLUMN [age]"));

    let drop = DropColumnRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        column_name: "email".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_column(&drop).await.unwrap().sql,
        "ALTER TABLE [dbo].[users] DROP COLUMN [email]"
    );
}

#[tokio::test]
async fn preview_index_and_constraint_ddl_cover_supported_shapes() {
    let adapter = MssqlAdapter::new();
    let index = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        columns: vec!["email".into()],
        index_type: "columnstore".into(),
        is_unique: true,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.create_index(&index).await.unwrap().sql,
        "CREATE UNIQUE COLUMNSTORE INDEX [idx_users_email] ON [dbo].[users] ([email])"
    );

    let drop_index = DropIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        index_name: "idx_users_email".into(),
        if_exists: true,
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_index(&drop_index).await.unwrap().sql,
        "DROP INDEX IF EXISTS [idx_users_email] ON [dbo].[users]"
    );

    for (definition, expected) in [
        (
            ConstraintDefinition::PrimaryKey {
                columns: vec!["id".into()],
            },
            "PRIMARY KEY ([id])",
        ),
        (
            ConstraintDefinition::Unique {
                columns: vec!["email".into()],
            },
            "UNIQUE ([email])",
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
            schema: "dbo".into(),
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

    let fk = AddConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".into()],
            reference_table: "users".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: Some("NO ACTION".into()),
        },
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.add_constraint(&fk).await.unwrap().sql,
        "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_orders_user] FOREIGN KEY ([user_id]) REFERENCES [users] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION"
    );

    let drop_constraint = DropConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "orders".into(),
        constraint_name: "fk_orders_user".into(),
        preview_only: true,
        expected_database: None,
    };
    assert_eq!(
        adapter.drop_constraint(&drop_constraint).await.unwrap().sql,
        "ALTER TABLE [dbo].[orders] DROP CONSTRAINT [fk_orders_user]"
    );
}

#[tokio::test]
async fn preview_validation_rejects_unsupported_shapes_before_connection() {
    let adapter = MssqlAdapter::new();
    let empty_table = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        name: "users".into(),
        columns: vec![],
        primary_key: None,
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    assert!(matches!(
        adapter.create_table(&empty_table).await.unwrap_err(),
        AppError::Validation(_)
    ));

    let bad_index = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
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
fn support_and_query_helpers_normalize_sql_shapes() {
    assert_eq!(quote_ident("a]b"), "[a]]b]");
    assert_eq!(qualified_table("dbo", "users"), "[dbo].[users]");
    assert_eq!(sql_string("O'Brien"), "N'O''Brien'");
    assert_eq!(map_mssql_data_type("nvarchar(20)"), ColumnCategory::Text);
    assert_eq!(
        map_mssql_data_type("uniqueidentifier"),
        ColumnCategory::Uuid
    );
    assert_eq!(
        format_mssql_data_type("nvarchar", Some(20), None, None),
        "nvarchar(10)"
    );
    assert_eq!(
        format_mssql_data_type("varbinary", Some(-1), None, None),
        "varbinary(max)"
    );
    assert_eq!(
        format_mssql_data_type("decimal", None, Some(10), Some(2)),
        "decimal(10,2)"
    );
    assert_eq!(
        json_string(Some(&Value::Bool(true))).as_deref(),
        Some("true")
    );
    assert_eq!(json_i64(Some(&Value::String("42".into()))), Some(42));
    assert_eq!(json_bool(Some(&Value::String("0".into()))), Some(false));
    assert!(validate_identifier("valid_name", "Identifier").is_ok());
    assert!(validate_identifier("1bad", "Identifier").is_err());

    assert_eq!(strip_leading_comments("-- x\nSELECT 1"), "SELECT 1");
    assert_eq!(strip_leading_comments("/* x */ SELECT 1"), "SELECT 1");
    assert_eq!(strip_trailing_terminator("SELECT 1 ; \n"), "SELECT 1");
    assert!(is_select_like("WITH cte AS (SELECT 1) SELECT * FROM cte"));
    assert!(matches!(
        classify_mutation("UPDATE users SET id = 1", 3),
        QueryType::Dml { rows_affected: 3 }
    ));
    assert!(matches!(
        classify_mutation("CREATE TABLE t(id int)", 0),
        QueryType::Ddl
    ));
    assert!(validate_raw_where("DROP TABLE users").is_err());

    let valid_columns = ["id", "email"].into_iter().collect();
    let filters = vec![
        FilterCondition {
            column: "email".into(),
            operator: FilterOperator::Like,
            value: Some("%@example.com".into()),
        },
        FilterCondition {
            column: "id".into(),
            operator: FilterOperator::IsNotNull,
            value: None,
        },
    ];
    assert_eq!(
        build_where_clause(&valid_columns, Some(&filters), None).unwrap(),
        " WHERE [email] LIKE N'%@example.com' AND [id] IS NOT NULL"
    );
    assert_eq!(
        build_order_clause(
            Some("email DESC, missing ASC"),
            &[column_info("id", true), column_info("email", false)]
        ),
        " ORDER BY [email] DESC"
    );
    assert_eq!(
        build_order_clause(None, &[column_info("id", true)]),
        " ORDER BY [id] ASC"
    );
}
