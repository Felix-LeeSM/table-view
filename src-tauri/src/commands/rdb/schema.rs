//! RDB catalog introspection commands.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ColumnInfo, FunctionInfo, SchemaInfo, TableInfo, ViewInfo};

/// Sprint 180 (AC-180-04) — register an optional cancel-token for the
/// duration of a schema-introspection call so the existing `cancel_query`
/// command can abort the in-flight work via the shared `query_tokens`
/// registry. Mirrors the pattern at `commands/rdb/query.rs:73-81`.
async fn register_cancel_token(
    state: &tauri::State<'_, AppState>,
    query_id: &Option<String>,
) -> Option<(String, CancellationToken)> {
    if let Some(qid) = query_id.as_ref() {
        let token = CancellationToken::new();
        let stored = token.clone();
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert(qid.clone(), stored);
        }
        Some((qid.clone(), token))
    } else {
        None
    }
}

async fn release_cancel_token(
    state: &tauri::State<'_, AppState>,
    cancel_handle: &Option<(String, CancellationToken)>,
) {
    if let Some((qid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(qid);
    }
}

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
    // Sprint 180 (AC-180-04): optional cancel-token id. Frontend can
    // pass a unique id and call `cancel_query(query_id)` to abort.
    query_id: Option<String>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_rdb()?
            .get_columns(&schema, &table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
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
    // Sprint 180 (AC-180-04): optional cancel-token id (see get_table_columns).
    query_id: Option<String>,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_rdb()?
            .get_table_indexes(&schema, &table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn get_table_constraints(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    // Sprint 180 (AC-180-04): optional cancel-token id (see get_table_columns).
    query_id: Option<String>,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_rdb()?
            .get_table_constraints(&schema, &table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
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
