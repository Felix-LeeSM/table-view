//! Sprint 365 (Phase 3, F.4) — cross-window `state-changed` event surface.
//!
//! Every backend mutation that wants to broadcast a state-changed
//! notification to all open windows calls [`emit_state_changed`] with a
//! domain / op / entity_id triple and a snapshot version. The function
//!
//!   1. increments the `(domain, entity_id)` version counter held in
//!      [`EventVersionRegistry`] so receivers can dedup / detect gaps,
//!   2. constructs the wire payload (`camelCase`, matching the strategy
//!      doc F.4 contract — see `docs/state-management-strategy-2026-05-15.md`
//!      lines 1295–1313),
//!   3. broadcasts via `AppHandle::emit("state-changed", payload)` so
//!      every window listener — including the calling window for the
//!      self-echo skip path — receives it.
//!
//! The wire shape is intentionally the same struct backend-side and
//! frontend-side: see `src/lib/events/stateChanged.ts` for the JS mirror.
//! Tests (`tests/emit_state_changed_payload.rs`) deserialize the on-wire
//! JSON to assert tag stability — a rename of any `EventDomain` /
//! `EventOp` variant breaks the contract test loudly rather than failing
//! silently at a receiver.
//!
//! The version counter is a per-`(EventDomain, entity_id)` `u64` monotonic
//! counter. It survives until the process exits — boot replays the
//! snapshot version separately, and the strategy doc accepts that
//! per-entity counters reset on relaunch (frontend `lastApplied` map is
//! window-local and also resets).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tracing::warn;

use crate::error::AppError;

/// Tauri event name used for every cross-window state-changed broadcast.
/// Centralized so a future rename touches one site (and frontend mirrors
/// the same constant in `src/lib/events/stateChanged.ts`).
pub const STATE_CHANGED_EVENT: &str = "state-changed";

/// Nine domains in the state-management migration that participate in
/// cross-window broadcast. Strategy doc F.4 (line 1300) fixes the wire
/// tag for each variant via `#[serde(rename_all = "camelCase")]`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EventDomain {
    Connection,
    Group,
    Workspace,
    Mru,
    Favorite,
    History,
    Setting,
    SchemaCache,
    DatagridColumnPrefs,
}

/// Op tags. Strategy doc F.4 (lines 1302–1306) lists the union — same
/// set frontend-side. `Bulk` covers mru (single bulk replacement
/// IPC); `Status` is the Q14 connection-status broadcast; `Invalidate`
/// is the Q23 schemaCache drop; `Reset` is Q21 reset-to-default;
/// `Clear` is F.5 history clear.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventOp {
    Create,
    Update,
    Delete,
    Reorder,
    Bulk,
    Status,
    Invalidate,
    Reset,
    Clear,
}

/// `field` discriminator for `datagridColumnPrefs.reset` (codex 7차 #1).
/// Strategy doc lines 1355–1363 + 1434–1444 lock the three variants:
///   - `widths` — reset widths only, hidden_columns preserved.
///   - `hiddenColumns` — reset hidden_columns only, widths preserved.
///   - `all` — reset both (row DELETE).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetField {
    Widths,
    HiddenColumns,
    All,
}

/// Per-(domain, entity_id) monotonic `u64` version counter. Receivers
/// (`src/lib/events/stateChanged.ts`) keep their own `lastApplied` map
/// keyed the same way; a version smaller than `lastApplied` is treated
/// as stale, and a version > `lastApplied + 1` triggers a domain refetch
/// to recover from a missed event.
///
/// `Mutex<HashMap>` is acceptable here — emits are not on a hot path
/// (mutate IPCs are already serialized by their respective entity-level
/// locks), and the critical section is a single hashmap lookup + u64
/// increment. We use `std::sync::Mutex`, not `tokio::sync::Mutex`,
/// because the section is sync, brief, and the emit fn itself is sync.
pub struct EventVersionRegistry {
    inner: Mutex<HashMap<(EventDomain, String), u64>>,
}

impl EventVersionRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Increment the counter for the given key (initializing to 1 on
    /// first use) and return the new value. The "`null` entity_id"
    /// case — history.clear — is keyed with an empty string sentinel,
    /// which is OK because no real entity_id can collide (history
    /// entityId is never an empty string; clear is the only `null` path).
    pub fn bump(&self, domain: EventDomain, entity_id: Option<&str>) -> u64 {
        let key_id = entity_id.unwrap_or("").to_string();
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| {
            // Recover the map from a poisoned lock — emits never panic
            // mid-section, so a poison is defensive and we proceed.
            poisoned.into_inner()
        });
        let counter = guard.entry((domain, key_id)).or_insert(0);
        *counter += 1;
        *counter
    }
}

impl Default for EventVersionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Arguments to [`emit_state_changed`]. Snapshot-version + origin-window
/// are caller-supplied because the backend doesn't have a global notion
/// of "current snapshot" — it's the caller's responsibility (e.g. a
/// mutate IPC handler) to pass the snapshot version returned by the
/// IPC's `get_initial_app_state` baseline. `origin_window` is the window
/// label of the IPC caller (or `None` for backend-initiated emits such
/// as the connection-status keep-alive task).
#[derive(Debug, Clone)]
pub struct EmitArgs {
    pub domain: EventDomain,
    pub op: EventOp,
    pub entity_id: Option<String>,
    pub origin_window: Option<String>,
    pub snapshot_version: u64,
    pub field: Option<ResetField>,
}

/// Wire payload — exactly mirrors the F.4 contract. `#[serde(rename_all =
/// "camelCase")]` + per-field `serialize_if_not_none` flips Option fields
/// off when null (matching the strategy doc's TS spec where `field?` is
/// optional).
///
/// `emitted_at` is the unix-ms wall clock at emit time. We use
/// `SystemTime::now()` rather than a monotonic clock because the
/// frontend consumes this purely for telemetry / "recent event" UI
/// (not ordering — `version` is the ordering signal).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StateChangedPayload {
    domain: EventDomain,
    op: EventOp,
    entity_id: Option<String>,
    version: u64,
    snapshot_version: u64,
    origin_window: Option<String>,
    emitted_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    field: Option<ResetField>,
}

/// Emit a `state-changed` event to every window in the app.
///
/// Returns `Err(AppError::Emit)` only if Tauri's serialization itself
/// fails — listeners not responding is normal (a window may have closed
/// between the version bump and the emit) and is logged as `warn` but
/// returned as `Ok(())`. The strategy doc's invariant is "best-effort
/// transport, ordered by version" — a lost event recovers via the
/// frontend's gap-detection path.
///
/// Side-effects:
///   1. bumps `registry.[(domain, entity_id)]` by 1 BEFORE constructing
///      payload — so the emitted `version` is the new value, not the old.
///   2. constructs the payload with the bumped version + caller-supplied
///      snapshot_version + origin_window + now() unix-ms.
///   3. calls `AppHandle::emit(STATE_CHANGED_EVENT, payload)` which Tauri
///      fan-outs to every webview listener (including the originating
///      window, which the frontend self-echo skip handles).
pub fn emit_state_changed<R: Runtime>(
    app: &AppHandle<R>,
    registry: &EventVersionRegistry,
    args: EmitArgs,
) -> Result<(), AppError> {
    let EmitArgs {
        domain,
        op,
        entity_id,
        origin_window,
        snapshot_version,
        field,
    } = args;

    let version = registry.bump(domain, entity_id.as_deref());
    let emitted_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        // SystemTime before UNIX_EPOCH is impossible on any clock the app
        // would run on, but if it happens we degrade to 1 (non-zero so
        // tests can assert positivity) and continue — the emit is still
        // semantically correct, just with a degenerate timestamp.
        .unwrap_or(1);

    let payload = StateChangedPayload {
        domain,
        op,
        entity_id,
        version,
        snapshot_version,
        origin_window,
        emitted_at,
        field,
    };

    if let Err(e) = app.emit(STATE_CHANGED_EVENT, payload) {
        warn!(
            target: "events",
            "failed to emit {STATE_CHANGED_EVENT}: {e}"
        );
        // Tauri's emit only fails on serialization; the payload struct
        // is statically `Serialize`, so this branch is unreachable in
        // practice but we surface the error to the caller anyway.
        // `AppError::Window` is the closest semantic fit — emit failures
        // are downstream of window / IPC bus tear-down.
        return Err(AppError::Window(format!(
            "emit {STATE_CHANGED_EVENT} failed: {e}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 3 sprint-365)
    //!
    //! 사유: `EventVersionRegistry::bump` 의 단조 증가 / 엔티티 분리 동작은
    //! integration test (`tests/emit_state_changed_payload.rs`) 가 AppHandle
    //! 경유로 검증하지만, registry 자체의 카운터 로직 (None vs Some entity_id
    //! 의 키 동작 포함) 은 unit 단계에서 잠가야 회귀 시 emit 전에 잡힌다.
    use super::*;

    #[test]
    fn bump_starts_at_one_for_new_key() {
        let r = EventVersionRegistry::new();
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 1);
    }

    #[test]
    fn bump_increments_monotonically_for_same_key() {
        let r = EventVersionRegistry::new();
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 1);
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 2);
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 3);
    }

    #[test]
    fn bump_partitions_by_entity() {
        let r = EventVersionRegistry::new();
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 1);
        assert_eq!(r.bump(EventDomain::Setting, Some("safe_mode")), 1);
        assert_eq!(r.bump(EventDomain::Setting, Some("theme")), 2);
    }

    #[test]
    fn bump_partitions_by_domain() {
        let r = EventVersionRegistry::new();
        assert_eq!(r.bump(EventDomain::Setting, Some("x")), 1);
        assert_eq!(r.bump(EventDomain::Connection, Some("x")), 1);
        assert_eq!(r.bump(EventDomain::Setting, Some("x")), 2);
    }

    #[test]
    fn bump_treats_none_entity_as_its_own_key() {
        // history.clear → entity_id = None. The counter stays distinct
        // from any real entity id.
        let r = EventVersionRegistry::new();
        assert_eq!(r.bump(EventDomain::History, None), 1);
        assert_eq!(r.bump(EventDomain::History, None), 2);
        assert_eq!(r.bump(EventDomain::History, Some("some-id")), 1);
    }
}
