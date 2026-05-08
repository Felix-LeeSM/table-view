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
//!
//! Sprint 237 P5 (2026-05-08) — handler bodies hoisted into
//! `_inner(&AppState)` shape; cancel-token helpers moved to
//! `commands/document/mod.rs`.

use crate::commands::connection::AppState;
use crate::db::{DocumentQueryResult, FindBody};
use crate::error::AppError;

use super::{not_connected, register_cancel_token, release_cancel_token};

async fn find_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    body: FindBody,
    query_id: Option<&str>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .find(
                database,
                collection,
                body,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
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
    find_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        body.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn aggregate_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    pipeline: Vec<bson::Document>,
    query_id: Option<&str>,
) -> Result<DocumentQueryResult, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .aggregate(
                database,
                collection,
                pipeline,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
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
    aggregate_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        pipeline,
        query_id.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): 핸들러를 `_inner(&AppState)` 로
    //! 추출했으니 테스트도 그것을 직접 호출. 시나리오: NotFound /
    //! Unsupported(document) / 트레이트 위임 / cancel-token release.
    use super::*;
    use crate::commands::test_util::{document_default, rdb_default, state_with};

    // ── find_documents ──────────────────────────────────────────────────

    #[tokio::test]
    async fn find_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            find_documents_inner(&state, "absent", "db", "c", FindBody::default(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn find_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            find_documents_inner(&state, "rdb", "db", "c", FindBody::default(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn find_doc_default_returns_empty_query_result() {
        let state = state_with("d", document_default()).await;
        let r = find_documents_inner(&state, "d", "db", "c", FindBody::default(), None)
            .await
            .unwrap();
        assert!(r.columns.is_empty());
        assert!(r.rows.is_empty());
        assert_eq!(r.total_count, 0);
    }

    #[tokio::test]
    async fn find_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ =
            find_documents_inner(&state, "d", "db", "c", FindBody::default(), Some("q-find")).await;
        assert!(!state.query_tokens.lock().await.contains_key("q-find"));
    }

    // ── aggregate_documents ─────────────────────────────────────────────

    #[tokio::test]
    async fn aggregate_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            aggregate_documents_inner(&state, "absent", "db", "c", Vec::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn aggregate_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            aggregate_documents_inner(&state, "rdb", "db", "c", Vec::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn aggregate_doc_default_returns_empty_query_result() {
        let state = state_with("d", document_default()).await;
        let r = aggregate_documents_inner(&state, "d", "db", "c", Vec::new(), None)
            .await
            .unwrap();
        assert!(r.columns.is_empty());
        assert_eq!(r.total_count, 0);
    }

    #[tokio::test]
    async fn aggregate_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = aggregate_documents_inner(&state, "d", "db", "c", Vec::new(), Some("q-agg")).await;
        assert!(!state.query_tokens.lock().await.contains_key("q-agg"));
    }
}
