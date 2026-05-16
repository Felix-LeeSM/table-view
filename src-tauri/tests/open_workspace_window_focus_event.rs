//! 작성 2026-05-16 (Phase 3 sprint-363) — `open_workspace_window` IPC 의
//! focus event emit + idempotency 강화 검증.
//!
//! sprint-363 (Q13 후속): sprint-361 이 per-conn 라벨 idempotent 분기를 잠근
//! 뒤, 본 sprint 는 그 위에 **focus event emit** 을 추가한다. 같은 conn 두
//! 번째 호출 (idempotent focus 경로) 도, 새 conn 첫 호출 (build 경로) 도
//! `workspace:focused` 이벤트를 한 번 emit 해서 frontend 가 toast / log /
//! analytics 를 매달 수 있게 한다.
//!
//! 검증 매트릭스:
//!   - AC-363-01 같은 conn 두 번 호출 → window count 1 + focus event 2회
//!     (1회: build 후 emit, 2회: idempotent re-focus 후 emit). payload 의
//!     `is_new` 플래그가 true → false 로 전이.
//!   - AC-363-02 idempotent re-focus 경로 (window already exists) 에서도
//!     `workspace:focused` event 가 emit 된다 — frontend 가 "기존 window
//!     focus" 시그널을 받을 수 있어야 toast / mru 갱신을 트리거 가능.
//!   - Invariant: 새 conn (다른 라벨) 호출은 별 window 를 만들고 event 도
//!     conn 별로 분리된다 (payload.connection_id 가 호출 인자와 일치).

use serde::Deserialize;
use std::sync::{Arc, Mutex};
use table_view_lib::commands::open_workspace_window::open_workspace_window_inner;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::{Listener, Manager};

/// Payload shape mirrors the backend emit — keep it in lockstep with
/// `commands::open_workspace_window::WorkspaceFocusedPayload`.
#[derive(Deserialize, Debug, Clone)]
struct WorkspaceFocusedPayload {
    connection_id: String,
    label: String,
    is_new: bool,
}

fn make_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app build")
}

/// Subscribe to the `workspace:focused` event and accumulate payloads into
/// the returned `Arc<Mutex<Vec<...>>>`. Tauri's `app.listen` returns an
/// id we discard — the listener stays alive for the test's lifetime.
fn capture_focus_events(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> Arc<Mutex<Vec<WorkspaceFocusedPayload>>> {
    let bucket = Arc::new(Mutex::new(Vec::new()));
    let bucket_clone = bucket.clone();
    app.handle().listen("workspace:focused", move |event| {
        let payload: WorkspaceFocusedPayload = serde_json::from_str(event.payload())
            .expect("workspace:focused payload should deserialize");
        bucket_clone
            .lock()
            .expect("focus event bucket lock")
            .push(payload);
    });
    bucket
}

#[tokio::test]
async fn ac_363_01_first_call_emits_focus_event_with_is_new_true() {
    let app = make_app();
    let bucket = capture_focus_events(&app);

    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("first open should succeed");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(
        events.len(),
        1,
        "first open should emit exactly one workspace:focused event, got {}",
        events.len()
    );
    let payload = &events[0];
    assert_eq!(payload.connection_id, "conn-1", "payload connection_id");
    assert_eq!(payload.label, "workspace-conn-1", "payload label");
    assert!(
        payload.is_new,
        "first open is a new-window event — is_new must be true"
    );
}

#[tokio::test]
async fn ac_363_02_same_conn_second_call_emits_focus_event_with_is_new_false() {
    let app = make_app();
    let bucket = capture_focus_events(&app);

    // First call: build path, is_new = true.
    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("first open should succeed");

    // Second call: idempotent re-focus path, is_new = false.
    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("second open (idempotent) should succeed");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(
        events.len(),
        2,
        "idempotent re-focus must still emit workspace:focused — frontend hooks on the event, not on window creation, got {} events",
        events.len()
    );
    assert!(
        events[0].is_new,
        "first event from build path must be is_new=true"
    );
    assert!(
        !events[1].is_new,
        "second event from idempotent focus path must be is_new=false"
    );
    assert_eq!(
        events[0].connection_id, events[1].connection_id,
        "both events share the conn_id"
    );

    // Window count invariant: still 1 window despite 2 events.
    assert_eq!(
        app.webview_windows().len(),
        1,
        "2 events, 1 window — idempotency preserved"
    );
}

#[tokio::test]
async fn focus_events_partition_by_connection_id_for_distinct_conns() {
    let app = make_app();
    let bucket = capture_focus_events(&app);

    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("conn-1 open");
    open_workspace_window_inner(app.handle().clone(), "conn-2".into())
        .await
        .expect("conn-2 open");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 2, "two distinct conns → two events");
    assert_eq!(events[0].connection_id, "conn-1");
    assert_eq!(events[1].connection_id, "conn-2");
    assert_eq!(events[0].label, "workspace-conn-1");
    assert_eq!(events[1].label, "workspace-conn-2");
    // Both are new-window events.
    assert!(events[0].is_new);
    assert!(events[1].is_new);
}

/// Reason (2026-05-16, sprint-363): empty connection_id is rejected upstream
/// by the validation guard inherited from sprint-361. No event must be
/// emitted because validation runs before the focus/build branch — a
/// frontend listener should never receive an empty connection_id payload.
#[tokio::test]
async fn empty_connection_id_emits_no_focus_event() {
    let app = make_app();
    let bucket = capture_focus_events(&app);

    let result = open_workspace_window_inner(app.handle().clone(), String::new()).await;
    assert!(result.is_err(), "empty conn_id must be rejected");

    let events = bucket.lock().expect("bucket lock");
    assert!(
        events.is_empty(),
        "no event must be emitted for rejected validation, got {:?}",
        events
    );
}
