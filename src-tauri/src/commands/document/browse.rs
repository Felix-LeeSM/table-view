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
use crate::error::AppError;
use crate::models::{ColumnInfo, TableInfo};

use super::{not_connected, register_cancel_token, release_cancel_token};

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

async fn list_mongo_databases_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
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

    let result: Result<Vec<TableInfo>, AppError> = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
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
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
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
            Ok(vec![TableInfo {
                name: format!("coll-of-{db}"),
                schema: db.to_string(),
                row_count: Some(42),
            }])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = list_mongo_collections_inner(&state, "d", "ns_x", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "coll-of-ns_x");
        assert_eq!(r[0].database, "ns_x");
        assert_eq!(r[0].document_count, Some(42));
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
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
                check_clauses: Vec::new(),
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
}
