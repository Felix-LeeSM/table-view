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
) -> Result<DocumentQueryResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_document()?
        .aggregate(&database, &collection, pipeline)
        .await
}
