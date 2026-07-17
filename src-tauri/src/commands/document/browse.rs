//! Document paradigm — catalog/browse commands (Sprint 66).
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_document()?` so that non-document connections fail
//! cleanly with `AppError::Unsupported` before any concrete method is
//! invoked. This mirrors the pattern established for RDB commands in
//! `commands/rdb/schema.rs`.
//!
//! Sprint 237 P5 (2026-05-08) — handler bodies hoisted into
//! `_inner(&AppState)` so unit tests drive prod code directly without
//! a `tauri::State` mock; cancel-token helpers moved to the shared
//! `commands/document/mod.rs`.

use serde::{Deserialize, Serialize};

use crate::commands::connection::AppState;
use crate::db::{
    CollectionValidatorRead, CreateMongoIndexRequest, CreateMongoIndexResult,
    DocumentCollectionInfo, DocumentCollectionType,
};
use crate::error::AppError;
use crate::models::{ColumnInfo, IndexInfo};

use super::{not_connected, register_cancel_token, release_cancel_token};

fn require_safety_confirmation(confirmed: bool, operation: &str) -> Result<(), AppError> {
    if confirmed {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "{operation} requires safety confirmation"
    )))
}

/// Wire shape for `list_mongo_databases`. The backend `NamespaceInfo`
/// already has `{ name: String }` — this alias exists purely so the
/// frontend type lives under an adapter-neutral name (`DatabaseInfo`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
}

/// Wire shape for `list_mongo_collections`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    pub database: String,
    pub collection_type: DocumentCollectionType,
    pub document_count: Option<i64>,
    pub read_only: bool,
    pub options: serde_json::Value,
    pub id_index: Option<serde_json::Value>,
}

impl From<DocumentCollectionInfo> for CollectionInfo {
    fn from(value: DocumentCollectionInfo) -> Self {
        Self {
            name: value.name,
            database: value.database,
            collection_type: value.collection_type,
            document_count: value.document_count,
            read_only: value.read_only,
            options: value.options,
            id_index: value.id_index,
        }
    }
}

async fn list_mongo_databases_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let namespaces = active.as_document()?.list_databases().await?;
    Ok(namespaces
        .into_iter()
        .map(|n| DatabaseInfo { name: n.name })
        .collect())
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
    list_mongo_databases_inner(state.inner(), &connection_id).await
}

async fn list_mongo_collections_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    query_id: Option<&str>,
) -> Result<Vec<CollectionInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result: Result<Vec<DocumentCollectionInfo>, AppError> = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .list_collections(database, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result.map(|tables| tables.into_iter().map(CollectionInfo::from).collect())
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
    list_mongo_collections_inner(
        state.inner(),
        &connection_id,
        &database,
        query_id.as_deref(),
    )
    .await
}

async fn infer_collection_fields_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    sample_size: Option<u32>,
    query_id: Option<&str>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let size = sample_size.unwrap_or(100) as usize;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .infer_collection_fields(
                database,
                collection,
                size,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
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
    infer_collection_fields_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        sample_size,
        query_id.as_deref(),
    )
    .await
}

async fn list_mongo_indexes_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<Vec<IndexInfo>, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .list_collection_indexes(database, collection)
        .await
}

/// Sprint 332 (Slice J live wire) — Mongo collection 인덱스 메타데이터를
/// `IndexInfo[]` 로 반환. RDB 의 `get_table_indexes` 와 같은 wire shape 이라
/// frontend 가 같은 grid 컴포넌트로 두 paradigm 의 인덱스를 렌더할 수 있다.
#[tauri::command]
pub async fn list_mongo_indexes(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<Vec<IndexInfo>, AppError> {
    list_mongo_indexes_inner(state.inner(), &connection_id, &database, &collection).await
}

async fn create_mongo_index_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    request: CreateMongoIndexRequest,
) -> Result<CreateMongoIndexResult, AppError> {
    // Server-side input validation. Each gate fires before the adapter
    // round-trip so callers that bypass the UI still see the same
    // contract MongoDB enforces server-side.
    if request.fields.is_empty() {
        return Err(AppError::Validation(
            "create_index requires at least one field".into(),
        ));
    }
    if request.expire_after_seconds.is_some() && request.fields.len() > 1 {
        return Err(AppError::Validation(
            "expireAfterSeconds requires a single-field index".into(),
        ));
    }

    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .create_collection_index(database, collection, request)
        .await
}

/// Sprint 351 — create a Mongo collection index. Accepts the full
/// option set (unique / sparse / TTL / partialFilterExpression /
/// collation / compound asc-desc). Driver errors (E11000,
/// IndexOptionsConflict, …) flow back as `AppError::Database` so the
/// UI can render the verbatim message in the dialog alert.
#[tauri::command]
pub async fn create_mongo_index(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    request: CreateMongoIndexRequest,
) -> Result<CreateMongoIndexResult, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    create_mongo_index_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        request,
    )
    .await
}

async fn drop_mongo_index_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    name: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    // The `_id_` guard fires before the adapter round-trip so the UX
    // contract holds even when the UI is bypassed (programmatic
    // callers, REPL, tests). MongoDB enforces the same server-side —
    // we surface the friendlier message before the driver error.
    if name == "_id_" {
        return Err(AppError::Validation(
            "The _id_ index cannot be dropped".into(),
        ));
    }
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_safety_confirmation(safety_confirmed, "drop_mongo_index")?;
    adapter
        .drop_collection_index(database, collection, name)
        .await
}

/// Sprint 351 — drop a Mongo collection index by canonical name. The
/// `_id_` index is rejected at the Tauri layer (`AppError::Validation`)
/// so the contract holds even when callers bypass the UI's disabled
/// trash button.
#[tauri::command]
pub async fn drop_mongo_index(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    name: String,
    safety_confirmed: Option<bool>,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    drop_mongo_index_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        &name,
        safety_confirmed.unwrap_or(false),
    )
    .await
}

async fn get_mongo_validator_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
) -> Result<CollectionValidatorRead, AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .get_collection_validator(database, collection)
        .await
}

/// Sprint 333/352 (Slice K live wire) — read the validator currently
/// stored on the Mongo collection (`listCollections.options.validator`)
/// along with the persisted `validationLevel` / `validationAction`. Each
/// of the three fields is `None` when MongoDB has not stored a value;
/// the UI then falls back to MongoDB's server-side defaults
/// (`strict` / `error`).
#[tauri::command]
pub async fn get_mongo_validator(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<CollectionValidatorRead, AppError> {
    get_mongo_validator_inner(state.inner(), &connection_id, &database, &collection).await
}

/// Sprint 352 — whitelist allowed `validationLevel` values. `None` means
/// the caller omitted the field; the adapter then skips the field in the
/// `collMod` doc and MongoDB applies its server-side default.
fn validate_level(level: Option<&str>) -> Result<(), AppError> {
    match level {
        None => Ok(()),
        Some("off") | Some("strict") | Some("moderate") => Ok(()),
        Some(_) => Err(AppError::Validation(
            "validationLevel must be one of off|strict|moderate".into(),
        )),
    }
}

/// Sprint 352 — whitelist allowed `validationAction` values. Same
/// semantics as [`validate_level`].
fn validate_action(action: Option<&str>) -> Result<(), AppError> {
    match action {
        None => Ok(()),
        Some("error") | Some("warn") => Ok(()),
        Some(_) => Err(AppError::Validation(
            "validationAction must be one of error|warn".into(),
        )),
    }
}

async fn set_mongo_validator_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    validator: Option<serde_json::Value>,
    validation_level: Option<String>,
    validation_action: Option<String>,
) -> Result<(), AppError> {
    // Whitelist validation runs before the connection lookup so a
    // malformed payload short-circuits without touching the adapter pool.
    validate_level(validation_level.as_deref())?;
    validate_action(validation_action.as_deref())?;

    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .set_collection_validator(
            database,
            collection,
            validator,
            validation_level,
            validation_action,
        )
        .await
}

/// Sprint 333/352 (Slice K live wire) — apply (`Some(value)`) or clear
/// (`None`) the validator on a Mongo collection via `collMod`. Sprint
/// 352 extends the payload with optional `validation_level` /
/// `validation_action`. Both default to MongoDB's server-side defaults
/// (`strict` / `error`) when the field is omitted by the caller —
/// preserving wire-level backward compatibility with pre-sprint
/// payloads. Unknown values are rejected with `AppError::Validation`
/// before the adapter is invoked.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // IPC boundary + #1584 injected window guard param
pub async fn set_mongo_validator(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    validator: Option<serde_json::Value>,
    validation_level: Option<String>,
    validation_action: Option<String>,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    set_mongo_validator_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        validator,
        validation_level,
        validation_action,
    )
    .await
}

async fn create_collection_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    options: Option<serde_json::Value>,
) -> Result<(), AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .create_collection(database, collection, options)
        .await
}

/// Sprint 334 (Slice L live wire) — create a Mongo collection with
/// optional creation options (capped, timeseries, validator, etc.) via
/// the driver's `create` command.
#[tauri::command]
pub async fn create_collection(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    options: Option<serde_json::Value>,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    create_collection_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        options,
    )
    .await
}

async fn rename_collection_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    from: &str,
    to: &str,
) -> Result<(), AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .rename_collection(database, from, to)
        .await
}

/// Sprint 334 (Slice L live wire) — rename a Mongo collection inside
/// the same database (admin runCommand renameCollection). Cross-DB
/// renames are out of scope for this slice.
#[tauri::command]
pub async fn rename_collection(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    from: String,
    to: String,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    rename_collection_inner(state.inner(), &connection_id, &database, &from, &to).await
}

async fn drop_mongo_database_inner(
    state: &AppState,
    connection_id: &str,
    name: &str,
    safety_confirmed: bool,
) -> Result<(), AppError> {
    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_document()?;
    require_safety_confirmation(safety_confirmed, "drop_mongo_database")?;
    adapter.drop_database(name).await
}

/// Sprint 335 (Slice M live wire) — drop the entire Mongo database
/// (`db.dropDatabase()`). The driver is idempotent: dropping a
/// non-existent DB succeeds.
#[tauri::command]
pub async fn drop_mongo_database(
    window: tauri::Window,
    state: tauri::State<'_, AppState>,
    connection_id: String,
    name: String,
    safety_confirmed: Option<bool>,
) -> Result<(), AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    drop_mongo_database_inner(
        state.inner(),
        &connection_id,
        &name,
        safety_confirmed.unwrap_or(false),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): commands/document/browse.rs 3
    //! Tauri command (list_mongo_databases, list_mongo_collections,
    //! infer_collection_fields). 핸들러를 `_inner(&AppState)` 로 추출했으니
    //! 테스트도 그것을 직접 호출. 시나리오:
    //!   1. lookup miss → NotFound
    //!   2. as_document()? → Rdb/Search/Kv → Unsupported(document)
    //!   3. trait 위임 결과 propagate (Ok/Err)
    //!   4. NamespaceInfo→DatabaseInfo, TableInfo→CollectionInfo 변환 verbatim
    use super::*;
    use crate::commands::test_util::{document_default, rdb_default, state_with};
    use crate::db::testing::{clone_app_error, StubDocumentAdapter};
    use crate::db::{ActiveAdapter, NamespaceInfo};
    use crate::models::ColumnCategory;

    // ── list_mongo_databases — 5 scenarios ───────────────────────────────

    #[tokio::test]
    async fn list_databases_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match list_mongo_databases_inner(&state, "absent").await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_databases_rdb_paradigm_returns_unsupported_document() {
        let state = state_with("rdb", rdb_default()).await;
        match list_mongo_databases_inner(&state, "rdb").await {
            Err(AppError::Unsupported(msg)) => assert!(
                msg.contains("document") || msg.contains("MongoDB"),
                "kw 'document'/'MongoDB' 누락: {msg}"
            ),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_databases_doc_ok_maps_namespaces_to_databaseinfo_preserving_order() {
        let mut s = StubDocumentAdapter::default();
        s.list_databases_fn = Some(Box::new(|| {
            Ok(vec![
                NamespaceInfo {
                    name: "admin".into(),
                },
                NamespaceInfo {
                    name: "table_view_test".into(),
                },
            ])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = list_mongo_databases_inner(&state, "d").await.unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].name, "admin");
        assert_eq!(r[1].name, "table_view_test");
    }

    #[tokio::test]
    async fn list_databases_doc_err_propagates_verbatim() {
        let err = AppError::Database("auth failed".into());
        let mut s = StubDocumentAdapter::default();
        let cloned = clone_app_error(&err);
        s.list_databases_fn = Some(Box::new(move || Err(clone_app_error(&cloned))));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        match list_mongo_databases_inner(&state, "d").await {
            Err(AppError::Database(msg)) => assert_eq!(msg, "auth failed"),
            other => panic!("Expected Database, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_databases_doc_ok_empty_list_propagates_as_empty() {
        let state = state_with("d", document_default()).await;
        let r = list_mongo_databases_inner(&state, "d").await.unwrap();
        assert!(r.is_empty());
    }

    // ── list_mongo_collections — 4 scenarios ─────────────────────────────

    #[tokio::test]
    async fn list_collections_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_mongo_collections_inner(&state, "absent", "db1", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn list_collections_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            list_mongo_collections_inner(&state, "rdb", "db1", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn list_collections_doc_ok_maps_tableinfo_to_collectioninfo_with_db_arg() {
        let mut s = StubDocumentAdapter::default();
        s.list_collections_fn = Some(Box::new(|db: &str| {
            Ok(vec![DocumentCollectionInfo {
                name: format!("coll-of-{db}"),
                database: db.to_string(),
                collection_type: DocumentCollectionType::Collection,
                document_count: Some(42),
                read_only: false,
                options: serde_json::json!({}),
                id_index: None,
            }])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = list_mongo_collections_inner(&state, "d", "ns_x", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "coll-of-ns_x");
        assert_eq!(r[0].database, "ns_x");
        assert!(matches!(
            r[0].collection_type,
            DocumentCollectionType::Collection
        ));
        assert_eq!(r[0].document_count, Some(42));
        assert_eq!(r[0].options, serde_json::json!({}));
    }

    #[tokio::test]
    async fn list_collections_doc_empty_db_propagates_as_empty() {
        let state = state_with("d", document_default()).await;
        let r = list_mongo_collections_inner(&state, "d", "db1", None)
            .await
            .unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn list_collections_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = list_mongo_collections_inner(&state, "d", "db", Some("q-lc")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("q-lc"));
    }

    // ── infer_collection_fields — 3 scenarios ────────────────────────────

    #[tokio::test]
    async fn infer_collection_fields_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            infer_collection_fields_inner(&state, "absent", "db", "c", None, None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn infer_collection_fields_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            infer_collection_fields_inner(&state, "rdb", "db", "c", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn infer_collection_fields_doc_ok_with_db_and_collection_args() {
        let mut s = StubDocumentAdapter::default();
        s.infer_collection_fields_fn = Some(Box::new(|db: &str, coll: &str| {
            Ok(vec![ColumnInfo {
                name: format!("field@{db}.{coll}"),
                data_type: "string".into(),
                nullable: true,
                default_value: None,
                is_identity: false,
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
                check_clauses: Vec::new(),
                category: ColumnCategory::Unknown,
            }])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = infer_collection_fields_inner(&state, "d", "DBA", "C1", None, None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "field@DBA.C1");
    }

    #[tokio::test]
    async fn infer_collection_fields_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = infer_collection_fields_inner(&state, "d", "db", "c", None, Some("q-icf")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("q-icf"));
    }

    // ── Sprint 335 — drop_mongo_database wiring ────────────────────────────

    #[tokio::test]
    async fn drop_mongo_database_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match drop_mongo_database_inner(&state, "absent", "staging", false).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_mongo_database_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        match drop_mongo_database_inner(&state, "rdb", "staging", false).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("document")),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_mongo_database_routes_to_trait_method() {
        // Sprint 335 — closure stub captures the name argument so the
        // wiring proves the inner fn forwards verbatim. Happy-path
        // dispatch (lock acquired → as_document() OK → trait fn → Ok).
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.drop_database_fn = Some(Box::new(|name| {
            assert_eq!(name, "staging");
            Ok(())
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        drop_mongo_database_inner(&state, "d", "staging", true)
            .await
            .unwrap();
    }

    // ── Sprint 351 — create_mongo_index / drop_mongo_index wiring ──────────
    //
    // 작성 이유 (2026-05-15): 새 두 Tauri command shim 의 server-side
    // validation gate 와 trait dispatch 를 통합 테스트와 별개로 단위 검증.
    // 시나리오:
    //   * empty fields → Validation (어댑터 도달 전 차단)
    //   * compound + TTL → Validation
    //   * happy path → adapter 에 같은 request 가 전달되고 returned name 이
    //     wire 로 propagate
    //   * unknown connection → NotFound
    //   * rdb paradigm → Unsupported
    //   * `_id_` drop → Validation
    //   * non-`_id_` drop → adapter 호출 happen

    use crate::db::{
        CreateMongoIndexRequest, CreateMongoIndexResult, MongoIndexDirection, MongoIndexField,
    };

    fn make_simple_request() -> CreateMongoIndexRequest {
        CreateMongoIndexRequest {
            name: None,
            fields: vec![MongoIndexField {
                name: "email".into(),
                direction: MongoIndexDirection::Asc,
            }],
            unique: Some(true),
            sparse: None,
            expire_after_seconds: None,
            partial_filter_expression: None,
            collation: None,
        }
    }

    #[tokio::test]
    async fn create_mongo_index_empty_fields_returns_validation() {
        let state = state_with("d", document_default()).await;
        let req = CreateMongoIndexRequest {
            name: None,
            fields: Vec::new(),
            unique: None,
            sparse: None,
            expire_after_seconds: None,
            partial_filter_expression: None,
            collation: None,
        };
        match create_mongo_index_inner(&state, "d", "app", "users", req).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("at least one field")),
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_mongo_index_ttl_on_compound_returns_validation() {
        let state = state_with("d", document_default()).await;
        let req = CreateMongoIndexRequest {
            name: None,
            fields: vec![
                MongoIndexField {
                    name: "a".into(),
                    direction: MongoIndexDirection::Asc,
                },
                MongoIndexField {
                    name: "b".into(),
                    direction: MongoIndexDirection::Desc,
                },
            ],
            unique: None,
            sparse: None,
            expire_after_seconds: Some(60),
            partial_filter_expression: None,
            collation: None,
        };
        match create_mongo_index_inner(&state, "d", "app", "users", req).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("single-field")),
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_mongo_index_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match create_mongo_index_inner(&state, "absent", "app", "users", make_simple_request())
            .await
        {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_mongo_index_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        match create_mongo_index_inner(&state, "rdb", "app", "users", make_simple_request()).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("document")),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_mongo_index_routes_request_to_trait_and_returns_name() {
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.create_collection_index_fn = Some(Box::new(|db, coll, req| {
            assert_eq!(db, "app");
            assert_eq!(coll, "users");
            assert_eq!(req.fields.len(), 1);
            assert_eq!(req.fields[0].name, "email");
            Ok(CreateMongoIndexResult {
                name: "email_1".into(),
            })
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let out = create_mongo_index_inner(&state, "d", "app", "users", make_simple_request())
            .await
            .unwrap();
        assert_eq!(out.name, "email_1");
    }

    #[tokio::test]
    async fn drop_mongo_index_blocks_id_index() {
        let state = state_with("d", document_default()).await;
        match drop_mongo_index_inner(&state, "d", "app", "users", "_id_", false).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("_id_")),
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_mongo_index_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match drop_mongo_index_inner(&state, "absent", "app", "users", "email_1", false).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_mongo_index_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        match drop_mongo_index_inner(&state, "rdb", "app", "users", "email_1", false).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("document")),
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_mongo_index_routes_to_trait_method() {
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.drop_collection_index_fn = Some(Box::new(|db, coll, name| {
            assert_eq!(db, "app");
            assert_eq!(coll, "users");
            assert_eq!(name, "email_1");
            Ok(())
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        drop_mongo_index_inner(&state, "d", "app", "users", "email_1", true)
            .await
            .unwrap();
    }

    // ── Sprint 352 — set_mongo_validator whitelist + dispatch wiring ───────
    //
    // 작성 이유 (2026-05-15): Validator IPC 가 새 level/action 인자를 받기
    // 시작했으므로 (a) 화이트리스트가 어댑터 도달 전에 차단하는지, (b) 정상
    // 입력이 verbatim 으로 전달되는지, (c) 옴미트되었을 때 어댑터에도 None
    // 으로 흐르는지 (백워드 컴팻 보장) 를 단위로 검증한다.

    #[tokio::test]
    async fn set_mongo_validator_rejects_unknown_level_with_validation_error() {
        let state = state_with("d", document_default()).await;
        let result = set_mongo_validator_inner(
            &state,
            "d",
            "app",
            "users",
            None,
            Some("bogus".into()),
            None,
        )
        .await;
        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("validationLevel"),
                    "expected level whitelist message, got: {msg}"
                );
                assert!(msg.contains("off"), "expected `off` in copy: {msg}");
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn set_mongo_validator_rejects_unknown_action_with_validation_error() {
        let state = state_with("d", document_default()).await;
        let result = set_mongo_validator_inner(
            &state,
            "d",
            "app",
            "users",
            None,
            None,
            Some("silent".into()),
        )
        .await;
        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("validationAction"),
                    "expected action whitelist message, got: {msg}"
                );
                assert!(msg.contains("error"), "expected `error` in copy: {msg}");
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn set_mongo_validator_forwards_level_and_action_verbatim() {
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.set_collection_validator_fn = Some(Box::new(|db, coll, validator, level, action| {
            assert_eq!(db, "app");
            assert_eq!(coll, "users");
            assert!(
                validator.is_some(),
                "validator payload should pass through verbatim"
            );
            assert_eq!(level.as_deref(), Some("moderate"));
            assert_eq!(action.as_deref(), Some("warn"));
            Ok(())
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        set_mongo_validator_inner(
            &state,
            "d",
            "app",
            "users",
            Some(serde_json::json!({ "$jsonSchema": {} })),
            Some("moderate".into()),
            Some("warn".into()),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn set_mongo_validator_omitted_level_action_remains_backward_compatible() {
        // Backward-compat — payload that carries only a validator (no
        // level/action keys) must reach the adapter with `None` on both
        // optional positions. This is the byte-equivalent of the
        // pre-Sprint-352 wire format.
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.set_collection_validator_fn = Some(Box::new(|_db, _coll, _validator, level, action| {
            assert!(
                level.is_none() && action.is_none(),
                "omitted keys must arrive as None"
            );
            Ok(())
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        set_mongo_validator_inner(&state, "d", "app", "users", None, None, None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn get_mongo_validator_returns_trio_from_adapter() {
        let mut s = crate::db::testing::StubDocumentAdapter::default();
        s.get_collection_validator_fn = Some(Box::new(|_db, _coll| {
            Ok(crate::db::CollectionValidatorRead {
                validator: Some(serde_json::json!({ "$jsonSchema": {} })),
                validation_level: Some("moderate".into()),
                validation_action: Some("warn".into()),
            })
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let out = get_mongo_validator_inner(&state, "d", "app", "users")
            .await
            .unwrap();
        assert!(out.validator.is_some());
        assert_eq!(out.validation_level.as_deref(), Some("moderate"));
        assert_eq!(out.validation_action.as_deref(), Some("warn"));
    }
}
