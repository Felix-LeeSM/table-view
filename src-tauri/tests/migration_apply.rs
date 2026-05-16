//! 작성 2026-05-16 (Phase 1 sprint-355) — Migration 적용 후 9 table 존재 +
//! PK / 인덱스 / `meta` table 검증.
//!
//! AC-355-02 / AC-355-03 의 source-of-truth. Strategy 문서 line 534 의 9 table
//! 목록 (8 도메인 + meta) 과 line 626 의 `workspaces` PK `(connection_id,
//! db_name)`, line 556-557 의 `query_history` index 가 모두 적용됐는지 검증.

use serial_test::serial;
use sqlx::Row;
use table_view_lib::storage::local as sqlite;
use tempfile::TempDir;

/// Set up a temp directory + fresh SQLite pool with migrations applied.
async fn setup_with_migrations() -> (TempDir, sqlx::SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = sqlite::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup_env() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

// AC-355-02: 9 tables exist after migration — 8 domain + meta.
#[tokio::test]
#[serial]
async fn test_migration_creates_nine_tables() {
    let (_dir, pool) = setup_with_migrations().await;

    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations' ORDER BY name")
        .fetch_all(&pool)
        .await
        .unwrap();

    let names: Vec<String> = rows.iter().map(|r| r.get::<String, _>("name")).collect();

    let expected = [
        "connection_groups",
        "connections",
        "datagrid_column_prefs",
        "favorites",
        "meta",
        "mru",
        "query_history",
        "settings",
        "workspaces",
    ];
    for t in expected.iter() {
        assert!(
            names.iter().any(|n| n == t),
            "Missing table '{}' — found tables: {:?}",
            t,
            names
        );
    }
    assert_eq!(
        expected.len(),
        9,
        "spec mandates exactly 9 tables (8 domain + meta)"
    );

    cleanup_env();
}

// AC-355-03: PK on workspaces (connection_id, db_name) — composite.
#[tokio::test]
#[serial]
async fn test_workspaces_pk_is_connection_id_and_db_name() {
    let (_dir, pool) = setup_with_migrations().await;

    // PRAGMA table_info returns rows with `pk` column 1..N for PK members,
    // 0 for non-PK. Composite PK uses 1-based ordering.
    let rows = sqlx::query("PRAGMA table_info(workspaces)")
        .fetch_all(&pool)
        .await
        .unwrap();

    let mut pk_columns: Vec<(String, i64)> = rows
        .iter()
        .filter_map(|r| {
            let pk: i64 = r.get("pk");
            if pk > 0 {
                Some((r.get::<String, _>("name"), pk))
            } else {
                None
            }
        })
        .collect();
    pk_columns.sort_by_key(|(_, pk)| *pk);

    assert_eq!(
        pk_columns.len(),
        2,
        "workspaces PK must have exactly 2 columns, got: {:?}",
        pk_columns
    );
    assert_eq!(pk_columns[0].0, "connection_id");
    assert_eq!(pk_columns[1].0, "db_name");

    cleanup_env();
}

// AC-355-03: PK on datagrid_column_prefs is 5-tuple
// (connection_id, paradigm, db_name, namespace, table_name).
#[tokio::test]
#[serial]
async fn test_datagrid_column_prefs_pk_is_5_tuple() {
    let (_dir, pool) = setup_with_migrations().await;

    let rows = sqlx::query("PRAGMA table_info(datagrid_column_prefs)")
        .fetch_all(&pool)
        .await
        .unwrap();

    let mut pk_columns: Vec<(String, i64)> = rows
        .iter()
        .filter_map(|r| {
            let pk: i64 = r.get("pk");
            if pk > 0 {
                Some((r.get::<String, _>("name"), pk))
            } else {
                None
            }
        })
        .collect();
    pk_columns.sort_by_key(|(_, pk)| *pk);

    let names: Vec<&str> = pk_columns.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "connection_id",
            "paradigm",
            "db_name",
            "namespace",
            "table_name",
        ],
        "datagrid_column_prefs PK shape mismatch"
    );

    cleanup_env();
}

// AC-355-03: `query_history` indexes `idx_history_connection_executed` and
// `idx_history_tab` exist.
#[tokio::test]
#[serial]
async fn test_query_history_has_required_indexes() {
    let (_dir, pool) = setup_with_migrations().await;

    let rows = sqlx::query("PRAGMA index_list(query_history)")
        .fetch_all(&pool)
        .await
        .unwrap();

    let names: Vec<String> = rows.iter().map(|r| r.get::<String, _>("name")).collect();
    assert!(
        names.iter().any(|n| n == "idx_history_connection_executed"),
        "Missing index idx_history_connection_executed — found: {:?}",
        names
    );
    assert!(
        names.iter().any(|n| n == "idx_history_tab"),
        "Missing index idx_history_tab — found: {:?}",
        names
    );

    cleanup_env();
}

// AC-355-02: migration runner is idempotent — running twice on the same db
// must succeed (the migration tool tracks applied versions).
#[tokio::test]
#[serial]
async fn test_migration_runner_is_idempotent() {
    let (_dir, pool) = setup_with_migrations().await;

    // Run pool init a second time — should NOT recreate or error.
    sqlite::run_migrations(&pool).await.unwrap();

    // Sanity: tables still exist exactly as expected. Exclude SQLite
    // internal tables (`sqlite_*`) and sqlx's own `_sqlx_migrations` ledger.
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 9, "9 user tables expected after idempotent run");

    cleanup_env();
}

// AC-355-02 invariant: meta key-value table has `legacy_imported` key default
// = 'pending' on fresh install (sentinel).
#[tokio::test]
#[serial]
async fn test_meta_legacy_imported_default_is_pending() {
    let (_dir, pool) = setup_with_migrations().await;

    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM meta WHERE key = 'legacy_imported'")
            .fetch_optional(&pool)
            .await
            .unwrap();

    let value = row
        .expect("meta.legacy_imported row missing after migration")
        .0;
    assert_eq!(value, "pending");

    cleanup_env();
}
