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
//!
//! Sprint 237 P5 (2026-05-08) — handler bodies hoisted into
//! `_inner(&AppState)` shape so unit tests can drive prod code directly.

use crate::commands::connection::AppState;
use crate::db::DocumentId;
use crate::error::AppError;

/// Map "unknown connection id" into the uniform NotFound error the rest of
/// the document commands emit. Kept local so `browse.rs`, `query.rs`, and
/// `mutate.rs` can each carry the helper without a shared module.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

async fn insert_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    document: bson::Document,
) -> Result<DocumentId, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .insert_document(database, collection, document)
        .await
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
    insert_document_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        document,
    )
    .await
}

async fn update_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    document_id: DocumentId,
    patch: bson::Document,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .update_document(database, collection, document_id, patch)
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
    update_document_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        document_id,
        patch,
    )
    .await
}

async fn delete_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    document_id: DocumentId,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .delete_document(database, collection, document_id)
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
    delete_document_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        document_id,
    )
    .await
}

async fn delete_many_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
) -> Result<u64, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .delete_many(database, collection, filter)
        .await
}

/// Sprint 198 — bulk delete every document matching `filter`. Returns the
/// driver's `deleted_count` so the UI can surface "N row(s) deleted" toast.
///
/// Empty filter (`{}`) is allowed at this layer — the Safe Mode classifier
/// (`analyzeMongoOperation` on the frontend) gates the call. Bypassing the
/// gate via direct IPC would still execute the call, so backend treats this
/// as the same trust boundary as the underlying driver.
#[tauri::command]
pub async fn delete_many(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: bson::Document,
) -> Result<u64, AppError> {
    delete_many_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter,
    )
    .await
}

async fn update_many_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    patch: bson::Document,
) -> Result<u64, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .update_many(database, collection, filter, patch)
        .await
}

/// Sprint 198 — bulk apply `$set` patch to every document matching `filter`.
/// Returns `modified_count`. The adapter rejects `_id` in patch (identity
/// mutation) — same contract as `update_document`.
#[tauri::command]
pub async fn update_many(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: bson::Document,
    patch: bson::Document,
) -> Result<u64, AppError> {
    update_many_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter,
        patch,
    )
    .await
}

async fn drop_collection_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<(), AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .drop_collection(database, collection)
        .await
}

/// Sprint 198 — drop the entire collection. Mongo parallel of RDB
/// `dropTable`; Safe Mode always classifies this as `danger`.
#[tauri::command]
pub async fn drop_collection(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<(), AppError> {
    drop_collection_inner(state.inner(), &connection_id, &database, &collection).await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): document/mutate.rs 6 commands
    //! 핸들러를 `_inner(&AppState)` 로 추출했으니 prod 코드 직접 호출.
    //! 시나리오 매트릭스: NotFound / Unsupported(document) / 트레이트 위임.
    use super::*;
    use crate::db::testing::{StubDocumentAdapter, StubRdbAdapter};
    use crate::db::ActiveAdapter;

    async fn state_with(id: &str, active: ActiveAdapter) -> AppState {
        let s = AppState::new();
        {
            let mut conns = s.active_connections.lock().await;
            conns.insert(id.to_string(), active);
        }
        s
    }

    fn document_default() -> ActiveAdapter {
        ActiveAdapter::Document(Box::new(StubDocumentAdapter::default()))
    }
    fn rdb_default() -> ActiveAdapter {
        ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))
    }

    // ── insert_document ─────────────────────────────────────────────────

    #[tokio::test]
    async fn insert_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            insert_document_inner(&state, "absent", "db", "c", bson::Document::new()).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn insert_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            insert_document_inner(&state, "rdb", "db", "c", bson::Document::new()).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn insert_document_default_returns_documentid_number_zero() {
        let state = state_with("d", document_default()).await;
        let r = insert_document_inner(&state, "d", "db", "c", bson::Document::new())
            .await
            .unwrap();
        match r {
            DocumentId::Number(n) => assert_eq!(n, 0),
            other => panic!("Expected Number, got: {:?}", other),
        }
    }

    // ── update_document ─────────────────────────────────────────────────

    #[tokio::test]
    async fn update_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            update_document_inner(
                &state,
                "absent",
                "db",
                "c",
                DocumentId::Number(1),
                bson::Document::new()
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn update_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            update_document_inner(
                &state,
                "rdb",
                "db",
                "c",
                DocumentId::Number(1),
                bson::Document::new()
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn update_document_default_ok() {
        let state = state_with("d", document_default()).await;
        assert!(update_document_inner(
            &state,
            "d",
            "db",
            "c",
            DocumentId::Number(1),
            bson::Document::new()
        )
        .await
        .is_ok());
    }

    // ── delete_document ─────────────────────────────────────────────────

    #[tokio::test]
    async fn delete_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            delete_document_inner(&state, "absent", "db", "c", DocumentId::Number(1)).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn delete_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            delete_document_inner(&state, "rdb", "db", "c", DocumentId::Number(1)).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn delete_document_default_ok() {
        let state = state_with("d", document_default()).await;
        assert!(
            delete_document_inner(&state, "d", "db", "c", DocumentId::Number(1))
                .await
                .is_ok()
        );
    }

    // ── delete_many / update_many ──────────────────────────────────────

    #[tokio::test]
    async fn delete_many_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            delete_many_inner(&state, "absent", "db", "c", bson::Document::new()).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn delete_many_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            delete_many_inner(&state, "rdb", "db", "c", bson::Document::new()).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn delete_many_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            delete_many_inner(&state, "d", "db", "c", bson::Document::new())
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn update_many_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            update_many_inner(
                &state,
                "absent",
                "db",
                "c",
                bson::Document::new(),
                bson::Document::new()
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn update_many_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            update_many_inner(
                &state,
                "rdb",
                "db",
                "c",
                bson::Document::new(),
                bson::Document::new()
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn update_many_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            update_many_inner(
                &state,
                "d",
                "db",
                "c",
                bson::Document::new(),
                bson::Document::new()
            )
            .await
            .unwrap(),
            0
        );
    }

    // ── drop_collection ────────────────────────────────────────────────

    #[tokio::test]
    async fn drop_collection_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            drop_collection_inner(&state, "absent", "db", "c").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_collection_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            drop_collection_inner(&state, "rdb", "db", "c").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn drop_collection_routes_with_db_and_collection_args_propagated() {
        let mut s = StubDocumentAdapter::default();
        s.drop_collection_fn = Some(Box::new(|db: &str, coll: &str| {
            if db.is_empty() || coll.is_empty() {
                Err(AppError::Validation(format!(
                    "missing args: '{db}'.'{coll}'"
                )))
            } else {
                Ok(())
            }
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        assert!(drop_collection_inner(&state, "d", "DB", "C").await.is_ok());
    }
}
