//! 작성 2026-05-17 (Phase 6 sprint-376 Q21 #8) — `clear_mru` IPC 의
//! backend contract 통합 검증.
//!
//! Lego invariant:
//!   1. `mru` table 의 모든 row 가 DELETE.
//!   2. `state-changed` payload `{domain:"mru", op:"bulk", entityId:null}`
//!      이 emit (mru 도메인은 frontend dispatcher 의 `routeNormalHandler`
//!      에서 `Bulk` 만 받음 — stateChanged.ts:301-308).
//!   3. originWindow 가 caller label 그대로 echo.
//!   4. 빈 table 에서의 clear 는 no-op + emit 1회 (idempotent / cross-window
//!      converge).

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serial_test::serial;
use table_view_lib::commands::persist_mru::{
    clear_mru_with_emit, persist_mru_inner, PersistMruRequest,
};
use table_view_lib::events::{EventVersionRegistry, STATE_CHANGED_EVENT};
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Listener;
use tempfile::TempDir;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct CapturedPayload {
    domain: String,
    op: String,
    #[serde(rename = "entityId")]
    entity_id: Option<String>,
    version: u64,
    #[serde(rename = "originWindow")]
    origin_window: Option<String>,
}

fn make_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app build")
}

fn capture_payloads(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> Arc<Mutex<Vec<CapturedPayload>>> {
    let bucket = Arc::new(Mutex::new(Vec::new()));
    let bucket_clone = bucket.clone();
    app.handle().listen(STATE_CHANGED_EVENT, move |event| {
        let payload: CapturedPayload = serde_json::from_str(event.payload())
            .expect("state-changed payload should deserialize");
        bucket_clone
            .lock()
            .expect("state-changed bucket lock")
            .push(payload);
    });
    bucket
}

async fn setup_pool() -> (TempDir, sqlx::SqlitePool) {
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
    table_view_lib::storage::reconcile::mismatch_counter::reset();
}

#[tokio::test]
#[serial]
async fn clear_mru_deletes_every_row_and_emits_mru_bulk_payload() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    // Seed three MRU entries.
    persist_mru_inner(
        &pool,
        vec![
            PersistMruRequest {
                connection_id: "c1".into(),
                last_used: 100,
            },
            PersistMruRequest {
                connection_id: "c2".into(),
                last_used: 200,
            },
            PersistMruRequest {
                connection_id: "c3".into(),
                last_used: 300,
            },
        ],
    )
    .await
    .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, 3);

    // Clear.
    clear_mru_with_emit(&pool, &registry, app.handle(), Some("launcher".to_string()))
        .await
        .expect("clear_mru_with_emit should succeed");

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, 0, "every mru row must be deleted by clear_mru");

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 1, "exactly one state-changed event");
    let p = &captured[0];
    assert_eq!(p.domain, "mru");
    assert_eq!(p.op, "bulk");
    assert!(
        p.entity_id.is_none(),
        "mru.bulk has no entityId (table-wide)"
    );
    assert_eq!(p.origin_window.as_deref(), Some("launcher"));
    assert_eq!(p.version, 1);
    cleanup();
}

#[tokio::test]
#[serial]
async fn clear_mru_on_empty_table_is_idempotent_and_still_emits() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    let pre: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pre, 0);

    clear_mru_with_emit(&pool, &registry, app.handle(), Some("launcher".to_string()))
        .await
        .unwrap();

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0].op, "bulk");
    cleanup();
}

#[tokio::test]
#[serial]
async fn clear_mru_bumps_version_monotonically() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    for _ in 0..3 {
        clear_mru_with_emit(&pool, &registry, app.handle(), Some("launcher".to_string()))
            .await
            .unwrap();
    }

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 3);
    assert_eq!(captured[0].version, 1);
    assert_eq!(captured[1].version, 2);
    assert_eq!(captured[2].version, 3);
    cleanup();
}
