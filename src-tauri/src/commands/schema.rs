use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, CreateIndexRequest, DropConstraintRequest,
    DropIndexRequest, FilterCondition, FunctionInfo, SchemaChangeResult, TableData, TableInfo,
    ViewInfo,
};

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
#[allow(clippy::too_many_arguments)]
pub async fn query_table_data(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    page: Option<i32>,
    page_size: Option<i32>,
    order_by: Option<String>,
    filters: Option<Vec<FilterCondition>>,
    raw_where: Option<String>,
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
            filters.as_deref(),
            raw_where.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn get_table_indexes(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.get_table_indexes(&table, &schema).await
}

#[tauri::command]
pub async fn get_table_constraints(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.get_table_constraints(&table, &schema).await
}

#[tauri::command]
pub async fn drop_table(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.drop_table(&table, &schema).await
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
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.rename_table(&table, &schema, &new_name).await
}

#[tauri::command]
pub async fn alter_table(
    state: tauri::State<'_, AppState>,
    request: AlterTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&request.connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.alter_table(&request).await
}

#[tauri::command]
pub async fn create_index(
    state: tauri::State<'_, AppState>,
    request: CreateIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&request.connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.create_index(&request).await
}

#[tauri::command]
pub async fn drop_index(
    state: tauri::State<'_, AppState>,
    request: DropIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&request.connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.drop_index(&request).await
}

#[tauri::command]
pub async fn add_constraint(
    state: tauri::State<'_, AppState>,
    request: AddConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&request.connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.add_constraint(&request).await
}

#[tauri::command]
pub async fn drop_constraint(
    state: tauri::State<'_, AppState>,
    request: DropConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&request.connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.drop_constraint(&request).await
}

#[tauri::command]
pub async fn list_views(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<ViewInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.list_views(&schema).await
}

#[tauri::command]
pub async fn list_functions(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<FunctionInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.list_functions(&schema).await
}

#[tauri::command]
pub async fn get_view_definition(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.get_view_definition(&schema, &view_name).await
}

#[tauri::command]
pub async fn get_function_source(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    function_name: String,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let adapter = connections
        .get(&connection_id)
        .ok_or_else(|| AppError::Connection("Not connected".into()))?;
    adapter.get_function_source(&schema, &function_name).await
}
