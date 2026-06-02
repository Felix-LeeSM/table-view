use table_view_lib::db::{DbAdapter, DuckdbAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfig, DatabaseType, QueryType};
use tempfile::TempDir;

fn duckdb_config(path: &str, read_only: bool) -> ConnectionConfig {
    ConnectionConfig {
        id: "duckdb-contract".to_string(),
        name: "DuckDB contract".to_string(),
        db_type: DatabaseType::Duckdb,
        host: String::new(),
        port: 0,
        user: String::new(),
        password: String::new(),
        database: path.to_string(),
        read_only,
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

fn seed_duckdb(path: &std::path::Path) {
    let conn = duckdb::Connection::open(path).unwrap();
    conn.execute_batch(
        "CREATE SCHEMA app;
         CREATE TABLE app.users (
             id INTEGER PRIMARY KEY,
             email VARCHAR NOT NULL,
             name VARCHAR NOT NULL,
             active BOOLEAN NOT NULL DEFAULT true
         );
         CREATE TABLE app.orders (
             id INTEGER,
             user_id INTEGER NOT NULL,
             total_cents INTEGER NOT NULL
         );
         CREATE VIEW app.active_users AS
             SELECT id, email FROM app.users WHERE active = true;
         INSERT INTO app.users VALUES
             (1, 'ada@example.test', 'Ada', true),
             (2, 'bob@example.test', 'Bob', false);
         INSERT INTO app.orders VALUES (1, 1, 1250);",
    )
    .unwrap();
}

async fn connected_fixture(read_only: bool) -> (TempDir, DuckdbAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("fixture.duckdb");
    seed_duckdb(&db_path);

    let adapter = DuckdbAdapter::new();
    adapter
        .connect(&duckdb_config(db_path.to_str().unwrap(), read_only))
        .await
        .unwrap();

    (dir, adapter)
}

#[tokio::test]
async fn duckdb_contract_opens_file_and_browses_schemas_tables_columns() {
    let (_dir, adapter) = connected_fixture(false).await;

    let schemas = adapter.list_namespaces().await.unwrap();
    assert!(
        schemas.iter().any(|schema| schema.name == "app"),
        "DuckDB user schema should be visible: {schemas:?}"
    );

    let tables = adapter.list_tables("app").await.unwrap();
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

    let columns = adapter.get_columns("app", "users", None).await.unwrap();
    assert_eq!(
        columns
            .iter()
            .map(|column| (
                column.name.as_str(),
                column.data_type.as_str(),
                column.nullable
            ))
            .collect::<Vec<_>>(),
        vec![
            ("id", "INTEGER", false),
            ("email", "VARCHAR", false),
            ("name", "VARCHAR", false),
            ("active", "BOOLEAN", false),
        ]
    );
}

#[tokio::test]
async fn duckdb_contract_browses_views_and_view_columns() {
    let (_dir, adapter) = connected_fixture(false).await;

    let views = <DuckdbAdapter as RdbAdapter>::list_views(&adapter, "app")
        .await
        .unwrap();
    let view = views
        .iter()
        .find(|view| view.name == "active_users")
        .expect("active_users view should be visible in DuckDB catalog");
    assert_eq!(view.schema, "app");
    assert!(
        view.definition
            .as_deref()
            .is_some_and(|definition| definition.contains("active")),
        "view definition should include DuckDB view SQL: {view:?}"
    );

    let columns = <DuckdbAdapter as RdbAdapter>::get_view_columns(&adapter, "app", "active_users")
        .await
        .unwrap();
    assert_eq!(
        columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "email"]
    );
}

#[tokio::test]
async fn duckdb_contract_execute_query_returns_shared_tabular_envelope() {
    let (_dir, adapter) = connected_fixture(false).await;

    let result = adapter
        .execute_sql("SELECT id, email FROM app.active_users ORDER BY id", None)
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
async fn duckdb_contract_query_table_data_reads_file_table_pages() {
    let (_dir, adapter) = connected_fixture(false).await;

    let result = adapter
        .query_table_data("app", "users", 1, 1, Some("id DESC"), None, None, None)
        .await
        .unwrap();

    assert_eq!(result.total_count, 2);
    assert_eq!(result.page_size, 1);
    assert_eq!(
        result.rows,
        vec![vec![
            serde_json::json!(2),
            serde_json::json!("bob@example.test"),
            serde_json::json!("Bob"),
            serde_json::json!(false),
        ]]
    );
}

#[tokio::test]
async fn duckdb_contract_read_only_connection_rejects_writes() {
    let (_dir, adapter) = connected_fixture(true).await;

    let result = adapter
        .execute_sql(
            "INSERT INTO app.users VALUES (3, 'new@example.test', 'New', true)",
            None,
        )
        .await;

    match result {
        Err(AppError::Database(message)) => assert!(
            message.to_ascii_lowercase().contains("read-only")
                || message.to_ascii_lowercase().contains("read only"),
            "expected DuckDB read-only error, got: {message}"
        ),
        other => panic!("Expected read-only database error, got: {other:?}"),
    }
}

#[tokio::test]
async fn duckdb_contract_unsupported_analytics_and_extensions_fail_clearly() {
    let (_dir, adapter) = connected_fixture(false).await;

    for (sql, expected) in [
        ("INSTALL httpfs", "extension"),
        ("LOAD httpfs", "extension"),
        ("SELECT load_extension('httpfs')", "extension"),
        ("COPY app.users TO '/tmp/users.csv'", "COPY"),
        ("ATTACH '/tmp/other.duckdb' AS other", "ATTACH/DETACH"),
        ("DETACH other", "ATTACH/DETACH"),
        (
            "SET enable_external_access = true",
            "external-file capability settings",
        ),
        (
            "SELECT * FROM read_csv_auto('/tmp/users.csv')",
            "CSV/Parquet/JSON",
        ),
        ("SELECT * FROM '/tmp/users.csv'", "replacement scans"),
    ] {
        let result = adapter.execute_sql(sql, None).await;
        match result {
            Err(AppError::Unsupported(message)) => {
                assert!(
                    message.contains(expected),
                    "{sql} expected {expected} unsupported message, got: {message}"
                );
                assert!(
                    !message.contains("/tmp/"),
                    "{sql} leaked local path in unsupported message: {message}"
                );
            }
            other => panic!("Expected Unsupported error for {sql}, got: {other:?}"),
        }
    }
}
