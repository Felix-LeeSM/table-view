use std::collections::HashMap;
use tokio::sync::Mutex;

use crate::db::postgres::PostgresAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionGroup, ConnectionStatus};
use crate::storage;

pub struct AppState {
    pub active_connections: Mutex<HashMap<String, PostgresAdapter>>,
    pub connection_status: Mutex<HashMap<String, ConnectionStatus>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
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
pub async fn connect(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    let data = storage::load_storage()?;
    let config = data
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Connection '{}' not found", id)))?;

    let adapter = PostgresAdapter::new();
    adapter.connect_pool(&config).await?;

    {
        let mut connections = state.active_connections.lock().await;
        connections.insert(id.clone(), adapter);
    }
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id, ConnectionStatus::Connected);
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
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
