mod common;

use common::query_result_contracts::{
    assert_rdb_dml_envelope, assert_rdb_runtime_database_error, assert_rdb_select_envelope,
    assert_rdb_unsupported_query,
};
use serial_test::serial;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use table_view_lib::db::{DbAdapter, RdbAdapter, SqliteAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConnectionConfig, ConstraintDefinition, CreateIndexRequest, CreateTablePlanRequest,
    CreateTableRequest, DatabaseType, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, RenameTableRequest, SchemaChangeResult,
};
use table_view_lib::storage::local as app_sqlite_state;
use tempfile::TempDir;

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-contract".to_string(),
        name: "SQLite contract".to_string(),
        db_type: DatabaseType::Sqlite,
        host: String::new(),
        port: 0,
        user: String::new(),
        password: String::new(),
        database: path.to_string(),
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

async fn seed_sqlite(path: &std::path::Path) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();

    sqlx::query(
        "CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE INDEX idx_users_name ON users(name)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE VIEW active_users AS
         SELECT id, email FROM users WHERE active = 1",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users(id, email, name, active) VALUES
            (1, 'ada@example.test', 'Ada', 1),
            (2, 'bob@example.test', 'Bob', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO orders(id, user_id, total_cents) VALUES (1, 1, 1250)")
        .execute(&pool)
        .await
        .unwrap();

    pool.close().await;
}

async fn connected_fixture() -> (TempDir, SqliteAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("user.sqlite");
    seed_sqlite(&db_path).await;

    let adapter = SqliteAdapter::new();
    adapter
        .connect(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    (dir, adapter)
}

#[tokio::test]
async fn sqlite_contract_opens_user_file_and_browses_tables_and_columns() {
    let (_dir, adapter) = connected_fixture().await;

    let tables = adapter.list_tables("main").await.unwrap();
    assert_eq!(
        tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["orders", "users"]
    );
    assert_eq!(
        tables
            .iter()
            .find(|table| table.name == "orders")
            .unwrap()
            .row_count,
        Some(1)
    );

    let columns = adapter.get_columns("main", "orders", None).await.unwrap();
    let user_id = columns
        .iter()
        .find(|column| column.name == "user_id")
        .unwrap();
    assert_eq!(user_id.data_type, "INTEGER");
    assert!(user_id.is_foreign_key);
    assert_eq!(user_id.fk_reference.as_deref(), Some("users(id)"));
}

#[tokio::test]
async fn sqlite_contract_browses_views_and_view_columns() {
    let (_dir, adapter) = connected_fixture().await;

    let views = <SqliteAdapter as RdbAdapter>::list_views(&adapter, "main")
        .await
        .unwrap();
    let view = views
        .iter()
        .find(|view| view.name == "active_users")
        .expect("active_users view should be visible in SQLite catalog");
    assert_eq!(view.schema, "main");
    assert!(
        view.definition
            .as_deref()
            .is_some_and(|definition| definition.contains("CREATE VIEW active_users")),
        "view definition should include SQLite create-view SQL: {view:?}"
    );

    let columns = <SqliteAdapter as RdbAdapter>::get_view_columns(&adapter, "main", "active_users")
        .await
        .unwrap();
    assert_eq!(
        columns
            .iter()
            .map(|column| (column.name.as_str(), column.data_type.as_str()))
            .collect::<Vec<_>>(),
        vec![("id", "INTEGER"), ("email", "TEXT")]
    );
}

#[tokio::test]
async fn sqlite_contract_browses_table_indexes() {
    let (_dir, adapter) = connected_fixture().await;

    let indexes = <SqliteAdapter as RdbAdapter>::get_table_indexes(&adapter, "main", "users", None)
        .await
        .unwrap();
    let index = indexes
        .iter()
        .find(|index| index.name == "idx_users_name")
        .expect("user-created SQLite index should be visible");

    assert_eq!(index.columns, vec!["name"]);
    assert_eq!(index.index_type, "BTREE");
    assert!(!index.is_unique);
    assert!(!index.is_primary);
}

#[tokio::test]
async fn sqlite_contract_execute_query_returns_tabular_result_envelope() {
    let (_dir, adapter) = connected_fixture().await;

    assert_rdb_select_envelope(
        &adapter,
        "SELECT id, email FROM active_users ORDER BY id",
        &["id", "email"],
        vec![vec![
            serde_json::json!(1),
            serde_json::json!("ada@example.test"),
        ]],
    )
    .await;
}

#[tokio::test]
async fn sqlite_contract_execute_query_returns_shared_dml_envelope() {
    let (_dir, adapter) = connected_fixture().await;

    assert_rdb_dml_envelope(&adapter, "UPDATE users SET active = 0 WHERE id = 1", 1).await;
}

#[tokio::test]
async fn sqlite_contract_execute_query_rejects_ddl_as_current_delta() {
    let (_dir, adapter) = connected_fixture().await;

    assert_rdb_unsupported_query(
        &adapter,
        "CREATE TABLE contract_created (id INTEGER)",
        "SQLite DDL is not supported",
    )
    .await;
}

#[tokio::test]
async fn sqlite_contract_execute_query_returns_runtime_database_error() {
    let (_dir, adapter) = connected_fixture().await;

    assert_rdb_runtime_database_error(
        &adapter,
        "SELECT * FROM missing_contract_table",
        "missing_contract_table",
    )
    .await;
}

fn assert_sqlite_ddl_unsupported(result: Result<SchemaChangeResult, AppError>, feature: &str) {
    match result {
        Err(AppError::Unsupported(message)) => assert!(
            message.contains(feature),
            "expected unsupported message to mention {feature:?}, got {message:?}"
        ),
        other => panic!("Expected SQLite DDL unsupported error, got: {:?}", other),
    }
}

fn ddl_column(name: &str) -> ColumnDefinition {
    ColumnDefinition {
        name: name.to_string(),
        data_type: "TEXT".to_string(),
        nullable: true,
        default_value: None,
        comment: None,
        is_identity: false,
    }
}

#[tokio::test]
async fn sqlite_contract_rejects_structured_ddl_methods_explicitly() {
    let (_dir, adapter) = connected_fixture().await;

    assert_structured_ddl_methods_unsupported(&adapter, true).await;
    assert_structured_ddl_methods_unsupported(&adapter, false).await;
}

async fn assert_structured_ddl_methods_unsupported(adapter: &SqliteAdapter, preview_only: bool) {
    assert_sqlite_ddl_unsupported(
        adapter
            .drop_table(&DropTableRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                cascade: false,
                preview_only,
                expected_database: None,
            })
            .await,
        "table drop",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .rename_table(&RenameTableRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                new_name: "people".to_string(),
                preview_only,
                expected_database: None,
            })
            .await,
        "table rename",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .alter_table(&AlterTableRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                changes: vec![ColumnChange::Drop {
                    name: "name".to_string(),
                }],
                preview_only,
                expected_database: None,
            })
            .await,
        "table alteration",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .add_column(&AddColumnRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                column: ddl_column("nickname"),
                check_expression: None,
                preview_only,
                expected_database: None,
            })
            .await,
        "column creation",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .drop_column(&DropColumnRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                column_name: "name".to_string(),
                cascade: false,
                preview_only,
                expected_database: None,
            })
            .await,
        "column drop",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .create_table(&CreateTableRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                name: "people".to_string(),
                columns: vec![ddl_column("name")],
                primary_key: None,
                preview_only,
                table_comment: None,
                expected_database: None,
            })
            .await,
        "table creation",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .create_table_plan(&CreateTablePlanRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                name: "people".to_string(),
                columns: vec![ddl_column("name")],
                primary_key: None,
                table_comment: None,
                indexes: Vec::new(),
                constraints: Vec::new(),
                preview_only,
                expected_database: None,
            })
            .await,
        "table creation",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .create_index(&CreateIndexRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                index_name: "idx_users_email".to_string(),
                columns: vec!["email".to_string()],
                index_type: "BTREE".to_string(),
                is_unique: false,
                preview_only,
                expected_database: None,
            })
            .await,
        "index creation",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .drop_index(&DropIndexRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                index_name: "idx_users_name".to_string(),
                table: "users".to_string(),
                if_exists: false,
                preview_only,
                expected_database: None,
            })
            .await,
        "index drop",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .add_constraint(&AddConstraintRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                constraint_name: "users_email_unique".to_string(),
                definition: ConstraintDefinition::Unique {
                    columns: vec!["email".to_string()],
                },
                preview_only,
                expected_database: None,
            })
            .await,
        "constraint creation",
    );
    assert_sqlite_ddl_unsupported(
        adapter
            .drop_constraint(&DropConstraintRequest {
                connection_id: "sqlite-contract".to_string(),
                schema: "main".to_string(),
                table: "users".to_string(),
                constraint_name: "users_email_unique".to_string(),
                preview_only,
                expected_database: None,
            })
            .await,
        "constraint drop",
    );
}

#[tokio::test]
#[serial]
async fn sqlite_contract_rejects_internal_app_state_file_as_user_connection() {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let state_path = app_sqlite_state::db_path().unwrap();
    let adapter = SqliteAdapter::new();

    let result = adapter
        .connect(&sqlite_config(state_path.to_str().unwrap()))
        .await;

    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("internal app SQLite state"))
        }
        other => panic!(
            "Expected internal app SQLite state validation error, got: {:?}",
            other
        ),
    }
}
