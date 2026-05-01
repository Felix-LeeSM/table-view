//! Document paradigm — catalog/browse commands (Sprint 66).
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_document()?` so that non-document connections fail
//! cleanly with `AppError::Unsupported` before any concrete method is
//! invoked. This mirrors the pattern established for RDB commands in
//! `commands/rdb/schema.rs`.

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ColumnInfo, TableInfo};

/// Sprint 180 (AC-180-04) — cancel-token registration helper, mirrors
/// the RDB schema-command shape so the document and RDB paths share the
/// same lifecycle on `state.query_tokens`.
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

/// Wire shape for `list_mongo_databases`. The backend `NamespaceInfo`
/// already has `{ name: String }` — this alias exists purely so the
/// frontend type lives under an adapter-neutral name (`DatabaseInfo`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
}

/// Wire shape for `list_mongo_collections`. Mirrors `TableInfo` so the
/// frontend can render collections in the same tree nodes it already uses
/// for RDB tables (name + schema + optional count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    pub database: String,
    pub document_count: Option<i64>,
}

impl From<TableInfo> for CollectionInfo {
    fn from(value: TableInfo) -> Self {
        Self {
            name: value.name,
            database: value.schema,
            document_count: value.row_count,
        }
    }
}

/// Lookup helper — returns `AppError::NotFound` when the id isn't connected.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

/// List every database visible to the connected MongoDB user.
///
/// Returns `{ name }` entries so the frontend tree can render them in the
/// same shape it already uses for Postgres schemas.
#[tauri::command]
pub async fn list_mongo_databases(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    let namespaces = active.as_document()?.list_databases().await?;
    Ok(namespaces
        .into_iter()
        .map(|n| DatabaseInfo { name: n.name })
        .collect())
}

/// List every collection inside `database` for the connected MongoDB
/// client. Returns empty list when the database exists but has no
/// collections (mongo auto-creates on first write, so this is expected).
#[tauri::command]
pub async fn list_mongo_collections(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    // Sprint 180 (AC-180-04): optional cancel-token id.
    query_id: Option<String>,
) -> Result<Vec<CollectionInfo>, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;

    let result: Result<Vec<TableInfo>, AppError> = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_document()?
            .list_collections(&database, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result.map(|tables| tables.into_iter().map(CollectionInfo::from).collect())
}

/// Infer the top-level column layout of `collection` by sampling up to
/// `sample_size` documents. `sample_size = None` falls back to 100 which
/// is plenty for the P0 Quick Open preview.
#[tauri::command]
pub async fn infer_collection_fields(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    sample_size: Option<u32>,
    // Sprint 180 (AC-180-04): optional cancel-token id.
    query_id: Option<String>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;
    let size = sample_size.unwrap_or(100) as usize;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_document()?
            .infer_collection_fields(
                &database,
                &collection,
                size,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
}
