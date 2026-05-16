//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-02 / AC-371-03 / AC-371-04) —
//! `list_history` 의 filter union + tabId/connectionId pairing + limit clamp.
//!
//! Wire shape (camelCase):
//!   `{ filter: { paradigm: "rdb" }, limit: 100 }`                  → OK
//!   `{ filter: { queryMode: "find" } }`                            → serde reject (400)
//!   `{ tabId: "tab-1" }` (connectionId 없음)                       → 400
//!   `{ limit: 1000 }`                                              → clamp 500
//!
//! 본 파일은 frontend wrapper test 와 동일 wire shape — invoke("list_history",
//! { req: { filter: {...}, limit: ... } }) 의 req payload 가 byte-equivalent
//! 로 deserialize 되어야 한다.

use serde_json::json;
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{
    add_history_entry_inner, list_history_inner, AddHistoryEntryRequest, ListHistoryRequest,
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

async fn seed_entries(pool: &SqlitePool, count: usize) {
    for i in 0..count {
        let req: AddHistoryEntryRequest = serde_json::from_value(json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": format!("SELECT {}", i),
            "status": "success",
            "durationMs": 5,
            "executedAt": now_ms() - i as i64,
        }))
        .unwrap();
        add_history_entry_inner(pool, req).await.unwrap();
    }
}

// AC-371-02 — filter without paradigm but with queryMode → serde reject (400).
// The discriminated union `HistoryQueryModeFilter` has `paradigm` as the
// internal tag — JSON `{"queryMode": "find"}` (no `paradigm`) cannot satisfy
// any variant.
#[tokio::test]
#[serial]
async fn ac_371_02_filter_without_paradigm_serde_rejects() {
    let _setup = setup().await;

    let payload = json!({
        "filter": { "queryMode": "find" },
    });

    let result = serde_json::from_value::<ListHistoryRequest>(payload);
    assert!(
        result.is_err(),
        "filter with queryMode but no paradigm must be rejected by serde — got Ok"
    );
    cleanup();
}

// AC-371-02 corollary — filter with paradigm only (no queryMode) is OK.
// Frontend uses this for "rdb only" or "document only" filtering.
#[tokio::test]
#[serial]
async fn filter_with_paradigm_only_is_accepted() {
    let (_dir, pool) = setup().await;
    seed_entries(&pool, 3).await;

    let req: ListHistoryRequest = serde_json::from_value(json!({
        "filter": { "paradigm": "rdb" },
    }))
    .unwrap();
    let resp = list_history_inner(&pool, req).await.unwrap();
    assert_eq!(resp.rows.len(), 3, "all 3 rdb entries should return");
    cleanup();
}

// AC-371-03 — tabId requires connectionId.
#[tokio::test]
#[serial]
async fn ac_371_03_tab_id_without_connection_id_returns_validation_error() {
    let (_dir, pool) = setup().await;

    let req: ListHistoryRequest = serde_json::from_value(json!({
        "tabId": "tab-1",
    }))
    .unwrap();
    let err = list_history_inner(&pool, req).await.unwrap_err();
    match err {
        AppError::Validation(msg) => {
            assert!(
                msg.contains("tabId"),
                "Validation message should mention tabId, got: {}",
                msg
            );
        }
        other => panic!("Expected Validation error, got: {:?}", other),
    }
    cleanup();
}

// AC-371-03 corollary — tabId + connectionId is accepted.
#[tokio::test]
#[serial]
async fn tab_id_with_connection_id_is_accepted() {
    let (_dir, pool) = setup().await;

    let req: ListHistoryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "tabId": "tab-1",
    }))
    .unwrap();
    // Empty table — should return Ok with 0 rows.
    let resp = list_history_inner(&pool, req).await.unwrap();
    assert!(resp.rows.is_empty());
    cleanup();
}

// AC-371-04 — limit > MAX_LIMIT clamps to 500.
#[tokio::test]
#[serial]
async fn ac_371_04_limit_1000_clamps_to_500() {
    let (_dir, pool) = setup().await;
    // Seed 600 rows so the clamp boundary is exercised end-to-end.
    seed_entries(&pool, 600).await;

    let req: ListHistoryRequest = serde_json::from_value(json!({
        "limit": 1000,
    }))
    .unwrap();
    let resp = list_history_inner(&pool, req).await.unwrap();

    assert!(
        resp.rows.len() <= 500,
        "limit must be clamped to 500, got {}",
        resp.rows.len()
    );
    assert_eq!(
        resp.rows.len(),
        500,
        "with 600 seeded rows + limit=1000, exactly 500 should return (clamp hit)"
    );
    cleanup();
}

// AC-371-04 corollary — limit omitted defaults to 100.
#[tokio::test]
#[serial]
async fn limit_omitted_defaults_to_100() {
    let (_dir, pool) = setup().await;
    seed_entries(&pool, 250).await;

    let req: ListHistoryRequest = serde_json::from_value(json!({})).unwrap();
    let resp = list_history_inner(&pool, req).await.unwrap();
    assert_eq!(
        resp.rows.len(),
        100,
        "default limit should be 100, got {}",
        resp.rows.len()
    );
    cleanup();
}

// AC-371-04 corollary — cursor pagination yields next_cursor when page is
// full and None when page is partial. Frontend uses this signal to decide
// whether to render "load more".
#[tokio::test]
#[serial]
async fn cursor_pagination_yields_next_cursor_when_page_full() {
    let (_dir, pool) = setup().await;
    seed_entries(&pool, 30).await;

    // limit=10 → first 10 rows + next_cursor
    let req: ListHistoryRequest = serde_json::from_value(json!({
        "limit": 10,
    }))
    .unwrap();
    let resp = list_history_inner(&pool, req).await.unwrap();
    assert_eq!(resp.rows.len(), 10);
    assert!(resp.next_cursor.is_some());

    // page 2 via cursor
    let req: ListHistoryRequest = serde_json::from_value(json!({
        "limit": 10,
        "cursor": resp.next_cursor.unwrap(),
    }))
    .unwrap();
    let resp2 = list_history_inner(&pool, req).await.unwrap();
    assert_eq!(resp2.rows.len(), 10);
    // The two pages should not overlap.
    let ids_page_1: Vec<i64> = resp.rows.iter().map(|r| r.id).collect();
    let ids_page_2: Vec<i64> = resp2.rows.iter().map(|r| r.id).collect();
    for id in &ids_page_2 {
        assert!(
            !ids_page_1.contains(id),
            "page 2 should not contain page 1's id {}",
            id
        );
    }
    cleanup();
}
