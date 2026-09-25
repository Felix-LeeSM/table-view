//! Written 2026-05-16 — verifies the partial fallback of
//! `get_initial_app_state_inner` (AC-357-07). Strategy F.2 line 1125 — when one
//! store's SQLite query fails, only that slot is filled with `{ error: "..." }`
//! and `partial: true`. The other stores proceed normally.
//!
//! Scenario: call the snapshot with the `mru` table dropped. The mru slot is
//! `{ error: "..." }` + partial=true; connections / workspaces / theme /
//! safe_mode are normal (default values).

use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
use table_view_lib::storage::local;
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

#[tokio::test]
#[serial]
async fn test_snapshot_partial_when_one_store_table_missing() {
    let (_dir, pool) = setup().await;

    // Drop the mru table — makes read_mru return a sqlx error.
    sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();

    // partial: true.
    assert_eq!(
        json["partial"],
        serde_json::Value::Bool(true),
        "partial must be true when any store fails"
    );

    // The mru slot has the shape { error: "..." }.
    let mru = json["stores"]["mru"].as_object().unwrap();
    assert!(
        mru.contains_key("error"),
        "mru slot must be {{ error: ... }} when table missing, got {:?}",
        mru.keys().collect::<Vec<_>>()
    );
    let err_msg = mru["error"].as_str().unwrap();
    assert!(
        !err_msg.is_empty(),
        "error message must be non-empty for debugging"
    );

    // The other stores are normal (default).
    let conns = json["stores"]["connections"].as_object().unwrap();
    assert!(
        conns.contains_key("items"),
        "connections must remain non-error when its own table is intact"
    );
    let theme = json["stores"]["theme"].as_object().unwrap();
    assert!(theme.contains_key("themeId"));

    cleanup();
}

// When two stores fail at once, both are expressed as { error }. partial=true.
#[tokio::test]
#[serial]
async fn test_snapshot_partial_with_multiple_failures() {
    let (_dir, pool) = setup().await;
    sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();
    sqlx::query("DROP TABLE settings")
        .execute(&pool)
        .await
        .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();

    assert_eq!(json["partial"], serde_json::Value::Bool(true));
    assert!(json["stores"]["mru"]
        .as_object()
        .unwrap()
        .contains_key("error"));
    assert!(json["stores"]["theme"]
        .as_object()
        .unwrap()
        .contains_key("error"));
    assert!(json["stores"]["safeMode"]
        .as_object()
        .unwrap()
        .contains_key("error"));
}

// partial: false when all stores are OK.
#[tokio::test]
#[serial]
async fn test_snapshot_partial_false_when_all_stores_ok() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    assert_eq!(json["partial"], serde_json::Value::Bool(false));
    cleanup();
}
