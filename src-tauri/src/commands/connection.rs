use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::db::mongodb::MongoAdapter;
use crate::db::postgres::PostgresAdapter;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use crate::models::{
    ConnectionConfig, ConnectionConfigPublic, ConnectionGroup, ConnectionStatus, DatabaseType,
};
use crate::storage;

/// Build an `ActiveAdapter` for the given database type.
///
/// Sprint 65 adds MongoDB dispatch on top of Sprint 64's Postgres wiring.
/// MySQL/SQLite still map to `AppError::Unsupported` pending Phase 9.
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
        DatabaseType::Mongodb => Ok(ActiveAdapter::Document(Box::new(MongoAdapter::new()))),
        other => Err(AppError::Unsupported(format!(
            "Database type {:?} is not supported yet",
            other
        ))),
    }
}

/// Request body for `save_connection`. Splitting `password` from the
/// `ConnectionConfigPublic` body lets the frontend express three distinct
/// intents:
/// - `password = None`     → preserve existing stored password
/// - `password = Some("")` → explicitly clear the stored password
/// - `password = Some(s)`  → set a new password
#[derive(Debug, Deserialize)]
pub struct SaveConnectionRequest {
    pub connection: ConnectionConfigPublic,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub is_new: Option<bool>,
}

/// Request body for `test_connection`. `password` follows the same three-way
/// semantics as `SaveConnectionRequest`. When `existing_id` is supplied and
/// `password` is `None`, the backend looks up the stored password without
/// ever exposing it to the caller.
#[derive(Debug, Deserialize)]
pub struct TestConnectionRequest {
    pub config: ConnectionConfigPublic,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub existing_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct StatusChangeEvent {
    id: String,
    status: ConnectionStatus,
}

pub struct AppState {
    /// Active adapter handles keyed by `ConnectionConfig::id`.
    ///
    /// Sprint 64 replaces the previous `HashMap<_, PostgresAdapter>` with an
    /// `ActiveAdapter` enum so the same map can hold relational, document,
    /// search, or kv adapters. Command handlers dispatch through
    /// `ActiveAdapter::as_rdb()?` / `as_document()?` / … to regain a typed
    /// reference.
    pub active_connections: Mutex<HashMap<String, ActiveAdapter>>,
    pub connection_status: Mutex<HashMap<String, ConnectionStatus>>,
    pub keep_alive_handles: Mutex<HashMap<String, JoinHandle<()>>>,
    pub query_tokens: Mutex<HashMap<String, CancellationToken>>,
    /// Session-scoped UUID generated once per app process. Shared by all
    /// windows so they can agree on which localStorage entries are "current
    /// session" vs stale from a previous run.
    pub session_id: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
            keep_alive_handles: Mutex::new(HashMap::new()),
            query_tokens: Mutex::new(HashMap::new()),
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Sprint 175 — captured once on the very first `get_session_id` call. The
/// delta `rust:first-ipc - rust:entry` is the "Tauri startup overhead" line
/// item in `docs/sprints/sprint-175/baseline.md`. `OnceLock::set` returns
/// `Ok(())` only on the first call, guaranteeing the `info!` line is emitted
/// exactly once regardless of how many windows race to invoke this command.
static FIRST_IPC_INSTANT: OnceLock<Instant> = OnceLock::new();

/// Return the process-scoped session UUID. Both launcher and workspace windows
/// receive the same value, which the frontend uses to tag localStorage entries
/// so stale data from a previous app run is automatically ignored.
#[tauri::command]
pub async fn get_session_id(state: tauri::State<'_, AppState>) -> Result<String, AppError> {
    // Sprint 175 — `rust:first-ipc`. `set` is atomic and returns `Ok(())`
    // only on the first call across all threads/windows; later invocations
    // see `Err(_)` and skip the log emission. The delta is computed against
    // `crate::BOOT_T0` (set in `lib.rs::run()`) when available; if the
    // static is not yet populated we still emit the literal token so the
    // log scraper never sees a silent gap.
    let now = Instant::now();
    if FIRST_IPC_INSTANT.set(now).is_ok() {
        let delta_ms = crate::BOOT_T0
            .get()
            .map(|t0| now.duration_since(*t0).as_secs_f64() * 1000.0);
        info!(
            target: "boot",
            "rust:first-ipc cmd=get_session_id delta_ms={:?}",
            delta_ms,
        );
    }
    Ok(state.session_id.clone())
}

/// Background task: periodically ping the connection and auto-reconnect on failure.
async fn keep_alive_loop(
    app: tauri::AppHandle,
    conn_id: String,
    interval_secs: u64,
    config: ConnectionConfig,
) {
    let mut consecutive_failures = 0u32;
    let max_retries = 3u32;

    loop {
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;

        // Ping check — dispatch through the paradigm-neutral lifecycle trait.
        let ping_ok = {
            let state = app.state::<AppState>();
            let connections = state.active_connections.lock().await;
            match connections.get(&conn_id) {
                Some(adapter) => adapter.lifecycle().ping().await.is_ok(),
                None => return, // Adapter removed — task should stop
            }
        };

        if ping_ok {
            consecutive_failures = 0;
            continue;
        }

        warn!(conn_id = %conn_id, "Keep-alive ping failed");

        // Set error status
        let error_status = ConnectionStatus::Error("Connection lost".into());
        {
            let state = app.state::<AppState>();
            let mut status = state.connection_status.lock().await;
            status.insert(conn_id.clone(), error_status.clone());
        }
        let _ = app.emit(
            "connection-status-changed",
            StatusChangeEvent {
                id: conn_id.clone(),
                status: error_status,
            },
        );

        // Attempt reconnect with exponential backoff
        consecutive_failures += 1;
        if consecutive_failures > max_retries {
            warn!(
                conn_id = %conn_id,
                retries = max_retries,
                "Max reconnection attempts reached"
            );
            return; // Stop keep-alive task
        }

        let backoff = Duration::from_secs(2u64.pow(consecutive_failures - 1));
        info!(
            conn_id = %conn_id,
            attempt = consecutive_failures,
            backoff_secs = backoff.as_secs(),
            "Attempting reconnection"
        );
        tokio::time::sleep(backoff).await;

        // Try reconnect — rebuild via the factory so adapter paradigm tracks
        // `DatabaseType` changes instead of being hard-coded here.
        let new_adapter = match make_adapter(&config.db_type) {
            Ok(a) => a,
            Err(e) => {
                warn!(
                    conn_id = %conn_id,
                    error = %e,
                    "Reconnection aborted: adapter factory rejected db_type"
                );
                return;
            }
        };
        match new_adapter.lifecycle().connect(&config).await {
            Ok(()) => {
                info!(conn_id = %conn_id, "Reconnected successfully");
                let state = app.state::<AppState>();
                {
                    let mut connections = state.active_connections.lock().await;
                    connections.insert(conn_id.clone(), new_adapter);
                }
                {
                    let mut status = state.connection_status.lock().await;
                    status.insert(conn_id.clone(), ConnectionStatus::Connected);
                }
                let _ = app.emit(
                    "connection-status-changed",
                    StatusChangeEvent {
                        id: conn_id.clone(),
                        status: ConnectionStatus::Connected,
                    },
                );
                consecutive_failures = 0;
            }
            Err(e) => {
                warn!(conn_id = %conn_id, error = %e, "Reconnection failed");
                let err_status = ConnectionStatus::Error(format!("Reconnection failed: {}", e));
                let state = app.state::<AppState>();
                let mut status = state.connection_status.lock().await;
                status.insert(conn_id.clone(), err_status.clone());
                let _ = app.emit(
                    "connection-status-changed",
                    StatusChangeEvent {
                        id: conn_id.clone(),
                        status: err_status,
                    },
                );
            }
        }
    }
}

#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionConfigPublic>, AppError> {
    let data = storage::load_storage_redacted()?;
    let presence = storage::password_presence_map()?;
    Ok(data
        .connections
        .iter()
        .map(|c| {
            let mut p: ConnectionConfigPublic = c.into();
            // load_storage_redacted clears passwords, so derive has_password
            // from the presence map instead of the (now-empty) field.
            p.has_password = *presence.get(&c.id).unwrap_or(&false);
            p
        })
        .collect())
}

#[tauri::command]
pub fn save_connection(req: SaveConnectionRequest) -> Result<ConnectionConfigPublic, AppError> {
    if req.connection.name.trim().is_empty() {
        return Err(AppError::Validation("Connection name is required".into()));
    }
    if req.connection.host.trim().is_empty() {
        return Err(AppError::Validation("Host is required".into()));
    }

    let mut conn = req.connection.into_config_with_empty_password();
    if req.is_new.unwrap_or(false) {
        conn.id = uuid::Uuid::new_v4().to_string();
    }

    let new_password = req.password.clone();
    storage::save_connection(conn.clone(), new_password)?;

    let presence = storage::password_presence_map()?;
    let mut public = ConnectionConfigPublic::from(&conn);
    public.has_password = *presence.get(&conn.id).unwrap_or(&false);
    Ok(public)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<(), AppError> {
    storage::delete_connection(&id)
}

#[tauri::command]
pub async fn test_connection(req: TestConnectionRequest) -> Result<String, AppError> {
    let TestConnectionRequest {
        config,
        password,
        existing_id,
    } = req;

    // Resolve which plaintext password to use for the test.
    let resolved_password: String = match password {
        Some(s) => s,
        None => match existing_id.as_deref() {
            Some(id) => storage::get_decrypted_password(id)?.unwrap_or_default(),
            None => String::new(),
        },
    };

    let mut full = config.into_config_with_empty_password();
    full.password = resolved_password;

    match full.db_type {
        DatabaseType::Postgresql => {
            PostgresAdapter::test(&full).await?;
        }
        other => {
            return Err(AppError::Unsupported(format!(
                "Database type {:?} is not supported yet",
                other
            )));
        }
    }
    Ok("Connection successful".into())
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let data = storage::load_storage_with_secrets()?;
    let config = data
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Connection '{}' not found", id)))?;

    let adapter = make_adapter(&config.db_type)?;
    adapter.lifecycle().connect(&config).await?;

    // Abort any previous keep-alive task for this connection
    {
        let mut handles = state.keep_alive_handles.lock().await;
        if let Some(old_handle) = handles.remove(&id) {
            old_handle.abort();
        }
    }

    {
        let mut connections = state.active_connections.lock().await;
        connections.insert(id.clone(), adapter);
    }
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id.clone(), ConnectionStatus::Connected);
    }

    // Start keep-alive background task
    let keep_alive_interval = config.keep_alive_interval.unwrap_or(30) as u64;
    let handle = tokio::spawn(keep_alive_loop(
        app,
        id.clone(),
        keep_alive_interval,
        config,
    ));
    {
        let mut handles = state.keep_alive_handles.lock().await;
        handles.insert(id, handle);
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    // Cancel keep-alive task
    {
        let mut handles = state.keep_alive_handles.lock().await;
        if let Some(handle) = handles.remove(&id) {
            handle.abort();
        }
    }

    let adapter = {
        let mut connections = state.active_connections.lock().await;
        connections.remove(&id)
    };
    if let Some(adapter) = adapter {
        adapter.lifecycle().disconnect().await?;
    }
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id, ConnectionStatus::Disconnected);
    }
    Ok(())
}

#[tauri::command]
pub fn list_groups() -> Result<Vec<ConnectionGroup>, AppError> {
    let data = storage::load_storage_redacted()?;
    Ok(data.groups)
}

#[tauri::command]
pub fn save_group(
    group: ConnectionGroup,
    is_new: Option<bool>,
) -> Result<ConnectionGroup, AppError> {
    if group.name.trim().is_empty() {
        return Err(AppError::Validation("Group name is required".into()));
    }

    let grp = if is_new.unwrap_or(false) {
        let mut new_group = group;
        new_group.id = uuid::Uuid::new_v4().to_string();
        new_group
    } else {
        group
    };

    storage::save_group(grp.clone())?;
    Ok(grp)
}

#[tauri::command]
pub fn delete_group(id: String) -> Result<(), AppError> {
    storage::delete_group(&id)
}

#[tauri::command]
pub fn move_connection_to_group(
    connection_id: String,
    group_id: Option<String>,
) -> Result<(), AppError> {
    storage::move_connection_to_group(&connection_id, group_id.as_deref())
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

const EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPayload {
    pub schema_version: u32,
    /// Unix epoch seconds of the export. Useful for back-dating a backup
    /// without pulling in a date-time crate just for serialization.
    pub exported_at_unix_secs: u64,
    pub app: String,
    pub connections: Vec<ConnectionConfigPublic>,
    pub groups: Vec<ConnectionGroup>,
}

#[derive(Debug, Serialize)]
pub struct RenamedEntry {
    pub original_name: String,
    pub new_name: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ImportResult {
    pub imported: Vec<String>,
    pub renamed: Vec<RenamedEntry>,
    pub created_groups: Vec<String>,
    pub skipped_groups: Vec<String>,
}

/// Export the requested connections (and any groups they reference) as a
/// portable JSON string. Passwords are NEVER included — neither plaintext
/// nor ciphertext. The receiving side must re-enter passwords on import.
#[tauri::command]
pub fn export_connections(ids: Vec<String>) -> Result<String, AppError> {
    let data = storage::load_storage_redacted()?;
    let presence = storage::password_presence_map()?;

    // Filter connections by ids (empty = all)
    let conns: Vec<&ConnectionConfig> = if ids.is_empty() {
        data.connections.iter().collect()
    } else {
        let id_set: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
        data.connections
            .iter()
            .filter(|c| id_set.contains(c.id.as_str()))
            .collect()
    };

    // Collect referenced groups
    let referenced_group_ids: std::collections::HashSet<&str> =
        conns.iter().filter_map(|c| c.group_id.as_deref()).collect();
    let groups: Vec<ConnectionGroup> = data
        .groups
        .iter()
        .filter(|g| referenced_group_ids.contains(g.id.as_str()))
        .cloned()
        .collect();

    let publics: Vec<ConnectionConfigPublic> = conns
        .into_iter()
        .map(|c| {
            let mut p: ConnectionConfigPublic = c.into();
            p.has_password = *presence.get(&c.id).unwrap_or(&false);
            p
        })
        .collect();

    let exported_at_unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = ExportPayload {
        schema_version: EXPORT_SCHEMA_VERSION,
        exported_at_unix_secs,
        app: "table-view".into(),
        connections: publics,
        groups,
    };

    serde_json::to_string_pretty(&payload).map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Sprint 140 — encrypted export / import (master-password envelope)
// ---------------------------------------------------------------------------

/// Minimum length the master password must satisfy to be accepted by the
/// encrypted export path. Empty / shorter passwords are rejected at the
/// command boundary so the KDF is never invoked with trivially-weak input.
const MASTER_PASSWORD_MIN_LEN: usize = 8;

/// Export the requested connections wrapped in a password-derived
/// `EncryptedEnvelope`. The plaintext body is identical to the value
/// `export_connections` would produce — `aead_encrypt_with_password` simply
/// wraps it. Returns the envelope serialised as pretty JSON.
#[tauri::command]
pub fn export_connections_encrypted(
    ids: Vec<String>,
    master_password: String,
) -> Result<String, AppError> {
    if master_password.len() < MASTER_PASSWORD_MIN_LEN {
        return Err(AppError::Validation(format!(
            "Master password must be at least {} characters",
            MASTER_PASSWORD_MIN_LEN
        )));
    }

    let plain_json = export_connections(ids)?;
    let envelope = storage::crypto::aead_encrypt_with_password(&plain_json, &master_password)?;
    serde_json::to_string_pretty(&envelope).map_err(AppError::from)
}

/// Import connections from either an encrypted envelope or a plain
/// `ExportPayload` JSON. Envelope detection is purely structural: when
/// `payload` parses as an `EncryptedEnvelope`, the master password is
/// required and the ciphertext is decrypted; otherwise the call falls
/// through to the existing plain-JSON `import_connections` path so older
/// (or unencrypted) backups remain importable. Wrong password collapses to
/// the canonical `INCORRECT_MASTER_PASSWORD_MESSAGE`.
#[tauri::command]
pub fn import_connections_encrypted(
    payload: String,
    master_password: String,
) -> Result<ImportResult, AppError> {
    // Heuristic: an envelope JSON has a `kdf` field. Anything else routes
    // to the plain-JSON path. We try a strict envelope parse and only
    // accept it when the `kdf` field is present so a payload that
    // happens to deserialize loosely (e.g. via #[serde(default)]) does
    // not accidentally short-circuit the plain-JSON branch.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
        if value.get("kdf").is_some() && value.get("ciphertext").is_some() {
            let envelope: storage::crypto::EncryptedEnvelope = serde_json::from_str(&payload)
                .map_err(|e| AppError::Validation(format!("Invalid envelope JSON: {}", e)))?;
            let plain_json =
                storage::crypto::aead_decrypt_with_password(&envelope, &master_password)?;
            return import_connections(plain_json);
        }
    }

    // Plain-JSON fallback — backward compatibility with existing exports.
    import_connections(payload)
}

/// Import connections from a JSON payload produced by `export_connections`.
/// All imported connections start with no password — the user must re-enter
/// each one before connecting.
#[tauri::command]
pub fn import_connections(json: String) -> Result<ImportResult, AppError> {
    let payload: ExportPayload = serde_json::from_str(&json)
        .map_err(|e| AppError::Validation(format!("Invalid import JSON: {}", e)))?;

    if payload.schema_version != EXPORT_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "Unsupported export schema version {} (expected {})",
            payload.schema_version, EXPORT_SCHEMA_VERSION
        )));
    }

    let mut result = ImportResult::default();

    // Build set of existing names + group ids
    let existing = storage::load_storage_redacted()?;
    let mut existing_conn_names: std::collections::HashSet<String> = existing
        .connections
        .iter()
        .map(|c| c.name.clone())
        .collect();
    let existing_group_ids: std::collections::HashSet<String> =
        existing.groups.iter().map(|g| g.id.clone()).collect();

    // Group id remapping (payload group id → final stored group id)
    let mut group_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // Process groups: keep id when it doesn't collide, otherwise reuse the
    // existing group with that id (treat as the same group).
    for grp in &payload.groups {
        if existing_group_ids.contains(&grp.id) {
            group_id_map.insert(grp.id.clone(), grp.id.clone());
        } else {
            storage::save_group(grp.clone())?;
            group_id_map.insert(grp.id.clone(), grp.id.clone());
            result.created_groups.push(grp.id.clone());
        }
    }

    // Process connections
    for conn in &payload.connections {
        // Always regenerate id to avoid collisions with the receiving store
        let new_id = uuid::Uuid::new_v4().to_string();

        // Resolve target group_id: prefer mapping from payload groups, else
        // existing group with same id, else drop the reference and report.
        let target_group_id = match conn.group_id.as_deref() {
            None => None,
            Some(gid) => {
                if let Some(mapped) = group_id_map.get(gid) {
                    Some(mapped.clone())
                } else if existing_group_ids.contains(gid) {
                    Some(gid.to_string())
                } else {
                    result.skipped_groups.push(conn.name.clone());
                    None
                }
            }
        };

        // Auto-rename on name collision
        let mut final_name = conn.name.clone();
        if existing_conn_names.contains(&final_name) {
            let original = final_name.clone();
            let mut candidate = format!("{} (imported)", original);
            let mut suffix = 2u32;
            while existing_conn_names.contains(&candidate) {
                candidate = format!("{} (imported {})", original, suffix);
                suffix += 1;
            }
            result.renamed.push(RenamedEntry {
                original_name: original,
                new_name: candidate.clone(),
            });
            final_name = candidate;
        }
        existing_conn_names.insert(final_name.clone());

        let stored = ConnectionConfig {
            id: new_id.clone(),
            name: final_name,
            db_type: conn.db_type.clone(),
            host: conn.host.clone(),
            port: conn.port,
            user: conn.user.clone(),
            password: String::new(), // never imported
            database: conn.database.clone(),
            group_id: target_group_id,
            color: conn.color.clone(),
            connection_timeout: conn.connection_timeout,
            keep_alive_interval: conn.keep_alive_interval,
            environment: conn.environment.clone(),
            auth_source: conn.auth_source.clone(),
            replica_set: conn.replica_set.clone(),
            tls_enabled: conn.tls_enabled,
        };

        // Save with explicit empty password (no preserve / no encrypt)
        storage::save_connection(stored, Some(String::new()))?;
        result.imported.push(new_id);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
    use serial_test::serial;
    use tempfile::TempDir;

    fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.to_string(),
            name: name.to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "secret".to_string(),
            database: "testdb".to_string(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    /// Test helper: invoke the `save_connection` Tauri command with a
    /// pre-existing `ConnectionConfig`. Treats `conn.password` as the new
    /// password (matching the historical single-arg `save_connection` shape).
    fn save_via_command(
        conn: ConnectionConfig,
        is_new: Option<bool>,
    ) -> Result<ConnectionConfigPublic, AppError> {
        let password = Some(conn.password.clone());
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&conn),
            password,
            is_new,
        };
        save_connection(req)
    }

    fn load_storage() -> Result<crate::models::StorageData, AppError> {
        storage::load_storage_with_secrets()
    }

    /// Test helper: invoke storage::save_connection treating conn.password as
    /// the new plaintext (matches old single-arg behavior).
    fn storage_save_conn(conn: ConnectionConfig) -> Result<(), AppError> {
        let pw = Some(conn.password.clone());
        storage::save_connection(conn, pw)
    }

    fn sample_group(id: &str, name: &str) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
            collapsed: false,
        }
    }

    // AC-11: save_connection validates empty name and empty host
    #[test]
    fn test_save_connection_rejects_empty_name() {
        let conn = sample_connection("c1", "");
        let result = save_via_command(conn.clone(), None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("name is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_connection_rejects_whitespace_name() {
        let conn = sample_connection("c1", "   ");
        let result = save_via_command(conn, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_save_connection_rejects_empty_host() {
        let mut conn = sample_connection("c1", "MyDB");
        conn.host = String::new();
        let result = save_via_command(conn, None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Host is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_connection_rejects_whitespace_host() {
        let mut conn = sample_connection("c1", "MyDB");
        conn.host = "   ".to_string();
        let result = save_via_command(conn, None);
        assert!(result.is_err());
    }

    // AC-12: save_connection with is_new=true generates UUID
    #[test]
    #[serial]
    fn test_save_connection_generates_uuid_when_is_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("placeholder-id", "MyDB");
        let result = save_via_command(conn, Some(true)).unwrap();

        // UUID should differ from the placeholder id
        assert_ne!(result.id, "placeholder-id");
        // UUID should be a valid v4 format (36 chars with dashes)
        assert_eq!(result.id.len(), 36);
        assert!(result.id.contains('-'));

        // The saved connection should be loadable with the new UUID
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, result.id);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_not_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_via_command(conn, Some(false)).unwrap();

        assert_eq!(result.id, "my-custom-id");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_is_new_is_none() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_via_command(conn, None).unwrap();

        assert_eq!(result.id, "my-custom-id");

        cleanup_test_env();
    }

    // AC-13: list_groups returns groups from storage
    #[test]
    #[serial]
    fn test_list_groups_returns_from_storage() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Production")).unwrap();
        storage::save_group(sample_group("g2", "Development")).unwrap();

        let groups = list_groups().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].id, "g1");
        assert_eq!(groups[0].name, "Production");
        assert_eq!(groups[1].id, "g2");
        assert_eq!(groups[1].name, "Development");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_list_groups_returns_empty_when_no_groups() {
        let _dir = setup_test_env();

        let groups = list_groups().unwrap();
        assert!(groups.is_empty());

        cleanup_test_env();
    }

    // AC-14: save_group validates empty name
    #[test]
    fn test_save_group_rejects_empty_name() {
        let group = sample_group("g1", "");
        let result = save_group(group, None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Group name is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_group_rejects_whitespace_name() {
        let group = sample_group("g1", "   ");
        let result = save_group(group, None);
        assert!(result.is_err());
    }

    #[test]
    #[serial]
    fn test_save_group_generates_uuid_when_is_new() {
        let _dir = setup_test_env();

        let group = sample_group("placeholder-id", "MyGroup");
        let result = save_group(group, Some(true)).unwrap();

        assert_ne!(result.id, "placeholder-id");
        assert_eq!(result.id.len(), 36);
        assert!(result.id.contains('-'));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_list_connections_returns_from_storage() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        storage_save_conn(sample_connection("c2", "DB2")).unwrap();

        let connections = list_connections().unwrap();
        assert_eq!(connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_connection_command_removes_connection() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        delete_connection("c1".to_string()).unwrap();

        let loaded = load_storage().unwrap();
        assert!(loaded.connections.is_empty());

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_group_command_removes_group() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        delete_group("g1".to_string()).unwrap();

        let loaded = load_storage().unwrap();
        assert!(loaded.groups.is_empty());

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // Password security regression tests (Phase B)
    // -------------------------------------------------------------------

    /// list_connections must NEVER include the plaintext password in the
    /// payload sent to the frontend, even when the password is stored.
    #[test]
    #[serial]
    fn test_list_connections_omits_plaintext_password() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "Sup3r!7".to_string();
        storage_save_conn(conn).unwrap();

        let publics = list_connections().unwrap();
        assert_eq!(publics.len(), 1);
        assert!(publics[0].has_password);

        // Serialize the wire format and assert the secret is not present
        let json = serde_json::to_string(&publics).unwrap();
        assert!(
            !json.contains("Sup3r!7"),
            "Plaintext password leaked into list_connections payload: {}",
            json
        );
        assert!(
            !json.contains("\"password\""),
            "Public payload must not include any 'password' field: {}",
            json
        );

        cleanup_test_env();
    }

    /// save_connection with `password = None` must preserve the existing
    /// stored password rather than clearing it.
    #[test]
    #[serial]
    fn test_save_connection_password_none_preserves_existing() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "origpw".into();
        storage_save_conn(conn).unwrap();

        // Now "edit" the connection without sending a new password
        let updated = sample_connection("c1", "DB1 edited");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&updated),
            password: None,
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        // The decrypted password should still be the original
        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("origpw".to_string()));

        cleanup_test_env();
    }

    /// `password = Some("")` must explicitly clear the stored password.
    #[test]
    #[serial]
    fn test_save_connection_password_empty_string_clears() {
        let _dir = setup_test_dir_inner();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "before".into();
        storage_save_conn(conn).unwrap();

        let stub = sample_connection("c1", "DB1");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&stub),
            password: Some(String::new()),
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some(String::new()));

        let publics = list_connections().unwrap();
        assert!(!publics[0].has_password);

        cleanup_test_env();
    }

    /// `password = Some(s)` must replace the stored password.
    #[test]
    #[serial]
    fn test_save_connection_password_some_replaces() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "old".into();
        storage_save_conn(conn).unwrap();

        let stub = sample_connection("c1", "DB1");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&stub),
            password: Some("brand-new".into()),
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("brand-new".to_string()));

        cleanup_test_env();
    }

    /// test_connection without an explicit password must look up the stored
    /// one when `existing_id` is supplied (so the dialog can run a test
    /// without the user re-typing the password).
    #[tokio::test]
    #[serial]
    async fn test_test_connection_uses_stored_password_when_omitted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "lkpme".into();
        // Use a host that won't resolve so the test fails fast at the network
        // step — we only care whether the password resolution path ran.
        conn.host = "definitely-not-a-real-host.invalid".into();
        storage_save_conn(conn.clone()).unwrap();

        // Send no password, but supply existing_id. Storage lookup should
        // succeed; then the postgres adapter will fail to actually connect,
        // which is fine — the assertion is that get_decrypted_password ran.
        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: None,
            existing_id: Some("c1".into()),
        };
        let result = test_connection(req).await;
        // We expect a connection error (host doesn't resolve), NOT a missing
        // password error. The mere fact that we got past the password lookup
        // is what's being verified.
        assert!(
            result.is_err(),
            "Expected connection failure to invalid host"
        );

        // Sanity: stored password is still intact and decryptable
        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("lkpme".to_string()));

        cleanup_test_env();
    }

    fn setup_test_dir_inner() -> tempfile::TempDir {
        setup_test_env()
    }

    // -------------------------------------------------------------------
    // Export / Import (Phase C)
    // -------------------------------------------------------------------

    /// Export must contain neither plaintext nor ciphertext password data.
    #[test]
    #[serial]
    fn test_export_connections_omits_password_field() {
        let _dir = setup_test_env();

        let plaintext = "P!ainSecret";
        let mut conn = sample_connection("c1", "DB1");
        conn.password = plaintext.into();
        storage_save_conn(conn).unwrap();

        // Capture the on-disk ciphertext to assert it is also absent.
        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        let raw_json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let ciphertext = raw_json["connections"][0]["password"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!ciphertext.is_empty(), "Ciphertext should exist on disk");

        let exported = export_connections(vec![]).unwrap();
        assert!(
            !exported.contains(plaintext),
            "Exported JSON must not contain plaintext password"
        );
        assert!(
            !exported.contains(&ciphertext),
            "Exported JSON must not contain on-disk ciphertext"
        );
        // Public payload field that signals presence is fine
        assert!(exported.contains("\"has_password\": true"));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_includes_referenced_groups() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g-prod", "Production")).unwrap();
        let mut conn = sample_connection("c1", "DB1");
        conn.group_id = Some("g-prod".to_string());
        storage_save_conn(conn).unwrap();

        // Add a second group with no connection — must NOT appear in export
        storage::save_group(sample_group("g-unused", "Unused")).unwrap();

        let exported = export_connections(vec!["c1".into()]).unwrap();
        let payload: ExportPayload = serde_json::from_str(&exported).unwrap();
        assert_eq!(payload.groups.len(), 1);
        assert_eq!(payload.groups[0].id, "g-prod");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_regenerates_uuids() {
        let _dir = setup_test_env();

        // Create a payload that already has fixed connection ids
        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "fixed-id".into(),
                name: "Imported".into(),
                db_type: DatabaseType::Postgresql,
                host: "localhost".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r1 = import_connections(json.clone()).unwrap();
        let r2 = import_connections(json).unwrap();

        // Both imports succeed and produce different new ids
        assert_eq!(r1.imported.len(), 1);
        assert_eq!(r2.imported.len(), 1);
        assert_ne!(r1.imported[0], r2.imported[0]);
        // Storage holds two distinct connections
        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_auto_renames_on_name_collision() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "MyDB")).unwrap();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "MyDB".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.renamed.len(), 1);
        assert_eq!(r.renamed[0].original_name, "MyDB");
        assert!(r.renamed[0].new_name.contains("(imported"));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_drops_unknown_group_reference() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "Lonely".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                group_id: Some("g-missing".into()),
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![], // group_id refers to nothing
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.skipped_groups, vec!["Lonely".to_string()]);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 1);
        assert_eq!(stored.connections[0].group_id, None);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_creates_new_groups_when_absent() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "InGrp".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                group_id: Some("g-new".into()),
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![ConnectionGroup {
                id: "g-new".into(),
                name: "Brand New".into(),
                color: None,
                collapsed: false,
            }],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.created_groups, vec!["g-new".to_string()]);

        let stored = storage::load_storage_redacted().unwrap();
        assert!(stored.groups.iter().any(|g| g.id == "g-new"));
        assert_eq!(stored.connections[0].group_id, Some("g-new".to_string()));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_round_trip() {
        let _dir = setup_test_env();

        // Seed with two connections, one in a group with a password
        storage::save_group(sample_group("g1", "G1")).unwrap();
        let mut c1 = sample_connection("c1", "DB1");
        c1.password = "h@s_pw".into();
        c1.group_id = Some("g1".into());
        storage_save_conn(c1).unwrap();

        let mut c2 = sample_connection("c2", "DB2");
        c2.password = String::new();
        storage_save_conn(c2).unwrap();

        let exported = export_connections(vec![]).unwrap();

        // Reset storage by deleting everything
        storage::delete_connection("c1").unwrap();
        storage::delete_connection("c2").unwrap();
        storage::delete_group("g1").unwrap();

        let r = import_connections(exported).unwrap();
        assert_eq!(r.imported.len(), 2);
        // No password should be set on any imported connection
        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);
        for c in &stored.connections {
            let pw = storage::get_decrypted_password(&c.id).unwrap();
            assert_eq!(pw, Some(String::new()), "Imported password must be empty");
        }

        cleanup_test_env();
    }

    #[test]
    fn test_import_connections_rejects_invalid_schema_version() {
        let bad = serde_json::json!({
            "schema_version": 99,
            "exported_at_unix_secs": 0,
            "app": "table-view",
            "connections": [],
            "groups": []
        })
        .to_string();
        let result = import_connections(bad);
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    #[serial]
    fn test_move_connection_to_group_command() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        storage_save_conn(sample_connection("c1", "DB1")).unwrap();

        move_connection_to_group("c1".to_string(), Some("g1".to_string())).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // make_adapter factory tests (Sprint 65)
    // -------------------------------------------------------------------

    #[test]
    fn test_make_adapter_postgres_returns_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Postgresql).expect("postgres should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Postgresql));
    }

    #[test]
    fn test_make_adapter_mongodb_returns_document_variant() {
        let adapter = make_adapter(&DatabaseType::Mongodb).expect("mongodb should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Document(_)),
            "expected Document variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Mongodb));
    }

    #[test]
    fn test_make_adapter_mysql_returns_unsupported() {
        match make_adapter(&DatabaseType::Mysql) {
            Err(AppError::Unsupported(msg)) => {
                assert!(msg.contains("Mysql"), "unexpected message: {msg}");
            }
            other => panic!("expected Unsupported, got: {:?}", other.is_ok()),
        }
    }

    #[test]
    fn test_make_adapter_sqlite_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Sqlite),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn test_make_adapter_redis_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Redis),
            Err(AppError::Unsupported(_))
        ));
    }

    // -------------------------------------------------------------------
    // Sprint 140 — encrypted export / import command tests
    // -------------------------------------------------------------------

    #[test]
    #[serial]
    fn test_export_connections_encrypted_round_trip() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "G1")).unwrap();
        let mut c1 = sample_connection("c1", "DB1");
        c1.password = "p@ss1".into();
        c1.group_id = Some("g1".into());
        storage_save_conn(c1).unwrap();

        let mut c2 = sample_connection("c2", "DB2");
        c2.password = String::new();
        storage_save_conn(c2).unwrap();

        let envelope_json = export_connections_encrypted(vec![], "open-sesame!".into()).unwrap();
        // Envelope shape sanity (locked schema)
        assert!(envelope_json.contains("\"v\": 1"));
        assert!(envelope_json.contains("\"kdf\": \"argon2id\""));
        assert!(envelope_json.contains("\"alg\": \"aes-256-gcm\""));
        assert!(envelope_json.contains("\"tag_attached\": true"));
        // Plaintext payload must not leak through ciphertext
        assert!(!envelope_json.contains("DB1"));
        assert!(!envelope_json.contains("DB2"));

        // Reset storage and import via the encrypted path
        storage::delete_connection("c1").unwrap();
        storage::delete_connection("c2").unwrap();
        storage::delete_group("g1").unwrap();

        let r = import_connections_encrypted(envelope_json, "open-sesame!".into()).unwrap();
        assert_eq!(r.imported.len(), 2);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_encrypted_rejects_short_password() {
        let _dir = setup_test_env();

        let err = export_connections_encrypted(vec![], "abc".into()).unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("at least 8 characters")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_encrypted_rejects_empty_password() {
        let _dir = setup_test_env();

        let err = export_connections_encrypted(vec![], String::new()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_encrypted_wrong_password_rejected() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        let envelope_json = export_connections_encrypted(vec![], "real-pass-1".into()).unwrap();

        let err = import_connections_encrypted(envelope_json, "wrong-pass-2".into()).unwrap_err();
        match err {
            AppError::Encryption(msg) => {
                assert_eq!(msg, storage::crypto::INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    /// Plain JSON pass-through: when the payload is not an envelope, the
    /// command falls back to the existing `import_connections` flow and
    /// the master password is ignored. This guards backward compatibility
    /// with older exports.
    #[test]
    #[serial]
    fn test_import_connections_encrypted_plain_json_pass_through() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "PlainImport".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![],
        };
        let plain_json = serde_json::to_string(&payload).unwrap();

        // Empty password is fine for plain-JSON fallback path.
        let r = import_connections_encrypted(plain_json, String::new()).unwrap();
        assert_eq!(r.imported.len(), 1);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 1);
        assert_eq!(stored.connections[0].name, "PlainImport");

        cleanup_test_env();
    }

    /// Schema version round-trip — a v1 payload encrypted to an envelope
    /// then decrypted must yield the same `schema_version`.
    #[test]
    #[serial]
    fn test_import_connections_encrypted_preserves_schema_version() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        let envelope_json = export_connections_encrypted(vec![], "another-pass".into()).unwrap();

        // Re-clear storage and import — the decrypted body must still
        // carry schema_version=1 to be accepted by import_connections.
        storage::delete_connection("c1").unwrap();
        let r = import_connections_encrypted(envelope_json, "another-pass".into()).unwrap();
        assert_eq!(r.imported.len(), 1);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_encrypted_invalid_envelope_json() {
        let _dir = setup_test_env();

        // Looks like an envelope (has kdf/ciphertext) but base64 garbage.
        let bad = serde_json::json!({
            "v": 1,
            "kdf": "argon2id",
            "m_cost": 19456,
            "t_cost": 2,
            "p_cost": 1,
            "salt": "AAAA",
            "nonce": "AAAA",
            "alg": "aes-256-gcm",
            "ciphertext": "AAAA",
            "tag_attached": true
        })
        .to_string();
        let err = import_connections_encrypted(bad, "any-pass-12".into()).unwrap_err();
        match err {
            AppError::Encryption(msg) => {
                assert_eq!(msg, storage::crypto::INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }

        cleanup_test_env();
    }
}
