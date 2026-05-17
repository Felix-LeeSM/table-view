//! 작성 2026-05-17 (Phase 6 sprint-376 Q21) — `reset_setting` IPC 의
//! backend contract 통합 검증.
//!
//! Lego invariant:
//!   1. `settings` row 가 SQLite 에서 DELETE.
//!   2. `state-changed` 이벤트가 `{domain:"setting", op:"reset", entityId:<key>}`
//!      payload 로 emit (refetch 미경로 — receiver 가 frontend
//!      `SETTING_DEFAULTS[entityId]` 에 set, strategy doc line 1389).
//!   3. version 카운터는 (`setting`, `<key>`) 단위로 monotonic.
//!   4. originWindow 이 caller 의 window label 로 echo (자기 자신 self-echo
//!      skip 의 discriminator).
//!   5. 존재하지 않는 key 의 reset 은 no-op + emit 1회 (idempotent — 다른 창의
//!      stale 상태 converge).

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serial_test::serial;
use table_view_lib::commands::persist_settings::{
    persist_setting_with_emit, reset_setting_with_emit, PersistSettingRequest,
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
async fn reset_setting_deletes_row_and_emits_setting_reset_payload() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    // Seed a row first via the normal persist path.
    persist_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("launcher".to_string()),
        PersistSettingRequest {
            key: "theme".into(),
            value_json: r#"{"themeId":"github","mode":"dark"}"#.into(),
        },
    )
    .await
    .unwrap();

    // Sanity: row exists.
    let pre: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key = 'theme'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pre, 1);

    // Reset it.
    reset_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("launcher".to_string()),
        "theme".into(),
    )
    .await
    .expect("reset_setting_with_emit should succeed");

    // Row is gone.
    let post: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key = 'theme'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(post, 0, "settings row should be deleted by reset_setting");

    // Captured: 1 update (seed) + 1 reset.
    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 2, "expected 2 events (update + reset)");
    let last = &captured[1];
    assert_eq!(last.domain, "setting");
    assert_eq!(last.op, "reset");
    assert_eq!(last.entity_id.as_deref(), Some("theme"));
    assert_eq!(last.origin_window.as_deref(), Some("launcher"));
    cleanup();
}

#[tokio::test]
#[serial]
async fn reset_setting_on_missing_key_is_idempotent_and_still_emits() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    // No seed — reset on a key that doesn't exist.
    reset_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("launcher".to_string()),
        "safe_mode".into(),
    )
    .await
    .expect("reset_setting on missing key should not error");

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 1, "still emits exactly 1 event");
    let p = &captured[0];
    assert_eq!(p.domain, "setting");
    assert_eq!(p.op, "reset");
    assert_eq!(p.entity_id.as_deref(), Some("safe_mode"));
    cleanup();
}

#[tokio::test]
#[serial]
async fn reset_setting_versions_are_monotonic_per_key() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    // Two resets on the same key bump the per-(setting,key) counter.
    for _ in 0..2 {
        reset_setting_with_emit(
            &pool,
            &registry,
            app.handle(),
            Some("launcher".to_string()),
            "theme".into(),
        )
        .await
        .unwrap();
    }

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 2);
    assert_eq!(captured[0].version, 1);
    assert_eq!(captured[1].version, 2);
    cleanup();
}

#[tokio::test]
#[serial]
async fn reset_setting_does_not_touch_other_keys() {
    cleanup();
    let app = make_app();
    let _bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    // Seed two distinct keys.
    for key in ["theme", "safe_mode"] {
        persist_setting_with_emit(
            &pool,
            &registry,
            app.handle(),
            Some("launcher".to_string()),
            PersistSettingRequest {
                key: key.into(),
                value_json: r#""anything""#.into(),
            },
        )
        .await
        .unwrap();
    }
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, 2);

    // Reset only `theme`.
    reset_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("launcher".to_string()),
        "theme".into(),
    )
    .await
    .unwrap();

    let theme_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key = 'theme'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let safe_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key = 'safe_mode'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        theme_count, 0,
        "reset_setting must delete only the target key"
    );
    assert_eq!(safe_count, 1, "sibling key must remain intact");
    cleanup();
}
