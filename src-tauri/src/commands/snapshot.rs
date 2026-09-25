//! `get_initial_app_state` snapshot IPC.
//!
//! Returns the wire shape of strategy F.2 byte-equivalently. At boot the
//! frontend hydrates the 5 boot-critical stores + runtime activeStatuses
//! atomically over a single IPC. Lazy stores (favorites /
//! queryHistory / schemaCache / datagrid_prefs) go over a separate IPC at
//! mount.
//!
//! Atomic guarantee — every store read runs inside a single
//! `BEGIN IMMEDIATE` transaction. Writes from other threads after the
//! transaction starts are not reflected in the snapshot.
//!
//! Partial fallback (F.2) — if one store's SQLite query fails, its slot gets
//! `{ error: "..." }` and `partial: true`. The other stores proceed normally.
//! All five reads share one transaction, so this branch fires on a per-store
//! query error (a dropped table, say), not on a torn read — the
//! `inner_partial_on_dropped_mru_table` test below covers it.
//!
//! Q9 perf — p95 < 50ms in a seeded environment of 10 connections × 50 tabs
//! (cargo test --release).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionGroup, ConnectionStatus};

// ---------------------------------------------------------------------------
// snapshotVersion — monotonic increment. +1 per call within the same process.
// Baseline for frontend event dedup (compares whether a store mirror event is
// stale relative to the snapshot).
// ---------------------------------------------------------------------------
static SNAPSHOT_VERSION: AtomicU64 = AtomicU64::new(0);

/// Prefix of the workspace window label. Shape: workspace-{conn_id}.
const WORKSPACE_LABEL_PREFIX: &str = "workspace-";

// ---------------------------------------------------------------------------
// Wire types — matching F.2.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialAppState {
    pub schema_version: u32,
    pub snapshot_version: u64,
    pub generated_at: i64,
    pub partial: bool,
    /// v0.3.1: `true` if boot auto-recovery (quarantine + fresh) happened
    /// within this process lifetime. Runtime meta, not a wire shape change,
    /// so `schema_version` stays 1.
    pub recovered: bool,
    /// #2183: `true` if `connections.json` was missing and was restored from
    /// the backup next to it, and that backup contained connections or
    /// groups. From #2187 on, restoring an empty document no longer counts —
    /// nothing was brought back, so there is nothing to announce.
    /// Separate from `recovered` because the two events must say opposite
    /// things to the user — `recovered` says "the app state was reset and an
    /// old copy is in `state.db.bak`", this one says "the saved connections
    /// and groups came back from `connections.json.bak` and nothing was
    /// reset". Either one alone sets `true`, so the sentence shown to the
    /// user must name both. Same runtime meta, so `schema_version` stays 1.
    pub connections_restored_from_backup: bool,
    pub stores: Stores,
    pub runtime: Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stores {
    pub connections: StoreSlot<ConnectionsStore>,
    pub workspaces: StoreSlot<WorkspacesStore>,
    pub mru: StoreSlot<MruStore>,
    pub theme: StoreSlot<ThemeStore>,
    pub safe_mode: StoreSlot<SafeModeStore>,
}

/// Partial fallback union for each store slot — domain data on success,
/// `{ error: "..." }` on failure. `#[serde(untagged)]` exposes both shapes
/// verbatim on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StoreSlot<T> {
    Ok(T),
    Err { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsStore {
    pub items: Vec<ConnectionConfigPublic>,
    pub groups: Vec<ConnectionGroup>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacesStore {
    /// Q13 PK (connection_id, db_name) — nested map. Launcher window → empty
    /// map; workspace window → only that connection.
    pub by_connection_id: HashMap<String, HashMap<String, Value>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MruStore {
    /// Connection id array sorted by `last_used` DESC.
    pub recent_connections: Vec<String>,
    /// The top (most recent) connection id. `null` when empty.
    pub last_used_connection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeStore {
    pub theme_id: String,
    /// `"system" | "light" | "dark"`.
    pub mode: String,
}

impl Default for ThemeStore {
    fn default() -> Self {
        // Must match the frontend `DEFAULT_THEME_ID`. The old `"default"` was
        // an id absent from the catalog, so the `data-theme="default"`
        // selector matched nothing and broke styles on first boot (regression
        // 2, 2026-05-16). The frontend test `loadAll.theme-fallback.test.ts`
        // checks the catalog even at the boundary, but the wire's truth must
        // also be a valid value from the start.
        Self {
            theme_id: "slate".into(),
            mode: "system".into(),
        }
    }
}

/// Safe Mode 3-tier. Wire value = lowercase variant (`"off"` / `"warn"` /
/// `"strict"`). `#[serde(other)]` deserializes unrecognised/legacy values
/// (the old `"on"` and similar) as a `Warn` fallback — matching the issue
/// #1113 decided default (warn). The default is also `Warn` (the effective
/// default for new installs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafeMode {
    Off,
    Strict,
    // `#[serde(other)]` must be the last variant. Warn is both fallback and default.
    #[default]
    #[serde(other)]
    Warn,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeModeStore {
    /// 3-tier `off` / `warn` / `strict`. Unrecognised values fall back to `warn` (#1113).
    pub mode: SafeMode,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub active_statuses: HashMap<String, ConnectionStatus>,
}

// ---------------------------------------------------------------------------
// Inner — takes pool + window_label + status_map and returns the snapshot.
// The Tauri command wrapper extracts the two arguments from `tauri::Window`
// and `tauri::State<AppState>` and calls it. Integration tests call this
// inner directly, so no mock window is needed.
// ---------------------------------------------------------------------------

/// Atomic snapshot read. `window_label` is `"launcher"` or
/// `"workspace-{conn_id}"`. Stripping the prefix from a workspace label
/// returns only that connection's sub-workspace.
pub async fn get_initial_app_state_inner(
    pool: &SqlitePool,
    window_label: &str,
    status_map: &HashMap<String, ConnectionStatus>,
) -> Result<InitialAppState, AppError> {
    let snapshot_version = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    let generated_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let scope_conn_id = window_label
        .strip_prefix(WORKSPACE_LABEL_PREFIX)
        .map(|s| s.to_string());

    // F.2 — a single `BEGIN IMMEDIATE` read transaction. Locks so that every
    // store sees a consistent view of the same instant.
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| AppError::Storage(format!("snapshot tx begin: {}", e)))?;

    // Each store has its own helper. If one helper fails, the state still transitions to partial=true.
    let mut partial = false;

    let connections = match read_connections(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let workspaces = match read_workspaces(&mut tx, scope_conn_id.as_deref()).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let mru = match read_mru(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let theme = match read_theme(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    let safe_mode = match read_safe_mode(&mut tx).await {
        Ok(v) => StoreSlot::Ok(v),
        Err(e) => {
            partial = true;
            StoreSlot::Err {
                error: e.to_string(),
            }
        }
    };

    // Commit releases the read lock. The tx is read-only, so rollback and
    // commit have no semantic difference, but commit keeps sqlx's LIFO
    // guarantee.
    tx.commit()
        .await
        .map_err(|e| AppError::Storage(format!("snapshot tx commit: {}", e)))?;

    Ok(InitialAppState {
        schema_version: 1,
        snapshot_version,
        generated_at,
        partial,
        recovered: false,
        connections_restored_from_backup: false,
        stores: Stores {
            connections,
            workspaces,
            mru,
            theme,
            safe_mode,
        },
        runtime: Runtime {
            active_statuses: status_map.clone(),
        },
    })
}

// ---------------------------------------------------------------------------
// Store readers — each helper performs one domain read inside the
// SqliteTransaction. JSON columns deserialize into serde_json::Value.
// ---------------------------------------------------------------------------

async fn read_connections(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<ConnectionsStore, AppError> {
    // connections → ConnectionConfigPublic shape. password_enc is exposed
    // only as the has_password boolean — plaintext / ciphertext never go on
    // the wire.
    let conn_rows = sqlx::query_as::<_, ConnectionRow>(
        "SELECT id, name, db_type, host, port, user, password_enc, database, read_only, group_id, color, \
         connection_timeout, keep_alive_interval, environment, auth_source, replica_set, \
         tls_enabled, trust_server_certificate \
         FROM connections ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read connections: {}", e)))?;

    // #1669 — the SQLite mirror never stores the Oracle wallet password (it
    // lives only in the connections.json SOT), so derive has_wallet_password
    // from the same presence map `list_connections` uses instead of hardcoding
    // false — otherwise a wallet-secured connection reads as unset on boot.
    let wallet_presence = crate::storage::wallet_password_presence_map()?;
    // #1649 — the mirror has no CA column, so `into_public` reconstructs
    // `verify-ca` as `verify-full` with `ca_cert_path: None`. Nothing connects
    // from the snapshot, so that is safe to *dial* with — but the boot window is
    // editable: a user who edits and saves a connection before
    // `loadConnections()` replaces the snapshot would write the null CA path
    // back to the file SOT and lose it (`storage::save_connection_with_wallet`
    // replaces the whole entry), and the next save would then be rejected by the
    // fail-closed `verify-ca` gate. Take the authoritative posture from the file
    // SOT — the same store the wallet presence map above reads — and close the
    // window instead of documenting it.
    let sot_posture: std::collections::HashMap<String, (crate::models::SslMode, Option<String>)> =
        crate::storage::load_storage_redacted()?
            .connections
            .into_iter()
            .map(|c| (c.id, (c.ssl_mode, c.ca_cert_path)))
            .collect();
    let items: Vec<ConnectionConfigPublic> = conn_rows
        .into_iter()
        .map(|row| {
            let mut p = row.into_public();
            p.has_wallet_password = *wallet_presence.get(&p.id).unwrap_or(&false);
            if let Some((ssl_mode, ca_cert_path)) = sot_posture.get(&p.id) {
                p.ssl_mode = *ssl_mode;
                p.ca_cert_path = ca_cert_path.clone();
            }
            p
        })
        .collect();

    let group_rows = sqlx::query_as::<_, GroupRow>(
        "SELECT id, name, color, collapsed FROM connection_groups \
         ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read groups: {}", e)))?;

    let groups: Vec<ConnectionGroup> = group_rows
        .into_iter()
        .map(|g| ConnectionGroup {
            id: g.id,
            name: g.name,
            color: g.color,
            collapsed: g.collapsed != 0,
        })
        .collect();

    Ok(ConnectionsStore { items, groups })
}

#[derive(Debug, sqlx::FromRow)]
struct ConnectionRow {
    id: String,
    name: String,
    db_type: String,
    host: String,
    port: i64,
    user: String,
    password_enc: String,
    database: String,
    read_only: i64,
    group_id: Option<String>,
    color: Option<String>,
    connection_timeout: Option<i64>,
    keep_alive_interval: Option<i64>,
    environment: Option<String>,
    auth_source: Option<String>,
    replica_set: Option<String>,
    tls_enabled: Option<i64>,
    trust_server_certificate: Option<i64>,
}

impl ConnectionRow {
    fn into_public(self) -> ConnectionConfigPublic {
        use crate::models::DatabaseType;
        let db_type = self.db_type.parse::<DatabaseType>().unwrap_or_default();
        let paradigm = db_type.paradigm();
        ConnectionConfigPublic {
            id: self.id,
            name: self.name,
            db_type,
            host: self.host,
            port: self.port as u16,
            user: self.user,
            database: self.database,
            read_only: self.read_only != 0,
            group_id: self.group_id,
            color: self.color,
            connection_timeout: self.connection_timeout.map(|v| v as u32),
            keep_alive_interval: self.keep_alive_interval.map(|v| v as u32),
            environment: self.environment,
            has_password: !self.password_enc.is_empty(),
            paradigm,
            auth_source: self.auth_source,
            replica_set: self.replica_set,
            // #1649 — the mirror keeps the legacy integer columns, so the
            // posture is folded back out of them. `read_connections` then
            // overlays the authoritative `ssl_mode`/`ca_cert_path` from the file
            // SOT, which is the only store that holds the CA path.
            ssl_mode: crate::models::SslMode::from_legacy(
                self.tls_enabled.map(|v| v != 0),
                self.trust_server_certificate.map(|v| v != 0),
            ),
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            // Default; `read_connections` overrides from the file-SOT presence
            // map since the SQLite mirror does not store the wallet password.
            has_wallet_password: false,
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct GroupRow {
    id: String,
    name: String,
    color: Option<String>,
    collapsed: i64,
}

async fn read_workspaces(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    scope_conn_id: Option<&str>,
) -> Result<WorkspacesStore, AppError> {
    // Launcher window (scope_conn_id == None) → empty byConnectionId.
    // Workspace window → only that conn.
    let Some(conn_id) = scope_conn_id else {
        return Ok(WorkspacesStore::default());
    };

    let rows = sqlx::query_as::<_, WorkspaceRow>(
        "SELECT connection_id, db_name, active_tab_id, tabs_json, sidebar_expanded_json, \
         closed_tabs_json FROM workspaces WHERE connection_id = ?",
    )
    .bind(conn_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| AppError::Storage(format!("read workspaces: {}", e)))?;

    let mut by_conn: HashMap<String, HashMap<String, Value>> = HashMap::new();
    for r in rows {
        let tabs: Value = serde_json::from_str(&r.tabs_json).unwrap_or(Value::Array(vec![]));
        let sidebar_expanded: Value =
            serde_json::from_str(&r.sidebar_expanded_json).unwrap_or(Value::Array(vec![]));
        let closed_tabs: Value =
            serde_json::from_str(&r.closed_tabs_json).unwrap_or(Value::Array(vec![]));
        let mut obj = serde_json::Map::new();
        obj.insert(
            "activeTabId".into(),
            r.active_tab_id.map(Value::String).unwrap_or(Value::Null),
        );
        obj.insert("tabs".into(), tabs);
        let mut sidebar = serde_json::Map::new();
        sidebar.insert("expanded".into(), sidebar_expanded);
        obj.insert("sidebar".into(), Value::Object(sidebar));
        obj.insert("closedTabHistory".into(), closed_tabs);
        by_conn
            .entry(r.connection_id)
            .or_default()
            .insert(r.db_name, Value::Object(obj));
    }

    Ok(WorkspacesStore {
        by_connection_id: by_conn,
    })
}

#[derive(Debug, sqlx::FromRow)]
struct WorkspaceRow {
    connection_id: String,
    db_name: String,
    active_tab_id: Option<String>,
    tabs_json: String,
    sidebar_expanded_json: String,
    closed_tabs_json: String,
}

async fn read_mru(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<MruStore, AppError> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT connection_id FROM mru ORDER BY last_used DESC")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read mru: {}", e)))?;
    let recent: Vec<String> = rows.into_iter().map(|(id,)| id).collect();
    let last_used_connection_id = recent.first().cloned();
    Ok(MruStore {
        recent_connections: recent,
        last_used_connection_id,
    })
}

async fn read_theme(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<ThemeStore, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'theme'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read theme: {}", e)))?;
    match row {
        Some((json,)) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(ThemeStore::default()),
    }
}

async fn read_safe_mode(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<SafeModeStore, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_json FROM settings WHERE key = 'safe_mode'")
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| AppError::Storage(format!("read safe_mode: {}", e)))?;
    match row {
        Some((json,)) => Ok(parse_safe_mode_value(&json)),
        None => Ok(SafeModeStore::default()),
    }
}

/// Boot-read backward compatibility (#1190). The frontend
/// `persistSettingValue("safe_mode", mode)` stores a bare JSON string
/// (`"warn"`), but the past/theoretical object wire (`{"mode":"warn"}`) must
/// also be absorbed. Try the bare string first (`SafeMode` absorbs
/// unrecognised values as warn via `#[serde(other)]`), then parse as an
/// object on failure. If both fail, `warn` fallback — consistent with the
/// #1113 enum policy.
fn parse_safe_mode_value(json: &str) -> SafeModeStore {
    if let Ok(mode) = serde_json::from_str::<SafeMode>(json) {
        return SafeModeStore { mode };
    }
    serde_json::from_str::<SafeModeStore>(json).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Tauri command wrapper — `tauri::Window` auto-injection +
// `AppState::connection_status` read. The pool is lazy-initialized in a
// `OnceCell`.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_initial_app_state(
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<InitialAppState, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let status_map = state.connection_status.lock().await.clone();
    let label = window.label().to_string();
    let mut snap = get_initial_app_state_inner(&pool, &label, &status_map).await?;
    // Carries whether boot auto-recovery happened to the frontend toast.
    // Read-and-reset via swap — the next boot cycle starts at false.
    snap.recovered = crate::storage::corrupt_recovery::DID_RECOVER
        .swap(false, std::sync::atomic::Ordering::SeqCst);
    // #2183 — carries the connections.json backup restore the same way. The
    // `read_connections` inside `_inner` above reads the file SOT (wallet
    // presence + TLS posture overlay), so by this swap point the restore has
    // already happened.
    snap.connections_restored_from_backup = crate::storage::CONNECTIONS_RESTORED_FROM_BACKUP
        .swap(false, std::sync::atomic::Ordering::SeqCst);
    Ok(snap)
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-16 — unit-level verification of the snapshot's default
    //! ctor + JSON serialization shape. The module's real integration
    //! verification lives in `tests/snapshot_*.rs` — because `cargo llvm-cov
    //! --lib` coverage does not include the integration tests, this module is
    //! the minimal unit smoke that keeps the `--lib` measurement's floor.
    //!
    //! Scenarios:
    //!   - Wire shape of the default values (theme = `"slate"` / `"system"`,
    //!     safe_mode = `"warn"`, runtime/workspaces empty)
    //!   - StoreSlot::Ok / Err `#[serde(untagged)]` round-trip
    //!   - WORKSPACE_LABEL_PREFIX strip logic (launcher → None, workspace-X → Some("X"))
    //!   - SNAPSHOT_VERSION monotonic increment
    //!   - InitialAppState camelCase serialization (schemaVersion / snapshotVersion / ...)
    //!
    //! Only pure-shape tests that need no pool — DB-touching scenarios are
    //! delegated to the integration tests.

    use crate::models::SslMode;

    use super::*;
    use serde_json::json;

    #[test]
    fn theme_store_default_is_slate_themeid_system_mode() {
        // Written 2026-05-16 — regression 2 (blank-theme boot).
        // The backend default must match the frontend `DEFAULT_THEME_ID`
        // ("slate"). If they diverge, an unknown `data-theme` selector sticks
        // on first boot, themes.css matching fails, and the visual styles
        // break.
        let t = ThemeStore::default();
        assert_eq!(t.theme_id, "slate");
        assert_eq!(t.mode, "system");
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["themeId"], "slate");
        assert_eq!(json["mode"], "system");
    }

    #[test]
    fn safe_mode_store_default_is_warn() {
        // Issue #1113 — the effective default for new installs. The old
        // default was "off" (the snapshot exposed it as the effective value
        // before frontend hydration), so on non-prod a DROP / WHERE-less
        // DELETE ran with no gate.
        let s = SafeModeStore::default();
        assert_eq!(s.mode, SafeMode::Warn);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["mode"], "warn");
    }

    #[test]
    fn safe_mode_deserializes_variants_and_falls_back_to_warn() {
        // Backward-compatibility lock (#1113) — 3-tier strings persisted in
        // existing SQLite deserialize unchanged, and unrecognised/legacy
        // values (the old "on" and similar) fall back to `warn`.
        // `SafeModeStore` is the object wire (`{"mode":"..."}`), so both the
        // struct level and the bare-enum level are checked.
        for (raw, expected) in [
            (r#"{"mode":"off"}"#, SafeMode::Off),
            (r#"{"mode":"warn"}"#, SafeMode::Warn),
            (r#"{"mode":"strict"}"#, SafeMode::Strict),
            // legacy / unrecognised → warn fallback.
            (r#"{"mode":"on"}"#, SafeMode::Warn),
            (r#"{"mode":"garbage"}"#, SafeMode::Warn),
        ] {
            let store: SafeModeStore = serde_json::from_str(raw).unwrap();
            assert_eq!(store.mode, expected, "store deserialize of {raw}");
        }
        // Round-trip: valid variants are identity under serialize → deserialize.
        for m in [SafeMode::Off, SafeMode::Warn, SafeMode::Strict] {
            let s = serde_json::to_string(&m).unwrap();
            assert_eq!(serde_json::from_str::<SafeMode>(&s).unwrap(), m);
        }
    }

    #[test]
    fn parse_safe_mode_value_accepts_bare_string_and_legacy_object() {
        // #1190 — boot-read backward compatibility. The frontend stores a
        // bare string, and the legacy/theoretical object wire is absorbed
        // too. Unrecognised values fall back to warn.
        for (raw, expected) in [
            // The shape the frontend actually stores — a bare JSON string.
            (r#""off""#, SafeMode::Off),
            (r#""warn""#, SafeMode::Warn),
            (r#""strict""#, SafeMode::Strict),
            // legacy object wire.
            (r#"{"mode":"off"}"#, SafeMode::Off),
            (r#"{"mode":"strict"}"#, SafeMode::Strict),
            // Unrecognised bare / object / fully malformed → warn fallback.
            (r#""garbage""#, SafeMode::Warn),
            (r#"{"mode":"on"}"#, SafeMode::Warn),
            (r#"not json"#, SafeMode::Warn),
        ] {
            assert_eq!(
                parse_safe_mode_value(raw).mode,
                expected,
                "parse_safe_mode_value({raw})"
            );
        }
    }

    #[test]
    fn workspaces_store_default_is_empty_by_connection_id() {
        let w = WorkspacesStore::default();
        assert!(w.by_connection_id.is_empty());
        let json = serde_json::to_value(&w).unwrap();
        assert_eq!(json["byConnectionId"], json!({}));
    }

    #[test]
    fn mru_store_default_is_empty_and_null_last_used() {
        let m = MruStore::default();
        assert!(m.recent_connections.is_empty());
        assert!(m.last_used_connection_id.is_none());
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["recentConnections"], json!([]));
        assert_eq!(json["lastUsedConnectionId"], serde_json::Value::Null);
    }

    #[test]
    fn store_slot_ok_serializes_as_inner_value() {
        let slot: StoreSlot<MruStore> = StoreSlot::Ok(MruStore::default());
        let json = serde_json::to_value(&slot).unwrap();
        // `untagged` enum — the Ok variant serializes as the inner value. No error key.
        assert!(!json.as_object().unwrap().contains_key("error"));
        assert!(json.as_object().unwrap().contains_key("recentConnections"));
    }

    #[test]
    fn store_slot_err_serializes_with_error_key() {
        let slot: StoreSlot<MruStore> = StoreSlot::Err {
            error: "table missing".into(),
        };
        let json = serde_json::to_value(&slot).unwrap();
        assert_eq!(json["error"], "table missing");
        assert!(!json.as_object().unwrap().contains_key("recentConnections"));
    }

    #[test]
    fn workspace_label_prefix_strip_for_launcher_returns_none() {
        // The launcher has no prefix, so the strip result is None.
        let label = "launcher";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert!(scope.is_none());
    }

    #[test]
    fn workspace_label_prefix_strip_for_workspace_returns_conn_id() {
        let label = "workspace-conn-42";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert_eq!(scope, Some("conn-42"));
    }

    #[test]
    fn workspace_label_prefix_strip_for_unknown_prefix_returns_none() {
        // A prefix other than workspace (e.g. "preview-...") → None → fallback to launcher.
        let label = "preview-foo";
        let scope = label.strip_prefix(WORKSPACE_LABEL_PREFIX);
        assert!(scope.is_none());
    }

    #[test]
    fn initial_app_state_serializes_with_camel_case_keys() {
        let s = InitialAppState {
            schema_version: 1,
            snapshot_version: 7,
            generated_at: 1_700_000_000_000,
            partial: false,
            recovered: false,
            connections_restored_from_backup: false,
            stores: Stores {
                connections: StoreSlot::Ok(ConnectionsStore {
                    items: vec![],
                    groups: vec![],
                }),
                workspaces: StoreSlot::Ok(WorkspacesStore::default()),
                mru: StoreSlot::Ok(MruStore::default()),
                theme: StoreSlot::Ok(ThemeStore::default()),
                safe_mode: StoreSlot::Ok(SafeModeStore::default()),
            },
            runtime: Runtime::default(),
        };
        let json = serde_json::to_value(&s).unwrap();
        let obj = json.as_object().unwrap();
        // camelCase top-level keys.
        for key in [
            "schemaVersion",
            "snapshotVersion",
            "generatedAt",
            "partial",
            "stores",
            "runtime",
        ] {
            assert!(obj.contains_key(key), "missing camelCase key `{}`", key);
        }
        // No snake_case leaks.
        for forbidden in [
            "schema_version",
            "snapshot_version",
            "generated_at",
            "safe_mode",
        ] {
            assert!(
                !obj.contains_key(forbidden),
                "snake_case `{}` leaked into wire",
                forbidden
            );
        }
        // stores' safeMode (camelCase).
        let stores = obj["stores"].as_object().unwrap();
        assert!(stores.contains_key("safeMode"));
        assert!(!stores.contains_key("safe_mode"));
        // runtime.activeStatuses (camelCase).
        let runtime = obj["runtime"].as_object().unwrap();
        assert!(runtime.contains_key("activeStatuses"));
    }

    #[test]
    fn snapshot_version_atomic_increments_monotonically() {
        // Checks SNAPSHOT_VERSION's monotonic guarantee directly at unit
        // level. The integration tests verify it via inner calls, but this
        // atomic's own round-trip is also explicitly locked — so that nothing
        // swaps in OrderInversion / Ordering::Relaxed.
        let v1 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        let v2 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        let v3 = SNAPSHOT_VERSION.fetch_add(1, Ordering::SeqCst);
        assert!(v2 > v1);
        assert!(v3 > v2);
    }

    #[test]
    fn runtime_default_has_empty_active_statuses() {
        let r = Runtime::default();
        assert!(r.active_statuses.is_empty());
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["activeStatuses"], json!({}));
    }

    // ----------------------------------------------------------------------
    // DB-touching inline tests — `cargo llvm-cov --lib` does not include the
    // integration tests, so the `read_*` helpers' coverage would be 0. The
    // integration tests cover these core scenarios with the pool, but some
    // happy paths are duplicated inline to keep the `--lib` measurement's
    // floor.
    // ----------------------------------------------------------------------

    use crate::storage::local;
    use serial_test::serial;
    use tempfile::TempDir;

    async fn pool_setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn inner_returns_default_shape_on_empty_db() {
        let (_dir, pool) = pool_setup().await;
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        assert_eq!(snap.schema_version, 1);
        assert!(!snap.partial);
        // schema_version=1 + monotonic snapshot_version > 0
        assert!(snap.snapshot_version > 0);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_workspace_scope_filters_to_one_connection() {
        let (_dir, pool) = pool_setup().await;
        // Seed two connection workspaces.
        for cid in ["conn-A", "conn-B"] {
            sqlx::query(
                "INSERT INTO workspaces(connection_id, db_name, active_tab_id, tabs_json, \
                 sidebar_expanded_json, closed_tabs_json, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(cid)
            .bind("db")
            .bind::<Option<String>>(None)
            .bind("[]")
            .bind("[]")
            .bind("[]")
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        }
        let snap = get_initial_app_state_inner(&pool, "workspace-conn-A", &HashMap::new())
            .await
            .unwrap();
        // launcher would give empty; workspace-conn-A only conn-A.
        if let StoreSlot::Ok(ws) = &snap.stores.workspaces {
            assert!(ws.by_connection_id.contains_key("conn-A"));
            assert!(!ws.by_connection_id.contains_key("conn-B"));
        } else {
            panic!("workspaces slot must be Ok");
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn persisted_workspace_round_trips_through_snapshot() {
        // #1091 shape guard — a `persist_workspace` UPSERT must read back
        // through `get_initial_app_state` into the exact `WorkspaceState`
        // shape the frontend store hydrates. Guards the #1190-class
        // camelCase / snake_case + string-vs-object drift at the boundary.
        use crate::commands::persist_workspace::{
            persist_workspace_inner, PersistWorkspaceRequest,
        };
        use crate::storage::meta::{set_legacy_import_state, LegacyImportState};

        let (_dir, pool) = pool_setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();

        persist_workspace_inner(
            &pool,
            PersistWorkspaceRequest {
                connection_id: "conn-A".into(),
                db_name: "dbA".into(),
                active_tab_id: Some("tab-2".into()),
                tabs_json: r#"[{"type":"table","id":"tab-1","table":"users"}]"#.into(),
                sidebar_expanded_json: r#"["public"]"#.into(),
                closed_tabs_json: r#"[{"type":"query","id":"query-1"}]"#.into(),
            },
        )
        .await
        .unwrap();

        let snap = get_initial_app_state_inner(&pool, "workspace-conn-A", &HashMap::new())
            .await
            .unwrap();
        let StoreSlot::Ok(ws) = &snap.stores.workspaces else {
            panic!("workspaces slot must be Ok");
        };
        let cell = &ws.by_connection_id["conn-A"]["dbA"];
        assert_eq!(cell["activeTabId"], json!("tab-2"));
        assert_eq!(
            cell["tabs"],
            json!([{"type":"table","id":"tab-1","table":"users"}])
        );
        assert_eq!(cell["sidebar"]["expanded"], json!(["public"]));
        assert_eq!(
            cell["closedTabHistory"],
            json!([{"type":"query","id":"query-1"}])
        );
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_reads_seeded_settings_for_theme_and_safe_mode() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("theme")
            .bind(r#"{"themeId":"monokai","mode":"light"}"#)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("safe_mode")
            .bind(r#"{"mode":"on"}"#)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.theme {
            StoreSlot::Ok(t) => {
                assert_eq!(t.theme_id, "monokai");
                assert_eq!(t.mode, "light");
            }
            StoreSlot::Err { error } => panic!("theme must read OK, got error={}", error),
        }
        match &snap.stores.safe_mode {
            // The seeded value "on" is a pre-3-tier legacy sentinel — warn fallback (#1113).
            StoreSlot::Ok(s) => assert_eq!(s.mode, SafeMode::Warn),
            StoreSlot::Err { error } => panic!("safe_mode must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_bare_string_safe_mode_respected_by_boot_read() {
        // #1190 regression — the frontend `persistSettingValue("safe_mode",
        // mode)` stores a bare JSON string (`"off"`) in value_json. The boot
        // read must absorb both the bare string and the legacy object
        // (`{"mode":...}`), and the persisted off must still be honored after
        // a restart (round-trip). This assertion failed before the #1190 fix
        // (it fell back to the default, warn, then).
        let (_dir, pool) = pool_setup().await;
        sqlx::query("INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("safe_mode")
            .bind(r#""off""#) // bare string — the shape the frontend actually stores
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.safe_mode {
            // The persisted bare-string off is honored in the boot snapshot (#1190 fix).
            StoreSlot::Ok(s) => assert_eq!(s.mode, SafeMode::Off),
            StoreSlot::Err { error } => panic!("safe_mode must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_reads_mru_in_last_used_desc_order() {
        let (_dir, pool) = pool_setup().await;
        for (id, ts) in [("c-1", 100i64), ("c-2", 500), ("c-3", 200)] {
            sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
                .bind(id)
                .bind(ts)
                .execute(&pool)
                .await
                .unwrap();
        }
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.mru {
            StoreSlot::Ok(m) => {
                assert_eq!(m.recent_connections, vec!["c-2", "c-3", "c-1"]);
                assert_eq!(m.last_used_connection_id.as_deref(), Some("c-2"));
            }
            StoreSlot::Err { error } => panic!("mru must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_partial_on_dropped_mru_table() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        assert!(snap.partial, "partial must be true when mru table missing");
        match &snap.stores.mru {
            StoreSlot::Err { error } => assert!(!error.is_empty()),
            StoreSlot::Ok(_) => panic!("mru slot must be Err"),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_returns_seeded_connection_in_items() {
        let (_dir, pool) = pool_setup().await;
        sqlx::query(
            "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
             sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("c-test")
        .bind("TestConn")
        .bind("mysql")
        .bind("localhost")
        .bind(3306i64)
        .bind("root")
        .bind("encrypted")
        .bind("test")
        .bind(0i64)
        .bind(1i64)
        .bind(1i64)
        .execute(&pool)
        .await
        .unwrap();
        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.connections {
            StoreSlot::Ok(c) => {
                assert_eq!(c.items.len(), 1);
                assert_eq!(c.items[0].id, "c-test");
                assert_eq!(c.items[0].name, "TestConn");
                assert!(
                    c.items[0].has_password,
                    "non-empty password_enc → has_password = true"
                );
            }
            StoreSlot::Err { error } => panic!("connections must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_derives_has_wallet_password_from_file_sot() {
        // Reason: #1669 review — the SQLite mirror never carries the Oracle
        // wallet password (it lives only in the connections.json SOT), so the
        // boot snapshot must derive has_wallet_password from that SOT (like
        // list_connections) rather than hardcode false. Previously a
        // wallet-secured connection read as unset on boot. (2026-07-17)
        use crate::models::{ConnectionConfig, DatabaseType};
        let (_dir, pool) = pool_setup().await;

        // File SOT: one connection with a wallet password, one without.
        let with_wallet = ConnectionConfig {
            id: "c-wallet".into(),
            name: "WalletConn".into(),
            db_type: DatabaseType::Oracle,
            host: "localhost".into(),
            port: 1521,
            user: "u".into(),
            password: String::new(),
            database: "XEPDB1".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        crate::storage::save_connection_with_wallet(
            with_wallet.clone(),
            None,
            Some("wallet-secret".into()),
        )
        .unwrap();
        let mut no_wallet = with_wallet;
        no_wallet.id = "c-plain".into();
        no_wallet.name = "PlainConn".into();
        crate::storage::save_connection_with_wallet(no_wallet, None, None).unwrap();

        // Mirror both ids into the SQLite snapshot store.
        for (idx, id) in ["c-wallet", "c-plain"].into_iter().enumerate() {
            sqlx::query(
                "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
                 sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(id)
            .bind("oracle")
            .bind("localhost")
            .bind(1521i64)
            .bind("u")
            .bind("")
            .bind("XEPDB1")
            .bind(idx as i64)
            .bind(1i64)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        }

        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.connections {
            StoreSlot::Ok(c) => {
                let wallet = c.items.iter().find(|i| i.id == "c-wallet").unwrap();
                let plain = c.items.iter().find(|i| i.id == "c-plain").unwrap();
                assert!(
                    wallet.has_wallet_password,
                    "wallet-secured connection must report has_wallet_password = true"
                );
                assert!(
                    !plain.has_wallet_password,
                    "connection without a wallet password must report false"
                );
            }
            StoreSlot::Err { error } => panic!("connections must read OK, got error={}", error),
        }
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_preserves_search_connection_types_from_storage() {
        use crate::models::{DatabaseType, Paradigm};

        let (_dir, pool) = pool_setup().await;
        for (idx, (id, db_type)) in [
            ("c-elastic", "elasticsearch"),
            ("c-opensearch", "opensearch"),
        ]
        .into_iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
                 sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(id)
            .bind(db_type)
            .bind("search.local")
            .bind(9200i64)
            .bind("")
            .bind("")
            .bind("")
            .bind(idx as i64)
            .bind(1i64)
            .bind(1i64)
            .execute(&pool)
            .await
            .unwrap();
        }

        let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
            .await
            .unwrap();
        match &snap.stores.connections {
            StoreSlot::Ok(c) => {
                assert_eq!(c.items.len(), 2);
                assert!(matches!(c.items[0].db_type, DatabaseType::Elasticsearch));
                assert_eq!(c.items[0].paradigm, Paradigm::Search);
                assert!(matches!(c.items[1].db_type, DatabaseType::Opensearch));
                assert_eq!(c.items[1].paradigm, Paradigm::Search);
            }
            StoreSlot::Err { error } => panic!("connections must read OK, got error={}", error),
        }
        pool_cleanup();
    }
}
