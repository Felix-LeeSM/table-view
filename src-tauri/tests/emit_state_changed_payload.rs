//! 작성 2026-05-16 (Phase 3 sprint-365) — `emit_state_changed` IPC wrapper +
//! `StateChangedPayload` wire shape + per-(domain, entity) version monotonicity.
//!
//! sprint-365 (Phase 3 of state-management strategy, F.4): cross-window state
//! delivery uses one canonical `state-changed` event. Every backend mutation
//! call calls `emit_state_changed(app, EmitArgs)` which (a) increments the
//! `(domain, entity_id)` version, (b) constructs the wire payload with
//! `originWindow` / `version` / `snapshotVersion` / `emittedAt`, and (c)
//! broadcasts via `AppHandle::emit` so every window listener receives the
//! same payload.
//!
//! 검증 매트릭스 (Acceptance Criteria):
//!   - AC-365-01 emit 한 번 → 모든 listener 가 payload 1회 수신.
//!     Payload shape: domain / op / entityId / version / snapshotVersion /
//!     originWindow / emittedAt 모두 채워짐.
//!   - 같은 (domain, entityId) 두 번 emit → version 단조 증가 (1 → 2).
//!   - 다른 entityId 는 독립 version (둘 다 1 부터 시작).
//!   - reset op 도 일반 update 와 같은 version 흐름 (no special-case backend
//!     side — frontend 가 `op:"reset"` 으로 분기).
//!   - `field` (datagridColumnPrefs.reset 전용) 가 옵션으로 직렬화됨.
//!   - `entityId=None` (history.clear) 도 직렬화 통과.
//!   - originWindow=None (backend-initiated) 도 직렬화 통과.

use serde::Deserialize;
use std::sync::{Arc, Mutex};
use table_view_lib::events::{
    emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry, ResetField,
    STATE_CHANGED_EVENT,
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Listener;

/// Wire payload shape — keep in lockstep with `StateChangedPayload` in
/// `src-tauri/src/events.rs`. `camelCase` matches the JS contract.
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
    #[serde(default)]
    field: Option<String>,
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
fn ac_365_01_emit_state_changed_broadcasts_payload_to_listeners() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    let result = emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Connection,
            op: EventOp::Update,
            entity_id: Some("conn-1".into()),
            origin_window: Some("workspace-conn-1".into()),
            snapshot_version: 7,
            field: None,
        },
    );
    assert!(result.is_ok(), "emit_state_changed should succeed");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(
        events.len(),
        1,
        "exactly one state-changed event captured, got {}",
        events.len()
    );
    let p = &events[0];
    assert_eq!(p.domain, "connection");
    assert_eq!(p.op, "update");
    assert_eq!(p.entity_id.as_deref(), Some("conn-1"));
    assert_eq!(p.origin_window.as_deref(), Some("workspace-conn-1"));
    assert_eq!(p.snapshot_version, 7);
    assert_eq!(p.version, 1, "first emit per entity → version 1");
    assert!(p.field.is_none(), "field omitted when ResetField=None");
    assert!(p.emitted_at > 0, "emittedAt must be a non-zero unix ms");
}

#[test]
fn version_increments_monotonically_per_entity() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    for _ in 0..3 {
        emit_state_changed(
            app.handle(),
            &registry,
            EmitArgs {
                domain: EventDomain::Setting,
                op: EventOp::Update,
                entity_id: Some("theme".into()),
                origin_window: None,
                snapshot_version: 0,
                field: None,
            },
        )
        .expect("emit");
    }

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].version, 1);
    assert_eq!(events[1].version, 2);
    assert_eq!(events[2].version, 3);
}

#[test]
fn version_partitions_by_entity() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    for entity in ["theme", "safe_mode", "theme", "sidebar_width"] {
        emit_state_changed(
            app.handle(),
            &registry,
            EmitArgs {
                domain: EventDomain::Setting,
                op: EventOp::Update,
                entity_id: Some(entity.into()),
                origin_window: None,
                snapshot_version: 0,
                field: None,
            },
        )
        .expect("emit");
    }

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 4);
    assert_eq!(events[0].entity_id.as_deref(), Some("theme"));
    assert_eq!(events[0].version, 1);
    assert_eq!(events[1].entity_id.as_deref(), Some("safe_mode"));
    assert_eq!(
        events[1].version, 1,
        "safe_mode is fresh entity → version 1"
    );
    assert_eq!(events[2].entity_id.as_deref(), Some("theme"));
    assert_eq!(events[2].version, 2, "theme second emit → version 2");
    assert_eq!(events[3].entity_id.as_deref(), Some("sidebar_width"));
    assert_eq!(events[3].version, 1);
}

#[test]
fn version_partitions_by_domain_and_entity() {
    // Same entity_id under two different domains must have independent
    // version counters — the (domain, entity_id) tuple is the key.
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    // Setting/theme → v1
    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Setting,
            op: EventOp::Update,
            entity_id: Some("theme".into()),
            origin_window: None,
            snapshot_version: 0,
            field: None,
        },
    )
    .expect("emit");
    // Connection/theme (hypothetical — same entity_id string) → v1 (independent)
    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::Connection,
            op: EventOp::Status,
            entity_id: Some("theme".into()),
            origin_window: None,
            snapshot_version: 0,
            field: None,
        },
    )
    .expect("emit");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].domain, "setting");
    assert_eq!(events[0].version, 1);
    assert_eq!(events[1].domain, "connection");
    assert_eq!(
        events[1].version, 1,
        "different domain → independent version counter"
    );
}

#[test]
fn datagrid_reset_serializes_field_widths() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::DatagridColumnPrefs,
            op: EventOp::Reset,
            entity_id: Some("entity-base64".into()),
            origin_window: None,
            snapshot_version: 0,
            field: Some(ResetField::Widths),
        },
    )
    .expect("emit");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].domain, "datagridColumnPrefs");
    assert_eq!(events[0].op, "reset");
    assert_eq!(events[0].field.as_deref(), Some("widths"));
}

#[test]
fn datagrid_reset_serializes_field_hidden_columns() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::DatagridColumnPrefs,
            op: EventOp::Reset,
            entity_id: Some("entity-base64".into()),
            origin_window: None,
            snapshot_version: 0,
            field: Some(ResetField::HiddenColumns),
        },
    )
    .expect("emit");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events[0].field.as_deref(), Some("hiddenColumns"));
}

#[test]
fn datagrid_reset_serializes_field_all() {
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::DatagridColumnPrefs,
            op: EventOp::Reset,
            entity_id: Some("entity-base64".into()),
            origin_window: None,
            snapshot_version: 0,
            field: Some(ResetField::All),
        },
    )
    .expect("emit");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events[0].field.as_deref(), Some("all"));
}

#[test]
fn history_clear_with_null_entity_id_and_null_origin() {
    // history.clear payload uses `entityId: null` (F.5 / codex 7차 #3) and
    // backend-initiated emits leave `originWindow: null` (no window owns
    // the action). Both must round-trip through serde.
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    emit_state_changed(
        app.handle(),
        &registry,
        EmitArgs {
            domain: EventDomain::History,
            op: EventOp::Clear,
            entity_id: None,
            origin_window: None,
            snapshot_version: 0,
            field: None,
        },
    )
    .expect("emit");

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].domain, "history");
    assert_eq!(events[0].op, "clear");
    assert!(events[0].entity_id.is_none());
    assert!(events[0].origin_window.is_none());
}

#[test]
fn nine_domains_each_serialize_to_strategy_doc_keys() {
    // F.4 wire spec — strategy doc lines 1300–1313 list the 9 domains.
    // This test locks every variant's serde tag so a future rename of any
    // variant breaks loudly here (and not silently in cross-window receivers).
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    let domains = [
        (EventDomain::Connection, "connection"),
        (EventDomain::Group, "group"),
        (EventDomain::Workspace, "workspace"),
        (EventDomain::Mru, "mru"),
        (EventDomain::Favorite, "favorite"),
        (EventDomain::History, "history"),
        (EventDomain::Setting, "setting"),
        (EventDomain::SchemaCache, "schemaCache"),
        (EventDomain::DatagridColumnPrefs, "datagridColumnPrefs"),
    ];

    for (variant, _) in &domains {
        emit_state_changed(
            app.handle(),
            &registry,
            EmitArgs {
                domain: *variant,
                op: EventOp::Update,
                entity_id: Some("x".into()),
                origin_window: None,
                snapshot_version: 0,
                field: None,
            },
        )
        .expect("emit");
    }

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), domains.len());
    for (i, (_, expected)) in domains.iter().enumerate() {
        assert_eq!(
            events[i].domain, *expected,
            "domain at index {i} should serialize as {expected}"
        );
    }
}

#[test]
fn all_ops_serialize_to_strategy_doc_tags() {
    // F.4 wire spec — strategy doc lines 1302–1306 list the ops. Lock
    // every op tag so a typo in `serde(rename)` is caught immediately.
    let app = make_app();
    let bucket = capture_payloads(&app);
    let registry = EventVersionRegistry::new();

    let ops = [
        (EventOp::Create, "create"),
        (EventOp::Update, "update"),
        (EventOp::Delete, "delete"),
        (EventOp::Reorder, "reorder"),
        (EventOp::Bulk, "bulk"),
        (EventOp::Status, "status"),
        (EventOp::Invalidate, "invalidate"),
        (EventOp::Reset, "reset"),
        (EventOp::Clear, "clear"),
    ];

    for (variant, _) in &ops {
        emit_state_changed(
            app.handle(),
            &registry,
            EmitArgs {
                domain: EventDomain::Setting,
                op: *variant,
                entity_id: Some("k".into()),
                origin_window: None,
                snapshot_version: 0,
                field: None,
            },
        )
        .expect("emit");
    }

    let events = bucket.lock().expect("bucket lock");
    assert_eq!(events.len(), ops.len());
    for (i, (_, expected)) in ops.iter().enumerate() {
        assert_eq!(
            events[i].op, *expected,
            "op at index {i} should serialize as {expected}"
        );
    }
}
