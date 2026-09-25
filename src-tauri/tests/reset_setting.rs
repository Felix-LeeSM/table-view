//! Written 2026-05-17 (Q21) — integration check of the `reset_setting` IPC
//! backend contract.
//!
//! Lego invariant:
//!   1. The `settings` row is DELETEd from SQLite.
//!   2. A `state-changed` event is emitted with the payload
//!      `{domain:"setting", op:"reset", entityId:<key>}` (no refetch path —
//!      the receiver sets the frontend `SETTING_DEFAULTS[entityId]`, strategy
//!      doc line 1389).
//!   3. The version counter is monotonic per (`setting`, `<key>`).
//!   4. originWindow echoes the caller's window label (the discriminator for
//!      skipping one's own self-echo).
//!   5. Resetting a key that does not exist is a no-op and still emits once
//!      (idempotent — other windows converge out of a stale state).

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
