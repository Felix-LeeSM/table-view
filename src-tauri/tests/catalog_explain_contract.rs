#[path = "support/catalog_explain_contract.rs"]
mod catalog_explain_contract;

use catalog_explain_contract::{
    assert_rdb_catalog_contract, assert_rdb_explain_unsupported_contract, ColumnContract,
    ConstraintDelta, IndexDelta, NamespaceLabelContract, RdbCatalogContract,
    RdbExplainUnsupportedContract, ViewContract,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use table_view_lib::{
    db::{DbAdapter, DuckdbAdapter, SqliteAdapter},
    models::{ConnectionConfig, DatabaseType},
};
use tempfile::TempDir;

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-catalog-explain-contract".to_string(),
        name: "SQLite catalog/explain contract".to_string(),
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

fn duckdb_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "duckdb-catalog-explain-contract".to_string(),
        name: "DuckDB catalog/explain contract".to_string(),
        db_type: DatabaseType::Duckdb,
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
    sqlx::query("CREATE INDEX idx_orders_user_id ON orders(user_id)")
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
         CREATE INDEX idx_users_name ON app.users(name);
         CREATE VIEW app.active_users AS
             SELECT id, email FROM app.users WHERE active = true;
         INSERT INTO app.users VALUES
             (1, 'ada@example.test', 'Ada', true),
             (2, 'bob@example.test', 'Bob', false);
         INSERT INTO app.orders VALUES (1, 1, 1250);",
    )
    .unwrap();
}

async fn connected_sqlite_fixture() -> (TempDir, SqliteAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("contract.sqlite");
    seed_sqlite(&db_path).await;

    let adapter = SqliteAdapter::new();
    adapter
        .connect(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    (dir, adapter)
}

async fn connected_duckdb_fixture() -> (TempDir, DuckdbAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("contract.duckdb");
    seed_duckdb(&db_path);

    let adapter = DuckdbAdapter::new();
    adapter
        .connect(&duckdb_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    (dir, adapter)
}

#[tokio::test]
async fn sqlite_catalog_explain_contract_records_file_rdb_deltas() {
    let (_dir, adapter) = connected_sqlite_fixture().await;

    assert_rdb_catalog_contract(
        &adapter,
        &RdbCatalogContract {
            db_type: DatabaseType::Sqlite,
            namespace_label: NamespaceLabelContract::Single("file"),
            namespace: "main",
            tables: &["orders", "users"],
            table: "orders",
            columns: &[
                ColumnContract {
                    name: "id",
                    data_type: "INTEGER",
                    nullable: false,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: None,
                },
                ColumnContract {
                    name: "user_id",
                    data_type: "INTEGER",
                    nullable: false,
                    is_primary_key: false,
                    is_foreign_key: true,
                    fk_reference: Some("users(id)"),
                },
            ],
            view: ViewContract {
                name: "active_users",
                definition_contains: "CREATE VIEW active_users",
                columns: &["id", "email"],
            },
            index_delta: IndexDelta::Contains {
                name: "idx_orders_user_id",
                columns: &["user_id"],
                is_unique: false,
                is_primary: false,
            },
            constraint_delta: ConstraintDelta::Empty {
                reason: "SQLite exposes FK through column metadata; structured constraint list is deferred",
            },
        },
    )
    .await;

    assert_rdb_explain_unsupported_contract(
        &adapter,
        &RdbExplainUnsupportedContract {
            select_sql: "SELECT id FROM users WHERE id = 1",
            mutation_sql: "UPDATE users SET active = 0 WHERE id = 1",
            verify_unchanged_sql: "SELECT active FROM users WHERE id = 1",
            unsupported_message_fragment: "EXPLAIN",
        },
    )
    .await;

    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn duckdb_catalog_explain_contract_records_schema_rdb_deltas() {
    let (_dir, adapter) = connected_duckdb_fixture().await;

    assert_rdb_catalog_contract(
        &adapter,
        &RdbCatalogContract {
            db_type: DatabaseType::Duckdb,
            namespace_label: NamespaceLabelContract::Schema,
            namespace: "app",
            tables: &["orders", "users"],
            table: "users",
            columns: &[
                ColumnContract {
                    name: "id",
                    data_type: "INTEGER",
                    nullable: false,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                },
                ColumnContract {
                    name: "email",
                    data_type: "VARCHAR",
                    nullable: false,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                },
            ],
            view: ViewContract {
                name: "active_users",
                definition_contains: "active",
                columns: &["id", "email"],
            },
            index_delta: IndexDelta::Empty {
                reason: "DuckDB RdbAdapter index metadata is not surfaced by the current catalog contract",
            },
            constraint_delta: ConstraintDelta::Empty {
                reason: "DuckDB RdbAdapter constraint metadata is not surfaced by the current catalog contract",
            },
        },
    )
    .await;

    assert_rdb_explain_unsupported_contract(
        &adapter,
        &RdbExplainUnsupportedContract {
            select_sql: "SELECT id FROM app.users WHERE id = 1",
            mutation_sql: "UPDATE app.users SET active = false WHERE id = 1",
            verify_unchanged_sql: "SELECT active FROM app.users WHERE id = 1",
            unsupported_message_fragment: "EXPLAIN",
        },
    )
    .await;

    adapter.disconnect().await.unwrap();
}
