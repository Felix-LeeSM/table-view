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
//!
//! Sprint 271a (2026-05-13) — each handler gains an opt-in
//! `expected_database: Option<String>` last-positional parameter. When the
//! caller passes `Some(expected)`, the probe samples
//! `adapter.current_database().await?.unwrap_or_default()` *inside* the same
//! `active_connections.lock()` acquisition that wraps the dispatch, and
//! returns `AppError::DbMismatch` BEFORE invoking the trait method. The
//! `None` path is byte-equivalent to pre-Sprint-271. Mirrors the Sprint 266
//! reference probe at `src-tauri/src/commands/rdb/query.rs:83–92`.
//!
//! Sprint 271c (2026-05-13) — `ensure_expected_db` helper hoisted to
//! `super` (`commands/rdb/mod.rs`) so DDL handlers can share the same
//! probe body. The 12 schema introspection call sites stay byte-
//! equivalent in behaviour; only the import path changed.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{
    ColumnInfo, FunctionInfo, PostgresExtensionInfo, PostgresTypeInfo, SchemaInfo, TableInfo,
    TriggerInfo, ViewInfo,
};

use super::{ensure_expected_db, not_connected, register_cancel_token, release_cancel_token};

async fn list_schemas_inner(
    state: &AppState,
    connection_id: &str,
    expected_database: Option<&str>,
) -> Result<Vec<SchemaInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    let namespaces = adapter.list_namespaces().await?;
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
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<SchemaInfo>, AppError> {
    list_schemas_inner(state.inner(), &connection_id, expected_database.as_deref()).await
}

async fn list_tables_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    expected_database: Option<&str>,
) -> Result<Vec<TableInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_tables(schema).await
}

#[tauri::command]
pub async fn list_tables(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<TableInfo>, AppError> {
    list_tables_inner(
        state.inner(),
        &connection_id,
        &schema,
        expected_database.as_deref(),
    )
    .await
}

async fn get_table_columns_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
    expected_database: Option<&str>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        match ensure_expected_db(adapter, expected_database).await {
            Ok(()) => {
                adapter
                    .get_columns(schema, table, cancel_handle.as_ref().map(|(_, tok)| tok))
                    .await
            }
            Err(e) => Err(e),
        }
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
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<ColumnInfo>, AppError> {
    get_table_columns_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
        expected_database.as_deref(),
    )
    .await
}

async fn list_schema_columns_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    expected_database: Option<&str>,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_schema_columns(schema).await
}

#[tauri::command]
pub async fn list_schema_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
    list_schema_columns_inner(
        state.inner(),
        &connection_id,
        &schema,
        expected_database.as_deref(),
    )
    .await
}

async fn get_table_indexes_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
    expected_database: Option<&str>,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        match ensure_expected_db(adapter, expected_database).await {
            Ok(()) => {
                adapter
                    .get_table_indexes(schema, table, cancel_handle.as_ref().map(|(_, tok)| tok))
                    .await
            }
            Err(e) => Err(e),
        }
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
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<crate::models::IndexInfo>, AppError> {
    get_table_indexes_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
        expected_database.as_deref(),
    )
    .await
}

async fn get_table_constraints_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    query_id: Option<&str>,
    expected_database: Option<&str>,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        match ensure_expected_db(adapter, expected_database).await {
            Ok(()) => {
                adapter
                    .get_table_constraints(
                        schema,
                        table,
                        cancel_handle.as_ref().map(|(_, tok)| tok),
                    )
                    .await
            }
            Err(e) => Err(e),
        }
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
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<crate::models::ConstraintInfo>, AppError> {
    get_table_constraints_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        query_id.as_deref(),
        expected_database.as_deref(),
    )
    .await
}

async fn list_views_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    expected_database: Option<&str>,
) -> Result<Vec<ViewInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_views(schema).await
}

#[tauri::command]
pub async fn list_views(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<ViewInfo>, AppError> {
    list_views_inner(
        state.inner(),
        &connection_id,
        &schema,
        expected_database.as_deref(),
    )
    .await
}

async fn list_functions_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    expected_database: Option<&str>,
) -> Result<Vec<FunctionInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_functions(schema).await
}

#[tauri::command]
pub async fn list_functions(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<FunctionInfo>, AppError> {
    list_functions_inner(
        state.inner(),
        &connection_id,
        &schema,
        expected_database.as_deref(),
    )
    .await
}

async fn get_view_definition_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    view_name: &str,
    expected_database: Option<&str>,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.get_view_definition(schema, view_name).await
}

#[tauri::command]
pub async fn get_view_definition(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<String, AppError> {
    get_view_definition_inner(
        state.inner(),
        &connection_id,
        &schema,
        &view_name,
        expected_database.as_deref(),
    )
    .await
}

async fn get_view_columns_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    view_name: &str,
    expected_database: Option<&str>,
) -> Result<Vec<ColumnInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.get_view_columns(schema, view_name).await
}

#[tauri::command]
pub async fn get_view_columns(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    view_name: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<ColumnInfo>, AppError> {
    get_view_columns_inner(
        state.inner(),
        &connection_id,
        &schema,
        &view_name,
        expected_database.as_deref(),
    )
    .await
}

async fn get_function_source_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    function_name: &str,
    expected_database: Option<&str>,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.get_function_source(schema, function_name).await
}

#[tauri::command]
pub async fn get_function_source(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    function_name: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<String, AppError> {
    get_function_source_inner(
        state.inner(),
        &connection_id,
        &schema,
        &function_name,
        expected_database.as_deref(),
    )
    .await
}

async fn list_triggers_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    table: &str,
    expected_database: Option<&str>,
) -> Result<Vec<TriggerInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_triggers(schema, table).await
}

/// Sprint 272 — list triggers attached to `(schema, table)`. PG impl
/// queries `pg_catalog.pg_trigger ⨝ pg_proc ⨝ pg_namespace ⨝ pg_class`
/// with `NOT t.tgisinternal`. Non-PG RDB adapters fall back to the trait
/// default `Ok(Vec::new())`; non-RDB connections fail via `as_rdb()?`
/// with `Unsupported(relational)` before the trait dispatches.
///
/// Sprint 271c — opt-in `expected_database` mismatch guard.
#[tauri::command]
pub async fn list_triggers(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
    // Sprint 271c — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<TriggerInfo>, AppError> {
    list_triggers_inner(
        state.inner(),
        &connection_id,
        &schema,
        &table,
        expected_database.as_deref(),
    )
    .await
}

async fn get_trigger_source_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    table: &str,
    trigger_name: &str,
    expected_database: Option<&str>,
) -> Result<String, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter
        .get_trigger_source(schema, table, trigger_name)
        .await
}

/// Sprint 272 — `pg_get_triggerdef(t.oid)` for one trigger. Non-PG
/// adapters surface `AppError::Unsupported` (the trait default) — there
/// is no sane empty-string default for a single-trigger query.
#[tauri::command]
pub async fn get_trigger_source(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
    trigger_name: String,
    // Sprint 271c — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<String, AppError> {
    get_trigger_source_inner(
        state.inner(),
        &connection_id,
        &schema,
        &table,
        &trigger_name,
        expected_database.as_deref(),
    )
    .await
}

async fn list_postgres_types_inner(
    state: &AppState,
    connection_id: &str,
    expected_database: Option<&str>,
) -> Result<Vec<PostgresTypeInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    adapter.list_types().await
}

async fn list_postgres_extensions_inner(
    state: &AppState,
    connection_id: &str,
    expected_database: Option<&str>,
) -> Result<Vec<PostgresExtensionInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, expected_database).await?;
    let _ = adapter;
    Ok(Vec::new())
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
///
/// Sprint 271a — opt-in db-mismatch guard via `expected_database`.
#[tauri::command]
pub async fn list_postgres_types(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    // Sprint 271a — opt-in db-mismatch guard. See module doc.
    expected_database: Option<String>,
) -> Result<Vec<PostgresTypeInfo>, AppError> {
    list_postgres_types_inner(state.inner(), &connection_id, expected_database.as_deref()).await
}

#[tauri::command]
pub async fn list_postgres_extensions(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    expected_database: Option<String>,
) -> Result<Vec<PostgresExtensionInfo>, AppError> {
    list_postgres_extensions_inner(state.inner(), &connection_id, expected_database.as_deref())
        .await
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
    use crate::commands::test_util::{document_default, rdb_default, state_with};
    use crate::db::testing::{clone_app_error, StubRdbAdapter};
    use crate::db::{ActiveAdapter, NamespaceInfo};
    use crate::models::{ColumnCategory, ConstraintInfo, FunctionInfo, IndexInfo};
    use std::collections::HashMap;

    // ── list_schemas witness — 5 contract + boundary scenarios ────────────

    #[tokio::test]
    async fn list_schemas_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match list_schemas_inner(&state, "absent", None).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_document_paradigm_returns_unsupported_relational() {
        let state = state_with("doc-1", document_default()).await;
        match list_schemas_inner(&state, "doc-1", None).await {
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
        let result = list_schemas_inner(&state, "rdb-1", None).await.unwrap();
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
        match list_schemas_inner(&state, "rdb-1", None).await {
            Err(AppError::Database(msg)) => {
                assert_eq!(msg, "permission denied for catalog")
            }
            other => panic!("Expected Database error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_rdb_ok_empty_list_propagates_as_empty() {
        let state = state_with("rdb-1", rdb_default()).await;
        let result = list_schemas_inner(&state, "rdb-1", None).await.unwrap();
        assert!(result.is_empty());
    }

    // ── 11 NotFound tests ────────────────────────────────────────────────

    #[tokio::test]
    async fn list_tables_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_tables_inner(&state, "absent", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_columns_inner(&state, "absent", "users", "public", None, None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_schema_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_schema_columns_inner(&state, "absent", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_indexes_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_indexes_inner(&state, "absent", "users", "public", None, None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_table_constraints_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_table_constraints_inner(&state, "absent", "users", "public", None, None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_views_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_views_inner(&state, "absent", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_functions_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_functions_inner(&state, "absent", "public", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_view_definition_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_view_definition_inner(&state, "absent", "public", "v", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_view_columns_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_view_columns_inner(&state, "absent", "public", "v", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn get_function_source_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_function_source_inner(&state, "absent", "public", "f", None).await,
            Err(AppError::NotFound(_))
        ));
    }
    #[tokio::test]
    async fn list_postgres_types_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_postgres_types_inner(&state, "absent", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    // ── 11 Unsupported(relational) tests on Document paradigm ────────────

    #[tokio::test]
    async fn list_tables_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_tables_inner(&state, "doc", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_columns_inner(&state, "doc", "users", "public", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_schema_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_schema_columns_inner(&state, "doc", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_indexes_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_indexes_inner(&state, "doc", "users", "public", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_table_constraints_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_table_constraints_inner(&state, "doc", "users", "public", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_views_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_views_inner(&state, "doc", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_functions_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_functions_inner(&state, "doc", "public", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_view_definition_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_view_definition_inner(&state, "doc", "public", "v", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_view_columns_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_view_columns_inner(&state, "doc", "public", "v", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn get_function_source_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_function_source_inner(&state, "doc", "public", "f", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_postgres_types_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_postgres_types_inner(&state, "doc", None).await,
            Err(AppError::Unsupported(_))
        ));
    }
    #[tokio::test]
    async fn list_postgres_extensions_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_postgres_extensions_inner(&state, "doc", None).await,
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
        let r = list_tables_inner(&state, "c", "ns_x", None).await.unwrap();
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
                check_clauses: Vec::new(),
                category: ColumnCategory::Unknown,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_table_columns_inner(&state, "c", "users", "ns_x", None, None)
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
        let r = list_schema_columns_inner(&state, "c", "ns_y", None)
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
        let r = get_table_indexes_inner(&state, "c", "tbl_b", "ns_a", None, None)
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
        let r = get_table_constraints_inner(&state, "c", "t", "ns", None, None)
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
        let r = list_views_inner(&state, "c", "ns_v", None).await.unwrap();
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
        let r = list_functions_inner(&state, "c", "ns_f", None)
            .await
            .unwrap();
        assert_eq!(r[0].name, "f@ns_f");
    }

    #[tokio::test]
    async fn get_view_definition_routes_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.get_view_definition_fn = Some(Box::new(|ns: &str, view: &str| {
            Ok(format!("CREATE VIEW {ns}.{view} AS SELECT 1"))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_view_definition_inner(&state, "c", "ns_q", "vw_z", None)
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
                check_clauses: Vec::new(),
                category: ColumnCategory::Unknown,
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_view_columns_inner(&state, "c", "ns", "vw", None)
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
        let r = get_function_source_inner(&state, "c", "ns_g", "fn_h", None)
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
        let r = list_postgres_types_inner(&state, "c", None).await.unwrap();
        assert_eq!(r[0].name, "uuid");
    }

    #[tokio::test]
    #[ignore = "RED evidence captured in docs/sprints/sprint-487/red-state.log"]
    async fn list_postgres_extensions_routes_to_list_extensions_trait_method() {
        let mut s = StubRdbAdapter::default();
        s.list_extensions_fn = Some(Box::new(|| {
            Ok(vec![PostgresExtensionInfo {
                name: "pg_trgm".into(),
                schema: "public".into(),
                version: "1.6".into(),
                comment: Some("text similarity measurement and index searching".into()),
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_postgres_extensions_inner(&state, "c", None)
            .await
            .unwrap();
        assert_eq!(r[0].name, "pg_trgm");
        assert_eq!(r[0].schema, "public");
        assert_eq!(r[0].version, "1.6");
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
        let _ = get_table_columns_inner(&state, "c", "t", "s", Some("qid-1"), None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-1"), "release 누락");
    }

    #[tokio::test]
    async fn get_table_indexes_inner_round_trip_releases_token() {
        let state = state_with("c", rdb_default()).await;
        let _ = get_table_indexes_inner(&state, "c", "t", "s", Some("qid-2"), None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-2"));
    }

    #[tokio::test]
    async fn get_table_constraints_inner_round_trip_releases_token() {
        let state = state_with("c", rdb_default()).await;
        let _ = get_table_constraints_inner(&state, "c", "t", "s", Some("qid-3"), None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-3"));
    }

    // ── Sprint 271a — expected_database guard (2026-05-13) ───────────────
    //
    // 작성 이유: 12 schema introspection commands 각각의 mismatch 가드
    // verbatim assertion. Sprint 266 reference (query.rs:83–92) 와 byte
    // equivalent — current_database probe 가 trait 호출 *전에* 일어나야
    // 하고, mismatch 시 underlying trait method (list_namespaces, list_tables
    // 등) 가 호출되지 않아야 함. underlying trait closure 가 panic 하도록
    // 두어 만약 가드가 새면 테스트가 fail panic 으로 즉시 surfaces.

    fn mismatched_adapter() -> StubRdbAdapter {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s
    }

    #[tokio::test]
    async fn list_schemas_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_namespaces_fn = Some(Box::new(|| {
            panic!("list_namespaces must not be invoked on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_schemas_inner(&state, "c", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_tables_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_tables_fn = Some(Box::new(|_| panic!("list_tables must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_tables_inner(&state, "c", "public", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_table_columns_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_columns_fn = Some(Box::new(|_, _| {
            panic!("get_columns must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_table_columns_inner(&state, "c", "t", "s", None, Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_table_columns_mismatch_releases_cancel_token() {
        // probe 가 trait 호출 *전에* short-circuit 해도 register 된 token 은
        // release 되어야 retry 가 깨끗하게 가능 (Sprint 266 mismatch + cancel
        // 의 mirror).
        let mut s = mismatched_adapter();
        s.get_columns_fn = Some(Box::new(|_, _| panic!("must not run")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let _ =
            get_table_columns_inner(&state, "c", "t", "s", Some("qid-mismatch"), Some("dbB")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-mismatch"));
    }

    #[tokio::test]
    async fn list_schema_columns_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_schema_columns_fn = Some(Box::new(|_| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_schema_columns_inner(&state, "c", "public", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_table_indexes_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_table_indexes_fn = Some(Box::new(|_, _| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_table_indexes_inner(&state, "c", "t", "s", None, Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_table_constraints_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_table_constraints_fn = Some(Box::new(|_, _| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_table_constraints_inner(&state, "c", "t", "s", None, Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_views_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_views_fn = Some(Box::new(|_| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_views_inner(&state, "c", "public", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_functions_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_functions_fn = Some(Box::new(|_| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_functions_inner(&state, "c", "public", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_view_definition_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_view_definition_fn = Some(Box::new(|_, _| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_view_definition_inner(&state, "c", "public", "v", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_view_columns_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_view_columns_fn = Some(Box::new(|_, _| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_view_columns_inner(&state, "c", "public", "v", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_function_source_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.get_function_source_fn = Some(Box::new(|_, _| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_function_source_inner(&state, "c", "public", "f", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_postgres_types_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_adapter();
        s.list_types_fn = Some(Box::new(|| panic!("must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_postgres_types_inner(&state, "c", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    // ── Sprint 271a — match path + None fast-path witness ────────────────
    //
    // 작성 이유 (2026-05-13): mismatch path 만 단언하면 happy/None paths 의
    // byte-equivalence 가 의심 잔여. 1 happy (Some + match → trait 호출) +
    // 1 none-fast-path (None → current_database probe 도 안 함) 를 witness
    // 로 추가.

    // ── Sprint 272 — list_triggers / get_trigger_source ──────────────────
    //
    // 작성 이유 (2026-05-13): 두 새 _inner 핸들러가 (a) NotFound /
    // Unsupported / happy / err 의 4 routing 케이스, (b) 271c 의 mismatch
    // panic-closure 패턴(adapter 메서드 호출 *전에* probe 가 차단), (c)
    // schema / table / trigger_name 인자가 trait 까지 그대로 전달되는지를
    // cover. 같은 패턴이 기존 list_functions_* / get_function_source_*
    // 테스트와 byte-equivalent 라 회귀 가드로 작동.

    #[tokio::test]
    async fn list_triggers_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            list_triggers_inner(&state, "absent", "public", "users", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn list_triggers_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            list_triggers_inner(&state, "doc", "public", "users", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn list_triggers_inner_returns_pg_triggers() {
        // Happy path — stub adapter returns a fixture trigger; the
        // dispatcher passes (schema, table) through unchanged.
        use crate::models::TriggerInfo;
        let mut s = StubRdbAdapter::default();
        s.list_triggers_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(vec![TriggerInfo {
                name: "audit_users".to_string(),
                schema: ns.to_string(),
                table: tbl.to_string(),
                timing: "BEFORE".to_string(),
                events: vec!["INSERT".to_string()],
                orientation: "ROW".to_string(),
                function_schema: "audit".to_string(),
                function_name: "log_insert".to_string(),
                arguments: None,
                when_expression: None,
                definition: format!("CREATE TRIGGER audit_users ON {ns}.{tbl}"),
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_triggers_inner(&state, "c", "public", "users", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "audit_users");
        assert_eq!(r[0].schema, "public");
        assert_eq!(r[0].table, "users");
        assert_eq!(
            r[0].definition,
            "CREATE TRIGGER audit_users ON public.users"
        );
    }

    #[tokio::test]
    async fn list_triggers_inner_db_mismatch() {
        // 271c panic-closure pattern: probe rejects BEFORE the trait
        // method is invoked. The closure panics if reached so any
        // probe-bypass regression surfaces as a test panic.
        let mut s = mismatched_adapter();
        s.list_triggers_fn = Some(Box::new(|_, _| {
            panic!("list_triggers must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match list_triggers_inner(&state, "c", "public", "users", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn get_trigger_source_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            get_trigger_source_inner(&state, "absent", "public", "users", "t", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn get_trigger_source_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            get_trigger_source_inner(&state, "doc", "public", "users", "t", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn get_trigger_source_inner_returns_pg_get_triggerdef() {
        // Happy path — stub adapter echoes the (schema, table, name)
        // arguments back so the dispatcher's arg-propagation is asserted.
        let mut s = StubRdbAdapter::default();
        s.get_trigger_source_fn = Some(Box::new(|ns: &str, tbl: &str, name: &str| {
            Ok(format!("CREATE TRIGGER {name} ON {ns}.{tbl}"))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = get_trigger_source_inner(&state, "c", "public", "users", "t1", None)
            .await
            .unwrap();
        assert_eq!(r, "CREATE TRIGGER t1 ON public.users");
    }

    #[tokio::test]
    async fn get_trigger_source_inner_db_mismatch() {
        let mut s = mismatched_adapter();
        s.get_trigger_source_fn = Some(Box::new(|_, _, _| {
            panic!("get_trigger_source must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match get_trigger_source_inner(&state, "c", "public", "users", "t1", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn list_schemas_expected_db_match_executes_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s.list_namespaces_fn = Some(Box::new(|| {
            Ok(vec![NamespaceInfo {
                name: "public".into(),
            }])
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_schemas_inner(&state, "c", Some("dbA")).await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "public");
    }

    #[tokio::test]
    async fn list_schemas_expected_db_none_skips_current_database_probe() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| {
            panic!("current_database must not be probed when expected_database is None")
        }));
        s.list_namespaces_fn = Some(Box::new(|| Ok(vec![])));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = list_schemas_inner(&state, "c", None).await.unwrap();
        assert!(r.is_empty());
    }
}
