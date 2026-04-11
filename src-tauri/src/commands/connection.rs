use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::db::postgres::PostgresAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionGroup, ConnectionStatus};
use crate::storage;

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
pub fn list_connections() -> Result<Vec<ConnectionConfig>, AppError> {
    let data = storage::load_storage()?;
    Ok(data.connections)
}

#[tauri::command]
pub fn save_connection(
    connection: ConnectionConfig,
    is_new: Option<bool>,
) -> Result<ConnectionConfig, AppError> {
    if connection.name.trim().is_empty() {
        return Err(AppError::Validation("Connection name is required".into()));
    }
    if connection.host.trim().is_empty() {
        return Err(AppError::Validation("Host is required".into()));
    }

    let conn = if is_new.unwrap_or(false) {
        let mut new_conn = connection;
        new_conn.id = uuid::Uuid::new_v4().to_string();
        new_conn
    } else {
        connection
    };

    storage::save_connection(conn.clone())?;
    Ok(conn)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<(), AppError> {
    storage::delete_connection(&id)
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, AppError> {
    match config.db_type {
        crate::models::DatabaseType::Postgresql => {
            PostgresAdapter::test(&config).await?;
        }
        _ => {
            return Err(AppError::Validation(format!(
                "Unsupported database type: {:?}",
                config.db_type
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
    let data = storage::load_storage()?;
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
    let data = storage::load_storage()?;
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
        }
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
        let result = save_connection(conn.clone(), None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("name is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_connection_rejects_whitespace_name() {
        let conn = sample_connection("c1", "   ");
        let result = save_connection(conn, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_save_connection_rejects_empty_host() {
        let mut conn = sample_connection("c1", "MyDB");
        conn.host = String::new();
        let result = save_connection(conn, None);
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
        let result = save_connection(conn, None);
        assert!(result.is_err());
    }

    // AC-12: save_connection with is_new=true generates UUID
    #[test]
    #[serial]
    fn test_save_connection_generates_uuid_when_is_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("placeholder-id", "MyDB");
        let result = save_connection(conn, Some(true)).unwrap();

        // UUID should differ from the placeholder id
        assert_ne!(result.id, "placeholder-id");
        // UUID should be a valid v4 format (36 chars with dashes)
        assert_eq!(result.id.len(), 36);
        assert!(result.id.contains('-'));

        // The saved connection should be loadable with the new UUID
        let loaded = storage::load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, result.id);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_not_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_connection(conn, Some(false)).unwrap();

        assert_eq!(result.id, "my-custom-id");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_is_new_is_none() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_connection(conn, None).unwrap();

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

        storage::save_connection(sample_connection("c1", "DB1")).unwrap();
        storage::save_connection(sample_connection("c2", "DB2")).unwrap();

        let connections = list_connections().unwrap();
        assert_eq!(connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_connection_command_removes_connection() {
        let _dir = setup_test_env();

        storage::save_connection(sample_connection("c1", "DB1")).unwrap();
        delete_connection("c1".to_string()).unwrap();

        let loaded = storage::load_storage().unwrap();
        assert!(loaded.connections.is_empty());

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_group_command_removes_group() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        delete_group("g1".to_string()).unwrap();

        let loaded = storage::load_storage().unwrap();
        assert!(loaded.groups.is_empty());

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_move_connection_to_group_command() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        storage::save_connection(sample_connection("c1", "DB1")).unwrap();

        move_connection_to_group("c1".to_string(), Some("g1".to_string())).unwrap();

        let loaded = storage::load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        cleanup_test_env();
    }
}
