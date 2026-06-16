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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ActiveAdapter, DbAdapter, DuckdbAdapter, PostgresAdapter};
    use crate::models::ConnectionConfig;
    use std::fs;

    fn duckdb_config(path: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: "duckdb".into(),
            name: "DuckDB".into(),
            db_type: DatabaseType::Duckdb,
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: path.into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    fn assert_validation(result: Result<impl Sized, AppError>) {
        assert!(matches!(
            result,
            Err(AppError::Validation(message)) if message.contains("Connection ID")
        ));
    }

    fn assert_not_connected(result: Result<impl Sized, AppError>) {
        assert!(matches!(
            result,
            Err(AppError::NotFound(message)) if message.contains("missing")
        ));
    }

    fn assert_duckdb_required(result: Result<impl Sized, AppError>) {
        assert!(matches!(
            result,
            Err(AppError::Unsupported(message))
                if message.contains("DuckDB file analytics requires a DuckDB connection")
        ));
    }

    #[tokio::test]
    async fn file_analytics_commands_reject_empty_connection_id_before_lookup() {
        let state = AppState::default();

        assert_validation(register_file_analytics_source_inner(&state, " ", "/tmp/data.csv").await);
        assert_validation(preview_file_analytics_source_inner(&state, " ", "src", Some(1)).await);
        assert_validation(list_file_analytics_source_metadata_inner(&state, " ").await);
        assert_validation(clear_file_analytics_sources_inner(&state, " ").await);
        assert_validation(
            execute_file_analytics_query_inner(&state, " ", "src", "SELECT * FROM src").await,
        );
    }

    #[tokio::test]
    async fn file_analytics_commands_fail_closed_when_connection_is_missing() {
        let state = AppState::default();

        assert_not_connected(
            register_file_analytics_source_inner(&state, "missing", "/tmp/data.csv").await,
        );
        assert_not_connected(
            preview_file_analytics_source_inner(&state, "missing", "src", Some(1)).await,
        );
        assert_not_connected(list_file_analytics_source_metadata_inner(&state, "missing").await);
        assert_not_connected(clear_file_analytics_sources_inner(&state, "missing").await);
        assert_not_connected(
            execute_file_analytics_query_inner(&state, "missing", "src", "SELECT * FROM src").await,
        );
    }

    #[tokio::test]
    async fn file_analytics_commands_require_duckdb_active_connection() {
        let state = AppState::default();
        state.active_connections.lock().await.insert(
            "postgres".into(),
            ActiveAdapter::Rdb(Box::new(PostgresAdapter::new())),
        );

        assert_duckdb_required(
            register_file_analytics_source_inner(&state, "postgres", "/tmp/data.csv").await,
        );
        assert_duckdb_required(
            preview_file_analytics_source_inner(&state, "postgres", "src", Some(1)).await,
        );
        assert_duckdb_required(list_file_analytics_source_metadata_inner(&state, "postgres").await);
        assert_duckdb_required(clear_file_analytics_sources_inner(&state, "postgres").await);
        assert_duckdb_required(
            execute_file_analytics_query_inner(&state, "postgres", "src", "SELECT * FROM src")
                .await,
        );
    }

    #[tokio::test]
    async fn file_analytics_commands_dispatch_to_duckdb_adapter() {
        let state = AppState::default();
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("fixture.duckdb");
        duckdb::Connection::open(&db_path).unwrap();
        let adapter = DuckdbAdapter::new();
        adapter
            .connect(&duckdb_config(db_path.to_str().unwrap()))
            .await
            .unwrap();
        state
            .active_connections
            .lock()
            .await
            .insert("duckdb".into(), ActiveAdapter::Rdb(Box::new(adapter)));
        let csv_path = dir.path().join("users.csv");
        fs::write(&csv_path, "id,name\n1,Ada\n2,Grace\n").unwrap();

        let source =
            register_file_analytics_source_inner(&state, "duckdb", csv_path.to_str().unwrap())
                .await
                .unwrap();
        let preview = preview_file_analytics_source_inner(&state, "duckdb", &source.id, Some(1))
            .await
            .unwrap();
        assert_eq!(preview.result.rows.len(), 1);

        let metadata = list_file_analytics_source_metadata_inner(&state, "duckdb")
            .await
            .unwrap();
        assert_eq!(metadata.len(), 1);

        let response = execute_file_analytics_query_inner(
            &state,
            "duckdb",
            &source.id,
            &format!("SELECT COUNT(*) AS total FROM \"{}\"", source.alias),
        )
        .await
        .unwrap();
        assert_eq!(response.result.rows[0][0], serde_json::json!(2));

        clear_file_analytics_sources_inner(&state, "duckdb")
            .await
            .unwrap();
        assert!(list_file_analytics_source_metadata_inner(&state, "duckdb")
            .await
            .unwrap()
            .is_empty());
    }
}
