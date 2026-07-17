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
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
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

// Issue #1231 — raw query row cap. Seed has 3 rows. An explicit small cap
// must return exactly `cap` rows with truncated=true; a cap ≥ 3 leaves it
// false. The cap is a direct arg (not the global) so these run in parallel
// with every other adapter test without leaking.
#[tokio::test]
async fn execute_query_caps_rows_and_flags_truncated_1231() {
    let (_dir, adapter) = connected_adapter().await;
    let result = adapter
        .execute_query("SELECT * FROM users ORDER BY id", None, 2)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 2, "row cap must limit fetched rows");
    assert!(result.truncated, "truncated must be set when capped");
    assert_eq!(
        result.total_count, 2,
        "total_count reflects the capped rows"
    );
}

#[tokio::test]
async fn execute_query_at_cap_boundary_not_truncated_1231() {
    let (_dir, adapter) = connected_adapter().await;
    // Exactly the row count — no (cap+1)th row exists, so not truncated.
    let result = adapter
        .execute_query("SELECT * FROM users ORDER BY id", None, 3)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 3);
    assert!(!result.truncated);
}

#[tokio::test]
async fn execute_query_under_cap_not_truncated_1231() {
    let (_dir, adapter) = connected_adapter().await;
    let result = adapter
        .execute_query("SELECT * FROM users ORDER BY id", None, 100)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 3);
    assert!(!result.truncated);
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
    // id 는 INTEGER 컬럼 — ADR 0026 (issue #1082) 에 따라 정밀도-보존 string
    // token 으로 wire 되고 프론트가 BigInt 로 승격한다.
    assert_eq!(result.rows[0][0], serde_json::json!("1"));
    assert_eq!(result.rows[0][1], serde_json::json!("ada@example.test"));
}

#[tokio::test]
async fn execute_query_dml_returns_rows_affected() {
    let (_dir, adapter) = connected_adapter().await;

    let result = adapter
        .execute_query(
            "INSERT INTO users(id, email, name) VALUES (4, 'cy@example.test', 'Cy')",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
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
            crate::db::row_cap::DEFAULT_ROW_CAP,
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
        .execute_query(
            "ALTER TABLE users ADD COLUMN nickname TEXT",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
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
        .execute_query(
            "SELECT load_extension('spellfix')",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
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

// Issue #1068 — export row streaming. The seeded `users` table has 3 rows; a
// batch_size below the row count must still stream every row (batch + tail
// flush) and report the total. Mirrors the PG/MySQL `stream_table_rows`
// contract: values are ordered by `column_names` and use the same
// `cell_to_json` wire shape (id is INTEGER → precision-preserving string token,
// ADR 0026).
#[tokio::test]
async fn stream_table_rows_streams_seeded_rows_across_batches_1068() {
    let (_dir, adapter) = connected_adapter().await;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(4);
    let cols = vec!["id".to_string(), "email".to_string(), "name".to_string()];

    let drain = tokio::spawn(async move {
        let mut rows = Vec::new();
        while let Some(batch) = rx.recv().await {
            rows.extend(batch);
        }
        rows
    });

    let total = <SqliteAdapter as RdbAdapter>::stream_table_rows(
        &adapter, "main", "users", 2, &cols, tx, None,
    )
    .await
    .expect("stream_table_rows must stream the seeded rows");

    let mut rows = drain.await.unwrap();
    rows.sort_by_key(|r| r[0].as_str().unwrap_or_default().to_string());

    assert_eq!(total, 3, "every seeded row is streamed");
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], serde_json::json!("1"));
    assert_eq!(rows[0][1], serde_json::json!("ada@example.test"));
    assert_eq!(rows[0][2], serde_json::json!("Ada"));
}

#[tokio::test]
async fn stream_table_rows_rejects_zero_batch_and_empty_columns_1068() {
    let (_dir, adapter) = connected_adapter().await;
    let (tx, _rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(1);
    let cols = vec!["id".to_string()];
    let zero = <SqliteAdapter as RdbAdapter>::stream_table_rows(
        &adapter, "main", "users", 0, &cols, tx, None,
    )
    .await;
    assert!(
        matches!(zero, Err(AppError::Validation(_))),
        "got: {zero:?}"
    );

    let (tx, _rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(1);
    let empty: Vec<String> = Vec::new();
    let no_cols = <SqliteAdapter as RdbAdapter>::stream_table_rows(
        &adapter, "main", "users", 10, &empty, tx, None,
    )
    .await;
    assert!(
        matches!(no_cols, Err(AppError::Validation(_))),
        "got: {no_cols:?}"
    );
}

#[tokio::test]
async fn stream_table_rows_aborts_on_cancelled_token_1068() {
    let (_dir, adapter) = connected_adapter().await;
    let (tx, _rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(4);
    let cols = vec!["id".to_string()];
    let token = CancellationToken::new();
    token.cancel();
    let result = <SqliteAdapter as RdbAdapter>::stream_table_rows(
        &adapter,
        "main",
        "users",
        2,
        &cols,
        tx,
        Some(&token),
    )
    .await;
    match result {
        Err(AppError::Database(message)) => assert!(message.contains("cancelled")),
        other => panic!("Expected cancellation error, got: {other:?}"),
    }
}

#[tokio::test]
async fn stream_table_rows_aborts_when_receiver_dropped_1068() {
    let (_dir, adapter) = connected_adapter().await;
    let (tx, rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(1);
    drop(rx);
    let cols = vec!["id".to_string()];
    // batch_size 1 flushes on the first row → the send fails against the dropped
    // receiver → the stream rolls back and aborts.
    let result = <SqliteAdapter as RdbAdapter>::stream_table_rows(
        &adapter, "main", "users", 1, &cols, tx, None,
    )
    .await;
    match result {
        Err(AppError::Database(message)) => assert!(message.contains("Receiver dropped")),
        other => panic!("Expected receiver-drop abort, got: {other:?}"),
    }
}

// Issue #1068 — `interrupt()` cancel. On a single-connection pool the follow-up
// query can only complete promptly if the cancel actually interrupted the
// running statement (via the SQLite progress handler) and freed the worker.
// Without a real interrupt the dropped future leaves the worker stepping the
// billion-row CTE to completion, so `SELECT 1` queues behind it and the
// timeout guard trips. Proves both clauses of the AC: the running query aborts,
// and the connection is reusable afterward.
#[tokio::test]
async fn cancel_interrupts_running_query_and_frees_connection_for_reuse_1068() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_single_connection_for_test(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let token = CancellationToken::new();
    let canceller = {
        let token = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            token.cancel();
        })
    };

    // A CPU-bound statement that runs for many seconds if never interrupted.
    let long = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000000000) SELECT count(*) FROM c";
    let result = adapter
        .execute_query(long, Some(&token), crate::db::row_cap::DEFAULT_ROW_CAP)
        .await;
    canceller.await.unwrap();
    assert!(
        result.is_err(),
        "cancelled long-running query must return an error, got: {result:?}"
    );

    // The one worker must be free — a stale interrupt handler bound to the
    // cancelled token would instead abort this follow-up too.
    let reuse = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        adapter.execute_query("SELECT 1", None, crate::db::row_cap::DEFAULT_ROW_CAP),
    )
    .await;
    let reuse = reuse.expect("follow-up query must not block behind an interrupted statement");
    assert!(
        reuse.is_ok(),
        "connection must be reusable after interrupt, got: {reuse:?}"
    );
}
