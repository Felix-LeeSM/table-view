use super::*;
use crate::models::DatabaseType;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-1".to_string(),
        name: "SQLite".to_string(),
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
        trust_server_certificate: None,
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
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
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
    sqlx::query("INSERT INTO users(id, email, name) VALUES (1, 'ada@example.test', 'Ada')")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn test_sqlite_create_database_file_creates_valid_new_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("created.sqlite");

    let created = SqliteAdapter::create_database_file(db_path.to_str().unwrap())
        .await
        .unwrap();

    assert_eq!(created, db_path.display().to_string());
    assert!(db_path.exists());
    SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_sqlite_create_database_file_rejects_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("existing.sqlite");
    seed_sqlite(&db_path).await;

    let result = SqliteAdapter::create_database_file(db_path.to_str().unwrap()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("already exists")),
        other => panic!("Expected validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_sqlite_create_database_file_rejects_missing_parent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("missing").join("app.sqlite");

    let result = SqliteAdapter::create_database_file(db_path.to_str().unwrap()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("parent directory")),
        other => panic!("Expected parent validation error, got: {:?}", other),
    }
    assert!(!db_path.exists());
}

#[tokio::test]
async fn test_sqlite_create_database_file_requires_absolute_path() {
    let result = SqliteAdapter::create_database_file("relative.sqlite").await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("absolute")),
        other => panic!("Expected absolute path validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_sqlite_connection_opens_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;

    SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_sqlite_connection_requires_absolute_path() {
    let result = SqliteAdapter::test(&sqlite_config("relative.sqlite")).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("absolute")),
        other => panic!("Expected absolute path validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_sqlite_read_only_connection_rejects_writes() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let mut config = sqlite_config(db_path.to_str().unwrap());
    config.read_only = true;
    let adapter = SqliteAdapter::new();

    adapter.connect_pool(&config).await.unwrap();
    adapter
        .execute_query(
            "SELECT COUNT(*) FROM users",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .unwrap();
    let result = adapter
        .execute_query(
            "INSERT INTO users(id, email, name) VALUES (2, 'ro@example.test', 'Read Only')",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!(
            "read-only SQLite connection must reject writes clearly: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn test_sqlite_connection_rejects_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("missing.sqlite");

    let result = SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap())).await;

    assert!(matches!(result, Err(AppError::Connection(_))));
    assert!(!db_path.exists(), "test_connection must not create files");
}

#[tokio::test]
async fn test_sqlite_adapter_lists_main_namespace_and_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    assert_eq!(
        adapter.current_database_path().await,
        Some(db_path.display().to_string())
    );
    let tables = adapter.list_tables("main").await.unwrap();
    assert_eq!(
        tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["orders", "users"]
    );
    assert_eq!(
        tables.iter().find(|t| t.name == "users").unwrap().row_count,
        Some(1)
    );
}

#[tokio::test]
async fn test_sqlite_adapter_caches_capability_inventory_until_disconnect() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let inventory = adapter.capability_inventory().await.unwrap();
    if inventory.json1 {
        adapter
            .execute_query(
                "SELECT json_extract('{\"a\":1}', '$.a') AS value",
                None,
                crate::db::row_cap::DEFAULT_ROW_CAP,
            )
            .await
            .unwrap();
    }

    adapter.disconnect_pool().await.unwrap();
    assert!(matches!(
        adapter.capability_inventory().await,
        Err(AppError::Connection(_))
    ));
}

#[tokio::test]
async fn test_sqlite_adapter_reads_columns_and_foreign_keys() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let columns = adapter.get_table_columns("main", "orders").await.unwrap();
    let user_id = columns.iter().find(|c| c.name == "user_id").unwrap();

    assert_eq!(user_id.data_type, "INTEGER");
    assert!(user_id.is_foreign_key);
    assert_eq!(user_id.fk_reference.as_deref(), Some("users(id)"));
    assert_eq!(user_id.category, ColumnCategory::Int);
}
