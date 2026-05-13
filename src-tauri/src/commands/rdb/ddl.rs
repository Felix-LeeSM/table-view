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
//!
//! Sprint 271c (2026-05-13) — every `*Request` struct gains an opt-in
//! `expected_database: Option<String>` field (`#[serde(default)]`). When
//! the caller passes `Some(expected)`, each `_inner` probes
//! `adapter.current_database()` under the same `active_connections.lock()`
//! acquisition that wraps the dispatch (via shared `ensure_expected_db`
//! helper hoisted from `schema.rs` to `super`) and returns
//! `AppError::DbMismatch` BEFORE invoking the trait method. The `None`
//! path is byte-equivalent to pre-Sprint-271 (no probe overhead). Mirrors
//! the Sprint 266 reference probe at `commands/rdb/query.rs:83–92`.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, CreateIndexRequest,
    CreateTablePlanRequest, CreateTableRequest, CreateTriggerRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, DropTriggerRequest,
    RenameTableRequest, SchemaChangeResult,
};

use super::{ensure_expected_db, not_connected};

async fn drop_table_inner(
    state: &AppState,
    request: &DropTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.drop_table(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.rename_table(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.alter_table(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.add_column(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.drop_column(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.create_table(request).await
}

#[tauri::command]
pub async fn create_table(
    state: tauri::State<'_, AppState>,
    request: CreateTableRequest,
) -> Result<SchemaChangeResult, AppError> {
    create_table_inner(state.inner(), &request).await
}

async fn create_table_plan_inner(
    state: &AppState,
    request: &CreateTablePlanRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.create_table_plan(request).await
}

/// Sprint 240 — unified `CREATE TABLE + indexes + constraints` handler.
/// Single round-trip server-side preview (frontend was fanning out
/// 1+N+M IPC calls per dialog refresh pre-Sprint-240).
#[tauri::command]
pub async fn create_table_plan(
    state: tauri::State<'_, AppState>,
    request: CreateTablePlanRequest,
) -> Result<SchemaChangeResult, AppError> {
    create_table_plan_inner(state.inner(), &request).await
}

async fn create_index_inner(
    state: &AppState,
    request: &CreateIndexRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.create_index(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.drop_index(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.add_constraint(request).await
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
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.drop_constraint(request).await
}

#[tauri::command]
pub async fn drop_constraint(
    state: tauri::State<'_, AppState>,
    request: DropConstraintRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_constraint_inner(state.inner(), &request).await
}

async fn create_trigger_inner(
    state: &AppState,
    request: &CreateTriggerRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.create_trigger(request).await
}

/// Sprint 273 — `CREATE TRIGGER` handler. Mirrors `create_table` /
/// `drop_table` body shape: lock connections, dispatch through
/// `as_rdb()`, optional `ensure_expected_db` probe, delegate to the
/// trait method. PG concrete impl validates identifiers / whitelists,
/// emits canonical SQL, and (when `req.preview_only == false`) wraps in
/// `BEGIN/COMMIT`. Non-PG RDB adapters surface `Unsupported` via the
/// trait default.
#[tauri::command]
pub async fn create_trigger(
    state: tauri::State<'_, AppState>,
    request: CreateTriggerRequest,
) -> Result<SchemaChangeResult, AppError> {
    create_trigger_inner(state.inner(), &request).await
}

async fn drop_trigger_inner(
    state: &AppState,
    request: &DropTriggerRequest,
) -> Result<SchemaChangeResult, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&request.connection_id)
        .ok_or_else(|| not_connected(&request.connection_id))?;
    let adapter = active.as_rdb()?;
    ensure_expected_db(adapter, request.expected_database.as_deref()).await?;
    adapter.drop_trigger(request).await
}

/// Sprint 274 — `DROP TRIGGER` handler. Mirrors `create_trigger` /
/// `drop_table` body shape: lock connections, dispatch through
/// `as_rdb()`, optional `ensure_expected_db` probe, delegate to the
/// trait method. PG concrete impl validates identifiers, emits canonical
/// SQL with optional CASCADE suffix, and (when `req.preview_only ==
/// false`) wraps in `sqlx::Transaction::begin/commit`. Non-PG RDB
/// adapters surface `Unsupported` via the trait default.
#[tauri::command]
pub async fn drop_trigger(
    state: tauri::State<'_, AppState>,
    request: DropTriggerRequest,
) -> Result<SchemaChangeResult, AppError> {
    drop_trigger_inner(state.inner(), &request).await
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
            expected_database: None,
        }
    }
    fn rename_table_req(id: &str) -> RenameTableRequest {
        RenameTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            new_name: "users_archived".into(),
            preview_only: true,
            expected_database: None,
        }
    }
    fn alter_table_req(id: &str) -> AlterTableRequest {
        AlterTableRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            changes: Vec::<ColumnChange>::new(),
            preview_only: true,
            expected_database: None,
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
                is_identity: false,
            },
            check_expression: None,
            preview_only: true,
            expected_database: None,
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
            expected_database: None,
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
            expected_database: None,
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
            expected_database: None,
        }
    }
    fn drop_index_req(id: &str) -> DropIndexRequest {
        DropIndexRequest {
            connection_id: id.into(),
            schema: "public".into(),
            index_name: "idx_x".into(),
            if_exists: false,
            preview_only: true,
            expected_database: None,
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
            expected_database: None,
        }
    }
    fn drop_constraint_req(id: &str) -> DropConstraintRequest {
        DropConstraintRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            constraint_name: "uq_x".into(),
            preview_only: true,
            expected_database: None,
        }
    }
    fn create_trigger_req(id: &str) -> CreateTriggerRequest {
        CreateTriggerRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            trigger_name: "tg_audit".into(),
            timing: "BEFORE".into(),
            events: vec!["INSERT".into()],
            orientation: "ROW".into(),
            when_expression: None,
            function_schema: "audit".into(),
            function_name: "log".into(),
            function_arguments: None,
            preview_only: true,
            expected_database: None,
        }
    }
    fn drop_trigger_req(id: &str) -> DropTriggerRequest {
        DropTriggerRequest {
            connection_id: id.into(),
            schema: "public".into(),
            table: "users".into(),
            trigger_name: "tg_audit".into(),
            cascade: false,
            preview_only: true,
            expected_database: None,
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

    // ── Sprint 271c — expected_database guard (2026-05-13) ────────────────
    //
    // 작성 이유: 11 DDL commands 각각의 mismatch 가드 verbatim assertion.
    // Sprint 266 reference (`query.rs:83–92`) 와 byte-equivalent — probe 가
    // trait 호출 *전에* 일어나고 mismatch 시 underlying trait method
    // (drop_table_sql 등) 가 호출되지 않아야 함. trait closure 가 panic
    // 하도록 두어 가드가 새면 fail-loud. 슬라이스 271a 의 schema 측
    // mismatched_adapter / panic-closure 패턴 재사용.

    fn mismatched_rdb() -> StubRdbAdapter {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s
    }

    fn with_expected(mut req: AlterTableRequest, db: &str) -> AlterTableRequest {
        req.expected_database = Some(db.into());
        req
    }

    #[tokio::test]
    async fn drop_table_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.drop_table_fn = Some(Box::new(|_| panic!("drop_table must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_table_req("c");
        req.expected_database = Some("dbB".into());
        match drop_table_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn rename_table_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.rename_table_fn = Some(Box::new(|_| {
            panic!("rename_table must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = rename_table_req("c");
        req.expected_database = Some("dbB".into());
        match rename_table_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn alter_table_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.alter_table_fn = Some(Box::new(|_| panic!("alter_table must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let req = with_expected(alter_table_req("c"), "dbB");
        match alter_table_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn add_column_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.add_column_fn = Some(Box::new(|_| panic!("add_column must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = add_column_req("c");
        req.expected_database = Some("dbB".into());
        match add_column_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_column_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.drop_column_fn = Some(Box::new(|_| panic!("drop_column must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_column_req("c");
        req.expected_database = Some("dbB".into());
        match drop_column_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_table_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.create_table_fn = Some(Box::new(|_| {
            panic!("create_table must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = create_table_req("c");
        req.expected_database = Some("dbB".into());
        match create_table_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_table_plan_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        // `create_table_plan` 의 trait 디폴트 구현은 `create_table` 등을 chain
        // 호출하므로 mismatch 시 어떤 child 도 트리거되면 panic 으로 surface.
        let mut s = mismatched_rdb();
        s.create_table_fn = Some(Box::new(|_| {
            panic!("create_table must not run on mismatch (chained from plan)")
        }));
        s.create_index_fn = Some(Box::new(|_| {
            panic!("create_index must not run on mismatch")
        }));
        s.add_constraint_fn = Some(Box::new(|_| {
            panic!("add_constraint must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let req = CreateTablePlanRequest {
            connection_id: "c".into(),
            schema: "public".into(),
            name: "new_table".into(),
            columns: Vec::new(),
            primary_key: None,
            table_comment: None,
            indexes: Vec::new(),
            constraints: Vec::new(),
            preview_only: true,
            expected_database: Some("dbB".into()),
        };
        match create_table_plan_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn create_index_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.create_index_fn = Some(Box::new(|_| {
            panic!("create_index must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = create_index_req("c");
        req.expected_database = Some("dbB".into());
        match create_index_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_index_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.drop_index_fn = Some(Box::new(|_| panic!("drop_index must not run on mismatch")));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_index_req("c");
        req.expected_database = Some("dbB".into());
        match drop_index_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn add_constraint_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.add_constraint_fn = Some(Box::new(|_| {
            panic!("add_constraint must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = add_constraint_req("c");
        req.expected_database = Some("dbB".into());
        match add_constraint_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn drop_constraint_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.drop_constraint_fn = Some(Box::new(|_| {
            panic!("drop_constraint must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_constraint_req("c");
        req.expected_database = Some("dbB".into());
        match drop_constraint_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    // ── Sprint 271c — match + None fast-path witness (2026-05-13) ─────────
    //
    // 작성 이유: mismatch 만 단언하면 happy / None paths 의 byte-equivalence
    // 가 의심 잔여. 1 happy (Some + match → trait 호출 정상) + 1 none-fast-
    // path (None → current_database probe 도 skip) 를 witness 로 추가.
    // drop_table 을 sample 로 채택 — request-shape 의 다른 DDL 와 probe 코드
    // 가 완전 동일하므로 sample 1 개로 invariant 보존 충분.

    #[tokio::test]
    async fn drop_table_expected_db_match_executes_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s.drop_table_fn = Some(Box::new(|_| {
            Ok(SchemaChangeResult {
                sql: "DROP TABLE x".into(),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_table_req("c");
        req.expected_database = Some("dbA".into());
        let result = drop_table_inner(&state, &req).await.unwrap();
        assert_eq!(result.sql, "DROP TABLE x");
    }

    #[tokio::test]
    async fn drop_table_expected_db_none_skips_current_database_probe() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| {
            panic!("current_database must not be probed when expected_database is None")
        }));
        s.drop_table_fn = Some(Box::new(|_| {
            Ok(SchemaChangeResult {
                sql: "DROP TABLE x".into(),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        // drop_table_req sets expected_database=None by default builder construction.
        let req = drop_table_req("c");
        assert!(
            req.expected_database.is_none(),
            "builder default must be None"
        );
        let result = drop_table_inner(&state, &req).await.unwrap();
        assert_eq!(result.sql, "DROP TABLE x");
    }

    // ── Sprint 273 — create_trigger 4-step contract ─────────────────
    //
    // 작성 이유 (2026-05-13): trigger CREATE 핸들러도 `_inner` 4-step
    // contract (NotFound / Unsupported / trait wiring / DbMismatch) 를
    // 보장한다. mismatch panic-closure 는 Sprint 271c 패턴 재사용 —
    // current_database 가 `dbA` 인데 expected 가 `dbB` 면 trait 호출
    // 전에 DbMismatch 가 surface 되고 stub closure 가 panic 하지 않아야
    // 한다.

    #[tokio::test]
    async fn create_trigger_routes_to_create_trigger_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = create_trigger_inner(&state, &create_trigger_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "create_trigger");
    }

    #[tokio::test]
    async fn create_trigger_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            create_trigger_inner(&state, &create_trigger_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn create_trigger_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            create_trigger_inner(&state, &create_trigger_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn create_trigger_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.create_trigger_fn = Some(Box::new(|_| {
            panic!("create_trigger must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = create_trigger_req("c");
        req.expected_database = Some("dbB".into());
        match create_trigger_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    // ── Sprint 274 — drop_trigger 4-step contract ───────────────────
    //
    // 작성 이유 (2026-05-13): trigger DROP 핸들러도 `_inner` 4-step
    // contract (NotFound / Unsupported / trait wiring / DbMismatch) 를
    // 보장한다. mismatch panic-closure 는 Sprint 271c 패턴 재사용 —
    // current_database 가 `dbA` 인데 expected 가 `dbB` 면 trait 호출
    // 전에 DbMismatch 가 surface 되고 stub closure 가 panic 하지 않아야
    // 한다. 시그니처가 `create_trigger` 와 byte-equivalent 이므로 동일한
    // 4 cases (wiring / NotFound / Unsupported / mismatch) 로 충분.

    #[tokio::test]
    async fn drop_trigger_routes_to_drop_trigger_trait_method() {
        let state = state_with("c", rdb_default()).await;
        let r = drop_trigger_inner(&state, &drop_trigger_req("c"))
            .await
            .unwrap();
        assert_eq!(r.sql, "drop_trigger");
    }

    #[tokio::test]
    async fn drop_trigger_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            drop_trigger_inner(&state, &drop_trigger_req("absent")).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn drop_trigger_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            drop_trigger_inner(&state, &drop_trigger_req("doc")).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn drop_trigger_expected_db_mismatch_returns_dbmismatch_and_skips_trait() {
        let mut s = mismatched_rdb();
        s.drop_trigger_fn = Some(Box::new(|_| {
            panic!("drop_trigger must not run on mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let mut req = drop_trigger_req("c");
        req.expected_database = Some("dbB".into());
        match drop_trigger_inner(&state, &req).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }
}
