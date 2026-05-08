//! Commands scoped to the document paradigm (Phase 6 / Sprints 66 + 72 + 80).
//!
//! Sprint 66 introduced the first four document-flavoured Tauri commands,
//! each a thin dispatcher that resolves the active connection, grabs the
//! `DocumentAdapter` via `ActiveAdapter::as_document()?`, and forwards to
//! the adapter trait method. Sprint 72 adds `aggregate_documents` alongside
//! `find_documents` so the frontend can submit an aggregation pipeline.
//! Sprint 80 (Phase 6 F-1) closes the backend half of the write path by
//! adding `insert_document` / `update_document` / `delete_document`.
//! All commands are registered in `src-tauri/src/lib.rs::run()`.
//!
//! Module split follows the RDB convention:
//!   - `browse` — read-only namespace/collection catalog introspection
//!     (`list_mongo_databases`, `list_mongo_collections`,
//!     `infer_collection_fields`).
//!   - `query`  — document read-path execution (`find_documents`,
//!     `aggregate_documents`).
//!   - `mutate` — write-path dispatch (`insert_document`,
//!     `update_document`, `delete_document`). Sprint 86 (F-2) will wire the
//!     frontend `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch, and
//!     Sprint 87 (F-3) will complete the inline-edit UI + AddDocumentModal.

pub mod browse;
pub mod mutate;
pub mod query;

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;

/// Sprint 180 (AC-180-04) — cancel-token registration helper, mirrors
/// the RDB schema-command shape so the document and RDB paths share the
/// same lifecycle on `state.query_tokens`.
///
/// Sprint 237 P5 (2026-05-08) — hoisted from per-file copies in
/// `browse.rs` and `query.rs` so handler bodies can be extracted into
/// `_inner(&AppState)` shape and unit-tested without `tauri::State`.
pub(super) async fn register_cancel_token(
    state: &AppState,
    query_id: Option<&str>,
) -> Option<(String, CancellationToken)> {
    let qid = query_id?.to_string();
    let token = CancellationToken::new();
    let stored = token.clone();
    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.insert(qid.clone(), stored);
    }
    Some((qid, token))
}

pub(super) async fn release_cancel_token(
    state: &AppState,
    cancel_handle: &Option<(String, CancellationToken)>,
) {
    if let Some((qid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(qid);
    }
}
