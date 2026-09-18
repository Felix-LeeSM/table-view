//! Written 2026-05-17 (AC-371-09) — the clock drift safety net of
//! `add_history_entry`.
//!
//! Invariant:
//!   - `|now - executedAt| > 5min` → override with backend now.
//!   - a drift of 5min or less stores the frontend value unchanged.
//!
//! Wire shape: cases that differ only in the `executedAt` field of the same
//! `AddHistoryEntryRequest` payload — past drift, within-threshold, and future
//! drift.
//!
//! To confirm the drift override happened, the test checks that the row's
//! `executed_at` column matches the backend's `now_ms()` at call time (within
//! roughly +/- 1s).

use serde_json::json;
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{add_history_entry_inner, AddHistoryEntryRequest};
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

const TEN_MIN_MS: i64 = 10 * 60 * 1000;
const ONE_MIN_MS: i64 = 60 * 1000;

// AC-371-09 case A — frontend executedAt = now - 10min → triggers drift →
// override with backend now.
#[tokio::test]
#[serial]
async fn ac_371_09_executed_at_10min_drift_is_overridden_with_backend_now() {
    let (_dir, pool) = setup().await;

    let frontend_ea = now_ms() - TEN_MIN_MS;
    let call_start = now_ms();

    let req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT 1",
        "status": "success",
        "durationMs": 1,
        "executedAt": frontend_ea,
    }))
    .unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();

    let call_end = now_ms();

    // backend override → resp.executed_at falls in [call_start, call_end].
    assert!(
        resp.executed_at >= call_start - 100 && resp.executed_at <= call_end + 100,
        "executed_at should be backend now ({}..={}), got {}",
        call_start,
        call_end,
        resp.executed_at
    );
    // And it is clearly not the stale value the frontend sent.
    assert!(
        resp.executed_at - frontend_ea > 9 * 60 * 1000,
        "drift was {} ms — must be > 9min if override took effect",
        resp.executed_at - frontend_ea
    );

    // Check the DB row.
    let row_ea: i64 = sqlx::query_scalar("SELECT executed_at FROM query_history WHERE id = ?")
        .bind(resp.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row_ea, resp.executed_at);
    cleanup();
}

// AC-371-09 case B — frontend executedAt = now - 1min → drift 1min < 5min →
// the frontend value is kept as-is.
#[tokio::test]
#[serial]
async fn ac_371_09_executed_at_within_threshold_passes_through() {
    let (_dir, pool) = setup().await;

    let frontend_ea = now_ms() - ONE_MIN_MS;
    let req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT 1",
        "status": "success",
        "durationMs": 1,
        "executedAt": frontend_ea,
    }))
    .unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();

    assert_eq!(
        resp.executed_at, frontend_ea,
        "within-threshold executedAt must pass through unchanged"
    );
    cleanup();
}

// AC-371-09 case C — a clock that jumped into the future (frontend executedAt
// > now + 10min) is also overridden with backend now.
#[tokio::test]
#[serial]
async fn ac_371_09_executed_at_future_drift_is_overridden() {
    let (_dir, pool) = setup().await;

    let frontend_ea = now_ms() + TEN_MIN_MS;
    let req: AddHistoryEntryRequest = serde_json::from_value(json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT 1",
        "status": "success",
        "durationMs": 1,
        "executedAt": frontend_ea,
    }))
    .unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();

    assert!(
        resp.executed_at < frontend_ea - 9 * 60 * 1000,
        "future-drift override should bring executedAt back to roughly backend now, got {} vs frontend {}",
        resp.executed_at,
        frontend_ea
    );
    cleanup();
}
