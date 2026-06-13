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
    ConnectionConfig, ConstraintDefinition, CreateIndexRequest, CreateTablePlanConstraint,
    CreateTablePlanIndex, CreateTablePlanRequest, CreateTableRequest, DatabaseType,
    DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest,
    RenameTableRequest, SchemaChangeResult,
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

async fn connected_read_only_fixture() -> (TempDir, SqliteAdapter) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("user.sqlite");
    seed_sqlite(&db_path).await;

    let mut config = sqlite_config(db_path.to_str().unwrap());
    config.read_only = true;
    let adapter = SqliteAdapter::new();
    adapter.connect(&config).await.unwrap();

    (dir, adapter)
}

async fn seed_sqlite_capability_tables(path: &std::path::Path) -> (bool, bool) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(false)
                .foreign_keys(true),
        )
        .await
        .unwrap();

    let fts5 = sqlx::query("CREATE VIRTUAL TABLE docs_fts USING fts5(title, body)")
        .execute(&pool)
        .await
        .is_ok();
    if fts5 {
        sqlx::query(
            "INSERT INTO docs_fts(rowid, title, body)
             VALUES (1, 'Ada notes', 'Ada writes SQLite search notes')",
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    let rtree =
        sqlx::query("CREATE VIRTUAL TABLE boxes_rtree USING rtree(id, min_x, max_x, min_y, max_y)")
            .execute(&pool)
            .await
            .is_ok();
    if rtree {
        sqlx::query(
            "INSERT INTO boxes_rtree(id, min_x, max_x, min_y, max_y)
             VALUES (1, 0.0, 1.0, 0.0, 1.0)",
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    pool.close().await;
    (fts5, rtree)
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
async fn sqlite_contract_probes_capabilities_and_runs_only_read_query_evidence() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("user.sqlite");
    seed_sqlite(&db_path).await;
    let (seeded_fts5, seeded_rtree) = seed_sqlite_capability_tables(&db_path).await;

    let adapter = SqliteAdapter::new();
    adapter
        .connect(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
    let inventory = <SqliteAdapter as RdbAdapter>::sqlite_capabilities(&adapter)
        .await
        .unwrap();

    if inventory.json1 {
        assert_rdb_select_envelope(
            &adapter,
            "SELECT json_extract('{\"name\":\"Ada\"}', '$.name') AS name",
            &["name"],
            vec![vec![serde_json::json!("Ada")]],
        )
        .await;
    }
    if inventory.fts5 {
        assert!(
            seeded_fts5,
            "FTS5 was probed true but seeded virtual table creation failed"
        );
        assert_rdb_select_envelope(
            &adapter,
            "SELECT rowid, title FROM docs_fts WHERE docs_fts MATCH 'Ada'",
            &["rowid", "title"],
            vec![vec![serde_json::json!(1), serde_json::json!("Ada notes")]],
        )
        .await;
    }
    if inventory.rtree {
        assert!(
            seeded_rtree,
            "RTREE was probed true but seeded virtual table creation failed"
        );
        assert_rdb_select_envelope(
            &adapter,
            "SELECT id FROM boxes_rtree WHERE min_x >= 0.0 AND max_x <= 1.0",
            &["id"],
            vec![vec![serde_json::json!(1)]],
        )
        .await;
    }
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
        "Raw SQLite DDL is not supported",
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
async fn sqlite_contract_previews_structured_create_table_without_mutating_schema() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![
                ColumnDefinition {
                    name: "id".to_string(),
                    data_type: "INTEGER".to_string(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_identity: false,
                },
                ColumnDefinition {
                    name: "name".to_string(),
                    data_type: "TEXT".to_string(),
                    nullable: false,
                    default_value: Some("'unknown'".to_string()),
                    comment: None,
                    is_identity: false,
                },
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        })
        .await
        .unwrap();

    assert_eq!(
        result.sql,
        "CREATE TABLE \"people\" (\"id\" INTEGER NOT NULL, \"name\" TEXT NOT NULL DEFAULT 'unknown', PRIMARY KEY (\"id\"))"
    );
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));
}

#[tokio::test]
async fn sqlite_contract_executes_structured_create_table_and_refreshes_schema() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![
                ColumnDefinition {
                    name: "id".to_string(),
                    data_type: "INTEGER".to_string(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_identity: false,
                },
                ddl_column("name"),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: false,
            table_comment: None,
            expected_database: None,
        })
        .await
        .unwrap();

    assert!(result.sql.contains("CREATE TABLE \"people\""));
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(tables.iter().any(|table| table.name == "people"));
    let columns = adapter.get_columns("main", "people", None).await.unwrap();
    let id = columns.iter().find(|column| column.name == "id").unwrap();
    assert!(id.is_primary_key);
    assert!(!id.nullable);
}

#[tokio::test]
async fn sqlite_contract_allows_structured_create_table_preview_on_read_only_connection() {
    let (_dir, adapter) = connected_read_only_fixture().await;

    let result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ddl_column("name")],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        })
        .await
        .unwrap();

    assert_eq!(result.sql, "CREATE TABLE \"people\" (\"name\" TEXT)");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));
}

#[tokio::test]
async fn sqlite_contract_rejects_structured_create_table_execute_on_read_only_connection() {
    let (_dir, adapter) = connected_read_only_fixture().await;

    let result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ddl_column("name")],
            primary_key: None,
            preview_only: false,
            table_comment: None,
            expected_database: None,
        })
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!(
            "Expected read-only create table rejection, got: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn sqlite_contract_create_table_plan_supports_table_only_slice() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table_plan(&CreateTablePlanRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ddl_column("name")],
            primary_key: None,
            table_comment: None,
            indexes: Vec::new(),
            constraints: Vec::new(),
            preview_only: false,
            expected_database: None,
        })
        .await
        .unwrap();

    assert_eq!(result.sql, "CREATE TABLE \"people\" (\"name\" TEXT)");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(tables.iter().any(|table| table.name == "people"));
}

#[tokio::test]
async fn sqlite_contract_create_table_plan_rejects_indexes_before_creating_table() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table_plan(&CreateTablePlanRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ddl_column("name")],
            primary_key: None,
            table_comment: None,
            indexes: vec![CreateTablePlanIndex {
                index_name: "idx_people_name".to_string(),
                columns: vec!["name".to_string()],
                index_type: "BTREE".to_string(),
                is_unique: false,
            }],
            constraints: Vec::new(),
            preview_only: false,
            expected_database: None,
        })
        .await;

    assert_sqlite_ddl_unsupported(result, "index creation");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));
}

#[tokio::test]
async fn sqlite_contract_create_table_plan_rejects_constraints_before_creating_table() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table_plan(&CreateTablePlanRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ddl_column("name")],
            primary_key: None,
            table_comment: None,
            indexes: Vec::new(),
            constraints: vec![CreateTablePlanConstraint {
                constraint_name: "uq_people_name".to_string(),
                definition: ConstraintDefinition::Unique {
                    columns: vec!["name".to_string()],
                },
            }],
            preview_only: false,
            expected_database: None,
        })
        .await;

    assert_sqlite_ddl_unsupported(result, "standalone constraints");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));
}

#[tokio::test]
async fn sqlite_contract_create_table_rejects_statement_escape_fragments() {
    let (_dir, adapter) = connected_fixture().await;

    let result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ColumnDefinition {
                name: "name".to_string(),
                data_type: "TEXT".to_string(),
                nullable: true,
                default_value: Some("'Ada'; DROP TABLE users".to_string()),
                comment: None,
                is_identity: false,
            }],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        })
        .await;

    assert!(
        matches!(result, Err(AppError::Validation(message)) if message.contains("statement terminators"))
    );
}

#[tokio::test]
async fn sqlite_contract_create_table_rejects_inline_constraint_fragments() {
    let (_dir, adapter) = connected_fixture().await;

    let type_result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ColumnDefinition {
                name: "name".to_string(),
                data_type: "TEXT UNIQUE".to_string(),
                nullable: true,
                default_value: None,
                comment: None,
                is_identity: false,
            }],
            primary_key: None,
            preview_only: false,
            table_comment: None,
            expected_database: None,
        })
        .await;

    assert_sqlite_ddl_unsupported(type_result, "UNIQUE");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));

    let default_result = adapter
        .create_table(&CreateTableRequest {
            connection_id: "sqlite-contract".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![ColumnDefinition {
                name: "name".to_string(),
                data_type: "TEXT".to_string(),
                nullable: true,
                default_value: Some("0 NOT NULL".to_string()),
                comment: None,
                is_identity: false,
            }],
            primary_key: None,
            preview_only: false,
            table_comment: None,
            expected_database: None,
        })
        .await;

    assert_sqlite_ddl_unsupported(default_result, "NOT");
    let tables = adapter.list_tables("main").await.unwrap();
    assert!(!tables.iter().any(|table| table.name == "people"));
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
