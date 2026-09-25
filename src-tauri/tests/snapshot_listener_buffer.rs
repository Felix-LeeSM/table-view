//! Written 2026-05-16 (AC-367-04) — when the backend emits a `state-changed`
//! event in the race window just before a snapshot is applied, a listener
//! registered beforehand receives that event with nothing dropped.
//!
//! The backend half of AC-367-04 — the frontend unit tests cover the buffer /
//! drain dedup behaviour, while this cargo test locks:
//!
//!   1. When `app.handle().listen(STATE_CHANGED_EVENT, …)` is registered before
//!      the `emit_state_changed` call, the payload reaches the listener right
//!      after the emit (the Tauri mock runtime fans an emit out synchronously).
//!   2. The `snapshot_version` argument of `emit_state_changed` goes onto the
//!      wire unchanged — the frontend drain dedup logic reads the same variable
//!      when it compares `snapshotVersion > applied`.
//!   3. Emitting twice while the listener is already registered delivers both —
//!      the "listener pre-register" pattern keeps receiving rather than firing
//!      once.
//!
//! This cargo test involves no real SQLite pool and no call to
//! `get_initial_app_state_inner` — the snapshot body itself is covered by
//! `tests/snapshot_atomic.rs` / `tests/snapshot_shape.rs`. What this test owns is
//! the time ordering between listener registration and emit.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use table_view_lib::events::{
    emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry, STATE_CHANGED_EVENT,
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Listener;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct CapturedPayload {
    domain: String,
    op: String,
    #[serde(rename = "entityId")]
    entity_id: Option<String>,
    version: u64,
    #[serde(rename = "snapshotVersion")]
    snapshot_version: u64,
    #[serde(rename = "originWindow")]
    origin_window: Option<String>,
    #[serde(rename = "emittedAt")]
    emitted_at: u64,
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

#[test]
fn ac_367_04_listener_registered_before_emit_receives_payload() {
    // Listener pre-register pattern: register listener FIRST, then emit.
    // The frontend boot does the same with `listen("state-changed", …)`
    // ahead of `getInitialAppState()` — this cargo test verifies the
    // runtime contract on the backend side.
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    // Simulate the race window: a backend emit happens while the (hypothetical)
    // snapshot read is in-flight. Because the listener was registered before
    // the emit, it captures the payload.
    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Connection,
            op: EventOp::Update,
            entity_id: Some("conn-1".to_string()),
            origin_window: Some("launcher".to_string()),
            snapshot_version: 7,
            field: None,
        },
    )
    .expect("emit_state_changed should succeed");

    let captured = bucket.lock().expect("bucket lock").clone();
    assert_eq!(
        captured.len(),
        1,
        "listener should capture exactly one event"
    );
    let p = &captured[0];
    assert_eq!(p.domain, "connection");
    assert_eq!(p.op, "update");
    assert_eq!(p.entity_id.as_deref(), Some("conn-1"));
    assert_eq!(p.snapshot_version, 7);
    assert_eq!(p.version, 1);
    assert_eq!(p.origin_window.as_deref(), Some("launcher"));
    assert!(p.emitted_at > 0);
}

#[test]
fn ac_367_04_snapshot_version_flows_through_to_wire() {
    // Frontend drain logic compares `payload.snapshotVersion > applied`.
    // Lock the wire field name + value pass-through so a future refactor
    // can't accidentally drop the field or rename it (rename test lives
    // in `emit_state_changed_payload.rs`).
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    for sv in &[3u64, 9u64, 42u64] {
        emit_state_changed(
            app.handle(),
            &registry,
            EmitArgs {
                domain: EventDomain::Mru,
                op: EventOp::Bulk,
                entity_id: None,
                origin_window: None,
                snapshot_version: *sv,
                field: None,
            },
        )
        .expect("emit ok");
    }

    let captured = bucket.lock().expect("bucket lock").clone();
    assert_eq!(captured.len(), 3);
    assert_eq!(captured[0].snapshot_version, 3);
    assert_eq!(captured[1].snapshot_version, 9);
    assert_eq!(captured[2].snapshot_version, 42);
}

#[test]
fn ac_367_04_pre_registered_listener_keeps_receiving_after_first_event() {
    // Pre-register-once pattern: the listener stays subscribed across
    // multiple emits, mirroring the frontend's single-`listen()` call
    // site that handles every event for the renderer's lifetime.
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Connection,
            op: EventOp::Status,
            entity_id: Some("conn-A".to_string()),
            origin_window: Some("workspace-conn-A".to_string()),
            snapshot_version: 1,
            field: None,
        },
    )
    .expect("emit 1 ok");

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Connection,
            op: EventOp::Status,
            entity_id: Some("conn-A".to_string()),
            origin_window: Some("workspace-conn-A".to_string()),
            snapshot_version: 1,
            field: None,
        },
    )
    .expect("emit 2 ok");

    let captured = bucket.lock().expect("bucket lock").clone();
    assert_eq!(captured.len(), 2);
    // For the same (domain, entity_id), version rises monotonically 1 → 2.
    assert_eq!(captured[0].version, 1);
    assert_eq!(captured[1].version, 2);
}
