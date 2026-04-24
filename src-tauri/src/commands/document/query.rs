//! Document paradigm — read-path query commands (Sprint 66).
//!
//! Currently hosts a single command — `find_documents` — that wraps the
//! `DocumentAdapter::find` trait method. The request body carries the
//! `filter` / `sort` / `projection` / `skip` / `limit` fields directly as
//! BSON documents so the frontend can forward its Find builder state
//! without an intermediate serialisation step.

use crate::commands::connection::AppState;
use crate::db::{DocumentQueryResult, FindBody};
use crate::error::AppError;

fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

/// Execute a MongoDB `find` against `database.collection` and return the
/// flattened projection expected by the DataGrid (`DocumentQueryResult`).
///
/// `body` defaults to an empty filter with no sort/projection when omitted
/// fields are absent — see `FindBody::default()`.
#[tauri::command]
pub async fn find_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    body: Option<FindBody>,
) -> Result<DocumentQueryResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    let body = body.unwrap_or_default();
    active
        .as_document()?
        .find(&database, &collection, body)
        .await
}
