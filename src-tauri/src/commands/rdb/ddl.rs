//! RDB schema-mutating commands (DDL).
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, CreateIndexRequest, DropConstraintRequest,
    DropIndexRequest, SchemaChangeResult,
};

fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

#[tauri::command]
pub async fn drop_table(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.drop_table(&schema, &table).await
}

#[tauri::command]
pub async fn rename_table(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    new_name: String,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_rdb()?
        .rename_table(&schema, &table, &new_name)
        .await
}

#[tauri::command]
pub async fn alter_table(
    state: tauri::State<'_, AppState>,
    request: AlterTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.alter_table(&request).await
}

#[tauri::command]
pub async fn create_index(
    state: tauri::State<'_, AppState>,
    request: CreateIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.create_index(&request).await
}

#[tauri::command]
pub async fn drop_index(
    state: tauri::State<'_, AppState>,
    request: DropIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_index(&request).await
}

#[tauri::command]
pub async fn add_constraint(
    state: tauri::State<'_, AppState>,
    request: AddConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.add_constraint(&request).await
}

#[tauri::command]
pub async fn drop_constraint(
    state: tauri::State<'_, AppState>,
    request: DropConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_constraint(&request).await
}
