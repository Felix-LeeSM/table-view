use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{TableData, TableInfo};

#[tauri::command]
pub async fn list_schemas(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<crate::models::SchemaInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.list_schemas().await
}

#[tauri::command]
pub async fn list_tables(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.list_tables(&schema).await
}

#[tauri::command]
pub async fn get_table_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<crate::models::ColumnInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.get_table_columns(&table, &schema).await
}

#[tauri::command]
pub async fn query_table_data(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    page: Option<i32>,
    page_size: Option<i32>,
    order_by: Option<String>,
) -> Result<TableData, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter
        .query_table_data(
            &table,
            &schema,
            page.unwrap_or(1),
            page_size.unwrap_or(100),
            order_by.as_deref(),
        )
        .await
}
