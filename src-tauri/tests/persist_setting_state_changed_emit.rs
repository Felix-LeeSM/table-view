//! 작성 2026-05-17 (Wave 9.5 회귀 7) — `persist_setting` 후 backend 가
//! `state-changed` 이벤트를 모든 window 에 broadcast 하는지 검증.
//!
//! 사용자 보고: "친구 테마가 창 단위로 적용되는 것 같아. 모든 창이 공유해야
//! 하는데". 진단 결과 sprint-365 가 만든 `emit_state_changed` 의 호출 site 가
//! `commands/` 전체에서 0개 — sprint-368 의 backend-first contract 가 SQLite
//! write 만 하고 cross-window 알림은 누락. frontend `theme-sync` bridge 가
//! 따로 있지만 backend path 가 살아 있어야 reconcile / state-changed 의 9-domain
//! 통합 dispatcher 가 일관되게 동작 (strategy F.4 line 1388).
//!
//! 본 test 는 user journey 의 backend half 를 lock 한다:
//!
//!   1. 사용자가 한 창에서 ThemePicker 클릭
//!   2. → `invoke("persist_setting", ...)`
//!   3. → backend SQLite write
//!   4. → backend `emit_state_changed(..., domain=Setting, op=Update, entityId="theme", originWindow=<caller label>)`
//!   5. → 모든 window 의 listener 가 동일 payload 수신
//!   6. → (frontend) 자기 window 는 self-echo skip, 다른 window 는
//!      `applyThemeSettingFromBackend()` → store mutate → DOM 적용.
//!
//! 본 test 는 step 4~5 를 MockRuntime 으로 lock — payload 의 wire shape /
//! version monotonicity / origin_window 채워짐을 단언.

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
    // sees it (strategy F.4 line 1388 — event=알림, 실제 값=수신자 refetch).
    let value: String = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = 'theme'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(value, r#"{"themeId":"github","mode":"dark"}"#);

    let captured = bucket.lock().unwrap();
    assert_eq!(captured.len(), 1);
    cleanup();
}
