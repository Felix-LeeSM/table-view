use crate::commands::connection::AppState;
use crate::commands::{not_connected, register_cancel_token, release_cancel_token};
use crate::db::{
    KvCommandRequest, KvDatabaseInfo, KvDeleteRequest, KvKeyScanPage, KvKeyScanRequest,
    KvMutationResult, KvSetStringRequest, KvStreamReadRequest, KvStreamReadResult,
    KvTtlUpdateRequest, KvValueEnvelope, KvValueReadRequest, RdbQueryResult,
};
use crate::error::AppError;
use crate::models::ConnectionStatus;

async fn list_kv_databases_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<KvDatabaseInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_kv()?.list_databases().await
}

#[tauri::command]
pub async fn list_kv_databases(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<KvDatabaseInfo>, AppError> {
    list_kv_databases_inner(state.inner(), &connection_id).await
}

async fn current_kv_database_inner(state: &AppState, connection_id: &str) -> Result<u16, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    Ok(active.as_kv()?.current_database().await?.unwrap_or(0))
}

#[tauri::command]
pub async fn current_kv_database(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<u16, AppError> {
    current_kv_database_inner(state.inner(), &connection_id).await
}

async fn switch_kv_database_inner(
    state: &AppState,
    connection_id: &str,
    database: u16,
) -> Result<u16, AppError> {
    {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active.as_kv()?.switch_database(database).await?;
    }
    {
        let mut statuses = state.connection_status.lock().await;
        statuses.insert(
            connection_id.to_string(),
            ConnectionStatus::Connected {
                active_db: Some(database.to_string()),
            },
        );
    }
    Ok(database)
}

#[tauri::command]
pub async fn switch_kv_database(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: u16,
) -> Result<u16, AppError> {
    switch_kv_database_inner(state.inner(), &connection_id, database).await
}

async fn scan_kv_keys_inner(
    state: &AppState,
    connection_id: &str,
    request: KvKeyScanRequest,
    query_id: Option<&str>,
) -> Result<KvKeyScanPage, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_kv()?
            .scan_keys(request, cancel_handle.as_ref().map(|(_, token)| token))
            .await
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn scan_kv_keys(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvKeyScanRequest,
    query_id: Option<String>,
) -> Result<KvKeyScanPage, AppError> {
    scan_kv_keys_inner(state.inner(), &connection_id, request, query_id.as_deref()).await
}

async fn get_kv_value_inner(
    state: &AppState,
    connection_id: &str,
    request: KvValueReadRequest,
    query_id: Option<&str>,
) -> Result<KvValueEnvelope, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_kv()?
            .read_value(request, cancel_handle.as_ref().map(|(_, token)| token))
            .await
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn get_kv_value(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvValueReadRequest,
    query_id: Option<String>,
) -> Result<KvValueEnvelope, AppError> {
    get_kv_value_inner(state.inner(), &connection_id, request, query_id.as_deref()).await
}

async fn execute_kv_command_inner(
    state: &AppState,
    connection_id: &str,
    request: KvCommandRequest,
    query_id: Option<&str>,
) -> Result<RdbQueryResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_kv()?
            .execute_command(request, cancel_handle.as_ref().map(|(_, token)| token))
            .await
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn execute_kv_command(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvCommandRequest,
    query_id: Option<String>,
) -> Result<RdbQueryResult, AppError> {
    execute_kv_command_inner(state.inner(), &connection_id, request, query_id.as_deref()).await
}

async fn set_kv_string_value_inner(
    state: &AppState,
    connection_id: &str,
    request: KvSetStringRequest,
) -> Result<KvMutationResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_kv()?.set_string(request).await
}

#[tauri::command]
pub async fn set_kv_string_value(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvSetStringRequest,
) -> Result<KvMutationResult, AppError> {
    set_kv_string_value_inner(state.inner(), &connection_id, request).await
}

async fn delete_kv_key_inner(
    state: &AppState,
    connection_id: &str,
    request: KvDeleteRequest,
) -> Result<KvMutationResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_kv()?.delete_key(request).await
}

#[tauri::command]
pub async fn delete_kv_key(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvDeleteRequest,
) -> Result<KvMutationResult, AppError> {
    delete_kv_key_inner(state.inner(), &connection_id, request).await
}

async fn update_kv_ttl_inner(
    state: &AppState,
    connection_id: &str,
    request: KvTtlUpdateRequest,
) -> Result<KvMutationResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_kv()?.update_ttl(request).await
}

#[tauri::command]
pub async fn update_kv_ttl(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvTtlUpdateRequest,
) -> Result<KvMutationResult, AppError> {
    update_kv_ttl_inner(state.inner(), &connection_id, request).await
}

async fn read_kv_stream_inner(
    state: &AppState,
    connection_id: &str,
    request: KvStreamReadRequest,
    query_id: Option<&str>,
) -> Result<KvStreamReadResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_kv()?
            .read_stream(request, cancel_handle.as_ref().map(|(_, token)| token))
            .await
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn read_kv_stream(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: KvStreamReadRequest,
    query_id: Option<String>,
) -> Result<KvStreamReadResult, AppError> {
    read_kv_stream_inner(state.inner(), &connection_id, request, query_id.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testing::StubKvAdapter;
    use crate::db::{ActiveAdapter, KvTtlUpdate, KvWriteSafety};
    use crate::models::DatabaseType;

    async fn kv_state() -> AppState {
        let state = AppState::new();
        state.active_connections.lock().await.insert(
            "kv".into(),
            ActiveAdapter::Kv(Box::new(StubKvAdapter {
                kind_value: DatabaseType::Redis,
            })),
        );
        state
    }

    fn scan_request() -> KvKeyScanRequest {
        KvKeyScanRequest {
            database: Some(0),
            cursor: None,
            pattern: Some("*".into()),
            limit: Some(10),
        }
    }

    fn value_request() -> KvValueReadRequest {
        KvValueReadRequest {
            key: "session:1".into(),
            database: Some(0),
            limit: Some(10),
            cursor: None,
        }
    }

    #[tokio::test]
    async fn kv_command_inners_dispatch_to_kv_adapter_contract() {
        let state = kv_state().await;

        assert!(matches!(
            list_kv_databases_inner(&state, "kv").await,
            Err(AppError::Unsupported(_))
        ));
        assert_eq!(current_kv_database_inner(&state, "kv").await.unwrap(), 0);
        assert!(matches!(
            switch_kv_database_inner(&state, "kv", 1).await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            scan_kv_keys_inner(&state, "kv", scan_request(), Some("scan")).await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            get_kv_value_inner(&state, "kv", value_request(), Some("read")).await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            execute_kv_command_inner(
                &state,
                "kv",
                KvCommandRequest {
                    command: "GET session:1".into(),
                    database: Some(0),
                },
                Some("command"),
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            set_kv_string_value_inner(
                &state,
                "kv",
                KvSetStringRequest {
                    key: "session:1".into(),
                    value: "ok".into(),
                    database: Some(0),
                    ttl_seconds: None,
                    safety: KvWriteSafety::RejectOverwrite,
                },
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            delete_kv_key_inner(
                &state,
                "kv",
                KvDeleteRequest {
                    key: "session:1".into(),
                    database: Some(0),
                    confirm_key: "session:1".into(),
                },
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            update_kv_ttl_inner(
                &state,
                "kv",
                KvTtlUpdateRequest {
                    key: "session:1".into(),
                    database: Some(0),
                    update: KvTtlUpdate::Persist {
                        confirm_key: "session:1".into(),
                    },
                },
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            read_kv_stream_inner(
                &state,
                "kv",
                KvStreamReadRequest {
                    key: "events".into(),
                    database: Some(0),
                    start: None,
                    end: None,
                    limit: Some(10),
                },
                Some("stream"),
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
        assert!(state.query_tokens.lock().await.is_empty());
    }

    #[tokio::test]
    async fn unknown_kv_connection_returns_not_found() {
        let state = AppState::new();
        assert!(matches!(
            list_kv_databases_inner(&state, "missing").await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            current_kv_database_inner(&state, "missing").await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            switch_kv_database_inner(&state, "missing", 1).await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            scan_kv_keys_inner(&state, "missing", scan_request(), Some("q")).await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            get_kv_value_inner(&state, "missing", value_request(), Some("q")).await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            execute_kv_command_inner(
                &state,
                "missing",
                KvCommandRequest {
                    command: "GET session:1".into(),
                    database: Some(0),
                },
                Some("q"),
            )
            .await,
            Err(AppError::NotFound(_))
        ));
        assert!(state.query_tokens.lock().await.is_empty());
    }
}
