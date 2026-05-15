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
use crate::db::{DocumentQueryResult, DocumentRow, FindBody};
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

// ── Sprint 308 (2026-05-14) — 4 new read-path commands ──────────────────
//
// 작성 이유: A1 mongosh 파서가 dispatch 할 `findOne` / `countDocuments` /
// `estimatedDocumentCount` / `distinct` 4 메서드. 각 inner 함수는 기존
// `find_documents_inner` 패턴(cancel-token register/release + `as_document()?`
// gate) 을 그대로 따라간다.

async fn find_one_document_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<Option<DocumentRow>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .find_one(
                database,
                collection,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Sprint 308 — single-document projection.
///
/// Dispatches `db.coll.findOne(<filter>)`. `Ok(None)` when no document
/// matches; `Ok(Some(DocumentRow))` otherwise (columns + projected row +
/// raw BSON for Quick Look).
#[tauri::command]
pub async fn find_one_document(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<Option<DocumentRow>, AppError> {
    find_one_document_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn count_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<i64, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .count_documents(
                database,
                collection,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Sprint 308 — exact filter count.
///
/// Dispatches `db.coll.countDocuments(<filter>)`. The driver scans the
/// collection for an accurate match — for an O(1) metadata estimate, use
/// `estimated_document_count`.
#[tauri::command]
pub async fn count_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<i64, AppError> {
    count_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn estimated_document_count_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    query_id: Option<&str>,
) -> Result<i64, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .estimated_document_count(
                database,
                collection,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Sprint 308 — O(1) metadata estimate of total document count.
///
/// Dispatches `db.coll.estimatedDocumentCount()`. Returns an approximate
/// count sourced from the collection's metadata — exact counts require the
/// slower `count_documents` path.
#[tauri::command]
pub async fn estimated_document_count(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    query_id: Option<String>,
) -> Result<i64, AppError> {
    estimated_document_count_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        query_id.as_deref(),
    )
    .await
}

async fn distinct_documents_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    field: &str,
    filter: bson::Document,
    query_id: Option<&str>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_document()?
            .distinct(
                database,
                collection,
                field,
                filter,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

/// Sprint 308 — distinct field values.
///
/// Dispatches `db.coll.distinct(<field>, <filter>)`. Returns each unique
/// value flattened through `flatten_cell` so the wire shape matches the
/// grid / Quick Look helper paths used by the other read commands.
#[tauri::command]
pub async fn distinct_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    field: String,
    filter: Option<bson::Document>,
    query_id: Option<String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    distinct_documents_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        &field,
        filter.unwrap_or_default(),
        query_id.as_deref(),
    )
    .await
}

async fn explain_mongo_find_inner(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter: bson::Document,
    verbosity: &str,
) -> Result<serde_json::Value, AppError> {
    if collection.trim().is_empty() {
        return Err(AppError::Validation(
            "Collection name must not be empty".into(),
        ));
    }
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_document()?
        .explain_query(database, collection, filter, verbosity)
        .await
}

/// Sprint 337 (U2 live wire) — Mongo `runCommand({explain: {find, filter},
/// verbosity})`. Returns the raw explain response as
/// `serde_json::Value`.
#[tauri::command]
pub async fn explain_mongo_find(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    filter: Option<bson::Document>,
    verbosity: Option<String>,
) -> Result<serde_json::Value, AppError> {
    explain_mongo_find_inner(
        state.inner(),
        &connection_id,
        &database,
        &collection,
        filter.unwrap_or_default(),
        verbosity.as_deref().unwrap_or("queryPlanner"),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
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

    // ── Sprint 308 (2026-05-14) — 4 new read commands ──────────────────
    //
    // 작성 이유: 각 신규 _inner 핸들러가 (a) 미존재 connection → NotFound,
    // (b) RDB paradigm → Unsupported, (c) document default stub → 자연
    // 기본값 (None / 0 / Vec::new) 을 surface 하는 3 거부 + 1 happy 매트릭스를
    // 통과하는지 검증. cancel-token release 회귀는 read-path 패밀리 공통이라
    // tracer (`find_one`) 하나로 대표한다.
    use crate::db::testing::StubDocumentAdapter;
    use crate::db::ActiveAdapter;

    // ── find_one_document ──────────────────────────────────────────────

    #[tokio::test]
    async fn find_one_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            find_one_document_inner(&state, "absent", "db", "c", bson::Document::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn find_one_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            find_one_document_inner(&state, "rdb", "db", "c", bson::Document::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn find_one_default_returns_none() {
        let state = state_with("d", document_default()).await;
        let r = find_one_document_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .unwrap();
        assert!(r.is_none());
    }

    #[tokio::test]
    async fn find_one_releases_token_on_round_trip() {
        let state = state_with("d", document_default()).await;
        let _ = find_one_document_inner(
            &state,
            "d",
            "db",
            "c",
            bson::Document::new(),
            Some("q-findone"),
        )
        .await;
        assert!(!state.query_tokens.lock().await.contains_key("q-findone"));
    }

    #[tokio::test]
    async fn find_one_routes_to_stub_with_document_row() {
        use crate::db::DocumentRow;
        use crate::models::{ColumnCategory, QueryColumn};
        let mut s = StubDocumentAdapter::default();
        s.find_one_fn = Some(Box::new(|_db: &str, _coll: &str| {
            Ok(Some(DocumentRow {
                columns: vec![QueryColumn {
                    name: "_id".into(),
                    data_type: "ObjectId".into(),
                    category: ColumnCategory::Unknown,
                }],
                row: vec![serde_json::Value::Null],
                raw: bson::Document::new(),
            }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = find_one_document_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .expect("should succeed")
            .expect("should be Some");
        assert_eq!(r.columns.len(), 1);
        assert_eq!(r.columns[0].name, "_id");
    }

    // ── count_documents ────────────────────────────────────────────────

    #[tokio::test]
    async fn count_documents_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            count_documents_inner(&state, "absent", "db", "c", bson::Document::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn count_documents_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            count_documents_inner(&state, "rdb", "db", "c", bson::Document::new(), None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn count_documents_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            count_documents_inner(&state, "d", "db", "c", bson::Document::new(), None)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn count_documents_routes_to_stub() {
        let mut s = StubDocumentAdapter::default();
        s.count_documents_fn = Some(Box::new(|_db: &str, _coll: &str| Ok(7)));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = count_documents_inner(&state, "d", "db", "c", bson::Document::new(), None)
            .await
            .unwrap();
        assert_eq!(r, 7);
    }

    // ── estimated_document_count ───────────────────────────────────────

    #[tokio::test]
    async fn estimated_document_count_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            estimated_document_count_inner(&state, "absent", "db", "c", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn estimated_document_count_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            estimated_document_count_inner(&state, "rdb", "db", "c", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn estimated_document_count_default_returns_zero() {
        let state = state_with("d", document_default()).await;
        assert_eq!(
            estimated_document_count_inner(&state, "d", "db", "c", None)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn estimated_document_count_routes_to_stub() {
        let mut s = StubDocumentAdapter::default();
        s.estimated_document_count_fn = Some(Box::new(|_db: &str, _coll: &str| Ok(42)));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = estimated_document_count_inner(&state, "d", "db", "c", None)
            .await
            .unwrap();
        assert_eq!(r, 42);
    }

    // ── distinct_documents ─────────────────────────────────────────────

    #[tokio::test]
    async fn distinct_documents_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            distinct_documents_inner(
                &state,
                "absent",
                "db",
                "c",
                "field",
                bson::Document::new(),
                None
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn distinct_documents_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            distinct_documents_inner(
                &state,
                "rdb",
                "db",
                "c",
                "field",
                bson::Document::new(),
                None
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn distinct_documents_default_returns_empty_vec() {
        let state = state_with("d", document_default()).await;
        let r =
            distinct_documents_inner(&state, "d", "db", "c", "field", bson::Document::new(), None)
                .await
                .unwrap();
        assert!(r.is_empty());
    }

    #[tokio::test]
    async fn distinct_documents_routes_to_stub_with_field() {
        let mut s = StubDocumentAdapter::default();
        s.distinct_fn = Some(Box::new(|_db: &str, _coll: &str, field: &str| {
            Ok(vec![serde_json::Value::String(format!("got:{field}"))])
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = distinct_documents_inner(
            &state,
            "d",
            "db",
            "c",
            "myfield",
            bson::Document::new(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0], serde_json::json!("got:myfield"));
    }

    // ── Sprint 337 (U2 live wire) — explain_mongo_find ────────────────────

    #[tokio::test]
    async fn explain_mongo_find_rejects_empty_collection() {
        let state = state_with("d", document_default()).await;
        match explain_mongo_find_inner(
            &state,
            "d",
            "db",
            "  ",
            bson::Document::new(),
            "queryPlanner",
        )
        .await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Collection name"), "unexpected: {msg}")
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_mongo_find_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match explain_mongo_find_inner(
            &state,
            "absent",
            "db",
            "c",
            bson::Document::new(),
            "queryPlanner",
        )
        .await
        {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_mongo_find_rdb_paradigm_returns_unsupported() {
        let state = state_with("rdb", rdb_default()).await;
        assert!(matches!(
            explain_mongo_find_inner(
                &state,
                "rdb",
                "db",
                "c",
                bson::Document::new(),
                "queryPlanner"
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn explain_mongo_find_routes_to_trait_method_with_args() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let called = Arc::new(AtomicBool::new(false));
        let called_for_closure = called.clone();
        let mut s = StubDocumentAdapter::default();
        s.explain_query_fn = Some(Box::new(move |db, coll, _filter, verbosity| {
            assert_eq!(db, "mydb");
            assert_eq!(coll, "mycoll");
            assert_eq!(verbosity, "executionStats");
            called_for_closure.store(true, Ordering::SeqCst);
            Ok(serde_json::json!({ "ok": 1 }))
        }));
        let state = state_with("d", ActiveAdapter::Document(Box::new(s))).await;
        let r = explain_mongo_find_inner(
            &state,
            "d",
            "mydb",
            "mycoll",
            bson::Document::new(),
            "executionStats",
        )
        .await
        .unwrap();
        assert!(called.load(Ordering::SeqCst));
        assert_eq!(r["ok"], serde_json::Value::from(1));
    }
}
