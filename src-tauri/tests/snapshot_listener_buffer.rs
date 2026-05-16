//! 작성 2026-05-16 (Phase 4 sprint-367) — snapshot 적용 직전 race-window 의
//! `state-changed` event 가 backend 에서 emit 될 때 listener (먼저 등록) 가
//! 그 event 를 누락 없이 수신함을 검증.
//!
//! AC-367-04 의 backend half — frontend 단위 테스트가 buffer / drain 의 dedup
//! 동작을 검증하는 반면, 본 cargo test 는 다음을 잠근다:
//!
//!   1. `app.handle().listen(STATE_CHANGED_EVENT, …)` 가 `emit_state_changed`
//!      호출 이전에 등록되면 emit 직후 payload 가 listener 에 도달한다 (Tauri
//!      mock runtime 이 emit 을 동기적으로 fan-out).
//!   2. `emit_state_changed` 의 `snapshot_version` 인자가 그대로 wire 에 실린다 —
//!      frontend 의 drain dedup logic 이 `snapshotVersion > applied` 으로
//!      비교할 때 같은 변수를 본다.
//!   3. listener 가 이미 등록된 상태에서 두 번 emit 하면 둘 다 수신 — 즉
//!      "listener pre-register" 패턴이 단발성이 아닌 지속 수신 가능함.
//!
//! 이 cargo test 는 실제 SQLite pool 또는 `get_initial_app_state_inner` 호출을
//! 포함하지 않는다 — snapshot 본문 자체는 `tests/snapshot_atomic.rs` /
//! `tests/snapshot_shape.rs` 가 다룬다. 본 test 의 책임은 listener 등록 vs emit
//! 의 시간 순서이다.

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
    // 같은 (domain, entity_id) 면 version 이 1 → 2 단조 증가.
    assert_eq!(captured[0].version, 1);
    assert_eq!(captured[1].version, 2);
}
