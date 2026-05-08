//! RDB catalog introspection commands.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.
//!
//! Sprint 237 P5 (2026-05-08) — handler bodies hoisted into `_inner(&AppState)`
//! so unit tests can drive them without a `tauri::State` mock. Public
//! `#[tauri::command]` wrappers delegate via `state.inner()`.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{ColumnInfo, FunctionInfo, PostgresTypeInfo, SchemaInfo, TableInfo, ViewInfo};

use super::{register_cancel_token, release_cancel_token};

/// Lookup helper — returns `AppError::NotFound` when the id isn't connected.
fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

async fn list_schemas_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<SchemaInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let namespaces = active.as_rdb()?.list_namespaces().await?;
    // NamespaceInfo and SchemaInfo share the same `{ name }` wire shape, so
    // mapping here preserves the payload exactly.
    Ok(namespaces
        .into_iter()
        .map(|n| SchemaInfo { name: n.name })
        .collect())
}

#[tauri::command]
pub async fn list_schemas(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<SchemaInfo>, AppError> {
    list_schemas_inner(state.inner(), &connection_id).await
}

async fn list_tables_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
) -> Result<Vec<TableInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.list_tables(schema).await
}

#[tauri::command]
pub async fn list_tables(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, AppError> {
    list_tables_inner(state.inner(), &connection_id, &schema).await
}

async fn get_table_columns_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_rdb()?
            .get_columns(schema, table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn get_table_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    // Sprint 180 (AC-180-04): optional cancel-token id. Frontend can
    // pass a unique id and call `cancel_query(query_id)` to abort.
    query_id: Option<String>,
) -> Result<Vec<ColumnInfo>, AppError> {
    get_table_columns_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
    )
    .await
}

async fn list_schema_columns_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.list_schema_columns(schema).await
}

#[tauri::command]
pub async fn list_schema_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    list_schema_columns_inner(state.inner(), &connection_id, &schema).await
}

async fn get_table_indexes_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_rdb()?
            .get_table_indexes(schema, table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn get_table_indexes(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    // Sprint 180 (AC-180-04): optional cancel-token id (see get_table_columns).
    query_id: Option<String>,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    get_table_indexes_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
    )
    .await
}

async fn get_table_constraints_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_rdb()?
            .get_table_constraints(schema, table, cancel_handle.as_ref().map(|(_, tok)| tok))
            .await
    };

    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn get_table_constraints(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    // Sprint 180 (AC-180-04): optional cancel-token id (see get_table_columns).
    query_id: Option<String>,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    get_table_constraints_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
    )
    .await
}

async fn list_views_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
) -> Result<Vec<ViewInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.list_views(schema).await
}

#[tauri::command]
pub async fn list_views(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<ViewInfo>, AppError> {
    list_views_inner(state.inner(), &connection_id, &schema).await
}

async fn list_functions_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
) -> Result<Vec<FunctionInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.list_functions(schema).await
}

#[tauri::command]
pub async fn list_functions(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<FunctionInfo>, AppError> {
    list_functions_inner(state.inner(), &connection_id, &schema).await
}

async fn get_view_definition_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    view_name: &str,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_rdb()?
        .get_view_definition(schema, view_name)
        .await
}

#[tauri::command]
pub async fn get_view_definition(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
) -> Result<String, AppError> {
    get_view_definition_inner(state.inner(), &connection_id, &schema, &view_name).await
}

async fn get_view_columns_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    view_name: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.get_view_columns(schema, view_name).await
}

#[tauri::command]
pub async fn get_view_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    get_view_columns_inner(state.inner(), &connection_id, &schema, &view_name).await
}

async fn get_function_source_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    function_name: &str,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_rdb()?
        .get_function_source(schema, function_name)
        .await
}

#[tauri::command]
pub async fn get_function_source(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    function_name: String,
) -> Result<String, AppError> {
    get_function_source_inner(state.inner(), &connection_id, &schema, &function_name).await
}

async fn list_postgres_types_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<PostgresTypeInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_rdb()?.list_types().await
}

/// Sprint 230 — list every Postgres-style data type visible to the
/// active connection (built-ins from `pg_catalog`, extension types
/// like PostGIS `geometry`, user-defined enums / domains / ranges /
/// composites). Read-only, no cancel-token (the call is small,
/// expected < 100 ms in practice). Pattern matches `list_views` /
/// `list_functions` (no `query_id` argument). Non-RDB connections
/// (Mongo) and non-PG RDB adapters (MySQL/SQLite/Oracle, Phase 17+)
/// fail cleanly via `as_rdb()?` + the trait's default
/// `Unsupported` impl.
#[tauri::command]
pub async fn list_postgres_types(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<PostgresTypeInfo>, AppError> {
    list_postgres_types_inner(state.inner(), &connection_id).await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): commands/rdb/schema.rs 12
    //! read-only catalog 명령에 대해 dispatch contract + read-method routing
    //! 을 모두 cover. 기존 `dispatch_*` helper (production body 1:1 mirror)
    //! 가 prod 핸들러를 비커버 상태로 두던 문제를 해결: production 코드를
    //! `_inner(&AppState)` 로 추출했으니 테스트도 그것을 직접 호출.
    //!
    //! 시나리오 매트릭스 (12 commands):
    //!   - NotFound: 12 (각 command 미등록 connection 경로)
    //!   - Unsupported(relational): 12 (각 command Document paradigm 분기)
    //!   - Routing/Ok: 12 (closure override 로 method-specific sentinel)
    //!   - Err propagation: 1 (witness — list_schemas)
    //!   - Empty boundary: 1 (witness — list_schemas)
    //!   - NamespaceInfo→SchemaInfo 매핑 verbatim: 1 (list_schemas only)
    //!
    //! 총 39 tests.
    use super::*;
    use crate::db::testing::{clone_app_error, StubDocumentAdapter, StubRdbAdapter};
    use crate::db::{ActiveAdapter, NamespaceInfo};
    use crate::models::{ConstraintInfo, FunctionInfo, IndexInfo};
    use std::collections::HashMap;

    async fn state_with(id: &str, active: ActiveAdapter) -> AppState {
        let state = AppState::new();
        {
            let mut conns = state.active_connections.lock().await;
            conns.insert(id.to_string(), active);
        }
        state
    }

    fn rdb_default() -> ActiveAdapter {
        ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))
    }
    fn document_default() -> ActiveAdapter {
        ActiveAdapter::Document(Box::new(StubDocumentAdapter::default()))
    }

    // ── list_schemas witness — 5 contract + boundary scenarios ────────────

    #[tokio::test]
    async fn list_schemas_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match list_schemas_inner(&state, "absent").await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_document_paradigm_returns_unsupported_relational() {
        let state = state_with("doc-1", document_default()).await;
        match list_schemas_inner(&state, "doc-1").await {
            Err(AppError::Unsupported(msg)) => {
                assert!(msg.contains("relational"), "kw 'relational' 누락: {msg}")
            }
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_rdb_ok_maps_namespaces_to_schemainfo_preserving_order() {
        let mut s = StubRdbAdapter::default();
        s.list_namespaces_fn = Some(Box::new(|| {
            Ok(vec![
                NamespaceInfo {
                    name: "public".into(),
                },
                NamespaceInfo { name: "app".into() },
            ])
        }));
        let state = state_with("rdb-1", ActiveAdapter::Rdb(Box::new(s))).await;
        let result = list_schemas_inner(&state, "rdb-1").await.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "public");
        assert_eq!(result[1].name, "app");
    }

    #[tokio::test]
    async fn list_schemas_rdb_err_propagates_verbatim() {
        let err = AppError::Database("permission denied for catalog".into());
        let mut s = StubRdbAdapter::default();
        let cloned = clone_app_error(&err);
        s.list_namespaces_fn = Some(Box::new(move || Err(clone_app_error(&cloned))));
        let state = state_with("rdb-1", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_schemas_inner(&state, "rdb-1").await {
            Err(AppError::Database(msg)) => {
                assert_eq!(msg, "permission denied for catalog")
            }
            other => panic!("Expected Database error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_rdb_ok_empty_list_propagates_as_empty() {
        let state = state_with("rdb-1", rdb_default()).await;
        let result = list_schemas_inner(&state, "rdb-1").await.unwrap();
        assert!(result.is_empty());
    }

    // ── 11 NotFound tests ────────────────────────────────────────────────

    #[tokio::test]
    async fn list_tables_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_tables_inner(&state, "absent", "public").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_columns_inner(&state, "absent", "users", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_schema_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_schema_columns_inner(&state, "absent", "public").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_indexes_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_indexes_inner(&state, "absent", "users", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_constraints_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_constraints_inner(&state, "absent", "users", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_views_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_views_inner(&state, "absent", "public").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_functions_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_functions_inner(&state, "absent", "public").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_view_definition_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_view_definition_inner(&state, "absent", "public", "v").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_view_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_view_columns_inner(&state, "absent", "public", "v").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_function_source_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_function_source_inner(&state, "absent", "public", "f").await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_postgres_types_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_postgres_types_inner(&state, "absent").await,
            Err(AppError::NotFound(_))
        ));
    }

    // ── 11 Unsupported(relational) tests on Document paradigm ────────────

    #[tokio::test]
    async fn list_tables_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_tables_inner(&state, "doc", "public").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_columns_inner(&state, "doc", "users", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_schema_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_schema_columns_inner(&state, "doc", "public").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_indexes_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_indexes_inner(&state, "doc", "users", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_constraints_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_constraints_inner(&state, "doc", "users", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_views_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_views_inner(&state, "doc", "public").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_functions_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_functions_inner(&state, "doc", "public").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_view_definition_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_view_definition_inner(&state, "doc", "public", "v").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_view_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_view_columns_inner(&state, "doc", "public", "v").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_function_source_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_function_source_inner(&state, "doc", "public", "f").await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_postgres_types_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_postgres_types_inner(&state, "doc").await,
            Err(AppError::Unsupported(_))
        ));
    }

    // ── 11 routing tests — schema-arg propagation ────────────────────────
    //
    // Default StubRdbAdapter 가 read-method 에 대해 Ok(empty) 반환. routing
    // 검증은 `closure override` 로 method-specific sentinel 을 놓고 dispatcher
    // 가 그것을 받아오는지 확인. 추가 보너스: schema/table 파라미터가 trait
    // 까지 그대로 전달되는지도 함께 검증 (closure 가 인자를 echo).

    #[tokio::test]
    async fn list_tables_routes_with_schema_arg_propagated() {
        let mut s = StubRdbAdapter::default();
        s.list_tables_fn = Some(Box::new(|ns: &str| {
            Ok(vec![TableInfo {
                name: format!("listed-from-{ns}"),
                schema: ns.to_string(),
                row_count: None,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_tables_inner(&state, "c", "ns_x").await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "listed-from-ns_x");
        assert_eq!(r[0].schema, "ns_x");
    }

    #[tokio::test]
    async fn get_table_columns_routes_with_schema_and_table_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_columns_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(vec![ColumnInfo {
                name: format!("col@{ns}.{tbl}"),
                data_type: "TEXT".into(),
                nullable: true,
                default_value: None,
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_table_columns_inner(&state, "c", "users", "ns_x", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "col@ns_x.users");
    }

    #[tokio::test]
    async fn list_schema_columns_routes_with_schema_arg_propagated() {
        let mut s = StubRdbAdapter::default();
        s.list_schema_columns_fn = Some(Box::new(|ns: &str| {
            let mut m = HashMap::new();
            m.insert(format!("from-{ns}"), Vec::new());
            Ok(m)
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_schema_columns_inner(&state, "c", "ns_y")
            .await
            .unwrap();
        assert!(r.contains_key("from-ns_y"));
    }

    #[tokio::test]
    async fn get_table_indexes_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_table_indexes_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(vec![IndexInfo {
                name: format!("idx@{ns}.{tbl}"),
                columns: vec![],
                index_type: "btree".into(),
                is_unique: false,
                is_primary: false,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_table_indexes_inner(&state, "c", "tbl_b", "ns_a", None)
            .await
            .unwrap();
        assert_eq!(r[0].name, "idx@ns_a.tbl_b");
    }

    #[tokio::test]
    async fn get_table_constraints_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_table_constraints_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(vec![ConstraintInfo {
                name: format!("c@{ns}.{tbl}"),
                constraint_type: "UNIQUE".into(),
                columns: vec![],
                reference_table: None,
                reference_columns: None,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_table_constraints_inner(&state, "c", "t", "ns", None)
            .await
            .unwrap();
        assert_eq!(r[0].name, "c@ns.t");
    }

    #[tokio::test]
    async fn list_views_routes_with_schema_arg_propagated() {
        let mut s = StubRdbAdapter::default();
        s.list_views_fn = Some(Box::new(|ns: &str| {
            Ok(vec![ViewInfo {
                name: format!("v@{ns}"),
                schema: ns.into(),
                definition: None,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_views_inner(&state, "c", "ns_v").await.unwrap();
        assert_eq!(r[0].name, "v@ns_v");
    }

    #[tokio::test]
    async fn list_functions_routes_with_schema_arg_propagated() {
        let mut s = StubRdbAdapter::default();
        s.list_functions_fn = Some(Box::new(|ns: &str| {
            Ok(vec![FunctionInfo {
                name: format!("f@{ns}"),
                schema: ns.into(),
                arguments: None,
                return_type: None,
                language: None,
                source: None,
                kind: "function".into(),
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_functions_inner(&state, "c", "ns_f").await.unwrap();
        assert_eq!(r[0].name, "f@ns_f");
    }

    #[tokio::test]
    async fn get_view_definition_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_view_definition_fn = Some(Box::new(|ns: &str, view: &str| {
            Ok(format!("CREATE VIEW {ns}.{view} AS SELECT 1"))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_view_definition_inner(&state, "c", "ns_q", "vw_z")
            .await
            .unwrap();
        assert_eq!(r, "CREATE VIEW ns_q.vw_z AS SELECT 1");
    }

    #[tokio::test]
    async fn get_view_columns_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_view_columns_fn = Some(Box::new(|ns: &str, view: &str| {
            Ok(vec![ColumnInfo {
                name: format!("vc@{ns}.{view}"),
                data_type: "TEXT".into(),
                nullable: true,
                default_value: None,
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_view_columns_inner(&state, "c", "ns", "vw")
            .await
            .unwrap();
        assert_eq!(r[0].name, "vc@ns.vw");
    }

    #[tokio::test]
    async fn get_function_source_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_function_source_fn = Some(Box::new(|ns: &str, func: &str| {
            Ok(format!("CREATE FUNCTION {ns}.{func}() …"))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_function_source_inner(&state, "c", "ns_g", "fn_h")
            .await
            .unwrap();
        assert_eq!(r, "CREATE FUNCTION ns_g.fn_h() …");
    }

    #[tokio::test]
    async fn list_postgres_types_routes_to_list_types_trait_method() {
        let mut s = StubRdbAdapter::default();
        s.list_types_fn = Some(Box::new(|| {
            Ok(vec![PostgresTypeInfo {
                schema: "pg_catalog".into(),
                name: "uuid".into(),
                type_kind: "base".into(),
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_postgres_types_inner(&state, "c").await.unwrap();
        assert_eq!(r[0].name, "uuid");
    }

    // ── cancel-token registration round-trip witness ─────────────────────
    //
    // Reason (2026-05-08): get_table_columns_inner / get_table_indexes_inner
    // / get_table_constraints_inner 는 register/release 사이의 path 가 prod
    // 핸들러 핵심. query_id Some 으로 호출 → 호출 후 registry 가 비어 있어야
    // (release 가 동작) 함을 단언.

    #[tokio::test]
    async fn get_table_columns_inner_round_trip_releases_token() {
        let state = state_with("c", rdb_default()).await;
        let _ = get_table_columns_inner(&state, "c", "t", "s", Some("qid-1")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-1"), "release 누락");
    }

    #[tokio::test]
    async fn get_table_indexes_inner_round_trip_releases_token() {
        let state = state_with("c", rdb_default()).await;
        let _ = get_table_indexes_inner(&state, "c", "t", "s", Some("qid-2")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-2"));
    }

    #[tokio::test]
    async fn get_table_constraints_inner_round_trip_releases_token() {
        let state = state_with("c", rdb_default()).await;
        let _ = get_table_constraints_inner(&state, "c", "t", "s", Some("qid-3")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-3"));
    }
}
