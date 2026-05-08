//! RDB schema-mutating commands (DDL).
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.
//!
//! Sprint 237 P5 (2026-05-08) — handler bodies hoisted into
//! `_inner(&AppState, &Request)` shape so unit tests can drive prod code
//! directly without a `tauri::State` mock.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, CreateIndexRequest,
    CreateTableRequest, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, RenameTableRequest, SchemaChangeResult,
};

use super::not_connected;

async fn drop_table_inner(
    state: &AppState,
    request: &DropTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_table(request).await
}

/// Sprint 235 — request-shaped DROP TABLE handler. Mirrors `create_table`
/// / `alter_table`: single `request: DropTableRequest` arg, returns
/// `SchemaChangeResult { sql }`. Tauri command name unchanged
/// (`drop_table`); the IPC payload shape changes from positional scalars
/// to `{ request: { connectionId, schema, table, cascade?, previewOnly? } }`.
#[tauri::command]
pub async fn drop_table(
    state: tauri::State<'_, AppState>,
    request: DropTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_table_inner(state.inner(), &request).await
}

async fn rename_table_inner(
    state: &AppState,
    request: &RenameTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.rename_table(request).await
}

/// Sprint 235 — request-shaped RENAME TABLE handler. Same shape as
/// `drop_table` / `create_table`.
#[tauri::command]
pub async fn rename_table(
    state: tauri::State<'_, AppState>,
    request: RenameTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    rename_table_inner(state.inner(), &request).await
}

async fn alter_table_inner(
    state: &AppState,
    request: &AlterTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.alter_table(request).await
}

#[tauri::command]
pub async fn alter_table(
    state: tauri::State<'_, AppState>,
    request: AlterTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    alter_table_inner(state.inner(), &request).await
}

async fn add_column_inner(
    state: &AppState,
    request: &AddColumnRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.add_column(request).await
}

/// Sprint 236 — request-shaped ADD COLUMN handler. Mirrors
/// `rename_table` / `drop_table` body shape: lock connections, dispatch
/// through `as_rdb()`, delegate to the trait method.
#[tauri::command]
pub async fn add_column(
    state: tauri::State<'_, AppState>,
    request: AddColumnRequest,
) -> Result<SchemaChangeResult, AppError> {
    add_column_inner(state.inner(), &request).await
}

async fn drop_column_inner(
    state: &AppState,
    request: &DropColumnRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_column(request).await
}

/// Sprint 236 — request-shaped DROP COLUMN handler. Same shape as
/// `add_column`.
#[tauri::command]
pub async fn drop_column(
    state: tauri::State<'_, AppState>,
    request: DropColumnRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_column_inner(state.inner(), &request).await
}

async fn create_table_inner(
    state: &AppState,
    request: &CreateTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.create_table(request).await
}

#[tauri::command]
pub async fn create_table(
    state: tauri::State<'_, AppState>,
    request: CreateTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    create_table_inner(state.inner(), &request).await
}

async fn create_index_inner(
    state: &AppState,
    request: &CreateIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.create_index(request).await
}

#[tauri::command]
pub async fn create_index(
    state: tauri::State<'_, AppState>,
    request: CreateIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    create_index_inner(state.inner(), &request).await
}

async fn drop_index_inner(
    state: &AppState,
    request: &DropIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_index(request).await
}

#[tauri::command]
pub async fn drop_index(
    state: tauri::State<'_, AppState>,
    request: DropIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_index_inner(state.inner(), &request).await
}

async fn add_constraint_inner(
    state: &AppState,
    request: &AddConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.add_constraint(request).await
}

#[tauri::command]
pub async fn add_constraint(
    state: tauri::State<'_, AppState>,
    request: AddConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    add_constraint_inner(state.inner(), &request).await
}

async fn drop_constraint_inner(
    state: &AppState,
    request: &DropConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    active.as_rdb()?.drop_constraint(request).await
}

#[tauri::command]
pub async fn drop_constraint(
    state: tauri::State<'_, AppState>,
    request: DropConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_constraint_inner(state.inner(), &request).await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    //! 작성 이유 (Sprint 237 P5, 2026-05-08): RDB DDL 10 핸들러를
    //! `_inner(&AppState, &Request)` 로 추출했으니 테스트가 prod `_inner` 를
    //! 직접 호출. 4-step contract:
    //!   1. active_connections lookup → miss → AppError::NotFound
    //!   2. as_rdb()? → 비-RDB paradigm → AppError::Unsupported(relational)
    //!   3. trait method 위임 → adapter Err → 변형 없이 propagate
    //!   4. trait method 위임 → adapter Ok → SchemaChangeResult propagate
    //!
    //! drop_table 을 4-step witness 로 검증, 나머지 9 commands 는 wiring
    //! (default StubRdbAdapter sentinel sql="<method>") + NotFound +
    //! Unsupported × 9 = 27 추가. not_connected helper format 1 test 포함.
    //! 32 tests 전체.

    use super::*;
    use crate::commands::test_util::{document_default, rdb_default, state_with};
    use crate::db::testing::{clone_app_error, StubRdbAdapter};
    use crate::db::ActiveAdapter;
    use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};

    fn rdb_with_drop_table_outcome(outcome: Result<SchemaChangeResult, AppError>) -> ActiveAdapter {
        let mut s = StubRdbAdapter::default();
        s.drop_table_fn = Some(Box::new(move |_| match &outcome {
            Ok(r) => Ok(SchemaChangeResult { sql: r.sql.clone() }),
            Err(e) => Err(clone_app_error(e)),
        }));
        ActiveAdapter::Rdb(Box::new(s))
    }

    // ── Request 빌더 ─────────────────────────────────────────────────────

    fn drop_table_req(id: &str) -> DropTableRequest {
        DropTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            cascade: false,
            preview_only: true,
        }
    }
    fn rename_table_req(id: &str) -> RenameTableRequest {
        RenameTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            new_name: "users_archived".into(),
            preview_only: true,
        }
    }
    fn alter_table_req(id: &str) -> AlterTableRequest {
        AlterTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            changes: Vec::<ColumnChange>::new(),
            preview_only: true,
        }
    }
    fn add_column_req(id: &str) -> AddColumnRequest {
        AddColumnRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            column: ColumnDefinition {
                name: "x".into(),
                data_type: "TEXT".into(),
                nullable: true,
                default_value: None,
                comment: None,
            },
            check_expression: None,
            preview_only: true,
        }
    }
    fn drop_column_req(id: &str) -> DropColumnRequest {
        DropColumnRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            column_name: "x".into(),
            cascade: false,
            preview_only: true,
        }
    }
    fn create_table_req(id: &str) -> CreateTableRequest {
        CreateTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            name: "new_table".into(),
            columns: Vec::new(),
            primary_key: None,
            preview_only: true,
            table_comment: None,
        }
    }
    fn create_index_req(id: &str) -> CreateIndexRequest {
        CreateIndexRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            index_name: "idx_x".into(),
            columns: vec!["x".into()],
            index_type: "btree".into(),
            is_unique: false,
            preview_only: true,
        }
    }
    fn drop_index_req(id: &str) -> DropIndexRequest {
        DropIndexRequest {
            connection_id: id.into(),
            schema: "public".into(),
            index_name: "idx_x".into(),
            if_exists: false,
            preview_only: true,
        }
    }
    fn add_constraint_req(id: &str) -> AddConstraintRequest {
        AddConstraintRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            constraint_name: "uq_x".into(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["x".into()],
            },
            preview_only: true,
        }
    }
    fn drop_constraint_req(id: &str) -> DropConstraintRequest {
        DropConstraintRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            constraint_name: "uq_x".into(),
            preview_only: true,
        }
    }

    // ── not_connected helper ────────────────────────────────────────────

    /// S0 — `not_connected(id)` 가 NotFound variant 사용 + id 메시지 포함.
    #[test]
    fn not_connected_helper_uses_notfound_with_id_in_message() {
        match not_connected("missing-id-42") {
            AppError::NotFound(msg) => {
                assert!(msg.contains("missing-id-42"), "id 누락: {msg}")
            }
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    // ── drop_table 4-step contract ──────────────────────────────────────

    /// S1 — 등록되지 않은 connection_id → NotFound, id 포함.
    #[tokio::test]
    async fn drop_table_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match drop_table_inner(&state, &drop_table_req("absent")).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    /// S2 — Document paradigm → Unsupported(relational).
    #[tokio::test]
    async fn drop_table_document_paradigm_returns_unsupported_relational() {
        let state = state_with("doc-1", document_default()).await;
        match drop_table_inner(&state, &drop_table_req("doc-1")).await {
            Err(AppError::Unsupported(msg)) => {
                assert!(msg.contains("relational"), "kw 'relational' 누락: {msg}")
            }
            other => panic!("Expected Unsupported, got: {:?}", other),
        }
    }

    /// S3 — RDB Ok → SchemaChangeResult propagate verbatim.
    #[tokio::test]
    async fn drop_table_rdb_ok_propagates_payload_verbatim() {
        let sql = "DROP TABLE \"public\".\"users\";";
        let state = state_with(
            "rdb-1",
            rdb_with_drop_table_outcome(Ok(SchemaChangeResult { sql: sql.into() })),
        )
        .await;
        let result = drop_table_inner(&state, &drop_table_req("rdb-1"))
            .await
            .unwrap();
        assert_eq!(result.sql, sql);
    }

    /// S4 — RDB Err → Database/Connection/Validation/... 변형 없이 propagate.
    #[tokio::test]
    async fn drop_table_rdb_err_propagates_verbatim() {
        let state = state_with(
            "rdb-1",
            rdb_with_drop_table_outcome(Err(AppError::Database(
                "pg backend: relation does not exist".into(),
            ))),
        )
        .await;
        match drop_table_inner(&state, &drop_table_req("rdb-1")).await {
            Err(AppError::Database(msg)) => {
                assert_eq!(msg, "pg backend: relation does not exist")
            }
            other => panic!("Expected Database error, got: {:?}", other),
        }
    }

    // ── 9 wiring tests — default StubRdbAdapter sql="<method>" ──────────

    #[tokio::test]
    async fn rename_table_routes_to_rename_table_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = rename_table_inner(&state, &rename_table_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "rename_table");
    }

    #[tokio::test]
    async fn alter_table_routes_to_alter_table_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = alter_table_inner(&state, &alter_table_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "alter_table");
    }

    #[tokio::test]
    async fn add_column_routes_to_add_column_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = add_column_inner(&state, &add_column_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "add_column");
    }

    #[tokio::test]
    async fn drop_column_routes_to_drop_column_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = drop_column_inner(&state, &drop_column_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "drop_column");
    }

    #[tokio::test]
    async fn create_table_routes_to_create_table_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = create_table_inner(&state, &create_table_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "create_table");
    }

    #[tokio::test]
    async fn create_index_routes_to_create_index_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = create_index_inner(&state, &create_index_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "create_index");
    }

    #[tokio::test]
    async fn drop_index_routes_to_drop_index_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = drop_index_inner(&state, &drop_index_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "drop_index");
    }

    #[tokio::test]
    async fn add_constraint_routes_to_add_constraint_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = add_constraint_inner(&state, &add_constraint_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "add_constraint");
    }

    #[tokio::test]
    async fn drop_constraint_routes_to_drop_constraint_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = drop_constraint_inner(&state, &drop_constraint_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "drop_constraint");
    }

    // ── 9 commands × 2 negative scenarios = 18 tests ────────────────────

    #[tokio::test]
    async fn rename_table_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            rename_table_inner(&state, &rename_table_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn rename_table_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            rename_table_inner(&state, &rename_table_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn alter_table_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            alter_table_inner(&state, &alter_table_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn alter_table_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            alter_table_inner(&state, &alter_table_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn add_column_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            add_column_inner(&state, &add_column_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn add_column_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            add_column_inner(&state, &add_column_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn drop_column_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            drop_column_inner(&state, &drop_column_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_column_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            drop_column_inner(&state, &drop_column_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn create_table_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            create_table_inner(&state, &create_table_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn create_table_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            create_table_inner(&state, &create_table_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn create_index_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            create_index_inner(&state, &create_index_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn create_index_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            create_index_inner(&state, &create_index_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn drop_index_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            drop_index_inner(&state, &drop_index_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_index_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            drop_index_inner(&state, &drop_index_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn add_constraint_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            add_constraint_inner(&state, &add_constraint_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn add_constraint_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            add_constraint_inner(&state, &add_constraint_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn drop_constraint_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            drop_constraint_inner(&state, &drop_constraint_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_constraint_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            drop_constraint_inner(&state, &drop_constraint_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }
}
