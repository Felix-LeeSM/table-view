//! Document paradigm — write-path mutate commands.
//!
//! The backend half of the document write path exposes
//! `MongoAdapter`'s `insert_document` / `update_document`
//! / `delete_document` methods as three Tauri commands. The frontend
//! `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch and
//! the inline-edit UI will call these commands to commit
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
//! pathway (`AppError: Serialize` in `src-tauri/table-view-core/src/error.rs`).
//!
//! ## Threat model — capability re-check (Issue #1618, D7)
//!
//! This command layer does NOT re-verify the TS-side `edit.editDocuments` /
//! `edit.bulkWrite` capability flags. Those flags are a UI-only affordance gate
//! (`supportsDocumentEditing` / `supportsBulkWrite` in `src/types/dataSource.ts`):
//! they decide whether the button renders, not whether the write is allowed. The
//! backend trust boundary here is deliberately narrower and enforces only:
//!   1. Paradigm — `ActiveAdapter::as_document()?` rejects a non-document
//!      connection id with `AppError::Unsupported` before any mutate runs.
//!   2. Safety — destructive bulk ops (`update_many` / `delete_many` /
//!      `bulk_write` with a many-op) require an explicit `safety_confirmed`.
//!   3. Deterministic identity — single-target bulk ops require an `_id`-only
//!      filter (`validate_bulk_write_identity`).
//!
//! So the capability gate is single-layer (UI). This is acceptable because a
//! wired document adapter that reaches this layer inherently supports the
//! document write path (there is no wired document engine that exposes
//! `insert/update/delete` yet withholds `edit.editDocuments`), and a direct-IPC
//! caller that bypasses the UI still hits the paradigm + safety gates above. If a
//! future document engine can connect as `document` yet must forbid writes (a
//! read-only document source), promote the capability check into this layer
//! (resolve the connection's profile and reject `!edit.editDocuments` /
//! `!edit.bulkWrite` before dispatch) rather than relying on the UI alone.
//!
//! Handler bodies hoisted into
//! `_inner(&AppState)` shape so unit tests can drive prod code directly.

use crate::commands::connection::AppState;
use crate::db::{BulkWriteOp, BulkWriteResult, DocumentId};
use crate::error::AppError;

use super::bulk_write_parse::parse_bulk_write_operations;
use super::not_connected;

fn require_safety_confirmation(confirmed: bool, operation: &str) -> Result<(), AppError> {
    if confirmed {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "{operation} requires safety confirmation"
    )))
}

fn bulk_write_requires_safety(operations: &[BulkWriteOp]) -> bool {
    operations.iter().any(|op| {
        matches!(
            op,
            BulkWriteOp::UpdateMany { .. } | BulkWriteOp::DeleteMany { .. }
        )
    })
}

fn is_id_only_filter(filter: &bson::Document) -> bool {
    filter.len() == 1 && filter.contains_key("_id")
}

fn validate_bulk_write_identity(operations: &[BulkWriteOp]) -> Result<(), AppError> {
    for op in operations {
        let (name, filter) = match op {
            BulkWriteOp::UpdateOne { filter, .. } => ("updateOne", filter),
            BulkWriteOp::DeleteOne { filter } => ("deleteOne", filter),
            BulkWriteOp::ReplaceOne { filter, .. } => ("replaceOne", filter),
            _ => continue,
        };
        if !is_id_only_filter(filter) {
            return Err(AppError::Validation(format!(
                "{name} requires an _id-only filter for deterministic document identity"
            )));
        }
    }
    Ok(())
}

async fn insert_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    document: bson::Document,
) -> Result<DocumentId, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
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
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document: bson::Document,
) -> Result<DocumentId, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
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
    let active = state
        .active_adapter(connection_id)
        .await
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
/// layer — that guard is to be revisited at the UI level.
#[tauri::command]
pub async fn update_document(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document_id: DocumentId,
    patch: bson::Document,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
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
    let active = state
        .active_adapter(connection_id)
        .await
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
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    document_id: DocumentId,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
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
    safety_confirmed: bool,
) -> Result<u64, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_safety_confirmation(safety_confirmed, "delete_many")?;
    adapter.delete_many(database, collection, filter).await
}

/// Bulk delete every document matching `filter`. Returns the
/// driver's `deleted_count` so the UI can surface "N row(s) deleted" toast.
///
/// Empty filter (`{}`) is allowed at this layer — the Safe Mode classifier
/// (`analyzeMongoOperation` on the frontend) gates the call. Bypassing the
/// gate via direct IPC would still execute the call, so backend treats this
/// as the same trust boundary as the underlying driver.
#[tauri::command]
pub async fn delete_many(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: bson::Document,
    safety_confirmed: Option<bool>,
) -> Result<u64, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    delete_many_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter,
        safety_confirmed.unwrap_or(false),
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
    safety_confirmed: bool,
) -> Result<u64, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_safety_confirmation(safety_confirmed, "update_many")?;
    adapter
        .update_many(database, collection, filter, patch)
        .await
}

/// Bulk apply `$set` patch to every document matching `filter`.
/// Returns `modified_count`. The adapter rejects `_id` in patch (identity
/// mutation) — same contract as `update_document`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // IPC boundary + #1584 injected window guard param
pub async fn update_many(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: bson::Document,
    patch: bson::Document,
    safety_confirmed: Option<bool>,
) -> Result<u64, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    update_many_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter,
        patch,
        safety_confirmed.unwrap_or(false),
    )
    .await
}

async fn drop_collection_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_safety_confirmation(safety_confirmed, "drop_collection")?;
    adapter.drop_collection(database, collection).await
}

/// Drop the entire collection. Mongo parallel of RDB
/// `dropTable`; Safe Mode always classifies this as `danger`.
#[tauri::command]
pub async fn drop_collection(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    safety_confirmed: Option<bool>,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    drop_collection_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        safety_confirmed.unwrap_or(false),
    )
    .await
}

// ── (2026-05-14) — new write commands ──────────────────────
//
// Why: the `insertMany` / `bulkWrite` methods the mongosh parser
// dispatches. They sit on the write path, so they take no cancel-token
// argument (the mongo driver does not support aborting an in-flight
// write). Both inner fns follow the `update_many_inner` pattern
// (`as_document()?` gate, no cancel handle) verbatim.

async fn insert_many_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    documents: Vec<bson::Document>,
) -> Result<Vec<DocumentId>, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .insert_many(database, collection, documents)
        .await
}

/// Bulk insert multiple documents.
///
/// Returns the server-assigned `_id` for each input document in **input
/// order** (`Vec<DocumentId>`). Empty input short-circuits to `Ok(vec![])`
/// without a driver call.
#[tauri::command]
pub async fn insert_many_documents(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    documents: Vec<bson::Document>,
) -> Result<Vec<DocumentId>, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    insert_many_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        documents,
    )
    .await
}

async fn bulk_write_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    operations: Vec<BulkWriteOp>,
    safety_confirmed: bool,
) -> Result<BulkWriteResult, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    validate_bulk_write_identity(&operations)?;
    if bulk_write_requires_safety(&operations) {
        require_safety_confirmation(safety_confirmed, "bulk_write destructive operation")?;
    }
    active
        .as_document()?
        .bulk_write(database, collection, operations)
        .await
}

/// Heterogeneous bulk-write.
///
/// Dispatches `db.coll.bulkWrite([...])`. The driver's `ordered: true`
/// default applies — first failure short-circuits the remaining ops.
/// Returns aggregate counters + `upserted_ids` for the upsert-mode
/// update / replace sub-ops. Empty input short-circuits to
/// `Ok(BulkWriteResult::default())`.
#[tauri::command]
pub async fn bulk_write_documents(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    operations: Vec<serde_json::Value>,
    safety_confirmed: Option<bool>,
) -> Result<BulkWriteResult, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    let operations = parse_bulk_write_operations(operations)?;
    bulk_write_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        operations,
        safety_confirmed.unwrap_or(false),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! Why this module exists (2026-05-08): document/mutate.rs command
    //! handlers were extracted as `_inner(&AppState)`, so the tests call
    //! prod code directly.
    //! Scenario matrix: NotFound / Unsupported(document) / trait delegation.
    use super::*;
    use crate::commands::test_util::{document_default, rdb_default, state_with};
    use crate::db::testing::StubDocumentAdapter;
    use crate::db::ActiveAdapter;

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
            delete_many_inner(&state, "absent", "db", "c", bson::Document::new(), false).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn delete_many_empty_filter_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match delete_many_inner(&state, "d", "db", "c", bson::Document::new(), false).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn delete_many_non_empty_filter_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match delete_many_inner(
            &state,
            "d",
            "db",
            "c",
            bson::doc! { "archived": true },
            false,
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn delete_many_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            delete_many_inner(&state, "rdb", "db", "c", bson::Document::new(), false).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn delete_many_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            delete_many_inner(&state, "d", "db", "c", bson::Document::new(), true)
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
                bson::Document::new(),
                false
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn update_many_non_empty_filter_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match update_many_inner(
            &state,
            "d",
            "db",
            "c",
            bson::doc! { "active": false },
            bson::doc! { "$set": { "reviewed": true } },
            false,
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
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
                bson::Document::new(),
                false
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
                bson::Document::new(),
                true
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
            drop_collection_inner(&state, "absent", "db", "c", false).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_collection_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match drop_collection_inner(&state, "d", "db", "c", false).await {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_collection_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            drop_collection_inner(&state, "rdb", "db", "c", false).await,
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
        assert!(drop_collection_inner(&state, "d", "DB", "C", true)
            .await
            .is_ok());
    }

    // ── insert_many_documents ─────────────────────────────
    //
    // Why (2026-05-14): verify that the write-path commands each pass the
    // NotFound / Unsupported(document) / trait delegation matrix. Uses the
    // stub's override slot to return only an `inserted_ids` length in a
    // minimal happy path, asserting just the wiring (the exact driver-id
    // shape is verified by the integration tests that run testcontainers).

    #[tokio::test]
    async fn insert_many_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            insert_many_documents_inner(&state, "absent", "db", "c", Vec::new()).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn insert_many_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            insert_many_documents_inner(&state, "rdb", "db", "c", Vec::new()).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn insert_many_default_returns_empty_vec() {
        let state = state_with("d", document_default()).await;
        let r = insert_many_documents_inner(&state, "d", "db", "c", Vec::new())
            .await
            .unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn insert_many_routes_to_stub_with_ids() {
        let mut s = StubDocumentAdapter::default();
        s.insert_many_fn = Some(Box::new(|_db: &str, _coll: &str| {
            Ok(vec![DocumentId::Number(1), DocumentId::Number(2)])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = insert_many_documents_inner(
            &state,
            "d",
            "db",
            "c",
            vec![bson::Document::new(), bson::Document::new()],
        )
        .await
        .unwrap();
        assert_eq!(r.len(), 2);
    }

    // ── bulk_write_documents ──────────────────────────────

    #[tokio::test]
    async fn bulk_write_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            bulk_write_documents_inner(&state, "absent", "db", "c", Vec::new(), false).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn bulk_write_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            bulk_write_documents_inner(&state, "rdb", "db", "c", Vec::new(), false).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn bulk_write_default_returns_default_result() {
        let state = state_with("d", document_default()).await;
        let r = bulk_write_documents_inner(&state, "d", "db", "c", Vec::new(), false)
            .await
            .unwrap();
        // BulkWriteResult::default() — all counts zero, no upserted ids.
        assert_eq!(r.inserted_count, 0);
        assert_eq!(r.matched_count, 0);
        assert_eq!(r.modified_count, 0);
        assert_eq!(r.deleted_count, 0);
        assert!(r.upserted_ids.is_empty());
    }

    #[tokio::test]
    async fn bulk_write_routes_to_stub_with_counters() {
        let mut s = StubDocumentAdapter::default();
        s.bulk_write_fn = Some(Box::new(|_db: &str, _coll: &str| {
            Ok(BulkWriteResult {
                inserted_count: 3,
                matched_count: 2,
                modified_count: 1,
                deleted_count: 4,
                upserted_ids: vec![DocumentId::Number(99)],
            })
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = bulk_write_documents_inner(
            &state,
            "d",
            "db",
            "c",
            vec![BulkWriteOp::InsertOne {
                document: bson::Document::new(),
            }],
            false,
        )
        .await
        .unwrap();
        assert_eq!(r.inserted_count, 3);
        assert_eq!(r.deleted_count, 4);
        assert_eq!(r.upserted_ids.len(), 1);
    }

    #[tokio::test]
    async fn bulk_write_delete_many_non_empty_filter_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match bulk_write_documents_inner(
            &state,
            "d",
            "db",
            "c",
            vec![BulkWriteOp::DeleteMany {
                filter: bson::doc! { "archived": true },
            }],
            false,
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn bulk_write_update_many_non_empty_filter_without_safety_ack_is_validation_error() {
        let state = state_with("d", document_default()).await;
        match bulk_write_documents_inner(
            &state,
            "d",
            "db",
            "c",
            vec![BulkWriteOp::UpdateMany {
                filter: bson::doc! { "active": false },
                update: bson::doc! { "$set": { "reviewed": true } },
                upsert: false,
            }],
            false,
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("safety confirmation"),
                    "unexpected message: {msg}"
                );
            }
            other => panic!("expected Validation error, got: {:?}", other),
        }
    }
}
