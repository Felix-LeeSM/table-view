use super::*;
use crate::db::RdbAdapter;
use crate::models::{ConnectionConfig, DatabaseType, QueryType};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio_util::sync::CancellationToken;

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-batch".to_string(),
        name: "SQLite batch".to_string(),
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
            name TEXT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users(id, email, name) VALUES
            (1, 'ada@example.test', 'Ada'),
            (2, 'bob@example.test', 'Bob')",
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

async fn scalar_count(adapter: &SqliteAdapter, sql: &str) -> i64 {
    let result = adapter.execute_query(sql, None).await.unwrap();
    result.rows[0][0].as_i64().unwrap()
}

#[tokio::test]
async fn execute_query_batch_commits_all_statements() {
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec![
        "INSERT INTO users(id, email, name) VALUES (3, 'cy@example.test', 'Cy')".to_string(),
        "UPDATE users SET name = 'Ada Lovelace' WHERE id = 1".to_string(),
    ];

    let results = <SqliteAdapter as RdbAdapter>::execute_sql_batch(&adapter, &statements, None)
        .await
        .unwrap();

    assert_eq!(results.len(), 2);
    assert!(results
        .iter()
        .all(|result| matches!(result.query_type, QueryType::Dml { rows_affected: 1 })));
    assert_eq!(
        scalar_count(&adapter, "SELECT COUNT(*) FROM users WHERE id = 3").await,
        1
    );
    assert_eq!(
        scalar_count(
            &adapter,
            "SELECT COUNT(*) FROM users WHERE name = 'Ada Lovelace'"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn execute_query_batch_rolls_back_on_statement_failure() {
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec![
        "INSERT INTO users(id, email, name) VALUES (3, 'cy@example.test', 'Cy')".to_string(),
        "INSERT INTO users(id, email, name) VALUES (4, 'ada@example.test', 'Duplicate')"
            .to_string(),
    ];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Database(message)) => assert!(message.contains("statement 2 of 2 failed")),
        other => panic!("Expected statement failure, got: {:?}", other),
    }
    assert_eq!(
        scalar_count(&adapter, "SELECT COUNT(*) FROM users WHERE id = 3").await,
        0
    );
}

#[tokio::test]
async fn dry_run_query_batch_rolls_back_successful_statements() {
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec![
        "UPDATE users SET name = 'Ada Preview' WHERE id = 1".to_string(),
        "INSERT INTO users(id, email, name) VALUES (3, 'cy@example.test', 'Cy')".to_string(),
    ];

    let results = <SqliteAdapter as RdbAdapter>::dry_run_sql_batch(&adapter, &statements, None)
        .await
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(
        scalar_count(
            &adapter,
            "SELECT COUNT(*) FROM users WHERE name = 'Ada Preview'"
        )
        .await,
        0
    );
    assert_eq!(
        scalar_count(&adapter, "SELECT COUNT(*) FROM users WHERE id = 3").await,
        0
    );
}

#[tokio::test]
async fn execute_query_batch_empty_input_is_noop_without_connection() {
    let adapter = SqliteAdapter::new();
    let result = adapter.execute_query_batch(&[], None).await.unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn execute_query_batch_pre_cancel_short_circuits_before_pool_lookup() {
    let adapter = SqliteAdapter::new();
    let token = CancellationToken::new();
    token.cancel();
    let statements = vec!["UPDATE users SET name = 'x' WHERE id = 1".to_string()];

    let result = adapter.execute_query_batch(&statements, Some(&token)).await;

    match result {
        Err(AppError::Database(message)) => assert!(message.contains("cancelled")),
        other => panic!("Expected cancellation error, got: {:?}", other),
    }
}
