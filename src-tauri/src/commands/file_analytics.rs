use tauri::State;
use tracing::info;

use crate::commands::connection::AppState;
use crate::commands::not_connected;
use crate::error::AppError;
use crate::models::{
    DatabaseType, FileAnalyticsPreview, FileAnalyticsQueryResponse, FileAnalyticsSource,
    FileAnalyticsSourceMetadata,
};

fn validate_connection_id(connection_id: &str) -> Result<(), AppError> {
    if connection_id.trim().is_empty() {
        return Err(AppError::Validation("Connection ID cannot be empty".into()));
    }
    Ok(())
}

fn ensure_duckdb(db_type: DatabaseType) -> Result<(), AppError> {
    if matches!(db_type, DatabaseType::Duckdb) {
        Ok(())
    } else {
        Err(AppError::Unsupported(
            "DuckDB file analytics requires a DuckDB connection".into(),
        ))
    }
}

pub(crate) async fn register_file_analytics_source_inner(
    state: &AppState,
    connection_id: &str,
    path: &str,
) -> Result<FileAnalyticsSource, AppError> {
    info!(
        connection_id = %connection_id,
        path_len = path.len(),
        "Registering DuckDB file analytics source"
    );
    validate_connection_id(connection_id)?;
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    ensure_duckdb(active.kind())?;
    active.as_rdb()?.register_file_analytics_source(path).await
}

pub(crate) async fn preview_file_analytics_source_inner(
    state: &AppState,
    connection_id: &str,
    source_id: &str,
    limit: Option<u32>,
) -> Result<FileAnalyticsPreview, AppError> {
    info!(
        connection_id = %connection_id,
        source_id = %source_id,
        "Previewing DuckDB file analytics source"
    );
    validate_connection_id(connection_id)?;
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    ensure_duckdb(active.kind())?;
    active
        .as_rdb()?
        .preview_file_analytics_source(source_id, limit)
        .await
}

pub(crate) async fn list_file_analytics_source_metadata_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<FileAnalyticsSourceMetadata>, AppError> {
    info!(
        connection_id = %connection_id,
        "Listing DuckDB file analytics source metadata"
    );
    validate_connection_id(connection_id)?;
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    ensure_duckdb(active.kind())?;
    active.as_rdb()?.list_file_analytics_source_metadata().await
}

pub(crate) async fn clear_file_analytics_sources_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<(), AppError> {
    info!(
        connection_id = %connection_id,
        "Clearing DuckDB file analytics sources"
    );
    validate_connection_id(connection_id)?;
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    ensure_duckdb(active.kind())?;
    active.as_rdb()?.clear_file_analytics_sources().await
}

pub(crate) async fn execute_file_analytics_query_inner(
    state: &AppState,
    connection_id: &str,
    source_id: &str,
    sql: &str,
) -> Result<FileAnalyticsQueryResponse, AppError> {
    info!(
        connection_id = %connection_id,
        source_id = %source_id,
        sql_len = sql.len(),
        "Executing DuckDB file analytics query"
    );
    validate_connection_id(connection_id)?;
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    ensure_duckdb(active.kind())?;
    active
        .as_rdb()?
        .execute_file_analytics_query(source_id, sql)
        .await
}

#[tauri::command]
pub async fn duckdb_register_file_analytics_source(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<FileAnalyticsSource, AppError> {
    register_file_analytics_source_inner(state.inner(), &connection_id, &path).await
}

#[tauri::command]
pub async fn duckdb_preview_file_analytics_source(
    state: State<'_, AppState>,
    connection_id: String,
    source_id: String,
    limit: Option<u32>,
) -> Result<FileAnalyticsPreview, AppError> {
    preview_file_analytics_source_inner(state.inner(), &connection_id, &source_id, limit).await
}

#[tauri::command]
pub async fn duckdb_list_file_analytics_source_metadata(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<FileAnalyticsSourceMetadata>, AppError> {
    list_file_analytics_source_metadata_inner(state.inner(), &connection_id).await
}

#[tauri::command]
pub async fn duckdb_clear_file_analytics_sources(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    clear_file_analytics_sources_inner(state.inner(), &connection_id).await
}

#[tauri::command]
pub async fn duckdb_execute_file_analytics_query(
    state: State<'_, AppState>,
    connection_id: String,
    source_id: String,
    sql: String,
) -> Result<FileAnalyticsQueryResponse, AppError> {
    execute_file_analytics_query_inner(state.inner(), &connection_id, &source_id, &sql).await
}
