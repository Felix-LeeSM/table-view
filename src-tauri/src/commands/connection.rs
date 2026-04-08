use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
            keep_alive_handles: Mutex::new(HashMap::new()),
        }
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
