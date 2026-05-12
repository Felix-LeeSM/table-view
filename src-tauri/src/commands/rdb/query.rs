//! RDB query execution, cancellation, and tabular paging.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{FilterCondition, QueryResult, TableData};

use super::{not_connected, register_cancel_token, release_cancel_token};

/// Validate query execution inputs.
///
/// Returns `Ok(())` if inputs are valid, or `Err(AppError::Validation)` otherwise.
/// Extracted as a separate function so it can be unit-tested without Tauri AppState.
pub fn validate_query_inputs(sql: &str, connection_id: &str) -> Result<(), AppError> {
    if sql.trim().is_empty() {
        return Err(AppError::Validation("SQL query cannot be empty".into()));
    }

    if connection_id.trim().is_empty() {
        return Err(AppError::Validation("Connection ID cannot be empty".into()));
    }

    Ok(())
}

/// Validate cancel_query inputs.
///
/// Returns `Ok(())` if the query_id is valid, or `Err(AppError::Validation)` otherwise.
pub fn validate_cancel_inputs(query_id: &str) -> Result<(), AppError> {
    if query_id.trim().is_empty() {
        return Err(AppError::Validation("Query ID cannot be empty".into()));
    }
    Ok(())
}

async fn execute_query_inner(
    state: &AppState,
    connection_id: &str,
    sql: &str,
    query_id: &str,
    expected_database: Option<&str>,
) -> Result<QueryResult, AppError> {
    info!(
        connection_id = %connection_id,
        query_id = %query_id,
        sql_len = sql.len(),
        "Executing query"
    );

    validate_query_inputs(sql, connection_id)?;

    // Register the cancellation token via the shared rdb/mod helper so this
    // command's lifecycle matches schema introspection commands (audit m14).
    let cancel_handle = register_cancel_token(state, Some(query_id)).await;
    let child_token = cancel_handle.as_ref().map(|(_, t)| t.clone());

    // Execute the query through the enum dispatch. We hold the
    // `active_connections` lock for the duration of the query — the same
    // shape used by every other RDB command post Sprint 64 — which is safe
    // because PostgresAdapter's inherent `execute_query` drives the query
    // through an internal pool guarded by its own `Arc<Mutex<…>>`.
    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        // Sprint 266 — opt-in db-mismatch guard. When the caller passes
        // `expected_database` we sample the adapter's current db inside
        // the same lock acquisition and refuse the execute if the backend
        // pool has been swapped out from under us (e.g. concurrent
        // `switch_active_db` from DbSwitcher). PG's sub-pool model
        // already routes by db, but MySQL/SQLite carry stateful `USE` /
        // `ATTACH` semantics — this guard is the cheapest correctness
        // floor without rewriting every RDB command signature.
        if let Some(expected) = expected_database {
            let actual = adapter.current_database().await?.unwrap_or_default();
            if actual != expected {
                release_cancel_token(state, &cancel_handle).await;
                return Err(AppError::DbMismatch {
                    expected: expected.to_string(),
                    actual,
                });
            }
        }
        adapter.execute_sql(sql, child_token.as_ref()).await
    };

    release_cancel_token(state, &cancel_handle).await;

    // Log execution time
    if let Ok(ref result) = result {
        info!(
            query_id = %query_id,
            execution_time_ms = result.execution_time_ms,
            total_count = result.total_count,
            "Query executed successfully"
        );
    } else if let Err(ref e) = result {
        warn!(
            query_id = %query_id,
            error = %e,
            "Query execution failed"
        );
    }

    result
}

/// Execute an arbitrary SQL query on the specified connection.
///
/// # Arguments
/// * `state` - Application state containing active connections
/// * `connection_id` - ID of the connection to use
/// * `sql` - SQL query to execute
/// * `query_id` - Unique identifier for this query (used for cancellation)
///
/// # Returns
/// * `QueryResult` - Query execution results including columns, rows, timing
/// Sprint 266 — `expected_database` is an optional db-mismatch guard. When
/// the caller provides it the backend verifies the adapter's active db
/// matches before dispatching the query; mismatch surfaces as
/// `AppError::DbMismatch`. Passing `None` preserves the pre-Sprint-266
/// fast-path (no current_database probe).
#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
    query_id: String,
    expected_database: Option<String>,
) -> Result<QueryResult, AppError> {
    execute_query_inner(
        state.inner(),
        &connection_id,
        &sql,
        &query_id,
        expected_database.as_deref(),
    )
    .await
}

async fn execute_query_batch_inner(
    state: &AppState,
    connection_id: &str,
    statements: &[String],
    query_id: &str,
    expected_database: Option<&str>,
) -> Result<Vec<QueryResult>, AppError> {
    info!(
        connection_id = %connection_id,
        query_id = %query_id,
        batch_size = statements.len(),
        "Executing query batch"
    );

    if connection_id.trim().is_empty() {
        return Err(AppError::Validation("Connection ID cannot be empty".into()));
    }
    if statements.is_empty() {
        return Err(AppError::Validation("Query batch cannot be empty".into()));
    }
    for (idx, sql) in statements.iter().enumerate() {
        if sql.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "Statement {} of {} is empty",
                idx + 1,
                statements.len()
            )));
        }
    }

    let cancel_handle = register_cancel_token(state, Some(query_id)).await;
    let child_token = cancel_handle.as_ref().map(|(_, t)| t.clone());

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        // Sprint 266 — opt-in db-mismatch guard. Sampled once at batch
        // start; mid-batch `USE other_db` style stateful statements stay
        // unguarded (per spec §AC-266-03).
        if let Some(expected) = expected_database {
            let actual = adapter.current_database().await?.unwrap_or_default();
            if actual != expected {
                release_cancel_token(state, &cancel_handle).await;
                return Err(AppError::DbMismatch {
                    expected: expected.to_string(),
                    actual,
                });
            }
        }
        adapter
            .execute_sql_batch(statements, child_token.as_ref())
            .await
    };

    release_cancel_token(state, &cancel_handle).await;

    match &result {
        Ok(results) => info!(
            query_id = %query_id,
            executed = results.len(),
            "Query batch committed"
        ),
        Err(e) => warn!(
            query_id = %query_id,
            batch_size = statements.len(),
            error = %e,
            "Query batch failed"
        ),
    }

    result
}

/// Sprint 183 — execute a batch of SQL statements inside a single
/// transaction (BEGIN/COMMIT/ROLLBACK). All-or-nothing: a failure on
/// statement K causes statements 1..K-1 to be rolled back and the original
/// failure to surface as `AppError::Database("statement K of N failed: ...")`.
///
/// Used by the inline-edit commit pipeline (Sprint 182 SQL Preview Dialog →
/// Commit). Pre-Sprint-183 the frontend looped over `execute_query`, which
/// applied earlier statements before the failure surfaced; that left rows
/// in inconsistent state on partial failure. The batch command makes the
/// commit atomic.
/// Sprint 266 — see `execute_query` doc on `expected_database`.
#[tauri::command]
pub async fn execute_query_batch(
    state: State<'_, AppState>,
    connection_id: String,
    statements: Vec<String>,
    query_id: String,
    expected_database: Option<String>,
) -> Result<Vec<QueryResult>, AppError> {
    execute_query_batch_inner(
        state.inner(),
        &connection_id,
        &statements,
        &query_id,
        expected_database.as_deref(),
    )
    .await
}

async fn execute_query_dry_run_inner(
    state: &AppState,
    connection_id: &str,
    statements: &[String],
    query_id: &str,
) -> Result<Vec<QueryResult>, AppError> {
    info!(
        connection_id = %connection_id,
        query_id = %query_id,
        batch_size = statements.len(),
        "Executing query dry-run"
    );

    if connection_id.trim().is_empty() {
        return Err(AppError::Validation("Connection ID cannot be empty".into()));
    }
    if statements.is_empty() {
        return Err(AppError::Validation("Query batch cannot be empty".into()));
    }
    for (idx, sql) in statements.iter().enumerate() {
        if sql.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "Statement {} of {} is empty",
                idx + 1,
                statements.len()
            )));
        }
    }

    let cancel_handle = register_cancel_token(state, Some(query_id)).await;
    let child_token = cancel_handle.as_ref().map(|(_, t)| t.clone());

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_rdb()?
            .dry_run_sql_batch(statements, child_token.as_ref())
            .await
    };

    release_cancel_token(state, &cancel_handle).await;

    match &result {
        Ok(results) => info!(
            query_id = %query_id,
            executed = results.len(),
            "Dry-run completed (rolled back)"
        ),
        Err(e) => warn!(
            query_id = %query_id,
            batch_size = statements.len(),
            error = %e,
            "Dry-run failed"
        ),
    }

    result
}

/// Sprint 247 (ADR 0022 Phase 3) — execute a batch of SQL statements
/// inside a transaction that is unconditionally rolled back. Returns
/// per-statement statistics (`rows_affected`, `execution_time_ms`) so
/// the destructive-statement confirm dialog can preview impact before
/// the user clicks Yes/No on the eventual commit.
///
/// Behaviour mirrors `execute_query_batch` (input validation, paradigm
/// guard, cancel-token registration, error message shape) — only the
/// transaction outcome differs (ROLLBACK instead of COMMIT). Adapters
/// that do not implement `dry_run_sql_batch` (MySQL/SQLite today)
/// surface `AppError::Unsupported` from the trait default; Mongo
/// connections fail at the paradigm guard with `AppError::Unsupported`
/// before the trait method is reached.
#[tauri::command]
pub async fn execute_query_dry_run(
    state: State<'_, AppState>,
    connection_id: String,
    statements: Vec<String>,
    query_id: String,
) -> Result<Vec<QueryResult>, AppError> {
    execute_query_dry_run_inner(state.inner(), &connection_id, &statements, &query_id).await
}

async fn cancel_query_inner(state: &AppState, query_id: &str) -> Result<String, AppError> {
    info!(query_id = %query_id, "Attempting to cancel query");

    validate_cancel_inputs(query_id)?;

    // Find and cancel the token
    let token = {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(query_id)
    };

    if let Some(token) = token {
        token.cancel();
        info!(query_id = %query_id, "Query cancelled successfully");
        Ok(format!("Query '{}' cancelled", query_id))
    } else {
        warn!(query_id = %query_id, "Query not found for cancellation");
        Err(AppError::NotFound(format!(
            "Query '{}' not found or already completed",
            query_id
        )))
    }
}

/// Cancel a running query by its ID.
///
/// # Arguments
/// * `state` - Application state containing query cancellation tokens
/// * `query_id` - Unique identifier of the query to cancel
///
/// # Returns
/// * `String` - Success message if query was cancelled
#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    query_id: String,
) -> Result<String, AppError> {
    cancel_query_inner(state.inner(), &query_id).await
}

#[allow(clippy::too_many_arguments)]
async fn query_table_data_inner(
    state: &AppState,
    connection_id: &str,
    table: &str,
    schema: &str,
    page: Option<i32>,
    page_size: Option<i32>,
    order_by: Option<&str>,
    filters: Option<&[FilterCondition]>,
    raw_where: Option<&str>,
    query_id: Option<&str>,
) -> Result<TableData, AppError> {
    // Hoist token registration outside the active_connections lock so
    // `cancel_query` can flip the flag without contention. Shared helper
    // mirrors the shape used by `execute_query` and `rdb/schema.rs`.
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_rdb()?
            .query_table_data(
                schema,
                table,
                page.unwrap_or(1),
                page_size.unwrap_or(100),
                order_by,
                filters,
                raw_where,
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    // Always remove the token after the call completes (success, error,
    // or cancelled) so the registry stays clean for the next attempt
    // (AC-180-05 retry contract).
    release_cancel_token(state, &cancel_handle).await;

    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_table_data(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    table: String,
    schema: String,
    page: Option<i32>,
    page_size: Option<i32>,
    order_by: Option<String>,
    filters: Option<Vec<FilterCondition>>,
    raw_where: Option<String>,
    // Sprint 180 (AC-180-04): optional per-call cancellation token id.
    // When provided, the command registers a `CancellationToken` in
    // `state.query_tokens` so the existing `cancel_query(query_id)`
    // command can abort the in-flight call cooperatively. When omitted
    // (legacy callers, fast paths) the trait method is invoked with
    // `None` and behaves identically to pre-Sprint-180.
    query_id: Option<String>,
) -> Result<TableData, AppError> {
    query_table_data_inner(
        state.inner(),
        &connection_id,
        &table,
        &schema,
        page,
        page_size,
        order_by.as_deref(),
        filters.as_deref(),
        raw_where.as_deref(),
        query_id.as_deref(),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn validate_query_inputs_rejects_empty_sql() {
        let result = validate_query_inputs("", "conn-1");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("SQL query cannot be empty"),
            "Expected empty SQL error, got: {}",
            err
        );
    }

    #[test]
    fn validate_query_inputs_rejects_whitespace_only_sql() {
        let result = validate_query_inputs("   ", "conn-1");
        assert!(result.is_err());
    }

    #[test]
    fn validate_query_inputs_rejects_empty_connection_id() {
        let result = validate_query_inputs("SELECT 1", "");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("Connection ID cannot be empty"),
            "Expected empty connection ID error, got: {}",
            err
        );
    }

    #[test]
    fn validate_query_inputs_accepts_valid_inputs() {
        let result = validate_query_inputs("SELECT 1", "conn-1");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_cancel_inputs_rejects_empty_query_id() {
        let result = validate_cancel_inputs("");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("Query ID cannot be empty"),
            "Expected empty query ID error, got: {}",
            err
        );
    }

    #[test]
    fn validate_cancel_inputs_rejects_whitespace_query_id() {
        let result = validate_cancel_inputs("  ");
        assert!(result.is_err());
    }

    #[test]
    fn validate_cancel_inputs_accepts_valid_query_id() {
        let result = validate_cancel_inputs("query-123");
        assert!(result.is_ok());
    }

    // ── Sprint 237 spec-first dispatch tests (2026-05-08) ────────────────
    //
    // 작성 이유: query.rs 4 Tauri command (execute_query, execute_query_batch,
    // cancel_query, query_table_data) 의 dispatch contract 가 검증되지 않음
    // (기존 7 tests 는 input-validation pure 함수만). 공유 stub
    // (`StubRdbAdapter`) 로 dispatcher contract 4-step + cancel-token registry
    // 의 lifecycle 까지 검증. AppState 는 직접 생성 (Tauri State wrapping 우회).

    use crate::commands::connection::AppState;
    use crate::commands::test_util::{document_default, state_with};
    use crate::db::testing::{clone_app_error, StubRdbAdapter};
    use crate::db::{ActiveAdapter, RdbQueryResult};
    use crate::models::{ColumnCategory, QueryColumn, QueryType, TableData};
    use tokio_util::sync::CancellationToken;

    // ── execute_query — 5 contract scenarios ─────────────────────────────

    #[tokio::test]
    async fn execute_query_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match execute_query_inner(&state, "absent", "SELECT 1", "q1", None).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            execute_query_inner(&state, "doc", "SELECT 1", "q1", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn execute_query_rdb_ok_propagates_payload_with_sql_arg() {
        let mut s = StubRdbAdapter::default();
        s.execute_sql_fn = Some(Box::new(|sql: &str| {
            Ok(RdbQueryResult {
                columns: vec![QueryColumn {
                    name: "echo".into(),
                    data_type: "text".into(),
                    category: ColumnCategory::Unknown,
                }],
                rows: vec![vec![serde_json::Value::String(sql.to_string())]],
                total_count: 1,
                execution_time_ms: 0,
                query_type: QueryType::Select,
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = execute_query_inner(&state, "c", "SELECT 42", "q1", None)
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], serde_json::Value::String("SELECT 42".into()));
    }

    #[tokio::test]
    async fn execute_query_rdb_err_propagates_verbatim() {
        let err = AppError::Database("syntax error at or near \"FORM\"".into());
        let mut s = StubRdbAdapter::default();
        let cloned = clone_app_error(&err);
        s.execute_sql_fn = Some(Box::new(move |_| Err(clone_app_error(&cloned))));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match execute_query_inner(&state, "c", "SELECT 1", "q1", None).await {
            Err(AppError::Database(msg)) => {
                assert_eq!(msg, "syntax error at or near \"FORM\"")
            }
            other => panic!("Expected Database, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_empty_sql_short_circuits_before_lookup() {
        // validation 이 lookup 보다 *먼저* 실행됨. 미등록 connection 이라도
        // empty SQL 이면 Validation 이 surface 되어야 함 (NotFound 아님).
        let state = AppState::new();
        match execute_query_inner(&state, "absent", "   ", "q1", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("SQL query cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_round_trip_releases_token() {
        // 정상 종료 시 query_tokens 에서 등록된 id 가 사라져야 retry path 가
        // 깨끗하게 다음 시도 가능 (AC-180-05).
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        let _ = execute_query_inner(&state, "c", "SELECT 1", "qid-eq", None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-eq"));
    }

    // ── Sprint 266 — expected_database 가드 ──────────────────────────────
    //
    // 작성 이유 (2026-05-12): DbSwitcher 가 backend pool 의 active db 를
    // 바꾸는 사이에 in-flight 쿼리가 도착하면 잘못된 db 에서 실행될 race.
    // Sprint 263 OoS #3 + Sprint 264 OoS #2 가 같은 갭을 다른 각도에서 제기.
    // 본 sprint 는 opt-in 가드만 — None 이면 기존 경로 그대로, Some 이면
    // current_database 와 비교해 mismatch 시 DbMismatch 반환.

    #[tokio::test]
    async fn execute_query_expected_db_mismatch_returns_dbmismatch() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        // execute_sql 이 호출되면 가드가 새는 것 — 의도된 sentinel.
        s.execute_sql_fn = Some(Box::new(|_| {
            panic!("execute_sql must not run when expected_database mismatches")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match execute_query_inner(&state, "c", "SELECT 1", "q1", Some("db2")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "db2");
                assert_eq!(actual, "db1");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_expected_db_match_executes_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        s.execute_sql_fn = Some(Box::new(|sql: &str| {
            Ok(RdbQueryResult {
                columns: vec![QueryColumn {
                    name: "echo".into(),
                    data_type: "text".into(),
                    category: ColumnCategory::Unknown,
                }],
                rows: vec![vec![serde_json::Value::String(sql.to_string())]],
                total_count: 1,
                execution_time_ms: 0,
                query_type: QueryType::Select,
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = execute_query_inner(&state, "c", "SELECT 1", "q1", Some("db1"))
            .await
            .unwrap();
        assert_eq!(r.rows[0][0], serde_json::Value::String("SELECT 1".into()));
    }

    #[tokio::test]
    async fn execute_query_expected_db_none_skips_check_backwards_compat() {
        // current_database_fn 이 호출되면 안 됨 — None 인 경우 fast-path 유지.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| {
            panic!("current_database must not be probed when expected_database is None")
        }));
        s.execute_sql_fn = Some(Box::new(|_| {
            Ok(RdbQueryResult {
                columns: vec![],
                rows: vec![],
                total_count: 0,
                execution_time_ms: 0,
                query_type: QueryType::Select,
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        assert!(execute_query_inner(&state, "c", "SELECT 1", "q1", None)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn execute_query_expected_db_mismatch_releases_cancel_token() {
        // 가드가 일찍 short-circuit 해도 register 된 token 은 release 되어야
        // 다음 시도가 깨끗하게 가능.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let _ = execute_query_inner(&state, "c", "SELECT 1", "qid-mismatch", Some("db2")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-mismatch"));
    }

    // ── execute_query_batch — input validation + dispatch ────────────────

    #[tokio::test]
    async fn execute_query_batch_empty_connection_id_rejected() {
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        match execute_query_batch_inner(&state, "  ", &stmts, "qb", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Connection ID cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_empty_statements_rejected() {
        let state = AppState::new();
        match execute_query_batch_inner(&state, "c", &[], "qb", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Query batch cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_empty_statement_at_index_reports_position() {
        // 3개 중 2번째가 비어있을 때 "Statement 2 of 3" 메시지에 위치 포함.
        let state = AppState::new();
        let stmts = vec!["SELECT 1".into(), "  ".into(), "SELECT 3".into()];
        match execute_query_batch_inner(&state, "c", &stmts, "qb", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Statement 2 of 3"), "위치 누락: {msg}")
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_unknown_connection_returns_notfound() {
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_batch_inner(&state, "absent", &stmts, "qb", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn execute_query_batch_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_batch_inner(&state, "doc", &stmts, "qb", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn execute_query_batch_rdb_propagates_results() {
        let mut s = StubRdbAdapter::default();
        s.execute_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|sql| RdbQueryResult {
                    columns: vec![QueryColumn {
                        name: "s".into(),
                        data_type: "text".into(),
                        category: ColumnCategory::Unknown,
                    }],
                    rows: vec![vec![serde_json::Value::String(sql.clone())]],
                    total_count: 1,
                    execution_time_ms: 0,
                    query_type: QueryType::Select,
                })
                .collect())
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["A".into(), "B".into()];
        let r = execute_query_batch_inner(&state, "c", &stmts, "qb", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].rows[0][0], serde_json::Value::String("A".into()));
        assert_eq!(r[1].rows[0][0], serde_json::Value::String("B".into()));
    }

    // ── Sprint 266 — execute_query_batch mismatch guard ──────────────────
    //
    // 작성 이유 (2026-05-12): single-query 가드 (위 execute_query_expected_db_*)
    // 를 batch path 로 mirror. batch 의 일부 statement 가 `USE other_db`
    // 같은 stateful 명령이라도 사전 검증은 batch 시작 시점 1 회만 (spec
    // §AC-266-03).

    #[tokio::test]
    async fn execute_query_batch_expected_db_mismatch_returns_dbmismatch() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        s.execute_sql_batch_fn = Some(Box::new(|_| {
            panic!("execute_sql_batch must not run on db mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["SELECT 1".to_string()];
        match execute_query_batch_inner(&state, "c", &stmts, "qb", Some("db2")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "db2");
                assert_eq!(actual, "db1");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_expected_db_match_executes_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        s.execute_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|_| RdbQueryResult {
                    columns: vec![],
                    rows: vec![],
                    total_count: 0,
                    execution_time_ms: 0,
                    query_type: QueryType::Select,
                })
                .collect())
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["SELECT 1".to_string(), "SELECT 2".to_string()];
        let r = execute_query_batch_inner(&state, "c", &stmts, "qb", Some("db1"))
            .await
            .unwrap();
        assert_eq!(r.len(), 2);
    }

    // ── Sprint 247 (ADR 0022 Phase 3) — dry-run dispatch tests ───────────
    //
    // 작성 이유 (2026-05-09): execute_query_dry_run_inner 의 input
    // validation + paradigm guard + adapter dispatch contract 가 검증되지
    // 않음. execute_query_batch_inner 와 시그니처가 동일해 mirror 6 케이스
    // 작성 (B1..B6). default trait impl (B7) 은 db/tests.rs 에서 별도
    // 검증 — RdbAdapter 의 default body 호출 path 는 그쪽이 owner.

    #[tokio::test]
    async fn dry_run_empty_connection_id_rejected() {
        // [AC-247-B1] — connection_id 가 trim 후 비어있으면 lookup 도
        // 안 가고 Validation 으로 short-circuit.
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        match execute_query_dry_run_inner(&state, "  ", &stmts, "qd").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Connection ID cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_empty_statements_rejected() {
        // [AC-247-B2] — empty Vec 이면 Validation. PG inherent 의 empty
        // short-circuit (Ok(vec![])) 보다 outer guard 가 먼저.
        let state = AppState::new();
        match execute_query_dry_run_inner(&state, "c", &[], "qd").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Query batch cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_empty_statement_at_index_reports_position() {
        // [AC-247-B3] — 3개 중 2번째가 비어있으면 "Statement 2 of 3"
        // 메시지에 위치 포함. execute_query_batch 와 동일 카피.
        let state = AppState::new();
        let stmts = vec!["a".into(), "".into(), "".into()];
        match execute_query_dry_run_inner(&state, "c", &stmts, "qd").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Statement 2 of 3"), "위치 누락: {msg}")
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_unknown_connection_returns_notfound() {
        // [AC-247-B4] — connection 미등록 시 NotFound. validation 통과
        // 후 active_connections lookup 에서 reject.
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_dry_run_inner(&state, "absent", &stmts, "qd").await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn dry_run_document_paradigm_returns_unsupported() {
        // [AC-247-B5] — Mongo 연결을 RDB command 가 reject. as_rdb 의
        // paradigm guard 가 dry-run 시도조차 못 하게 막음.
        let state = state_with("doc", document_default()).await;
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_dry_run_inner(&state, "doc", &stmts, "qd").await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn dry_run_rdb_propagates_results() {
        // [AC-247-B6] — adapter 의 dry_run_sql_batch 결과를 그대로 propagate.
        // mock 에서 total_count=3 반환 → command 결과의 total_count 도 3.
        let mut s = StubRdbAdapter::default();
        s.dry_run_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|_| RdbQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 3,
                    execution_time_ms: 7,
                    query_type: QueryType::Dml { rows_affected: 3 },
                })
                .collect())
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["UPDATE t SET x = 1".into()];
        let r = execute_query_dry_run_inner(&state, "c", &stmts, "qd")
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].total_count, 3);
        assert_eq!(r[0].execution_time_ms, 7);
    }

    // ── query_table_data — dispatch contract ─────────────────────────────

    #[tokio::test]
    async fn query_table_data_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            query_table_data_inner(
                &state, "absent", "users", "public", None, None, None, None, None, None
            )
            .await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn query_table_data_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            query_table_data_inner(
                &state, "doc", "users", "public", None, None, None, None, None, None
            )
            .await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn query_table_data_rdb_ok_propagates_with_args_propagated() {
        let mut s = StubRdbAdapter::default();
        s.query_table_data_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(TableData {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 7,
                page: 1,
                page_size: 100,
                executed_query: format!("SELECT FROM {ns}.{tbl}"),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = query_table_data_inner(
            &state, "c", "tbl_w", "ns_q", None, None, None, None, None, None,
        )
        .await
        .unwrap();
        assert_eq!(r.executed_query, "SELECT FROM ns_q.tbl_w");
        assert_eq!(r.total_count, 7);
    }

    // ── cancel_query — dispatch contract + token registry side effect ────

    #[tokio::test]
    async fn cancel_query_validation_rejects_empty_id() {
        let state = AppState::new();
        match cancel_query_inner(&state, "  ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Query ID cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn cancel_query_unknown_id_returns_notfound() {
        let state = AppState::new();
        match cancel_query_inner(&state, "no-such-id").await {
            Err(AppError::NotFound(msg)) => {
                assert!(msg.contains("no-such-id"));
                assert!(msg.contains("not found or already completed"));
            }
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn cancel_query_present_id_triggers_cancel_and_removes_from_registry() {
        let state = AppState::new();
        let token = CancellationToken::new();
        // 미리 등록 (정상 lifecycle 의 mid-flight 시뮬레이션)
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert("q-1".into(), token.clone());
        }

        let r = cancel_query_inner(&state, "q-1").await.unwrap();
        assert!(r.contains("q-1"), "msg: {r}");
        // 1) 토큰이 cancel 상태로 전이
        assert!(
            token.is_cancelled(),
            "cancel_query 가 token.cancel() 호출 안 함"
        );
        // 2) registry 에서 제거되어 두번째 호출은 NotFound
        match cancel_query_inner(&state, "q-1").await {
            Err(AppError::NotFound(_)) => (),
            other => panic!("두번째 호출은 NotFound 여야 함: {:?}", other),
        }
    }
}
