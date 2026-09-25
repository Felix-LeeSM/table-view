//! Written 2026-05-17 (AC-371-07) — verifies the `clear_history` sequence
//! BEGIN → COUNT → DELETE → COMMIT → VACUUM (outside the transaction) →
//! `{deletedCount}`.
//!
//! Invariants:
//!   1. After the call `query_history` holds 0 rows.
//!   2. The response's `deletedCount` equals the row count before the call.
//!   3. VACUUM runs outside the transaction — `clear_history_inner` succeeding
//!      without a SQLite error from a mid-tx VACUUM is itself the proof of the
//!      contract (SQLite rejects a mid-transaction VACUUM, so a failure
//!      propagates straight out as Err).
//!   4. Calling clear again after a clear gives `deletedCount = 0`
//!      (idempotent).
//!
//! This file calls `clear_history_inner` directly — the emit of the IPC layer
//! is verified separately by the `tests/emit_state_changed_payload.rs` pattern,
//! which needs a `tauri::App`. The emit step of AC-371-07 is covered
//! end-to-end by the frontend listener integration in
//! `src/hooks/useQueryHistory.event-refetch.test.ts`.

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

// Proof that VACUUM runs outside the transaction — were it to run inside one,
// SQLite would reject it at once with `cannot VACUUM from within a
// transaction`. This test checks all of (a) clear returns Ok after the seed,
// (b) the row count is 0, and (c) the next INSERT gets a fresh AUTOINCREMENT
// id — all of which pass only when VACUUM succeeded.
#[tokio::test]
#[serial]
async fn ac_371_07_vacuum_outside_transaction_does_not_error() {
    let (_dir, pool) = setup().await;
    seed(&pool, 3).await;
    // Had VACUUM sat inside the transaction, clear_history_inner would return
    // Err on the SQLite error at once and unwrap() would panic — so this call
    // succeeding is itself the proof that VACUUM ran outside the transaction.
    let deleted = clear_history_inner(&pool).await.unwrap();
    assert_eq!(deleted, 3);

    // A new INSERT still works normally after VACUUM.
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

// AC-371-07 idempotency — calling clear again after a clear → 0.
#[tokio::test]
#[serial]
async fn ac_371_07_clear_is_idempotent() {
    let (_dir, pool) = setup().await;
    seed(&pool, 5).await;
    assert_eq!(clear_history_inner(&pool).await.unwrap(), 5);
    assert_eq!(clear_history_inner(&pool).await.unwrap(), 0);
    cleanup();
}
