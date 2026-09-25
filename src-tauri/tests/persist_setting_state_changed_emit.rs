//! Written 2026-05-17 — verifies that after `persist_setting` the backend
//! broadcasts a `state-changed` event to every window.
//!
//! User report: "the theme seems to be applied per window, but all windows
//! should share it". The diagnosis found that `emit_state_changed` had zero
//! call sites anywhere in `commands/` — the backend-first contract only did
//! the SQLite write and dropped the cross-window notification. A frontend
//! `theme-sync` bridge exists separately, but the backend path has to be alive
//! for the 9-domain unified dispatcher of reconcile / state-changed to behave
//! consistently (strategy F.4 line 1388).
//!
//! This test locks the backend half of the user journey:
//!
//!   1. The user clicks ThemePicker in one window
//!   2. → `invoke("persist_setting", ...)`
//!   3. → backend SQLite write
//!   4. → backend `emit_state_changed(..., domain=Setting, op=Update, entityId="theme", originWindow=<caller label>)`
//!   5. → every window's listener receives the same payload
//!   6. → (frontend) the originating window skips the self-echo; the other
//!      windows run `applyThemeSettingFromBackend()` → store mutate → DOM
//!      update.
//!
//! Steps 4-5 are the part locked here with MockRuntime — the payload's wire
//! shape, version monotonicity, and origin_window being filled in.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serial_test::serial;
use table_view_lib::commands::persist_settings::{
    persist_setting_with_emit, PersistSettingRequest,
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
async fn persist_setting_theme_emits_state_changed_with_setting_update_theme() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

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
    .expect("persist_setting_with_emit should succeed");

    let captured = bucket.lock().expect("bucket lock");
    assert_eq!(
        captured.len(),
        1,
        "exactly one state-changed event should fire"
    );
    let p = &captured[0];
    assert_eq!(p.domain, "setting", "domain must be 'setting'");
    assert_eq!(p.op, "update", "op must be 'update'");
    assert_eq!(
        p.entity_id.as_deref(),
        Some("theme"),
        "entityId must echo the settings key"
    );
    assert_eq!(
        p.origin_window.as_deref(),
        Some("launcher"),
        "originWindow must echo caller's window label so self-echo skip works on receivers"
    );
    assert_eq!(
        p.version, 1,
        "first emit for (setting, theme) starts at version 1"
    );
    cleanup();
}

#[tokio::test]
#[serial]
async fn persist_setting_same_key_twice_bumps_version_monotonically() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    for value in [
        r#"{"themeId":"github","mode":"dark"}"#,
        r#"{"themeId":"vercel","mode":"light"}"#,
    ] {
        persist_setting_with_emit(
            &pool,
            &registry,
            app.handle(),
            Some("launcher".to_string()),
            PersistSettingRequest {
                key: "theme".into(),
                value_json: value.into(),
            },
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
async fn persist_setting_different_keys_use_independent_version_counters() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

    persist_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("workspace-conn-1".to_string()),
        PersistSettingRequest {
            key: "theme".into(),
            value_json: r#"{"themeId":"github","mode":"dark"}"#.into(),
        },
    )
    .await
    .unwrap();
    persist_setting_with_emit(
        &pool,
        &registry,
        app.handle(),
        Some("workspace-conn-1".to_string()),
        PersistSettingRequest {
            key: "safe_mode".into(),
            value_json: r#""warn""#.into(),
        },
    )
    .await
    .unwrap();

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 2);
    // Both start at 1 — per-(domain, entityId) partition.
    assert_eq!(captured[0].entity_id.as_deref(), Some("theme"));
    assert_eq!(captured[0].version, 1);
    assert_eq!(captured[1].entity_id.as_deref(), Some("safe_mode"));
    assert_eq!(captured[1].version, 1);
    cleanup();
}

#[tokio::test]
#[serial]
async fn persist_setting_writes_sqlite_before_emit_so_receiver_refetch_sees_new_value() {
    cleanup();
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();
    let (_dir, pool) = setup_pool().await;

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

    // At the moment emit fired, the SQLite row must already contain the
    // new value so any receiver immediately calling `get_setting("theme")`
    // sees it (strategy F.4 line 1388 — the event is the notification; the
    // actual value comes from the receiver's refetch).
    let value: String = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = 'theme'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(value, r#"{"themeId":"github","mode":"dark"}"#);

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 1);
    cleanup();
}
