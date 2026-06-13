//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-06) — `get_history_detail`
//! 응답이 `id`, `source`, `sql`, `sqlRedacted` 만 carry.
//!
//! Wire shape (camelCase):
//!   request : `{ id: 42 }`
//!   response: `{ id: 42, source: "raw", sql: "...", sqlRedacted: "..." }`
//!
//! 본 IPC 는 bulk dump path 가 0 — 단일 row id 만 받아 단일 row 반환.
//! file-analytics 는 detail 에서도 redacted SQL 만 반환한다.

use serde_json::{json, Value};
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{
    add_history_entry_inner, get_history_detail_inner, AddHistoryEntryRequest,
    GetHistoryDetailRequest,
};
use table_view_lib::error::AppError;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    set_legacy_import_state(&pool, LegacyImportState::Done)
        .await
        .unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tokio::test]
#[serial]
async fn ac_371_06_detail_response_carries_expected_keys() {
    let (_dir, pool) = setup().await;

    let add_req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT * FROM users WHERE email = 'user@example.com'",
        "status": "success",
        "durationMs": 7,
        "executedAt": now_ms(),
    }))
    .unwrap();
    let added = add_history_entry_inner(&pool, add_req).await.unwrap();

    let detail = get_history_detail_inner(&pool, GetHistoryDetailRequest { id: added.id })
        .await
        .unwrap();
    assert_eq!(detail.id, added.id);
    assert_eq!(detail.source, "raw");
    assert_eq!(
        detail.sql,
        "SELECT * FROM users WHERE email = 'user@example.com'"
    );
    assert_eq!(detail.sql_redacted, "SELECT * FROM users WHERE email = ?");

    // Wire shape: serialize and assert exactly 4 keys.
    let serialized: Value = serde_json::to_value(&detail).unwrap();
    let obj = serialized
        .as_object()
        .expect("detail must serialize to a JSON object");
    let keys: Vec<&String> = obj.keys().collect();
    assert_eq!(
        keys.len(),
        4,
        "detail response must have exactly 4 keys, got: {:?}",
        keys
    );
    assert!(obj.contains_key("id"));
    assert!(obj.contains_key("source"));
    assert!(obj.contains_key("sql"));
    assert!(obj.contains_key("sqlRedacted"));

    cleanup();
}

#[tokio::test]
#[serial]
async fn file_analytics_detail_does_not_return_absolute_path_sql() {
    let (_dir, pool) = setup().await;

    let add_req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "duckdb-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "file-analytics",
        "sql": "SELECT '/Users/felix/private/sales.csv' AS path FROM \"sales_csv\"",
        "status": "success",
        "durationMs": 7,
        "executedAt": now_ms(),
    }))
    .unwrap();
    let added = add_history_entry_inner(&pool, add_req).await.unwrap();

    let detail = get_history_detail_inner(&pool, GetHistoryDetailRequest { id: added.id })
        .await
        .unwrap();
    let serialized = serde_json::to_string(&detail).unwrap();

    assert_eq!(detail.source, "file-analytics");
    assert_eq!(detail.sql, detail.sql_redacted);
    assert!(!serialized.contains("/Users/felix/private/sales.csv"));

    cleanup();
}

#[tokio::test]
#[serial]
async fn detail_returns_not_found_for_missing_id() {
    let (_dir, pool) = setup().await;

    let err = get_history_detail_inner(&pool, GetHistoryDetailRequest { id: 99_999 })
        .await
        .unwrap_err();
    match err {
        AppError::NotFound(msg) => {
            assert!(msg.contains("99999"), "NotFound message should mention id");
        }
        other => panic!("Expected NotFound, got: {:?}", other),
    }
    cleanup();
}
