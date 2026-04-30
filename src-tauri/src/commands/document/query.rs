//! Document paradigm — read-path query commands (Sprints 66 + 72).
//!
//! Sprint 66 seeded `find_documents`, which wraps the `DocumentAdapter::find`
//! trait method. The request body carries the
//! `filter` / `sort` / `projection` / `skip` / `limit` fields directly as
//! BSON documents so the frontend can forward its Find builder state
//! without an intermediate serialisation step.
//!
//! Sprint 72 (Phase 6 plan E-1) adds `aggregate_documents`, the sibling
//! dispatcher for `DocumentAdapter::aggregate`. The pipeline arrives as a
//! `Vec<bson::Document>` so the frontend can send a
//! `Record<string, unknown>[]` payload that serde deserialises element-wise
//! without a wrapper struct. All error paths mirror `find_documents`:
//! unknown connection id → `AppError::NotFound`, non-document paradigm →
//! `AppError::Unsupported` (via `as_document()?`), adapter failures bubble up
//! as `AppError::Database` / `AppError::Connection` / `AppError::Validation`.

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;
use crate::db::{DocumentQueryResult, FindBody};
use crate::error::AppError;

fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

/// Sprint 180 (AC-180-04) — cancel-token registration helper.
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
    // Sprint 180 (AC-180-04): optional cancel-token id.
    query_id: Option<String>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;
    let body = body.unwrap_or_default();

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_document()?
            .find(
                &database,
                &collection,
                body,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
}

/// Execute a MongoDB aggregation pipeline against `database.collection` and
/// return the flattened projection expected by the DataGrid
/// (`DocumentQueryResult`).
///
/// The caller supplies `pipeline` as a JSON array of stages; serde
/// deserialises each element into a `bson::Document`, so stages like
/// `[{"$match": {...}}, {"$sort": {...}}]` flow straight to the driver
/// without a wrapper struct. An empty pipeline degenerates to a pass-through
/// `find`-equivalent scan (driver default behaviour).
///
/// Side-effect stages (`$out`, `$merge`) are not explicitly blocked by this
/// command; the Sprint 72 contract limits scope to read-only result
/// collection, and callers are expected to steer clear. Sprint 80 will
/// revisit preview / safety guards.
#[tauri::command]
pub async fn aggregate_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    pipeline: Vec<bson::Document>,
    // Sprint 180 (AC-180-04): optional cancel-token id, mirrors find_documents.
    query_id: Option<String>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(&state, &query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_document()?
            .aggregate(
                &database,
                &collection,
                pipeline,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(&state, &cancel_handle).await;
    result
}
