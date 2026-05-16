//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-07) — `clear_history`
//! 의 BEGIN → COUNT → DELETE → COMMIT → VACUUM (transaction 밖) →
//! `{deletedCount}` 시퀀스 검증.
//!
//! Invariants:
//!   1. 호출 후 `query_history` row 수가 0.
//!   2. 응답의 `deletedCount` 가 호출 전 row 수와 동일.
//!   3. VACUUM 이 transaction 밖에서 실행 — `clear_history_inner` 가
//!      mid-tx VACUUM 으로 인한 SQLite error 없이 성공한다는 자체가
//!      contract 의 증명 (SQLite 가 mid-transaction VACUUM 을 reject 하므로
//!      실패하면 곧바로 Err 로 propagate).
//!   4. clear 호출 후 다시 호출하면 `deletedCount = 0` (멱등).
//!
//! 본 파일은 `clear_history_inner` 를 직접 호출 — IPC 레이어의 emit 은
//! tauri::App 가 필요한 `tests/emit_state_changed_payload.rs` 패턴이 별도
//! 검증. AC-371-07 의 emit 단계는 sprint-372 의 frontend listener 통합에서
//! end-to-end 로 검증.

use serde_json::json;
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{
    add_history_entry_inner, clear_history_inner, AddHistoryEntryRequest,
};
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

async fn seed(pool: &SqlitePool, count: usize) {
    for i in 0..count {
        let req: AddHistoryEntryRequest = serde_json::from_value(json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": format!("SELECT {}", i),
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(pool, req).await.unwrap();
    }
}

#[tokio::test]
#[serial]
async fn ac_371_07_clear_deletes_all_rows_and_reports_count() {
    let (_dir, pool) = setup().await;
    seed(&pool, 12).await;

    let pre: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pre, 12);

    let deleted = clear_history_inner(&pool).await.unwrap();
    assert_eq!(deleted, 12, "deletedCount must equal pre-call row count");

    let post: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(post, 0, "all rows must be deleted");

    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_371_07_clear_on_empty_table_returns_zero() {
    let (_dir, pool) = setup().await;
    let deleted = clear_history_inner(&pool).await.unwrap();
    assert_eq!(deleted, 0);
    cleanup();
}

// VACUUM 이 transaction 밖에서 실행되는지의 증명 — 만약 VACUUM 이
// transaction 안에서 실행되면 SQLite 가 `cannot VACUUM from within a
// transaction` 으로 즉시 reject 한다. 본 테스트는 (a) seed 후 clear 가
// Ok 를 반환하고 (b) row 수가 0 이며 (c) 다음 INSERT 가 새 AUTOINCREMENT
// id 를 잘 받는지를 모두 확인 — VACUUM 이 성공해야만 모두 통과.
#[tokio::test]
#[serial]
async fn ac_371_07_vacuum_outside_transaction_does_not_error() {
    let (_dir, pool) = setup().await;
    seed(&pool, 3).await;
    // 만약 VACUUM 이 transaction 안에 들어 있었다면 clear_history_inner 가
    // SQLite error 로 즉시 Err 반환 — unwrap() 가 panic 하므로 본 호출의
    // 성공 자체가 VACUUM 가 transaction 밖에서 실행됐다는 증명.
    let deleted = clear_history_inner(&pool).await.unwrap();
    assert_eq!(deleted, 3);

    // VACUUM 후에도 정상적으로 새 INSERT 가능.
    let req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT 1",
        "status": "success",
        "durationMs": 1,
        "executedAt": now_ms(),
    }))
    .unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();
    assert!(resp.id > 0);
    cleanup();
}

// AC-371-07 멱등 — clear 후 clear 다시 호출 → 0.
#[tokio::test]
#[serial]
async fn ac_371_07_clear_is_idempotent() {
    let (_dir, pool) = setup().await;
    seed(&pool, 5).await;
    assert_eq!(clear_history_inner(&pool).await.unwrap(), 5);
    assert_eq!(clear_history_inner(&pool).await.unwrap(), 0);
    cleanup();
}
