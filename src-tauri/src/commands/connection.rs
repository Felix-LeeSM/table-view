use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::db::postgres::PostgresAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionConfigPublic, ConnectionGroup, ConnectionStatus};
use crate::storage;

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
    pub active_connections: Mutex<HashMap<String, PostgresAdapter>>,
    pub connection_status: Mutex<HashMap<String, ConnectionStatus>>,
    pub keep_alive_handles: Mutex<HashMap<String, JoinHandle<()>>>,
    pub query_tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
            keep_alive_handles: Mutex::new(HashMap::new()),
            query_tokens: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
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

        // Ping check
        let ping_ok = {
            let state = app.state::<AppState>();
            let connections = state.active_connections.lock().await;
            match connections.get(&conn_id) {
                Some(adapter) => adapter.ping().await.is_ok(),
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

        // Try reconnect
        let new_adapter = PostgresAdapter::new();
        match new_adapter.connect_pool(&config).await {
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
        crate::models::DatabaseType::Postgresql => {
            PostgresAdapter::test(&full).await?;
        }
        _ => {
            return Err(AppError::Validation(format!(
                "Unsupported database type: {:?}",
                full.db_type
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

    let adapter = PostgresAdapter::new();
    adapter.connect_pool(&config).await?;

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
        adapter.disconnect_pool().await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
    use serial_test::serial;
    use tempfile::TempDir;

    fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VIEWTABLE_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
        std::env::remove_var("VIEWTABLE_TEST_DATA_DIR");
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
}
