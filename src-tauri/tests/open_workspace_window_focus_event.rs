//! Written 2026-05-16 — verifies the focus event emit + idempotency of the
//! `open_workspace_window` IPC.
//!
//! Q13: on top of the per-conn label idempotent branch, `open_workspace_window`
//! emits a **focus event**. Both the second call for the same conn (the
//! idempotent focus path) and the first call for a new conn (the build path)
//! emit `workspace:focused` once, so the frontend can hang a toast / log /
//! analytics off it.
//!
//! Verification matrix:
//!   - AC-363-01 two calls for the same conn → window count 1 + 2 focus events
//!     (first: emit after the build, second: emit after the idempotent
//!     re-focus). The payload's `is_new` flag goes true → false.
//!   - AC-363-02 the idempotent re-focus path (window already exists) emits
//!     `workspace:focused` as well — the frontend needs that "an existing
//!     window was focused" signal to trigger a toast / mru refresh.
//!   - Invariant: a call for a new conn (a different label) builds its own
//!     window and the events stay split per conn (payload.connection_id matches
//!     the call argument).

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

/// Reason (2026-05-16): an empty connection_id is rejected upstream by the
/// validation guard. No event must be emitted because validation runs before
/// the focus/build branch — a frontend listener should never receive an empty
/// connection_id payload.
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
