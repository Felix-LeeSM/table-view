use super::*;
use crate::db::RdbAdapter;
use crate::models::{ConnectionConfig, DatabaseType, QueryType, SslMode};
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
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
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
    // Issue #1079 — a primary-key-less table that can hold fully-duplicate
    // rows. The grid's all-column WHERE fallback matches every duplicate, so a
    // single-row edit intent silently becomes an N-row write unless the commit
    // batch enforces the one-row-per-statement contract.
    sqlx::query("CREATE TABLE logs (id INTEGER, msg TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO logs(id, msg) VALUES (1, 'a'), (1, 'a')")
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

async fn scalar_count(adapter: &SqliteAdapter, sql: &str) -> i64 {
    let result = adapter
        .execute_query(sql, None, crate::db::row_cap::DEFAULT_ROW_CAP)
        .await
        .unwrap();
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
async fn execute_query_batch_rolls_back_when_statement_matches_multiple_rows() {
    // Issue #1079 — PK-less table with two identical rows. The grid's
    // all-column WHERE fallback matches both, so a one-row delete intent would
    // silently delete two rows. The commit batch must roll the whole
    // transaction back when a statement affects anything other than one row.
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec!["DELETE FROM logs WHERE id = 1 AND msg = 'a'".to_string()];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Database(message)) => assert!(
            message.contains("statement 1 of 1 failed") && message.contains("affected 2"),
            "unexpected error message: {message}"
        ),
        other => panic!("Expected single-row guard rollback, got: {:?}", other),
    }
    // Rolled back — both duplicate rows survive.
    assert_eq!(scalar_count(&adapter, "SELECT COUNT(*) FROM logs").await, 2);
}

#[tokio::test]
async fn execute_query_batch_rolls_back_when_statement_matches_no_rows() {
    // Issue #1079 (recommendation #3, sibling of #1080) — a WHERE that matches
    // zero rows (row already gone, or a NULL column in the all-column
    // fallback) is also a one-row-contract violation: the intended edit did
    // not apply. It must roll back with a 0-row cause hint that does NOT blame
    // a missing primary key.
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec!["DELETE FROM logs WHERE id = 999 AND msg = 'absent'".to_string()];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Database(message)) => assert!(
            message.contains("statement 1 of 1 failed")
                && message.contains("affected 0")
                && !message.contains("add a primary key"),
            "unexpected error message: {message}"
        ),
        other => panic!("Expected zero-row guard rollback, got: {:?}", other),
    }
    // Nothing removed — the two seeded rows survive.
    assert_eq!(scalar_count(&adapter, "SELECT COUNT(*) FROM logs").await, 2);
}

#[tokio::test]
async fn execute_query_batch_rejects_read_only_sqlite_writes_clearly() {
    let (_dir, adapter) = connected_read_only_adapter().await;
    let statements = vec!["UPDATE users SET name = 'Ada Readonly' WHERE id = 1".to_string()];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!("Expected read-only unsupported error, got: {:?}", other),
    }
}

#[tokio::test]
async fn execute_query_batch_rejects_cte_prefixed_read_only_sqlite_writes_clearly() {
    let (_dir, adapter) = connected_read_only_adapter().await;
    let statements = vec!["WITH next_name(value) AS (SELECT 'Ada Readonly')
         UPDATE users SET name = (SELECT value FROM next_name) WHERE id = 1"
        .to_string()];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!("Expected read-only unsupported error, got: {:?}", other),
    }
}

#[tokio::test]
async fn execute_query_batch_rejects_sqlite_ddl_clearly() {
    let (_dir, adapter) = connected_adapter().await;
    let statements = vec!["ALTER TABLE users ADD COLUMN nickname TEXT".to_string()];

    let result = adapter.execute_query_batch(&statements, None).await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("Raw SQLite DDL is not supported"))
        }
        other => panic!("Expected SQLite DDL unsupported error, got: {:?}", other),
    }
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

/// How long the fixture writer keeps the file's lock, and the floor the worker's
/// own stall has to clear — both explained on the twins in
/// `ddl_native_live_tests.rs`.
const CONTENDED_HOLD: std::time::Duration = std::time::Duration::from_millis(200);
const CONTENDED_FLOOR: std::time::Duration = std::time::Duration::from_millis(100);

/// Runs `statements` as a dry-run batch while an unrelated writer holds the
/// file, releases that writer after [`CONTENDED_HOLD`], and reports the batch's
/// result together with how long the batch worker itself was stuck. The worker
/// times itself — timing it from here would fold in this function's own sleep
/// and could never fail.
async fn dry_run_against_a_held_write_lock(
    adapter: &SqliteAdapter,
    db_path: &std::path::Path,
    statements: Vec<String>,
) -> (Result<Vec<QueryResult>, AppError>, std::time::Duration) {
    let release = crate::db::adapters::sqlite::connection::hold_write_lock(db_path).await;
    let worker = adapter.clone();
    let running = tokio::spawn(async move {
        let started = std::time::Instant::now();
        (
            worker.dry_run_query_batch(&statements, None).await,
            started.elapsed(),
        )
    });

    tokio::time::sleep(CONTENDED_HOLD).await;
    release.send(()).expect("release the contending writer");
    running.await.expect("batch task")
}

fn assert_waited_for_the_lock(
    result: Result<Vec<QueryResult>, AppError>,
    blocked_for: std::time::Duration,
) {
    result.expect("the batch must wait for the lock, not fail fast");
    assert!(
        blocked_for >= CONTENDED_FLOOR,
        "the batch finished in {blocked_for:?}, so it never blocked on the \
         contending writer and this case has stopped exercising the lock"
    );
}

/// Regression (#2130): the batch runner opened its transaction deferred, which
/// is enough for a batch that writes first — SQLite takes the write lock
/// straight away and the busy handler applies. A batch that reads first does
/// not get that: the read leaves the connection in a read transaction, and the
/// later write has to upgrade one, which SQLite refuses on the spot without
/// consulting `busy_timeout`. A statement list the adapter accepts must not
/// depend on its own statement order to survive a concurrent writer.
#[tokio::test]
async fn a_batch_that_reads_before_it_writes_waits_out_a_concurrent_writer() {
    let (dir, adapter) = connected_adapter().await;
    let (result, blocked_for) = dry_run_against_a_held_write_lock(
        &adapter,
        &dir.path().join("app.sqlite"),
        vec![
            "SELECT id FROM users".to_string(),
            "UPDATE users SET name = 'Ada Lovelace' WHERE id = 1".to_string(),
        ],
    )
    .await;

    assert_waited_for_the_lock(result, blocked_for);
}

/// Regression (#2155): the same read-then-upgrade failure, reached through a
/// statement whose write nothing in `QueryType` can see. `PRAGMA user_version`
/// assigns to the database header, but a pragma's result renders like a query
/// so `QueryType` files it under `Select` next to `PRAGMA table_info`. A begin
/// style chosen from that classification opened this batch deferred and it
/// failed fast, which is why the choice is made by `sqlite_statement_writes`
/// instead. The SQL editor's Dry Run hands the buffer through unsplit, so this
/// is a statement list a user sends, not a synthetic one.
#[tokio::test]
async fn a_batch_whose_only_write_is_a_pragma_waits_out_a_concurrent_writer() {
    let (dir, adapter) = connected_adapter().await;
    let (result, blocked_for) = dry_run_against_a_held_write_lock(
        &adapter,
        &dir.path().join("app.sqlite"),
        vec![
            "SELECT id FROM users".to_string(),
            "PRAGMA user_version = 5".to_string(),
        ],
    )
    .await;

    assert_waited_for_the_lock(result, blocked_for);
}

/// Regression (#2130 반작용): a statement list of nothing but reads is legal
/// input, so the batch runner must not take the file's write lock for it. It
/// used to open deferred and never did; the `BEGIN IMMEDIATE` fix would have,
/// which just moves the "database is locked" onto whoever wanted to write
/// during the read.
#[tokio::test]
async fn a_read_only_batch_does_not_take_the_write_lock() {
    let (dir, adapter) = connected_adapter().await;
    let release =
        crate::db::adapters::sqlite::connection::hold_write_lock(&dir.path().join("app.sqlite"))
            .await;
    let statements = vec!["SELECT id FROM users".to_string()];

    // A writer holds the file. A deferred read shares it; an `IMMEDIATE` one
    // queues behind it and only gives up when `busy_timeout` runs out. Dry-run
    // is the entry point a read-only list can succeed on — the commit one takes
    // it and then rejects any statement that does not touch exactly one row.
    let batch = tokio::time::timeout(
        CONTENDED_HOLD,
        adapter.dry_run_query_batch(&statements, None),
    )
    .await
    .expect("a read-only batch must not queue behind an unrelated writer");

    release.send(()).expect("release the contending writer");
    batch.expect("read-only batch");
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
