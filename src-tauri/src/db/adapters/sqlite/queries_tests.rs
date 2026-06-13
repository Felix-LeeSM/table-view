use super::*;
use crate::db::RdbAdapter;
use crate::models::{ConnectionConfig, DatabaseType, FilterCondition, FilterOperator, QueryType};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-query".to_string(),
        name: "SQLite query".to_string(),
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
            active BOOLEAN NOT NULL DEFAULT 1
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users(id, email, name, active) VALUES
            (1, 'ada@example.test', 'Ada', 1),
            (2, 'bob@example.test', 'Bob', 0),
            (3, 'zann@example.test', 'Ann', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
}

async fn connected_adapter() -> (tempfile::TempDir, SqliteAdapter) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
    (dir, adapter)
}

async fn connected_read_only_adapter() -> (tempfile::TempDir, SqliteAdapter) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let mut config = sqlite_config(db_path.to_str().unwrap());
    config.read_only = true;
    let adapter = SqliteAdapter::new();
    adapter.connect_pool(&config).await.unwrap();
    (dir, adapter)
}

#[test]
fn sqlite_query_type_classifies_cte_prefixed_main_statement() {
    assert!(matches!(
        sqlite_query_type("WITH active AS (SELECT id FROM users) SELECT * FROM active"),
        QueryType::Select
    ));
    assert!(matches!(
        sqlite_query_type(
            "WITH next_name(value) AS (SELECT 'Ada Readonly')
             UPDATE users SET name = (SELECT value FROM next_name) WHERE id = 1"
        ),
        QueryType::Dml { .. }
    ));
}

#[test]
fn sqlite_load_extension_scanner_ignores_comments_and_strings() {
    assert!(sqlite_invokes_load_extension(
        "SELECT load_extension('spellfix')"
    ));
    assert!(sqlite_invokes_load_extension(
        "SELECT /* allowed comment */ LOAD_EXTENSION ( 'x' )"
    ));
    assert!(sqlite_invokes_load_extension(
        "SELECT \"load_extension\"('spellfix')"
    ));
    assert!(sqlite_invokes_load_extension(
        "SELECT `load_extension`('spellfix')"
    ));
    assert!(sqlite_invokes_load_extension(
        "SELECT [load_extension]('spellfix')"
    ));
    assert!(!sqlite_invokes_load_extension(
        "SELECT 'load_extension(' AS label -- load_extension('x')"
    ));
    assert!(!sqlite_invokes_load_extension(
        "SELECT \"load_extension\" AS label"
    ));
}

#[tokio::test]
async fn execute_query_select_returns_columns_and_rows() {
    let (_dir, adapter) = connected_adapter().await;

    let result = <SqliteAdapter as RdbAdapter>::execute_sql(
        &adapter,
        "SELECT id, email FROM users ORDER BY id",
        None,
    )
    .await
    .unwrap();

    assert!(matches!(result.query_type, QueryType::Select));
    assert_eq!(
        result
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "email"]
    );
    assert_eq!(result.total_count, 3);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
    assert_eq!(result.rows[0][1], serde_json::json!("ada@example.test"));
}

#[tokio::test]
async fn execute_query_dml_returns_rows_affected() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .execute_query(
            "INSERT INTO users(id, email, name) VALUES (4, 'cy@example.test', 'Cy')",
            None,
        )
        .await
        .unwrap();

    match result.query_type {
        QueryType::Dml { rows_affected } => assert_eq!(rows_affected, 1),
        other => panic!("Expected DML result, got: {:?}", other),
    }
    assert_eq!(result.total_count, 1);
}

#[tokio::test]
async fn execute_query_rejects_cte_prefixed_write_on_read_only_sqlite() {
    let (_dir, adapter) = connected_read_only_adapter().await;

    let result = adapter
        .execute_query(
            "WITH next_name(value) AS (SELECT 'Ada Readonly')
             UPDATE users SET name = (SELECT value FROM next_name) WHERE id = 1",
            None,
        )
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!("Expected read-only unsupported error, got: {:?}", other),
    }
}

#[tokio::test]
async fn execute_query_rejects_sqlite_ddl_clearly() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .execute_query("ALTER TABLE users ADD COLUMN nickname TEXT", None)
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("Raw SQLite DDL is not supported"))
        }
        other => panic!("Expected SQLite DDL unsupported error, got: {:?}", other),
    }
}

#[tokio::test]
async fn execute_query_rejects_loadable_extensions_explicitly() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .execute_query("SELECT load_extension('spellfix')", None)
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("loadable extensions"))
        }
        other => panic!(
            "Expected loadable extension unsupported error, got: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn query_table_data_filters_sorts_and_paginates() {
    let (_dir, adapter) = connected_adapter().await;
    let filters = vec![FilterCondition {
        column: "name".into(),
        operator: FilterOperator::Like,
        value: Some("A%".into()),
    }];

    let data = <SqliteAdapter as RdbAdapter>::query_table_data(
        &adapter,
        "main",
        "users",
        1,
        1,
        Some("email DESC"),
        Some(&filters),
        None,
        None,
    )
    .await
    .unwrap();

    let name_idx = data
        .columns
        .iter()
        .position(|column| column.name == "name")
        .unwrap();
    assert_eq!(data.total_count, 2);
    assert_eq!(data.rows.len(), 1);
    assert_eq!(data.rows[0][name_idx], serde_json::json!("Ann"));
    assert!(data.executed_query.contains("ORDER BY \"email\" DESC"));
    assert!(data.executed_query.contains("LIMIT 1 OFFSET 0"));
}

#[tokio::test]
async fn query_table_data_rejects_raw_where_semicolon() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .query_table_data(
            "main",
            "users",
            1,
            10,
            None,
            None,
            Some("1=1; DROP TABLE users"),
            None,
        )
        .await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("semicolons")),
        other => panic!("Expected raw where validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn query_table_data_rejects_raw_where_union_tail() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .query_table_data(
            "main",
            "users",
            1,
            10,
            None,
            None,
            Some("1 = 1 UNION SELECT password FROM users"),
            None,
        )
        .await;

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("single boolean expression"))
        }
        other => panic!("Expected raw where validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn query_table_data_pre_cancel_short_circuits_before_pool_lookup() {
    let adapter = SqliteAdapter::new();
    let token = CancellationToken::new();
    token.cancel();

    let result = adapter
        .query_table_data("main", "users", 1, 10, None, None, None, Some(&token))
        .await;

    match result {
        Err(AppError::Database(message)) => assert!(message.contains("cancelled")),
        other => panic!("Expected cancellation error, got: {:?}", other),
    }
}
