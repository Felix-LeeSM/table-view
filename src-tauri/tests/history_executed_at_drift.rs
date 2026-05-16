//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-09) — `add_history_entry`
//! 의 clock drift 안전망.
//!
//! Invariant:
//!   - `|now - executedAt| > 5min` → backend now 로 override.
//!   - drift 가 5min 이하면 frontend 값 그대로 저장.
//!
//! Wire shape: 같은 `AddHistoryEntryRequest` payload 의 `executedAt` 필드
//! 한 값만 다른 두 케이스 — 한 번은 1h 전 (drift), 한 번은 30s 전 (OK).
//!
//! drift override 가 일어났음을 확인하기 위해 backend 가 호출 시점의
//! `now_ms()` 와 row 의 `executed_at` 컬럼이 일치 (대략 +/- 1s 이내) 하는지
//! 검증.

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

// AC-371-09 case A — frontend executedAt = now - 10min → drift 트리거 →
// backend now 로 override.
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

    // backend override → resp.executed_at 는 [call_start, call_end] 범위.
    assert!(
        resp.executed_at >= call_start - 100 && resp.executed_at <= call_end + 100,
        "executed_at should be backend now ({}..={}), got {}",
        call_start,
        call_end,
        resp.executed_at
    );
    // 그리고 frontend 가 보낸 stale 값은 분명히 아님.
    assert!(
        resp.executed_at - frontend_ea > 9 * 60 * 1000,
        "drift was {} ms — must be > 9min if override took effect",
        resp.executed_at - frontend_ea
    );

    // DB row 확인.
    let row_ea: i64 = sqlx::query_scalar("SELECT executed_at FROM query_history WHERE id = ?")
        .bind(resp.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row_ea, resp.executed_at);
    cleanup();
}

// AC-371-09 case B — frontend executedAt = now - 1min → drift 1min < 5min →
// frontend 값 그대로 유지.
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

// AC-371-09 case C — 시계가 미래로 점프 (frontend executedAt > now + 10min)
// 한 케이스도 backend now 로 override.
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
