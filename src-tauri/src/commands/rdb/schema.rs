//! RDB catalog introspection commands.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ColumnInfo, FunctionInfo, SchemaInfo, TableInfo, ViewInfo};

/// Lookup helper — returns `AppError::NotFound` when the id isn't connected.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

#[tauri::command]
pub async fn list_schemas(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<SchemaInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    let namespaces = active.as_rdb()?.list_namespaces().await?;
    // NamespaceInfo and SchemaInfo share the same `{ name }` wire shape, so
    // mapping here preserves the payload exactly.
    Ok(namespaces
        .into_iter()
        .map(|n| SchemaInfo { name: n.name })
        .collect())
}

#[tauri::command]
pub async fn list_tables(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.list_tables(&schema).await
}

#[tauri::command]
pub async fn get_table_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.get_columns(&schema, &table).await
}

#[tauri::command]
pub async fn list_schema_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.list_schema_columns(&schema).await
}

#[tauri::command]
pub async fn get_table_indexes(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.get_table_indexes(&schema, &table).await
}

#[tauri::command]
pub async fn get_table_constraints(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_rdb()?
        .get_table_constraints(&schema, &table)
        .await
}

#[tauri::command]
pub async fn list_views(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<ViewInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.list_views(&schema).await
}

#[tauri::command]
pub async fn list_functions(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<FunctionInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.list_functions(&schema).await
}

#[tauri::command]
pub async fn get_view_definition(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_rdb()?
        .get_view_definition(&schema, &view_name)
        .await
}

#[tauri::command]
pub async fn get_view_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active.as_rdb()?.get_view_columns(&schema, &view_name).await
}

#[tauri::command]
pub async fn get_function_source(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    function_name: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_rdb()?
        .get_function_source(&schema, &function_name)
        .await
}
