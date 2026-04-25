//! Document paradigm — write-path mutate commands (Sprint 80, Phase 6 F-1).
//!
//! Sprint 80 closes the backend half of the document write path by exposing
//! `MongoAdapter`'s freshly-implemented `insert_document` / `update_document`
//! / `delete_document` methods as three Tauri commands. The frontend
//! `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch (Sprint 86) and
//! the inline-edit UI (Sprint 87) will call these commands to commit
//! document changes.
//!
//! ## Dispatch pattern
//!
//! Every handler mirrors the `browse.rs` / `query.rs` shape:
//!   1. Lock `state.active_connections` to look up the live adapter.
//!   2. Convert "unknown connection id" into `AppError::NotFound` via the
//!      `not_connected` helper (identical to the sibling files so the error
//!      surface stays uniform).
//!   3. Resolve the adapter through `ActiveAdapter::as_document()?` so that
//!      non-document paradigms (e.g. a Postgres connection id) fail with
//!      `AppError::Unsupported` before any mutate method runs.
//!   4. Forward to the adapter trait method and let the typed `AppError`
//!      variants bubble up.
//!
//! ## Error propagation
//!
//! The adapter emits precise error variants:
//!   * `AppError::Validation` — empty namespace, `_id` in patch, invalid
//!     `DocumentId::ObjectId` hex.
//!   * `AppError::Connection` — pool not established.
//!   * `AppError::NotFound`   — `matched_count == 0` / `deleted_count == 0`.
//!   * `AppError::Database`   — driver call failure (`insert_one` / `update_one` /
//!     `delete_one`).
//!
//! These flow to the frontend via the standard Tauri error-serialisation
//! pathway (`AppError: Serialize` in `src-tauri/src/error.rs`).

use crate::commands::connection::AppState;
use crate::db::DocumentId;
use crate::error::AppError;

/// Map "unknown connection id" into the uniform NotFound error the rest of
/// the document commands emit. Kept local so `browse.rs`, `query.rs`, and
/// `mutate.rs` can each carry the helper without a shared module.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

/// Insert a single BSON document into `database.collection` and return the
/// server-assigned `_id` encoded as a `DocumentId`.
///
/// Callers omit `_id` to let MongoDB auto-generate an `ObjectId`; otherwise
/// the supplied `_id` is honoured. The returned `DocumentId` uses the BSON
/// variant the driver observed (`ObjectId` / `String` / `Number` / `Raw`)
/// so the UI can update its local row cache without a re-fetch.
#[tauri::command]
pub async fn insert_document(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document: bson::Document,
) -> Result<DocumentId, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_document()?
        .insert_document(&database, &collection, document)
        .await
}

/// Apply a `$set` patch to a single document identified by `document_id`.
///
/// The adapter rejects patches that contain `_id` (identity mutation) and
/// maps `matched_count == 0` to `AppError::NotFound` so the UI can surface
/// stale-row feedback. Nested-path updates (e.g. `{"profile.name": ...}`)
/// are permitted by MongoDB semantics but not explicitly validated by this
/// layer — Sprint 87 will revisit that guard at the UI level.
#[tauri::command]
pub async fn update_document(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document_id: DocumentId,
    patch: bson::Document,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_document()?
        .update_document(&database, &collection, document_id, patch)
        .await
}

/// Delete a single document by its `_id`.
///
/// `deleted_count == 0` surfaces as `AppError::NotFound` — the adapter does
/// not short-circuit on an empty collection because driver-emitted errors
/// (e.g. auth failure) must remain distinguishable from missing-target
/// feedback.
#[tauri::command]
pub async fn delete_document(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document_id: DocumentId,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;
    active
        .as_document()?
        .delete_document(&database, &collection, document_id)
        .await
}
