use serial_test::serial;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use table_view_lib::db::{DbAdapter, RdbAdapter, SqliteAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfig, DatabaseType, QueryType};
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

    let views = adapter.list_views("main").await.unwrap();
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

    let columns = adapter
        .get_view_columns("main", "active_users")
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

    let indexes = adapter
        .get_table_indexes("main", "users", None)
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

    let result = adapter
        .execute_sql("SELECT id, email FROM active_users ORDER BY id", None)
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
    assert_eq!(result.total_count, 1);
    assert_eq!(
        result.rows,
        vec![vec![
            serde_json::json!(1),
            serde_json::json!("ada@example.test"),
        ]]
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
