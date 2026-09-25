//! RDB query execution, cancellation, and tabular paging.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

mod mysql_scripting;

use self::mysql_scripting::{
    validate_mysql_scripting_boundary, validate_mysql_scripting_boundary_batch,
};
use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::db::postgres::validate_identifier;
use crate::error::AppError;
use crate::models::{DatabaseType, FilterCondition, QueryResult, TableData};

use super::{ensure_expected_db, not_connected, register_cancel_token, release_cancel_token};

/// Issue #1351 / #1450 / PR #1473 — the Safe Mode danger check that respects
/// the connection dialect. The shared classifier is dialect-agnostic by default
/// and (a) misses Oracle PL/SQL blocks (`BEGIN … END;`), routine execution
/// (`EXEC` / `EXECUTE IMMEDIATE` / `CALL`), and admin DDL (`ALTER SYSTEM`,
/// `DROP USER`, `AUDIT`, non table/index/view `CREATE`, …), which
/// `oracle::is_oracle_danger` widens to danger on Oracle connections, and
/// (b) needs the dialect's comment/literal scanning rules: `#` line comments
/// and backslash literal escapes exist only on MySQL/MariaDB, and block
/// comments nest only on PostgreSQL (#1450 / #1473). Resolving the adapter
/// kind once maps it to the classifier's [`SqlDialect`] and lets the Oracle
/// widening run only for Oracle, so other dialects pay nothing.
async fn rdb_sql_is_danger(state: &AppState, connection_id: &str, sql: &str) -> bool {
    let kind = connection_kind(state, connection_id).await;
    sql_parser_core::safety::is_danger_with_dialect(sql, safety_dialect(kind.as_ref()))
        || (matches!(kind.as_ref(), Some(DatabaseType::Oracle))
            && sql_parser_core::oracle::is_oracle_danger(sql))
}

/// Batch form of [`rdb_sql_is_danger`]. Worst tier wins — a single dialect-
/// specific danger statement anywhere in the atomic batch gates the whole
/// batch. The dialect is resolved once, not per statement.
async fn rdb_batch_is_danger(state: &AppState, connection_id: &str, statements: &[String]) -> bool {
    let kind = connection_kind(state, connection_id).await;
    let dialect = safety_dialect(kind.as_ref());
    if statements
        .iter()
        .any(|sql| sql_parser_core::safety::is_danger_with_dialect(sql, dialect))
    {
        return true;
    }
    matches!(kind.as_ref(), Some(DatabaseType::Oracle))
        && statements
            .iter()
            .any(|sql| sql_parser_core::oracle::is_oracle_danger(sql))
}

/// Issue #1529 — is this SQL a write for the read-only connection gate? The
/// inverse of the fail-closed-on-parse / fail-open-on-keyword read classifier.
/// Resolves the dialect once (same as the danger path) for the literal/comment-
/// aware statement split, so a trailing write cannot hide behind a leading read.
async fn rdb_sql_is_write(state: &AppState, connection_id: &str, sql: &str) -> bool {
    let kind = connection_kind(state, connection_id).await;
    !sql_parser_core::safety::is_read_only_safe_with_dialect(sql, safety_dialect(kind.as_ref()))
}

/// Batch form of [`rdb_sql_is_write`] — any write statement anywhere in the
/// batch makes the whole (atomic) batch a write.
async fn rdb_batch_is_write(state: &AppState, connection_id: &str, statements: &[String]) -> bool {
    let kind = connection_kind(state, connection_id).await;
    let dialect = safety_dialect(kind.as_ref());
    statements
        .iter()
        .any(|sql| !sql_parser_core::safety::is_read_only_safe_with_dialect(sql, dialect))
}

/// Current adapter kind for `connection_id`, or `None` for a missing / non-RDB
/// connection (the generic classifier has already run and the connection error
/// surfaces downstream in dispatch).
async fn connection_kind(state: &AppState, connection_id: &str) -> Option<DatabaseType> {
    state
        .active_adapter(connection_id)
        .await
        .map(|adapter| adapter.kind())
}

/// Adapter kind → classifier scanning rules (#1450 / #1473). MySQL/MariaDB
/// lead line comments with `#` and escape literals with `\`; PostgreSQL nests
/// block comments. Everything else — including a missing / non-RDB connection —
/// maps to the conservative `Other` (first-close comments, fail-closed).
fn safety_dialect(kind: Option<&DatabaseType>) -> sql_parser_core::safety::SqlDialect {
    use sql_parser_core::safety::SqlDialect;
    match kind {
        Some(DatabaseType::Mysql | DatabaseType::Mariadb) => SqlDialect::MysqlFamily,
        Some(DatabaseType::Postgresql) => SqlDialect::Postgres,
        // #1455 P3-4 — Oracle so the shared classifier recognizes `q'[…]'`
        // alternate quoting; a fake `WHERE` inside one no longer downgrades a
        // WHERE-less UPDATE/DELETE.
        Some(DatabaseType::Oracle) => SqlDialect::Oracle,
        _ => SqlDialect::Other,
    }
}

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

/// Validate batch execution inputs (shared by execute_query_batch and dry-run).
///
/// Returns `Ok(())` if inputs are valid, or `Err(AppError::Validation)` otherwise.
/// Extracted so the batch/dry-run handlers share one validation source instead
/// of duplicating the connection-id / empty-batch / per-statement checks.
pub fn validate_batch_inputs(connection_id: &str, statements: &[String]) -> Result<(), AppError> {
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

    // Execute the query through the enum dispatch. Issue #1087 — resolve the
    // adapter via `active_adapter` (short lock + `Arc` clone) and drop the
    // `active_connections` guard *before* awaiting the query, so a long query
    // no longer serialises every other command or blocks `cancel_query_native`.
    // The cloned `Arc` keeps the adapter alive for the whole call, and
    // PostgresAdapter drives execution through its own internal
    // `Arc<Mutex<…>>` pool.
    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        if let Err(err) = validate_mysql_scripting_boundary(sql, &active.kind()) {
            release_cancel_token(state, &cancel_handle).await;
            return Err(err);
        }
        let adapter = active.as_rdb()?;
        // Opt-in db-mismatch guard. When the caller passes `expected_database`
        // we sample the adapter's current db on the resolved handle and refuse
        // the execute if it does not match (e.g. a concurrent
        // `switch_active_db` from DbSwitcher moved the backend pool). PG's
        // sub-pool model already routes by db, but MySQL/SQLite carry stateful
        // `USE` / `ATTACH` semantics — this is a best-effort correctness
        // floor, not a hard guarantee. Issue #1087 — probe and dispatch are
        // two separate awaits on the shared `Arc` handle and are NO LONGER
        // serialised against a concurrent same-connection `switch_active_db`
        // by the global lock, so a switch landing between the probe and the
        // dispatch is a narrow TOCTOU the guard cannot catch (recorded in
        // docs/product/known-limitations-cross-cutting.md). Restoring true
        // atomicity would need an adapter-level checked-execute API, out of
        // #1087 scope.
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
        // Issue #1230 — run through the pid-tracked path so native cancel
        // (pg_cancel_backend / KILL QUERY) can reach a long-running query.
        // The adapter sends its server pid through `pid_tx` the moment it
        // pins a connection; we record it under `query_id` so
        // `get_query_server_pid` can hand it to the frontend while the query
        // is still running. Adapters without native cancel drop the sender,
        // so `pid_rx` resolves to `Err` and nothing is recorded (the frontend
        // then keeps cooperative-token cancel).
        let (pid_tx, pid_rx) = tokio::sync::oneshot::channel();
        let query_fut = adapter.execute_sql_tracked(sql, child_token.as_ref(), pid_tx);
        let record_fut = async {
            if let Ok(pid) = pid_rx.await {
                state
                    .query_server_pids
                    .lock()
                    .await
                    .insert(query_id.to_string(), pid);
            }
        };
        let (result, ()) = tokio::join!(query_fut, record_fut);
        result
    };

    release_cancel_token(state, &cancel_handle).await;
    // Issue #1230 — the query is no longer in flight; drop its pid record so a
    // late cancel for this (unique) query_id can't target a stale backend.
    state.query_server_pids.lock().await.remove(query_id);

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
/// `expected_database` is an optional db-mismatch guard. When the caller
/// provides it the backend verifies the adapter's active db matches before
/// dispatching the query; mismatch surfaces as `AppError::DbMismatch`. Passing
/// `None` preserves the fast-path (no current_database probe).
#[tauri::command]
pub async fn execute_query(
    window: tauri::Window,
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
    query_id: String,
    expected_database: Option<String>,
    // Issue #1112 — set by the frontend only after its Safe Mode confirm
    // dialog is satisfied. `None` / `false` = unconfirmed; the backend gate
    // rejects a destructive statement in a confirm-required context.
    safety_confirmed: Option<bool>,
) -> Result<QueryResult, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    // Issue #1529 — read-only connection gate (chokepoint). Blocks ANY write
    // (broader than the Safe Mode danger set: also INSERT / bounded UPDATE /
    // CREATE …) on a connection the user flagged read-only, re-reading the flag
    // from the backend's own store so a frontend bypass can't clear it. A read
    // short-circuits before the store read. Runs before the Safe Mode gate and
    // independent of it (no `safety_confirmed` bypass — read-only is a hard
    // block).
    if rdb_sql_is_write(state.inner(), &connection_id, &sql).await {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_read_only(&pool, &connection_id, true).await?;
    }
    // Issue #1112 — Safe Mode backend gate (chokepoint). Classify cheaply
    // first (pure, reuses `sql-parser-core`); only a destructive statement
    // pays the settings/environment SQLite read. Runs before dispatch, using
    // the backend's own store, so a frontend hydration race or a direct IPC
    // bypass can't run destructive SQL unconfirmed.
    if rdb_sql_is_danger(state.inner(), &connection_id, &sql).await {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_rdb_danger(
            &pool,
            &connection_id,
            safety_confirmed.unwrap_or(false),
        )
        .await?;
    }
    // Issue #1231 — publish the persisted row cap for the adapter fetch loop.
    crate::commands::sqlite_pool::publish_row_cap().await;
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

    validate_batch_inputs(connection_id, statements)?;

    let cancel_handle = register_cancel_token(state, Some(query_id)).await;
    let child_token = cancel_handle.as_ref().map(|(_, t)| t.clone());

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        if let Err(err) = validate_mysql_scripting_boundary_batch(statements, &active.kind()) {
            release_cancel_token(state, &cancel_handle).await;
            return Err(err);
        }
        let adapter = active.as_rdb()?;
        // Opt-in db-mismatch guard. Sampled once at batch
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

/// Execute a batch of SQL statements inside a single transaction
/// (BEGIN/COMMIT/ROLLBACK). All-or-nothing: a failure on statement K causes
/// statements 1..K-1 to be rolled back and the original failure to surface as
/// `AppError::Database("statement K of N failed: ...")`.
///
/// Used by the inline-edit commit pipeline (SQL Preview Dialog → Commit).
/// Before this command the frontend looped over `execute_query`, which applied
/// earlier statements before the failure surfaced; that left rows in
/// inconsistent state on partial failure. The batch command makes the commit
/// atomic. See `execute_query` doc on `expected_database`.
#[tauri::command]
pub async fn execute_query_batch(
    window: tauri::Window,
    state: State<'_, AppState>,
    connection_id: String,
    statements: Vec<String>,
    query_id: String,
    expected_database: Option<String>,
    // Issue #1112 — see `execute_query`.
    safety_confirmed: Option<bool>,
) -> Result<Vec<QueryResult>, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    // Issue #1529 — read-only connection gate (batch). Any write statement
    // anywhere in the atomic batch is rejected on a read-only connection. This
    // covers the inline-edit commit pipeline, which routes through this command.
    if rdb_batch_is_write(state.inner(), &connection_id, &statements).await {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_read_only(&pool, &connection_id, true).await?;
    }
    // Issue #1112 — Safe Mode backend gate (batch). Worst tier wins: a
    // single destructive statement anywhere in the atomic batch requires
    // confirmation for the whole batch. Non-destructive batches never touch
    // the settings store.
    if rdb_batch_is_danger(state.inner(), &connection_id, &statements).await {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_rdb_danger(
            &pool,
            &connection_id,
            safety_confirmed.unwrap_or(false),
        )
        .await?;
    }
    // Issue #1231 — a batch may carry a SELECT; publish the cap too.
    crate::commands::sqlite_pool::publish_row_cap().await;
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
    expected_database: Option<&str>,
) -> Result<Vec<QueryResult>, AppError> {
    info!(
        connection_id = %connection_id,
        query_id = %query_id,
        batch_size = statements.len(),
        "Executing query dry-run"
    );

    validate_batch_inputs(connection_id, statements)?;

    let cancel_handle = register_cancel_token(state, Some(query_id)).await;
    let child_token = cancel_handle.as_ref().map(|(_, t)| t.clone());

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        if let Err(err) = validate_mysql_scripting_boundary_batch(statements, &active.kind()) {
            release_cancel_token(state, &cancel_handle).await;
            return Err(err);
        }
        let adapter = active.as_rdb()?;
        // Opt-in db-mismatch guard. Byte-equivalent to the reference probe
        // inlined in `execute_query_inner`: probe sampled inside the same
        // `active_connections.lock()` acquisition, `unwrap_or_default()`
        // coercion on `current_database`, mismatch returns
        // `AppError::DbMismatch` BEFORE invoking the trait, and the cancel
        // token is released first so a retry can re-register under the same
        // query id.
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

/// Execute a batch of SQL statements inside a transaction that is rolled
/// back. Returns per-statement statistics so the destructive-statement
/// confirm dialog can preview impact before the eventual commit.
///
/// Behaviour mirrors `execute_query_batch` (input validation, paradigm
/// guard, cancel-token registration, error message shape) — only the
/// transaction outcome differs (ROLLBACK instead of COMMIT). Adapters
/// that do not implement `dry_run_sql_batch` surface `AppError::Unsupported`
/// from the trait default; Mongo connections fail at the paradigm guard
/// before the trait method is reached.
///
/// `expected_database` keeps the opt-in mismatch guard used by
/// `execute_query`: `None` preserves the legacy fast path, `Some` gates
/// dry-run dispatch on the adapter's active database.
#[tauri::command]
pub async fn execute_query_dry_run(
    window: tauri::Window,
    state: State<'_, AppState>,
    connection_id: String,
    statements: Vec<String>,
    query_id: String,
    expected_database: Option<String>,
) -> Result<Vec<QueryResult>, AppError> {
    crate::commands::guard::guard_not_launcher(window.label())?;
    // Issue #1529 — read-only gate (dry-run). A dry-run is BEGIN → execute →
    // ROLLBACK: the write statement ACTUALLY runs on the server before the
    // rollback, and on MySQL/MariaDB/Oracle a DDL statement implicit-commits so
    // the rollback is a no-op and the write persists. So a write dry-run on a
    // read-only connection must be rejected, not just the eventual commit. The
    // frontend confirm flow (useDryRun) auto-fires this for warn/danger tiers;
    // the rejection surfaces there as the batch/commit path already does.
    if rdb_batch_is_write(state.inner(), &connection_id, &statements).await {
        let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
        crate::commands::safe_mode::enforce_read_only(&pool, &connection_id, true).await?;
    }
    execute_query_dry_run_inner(
        state.inner(),
        &connection_id,
        &statements,
        &query_id,
        expected_database.as_deref(),
    )
    .await
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

/// Issue #1230 — resolve the native server pid the frontend passes to
/// `cancel_query_native` for a running query. `execute_query` records the pid
/// a few milliseconds after the query pins a connection, and this IPC may
/// arrive first, so we poll briefly. Returns `None` when the query never
/// captured a pid (adapter without native cancel) or already finished (a fast
/// query that needs no cancel).
async fn get_query_server_pid_inner(state: &AppState, query_id: &str) -> Option<i64> {
    // ponytail: naive bounded poll (≤1s in 20ms steps). The pid lands within a
    // couple ms of executeQuery reaching the backend; a Notify handshake would
    // be more code for no user-visible gain.
    for _ in 0..50 {
        if let Some(pid) = state.query_server_pids.lock().await.get(query_id).copied() {
            return Some(pid);
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    None
}

/// IPC — see [`get_query_server_pid_inner`].
#[tauri::command]
pub async fn get_query_server_pid(
    state: State<'_, AppState>,
    query_id: String,
) -> Result<Option<i64>, AppError> {
    Ok(get_query_server_pid_inner(state.inner(), &query_id).await)
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
    expected_database: Option<&str>,
) -> Result<TableData, AppError> {
    // Hoist token registration outside the active_connections lock so
    // `cancel_query` can flip the flag without contention. Shared helper
    // mirrors the shape used by `execute_query` and `rdb/schema.rs`.
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        // Opt-in db-mismatch guard. Byte-equivalent to the reference probe
        // inlined in `execute_query_inner`: it runs inside the same
        // `active_connections.lock()` acquisition, `unwrap_or_default()`
        // coercion on `current_database`, mismatch returns
        // `AppError::DbMismatch` BEFORE invoking the trait. The cancel token
        // is released before the early-return so the retry path can
        // re-register the same query id.
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
        let cancel_tok = cancel_handle.as_ref().map(|(_, tok)| tok);
        match query_id {
            // Issue #1269 — a browse with a cancel id runs through the
            // pid-tracked path so the grid Stop button can fire native cancel
            // (pg_cancel_backend / KILL QUERY) against a long scan. The adapter
            // sends its server pid the moment it pins a connection; we record it
            // under `query_id` so `get_query_server_pid` can hand it to the
            // frontend while the browse is still running. Adapters without
            // native cancel drop the sender, so `pid_rx` resolves to `Err` and
            // nothing is recorded (the grid then keeps cooperative-token
            // cancel). Mirrors `execute_query_inner`.
            Some(qid) => {
                let (pid_tx, pid_rx) = tokio::sync::oneshot::channel();
                let browse_fut = adapter.query_table_data_tracked(
                    schema,
                    table,
                    page.unwrap_or(1),
                    page_size.unwrap_or(100),
                    order_by,
                    filters,
                    raw_where,
                    cancel_tok,
                    pid_tx,
                );
                let record_fut = async {
                    if let Ok(pid) = pid_rx.await {
                        state
                            .query_server_pids
                            .lock()
                            .await
                            .insert(qid.to_string(), pid);
                    }
                };
                let (result, ()) = tokio::join!(browse_fut, record_fut);
                result
            }
            None => {
                adapter
                    .query_table_data(
                        schema,
                        table,
                        page.unwrap_or(1),
                        page_size.unwrap_or(100),
                        order_by,
                        filters,
                        raw_where,
                        cancel_tok,
                    )
                    .await
            }
        }
    };

    // Always remove the token after the call completes (success, error,
    // or cancelled) so the registry stays clean for the next attempt
    // (AC-180-05 retry contract).
    release_cancel_token(state, &cancel_handle).await;
    // Issue #1269 — browse is no longer in flight; drop its pid record so a
    // late native cancel for this query_id can't target a stale backend.
    if let Some(qid) = query_id {
        state.query_server_pids.lock().await.remove(qid);
    }

    result
}

async fn count_null_rows_inner(
    state: &AppState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: &str,
    expected_database: Option<&str>,
) -> Result<i64, AppError> {
    // Identifier validation runs *before* connection lookup so a bogus schema
    // / table / column short-circuits without taking the `active_connections`
    // lock. Mirrors the `validate_query_inputs` placement on
    // `execute_query_inner`. The validator is the same
    // `[a-zA-Z_][a-zA-Z0-9_]*` + NAMEDATALEN-63 helper used by every DDL
    // emitter (`db/postgres/mutations.rs::validate_identifier`).
    validate_identifier(schema, "Schema name")?;
    validate_identifier(table, "Table name")?;
    validate_identifier(column, "Column name")?;

    let active = state
        .active_adapter(connection_id)
        .await
        .ok_or_else(|| not_connected(connection_id))?;
    let adapter = active.as_rdb()?;
    // Opt-in DbMismatch guard. Shared `ensure_expected_db` helper. `None` is
    // byte-equivalent — no `current_database()` probe.
    ensure_expected_db(adapter, expected_database).await?;
    adapter.count_null_rows(schema, table, column).await
}

/// Count rows where the named column is `NULL`. The `ColumnsEditor` MODIFY
/// editor debounces a call to this command 500 ms after the user toggles SET
/// NOT NULL on a column that is currently nullable. A non-zero result surfaces
/// an inline warning ("`N` rows have NULL — adding NOT NULL will fail"); zero
/// rows or a probe error is silently ignored — the warning is advisory and
/// never blocks preview / commit.
///
/// Identifiers go through the shared `validate_identifier` helper
/// (NAMEDATALEN-63 + `[a-zA-Z_][a-zA-Z0-9_]*`). The expression cannot use
/// parameter binding — PG only binds values, not identifiers — so the
/// validator + ANSI-quoting (`quote_identifier`) is the SQL-injection floor.
///
/// `expected_database` opt-in DbMismatch guard runs under the same
/// `active_connections.lock()` acquisition that dispatches the trait method.
#[tauri::command]
pub async fn count_null_rows(
    state: State<'_, AppState>,
    connection_id: String,
    schema: String,
    table: String,
    column: String,
    expected_database: Option<String>,
) -> Result<i64, AppError> {
    count_null_rows_inner(
        state.inner(),
        &connection_id,
        &schema,
        &table,
        &column,
        expected_database.as_deref(),
    )
    .await
}

async fn explain_rdb_query_inner(
    state: &AppState,
    connection_id: &str,
    sql: &str,
    expected_database: Option<&str>,
    // Issue #1269 — optional cooperative cancel id. When provided the command
    // registers a `CancellationToken` under this id so the existing
    // `cancel_query(query_id)` command can abort a slow EXPLAIN. The guarantee
    // is cooperative: the client stops awaiting and the plan future is dropped,
    // but the server-side operation is not natively killed (no pid capture).
    query_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    if sql.trim().is_empty() {
        return Err(AppError::Validation("SQL must not be empty".into()));
    }
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        ensure_expected_db(adapter, expected_database).await?;
        match cancel_handle.as_ref().map(|(_, tok)| tok) {
            Some(token) => tokio::select! {
                r = adapter.explain_query(sql) => r,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => adapter.explain_query(sql).await,
        }
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

/// U2 — RDB `EXPLAIN (FORMAT JSON)` for the given
/// SQL. Frontend `ExplainViewer` renders the raw JSON plan tree.
#[tauri::command]
pub async fn explain_rdb_query(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    sql: String,
    expected_database: Option<String>,
    query_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    explain_rdb_query_inner(
        state.inner(),
        &connection_id,
        &sql,
        expected_database.as_deref(),
        query_id.as_deref(),
    )
    .await
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
    // AC-180-04: optional per-call cancellation token id.
    // When provided, the command registers a `CancellationToken` in
    // `state.query_tokens` so the existing `cancel_query(query_id)`
    // command can abort the in-flight call cooperatively. When omitted
    // (legacy callers, fast paths) no token is registered and the trait
    // method is invoked with `None`.
    query_id: Option<String>,
    // Opt-in db-mismatch guard. See `execute_query` doc.
    expected_database: Option<String>,
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
        expected_database.as_deref(),
    )
    .await
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn safety_dialect_maps_scanning_rules_per_kind() {
        use sql_parser_core::safety::SqlDialect;
        // #1450 / #1473 — MySQL/MariaDB get `#` comments + backslash escapes;
        // PostgreSQL gets nested block comments; every other kind (and a
        // missing connection) gets the conservative fail-closed `Other`.
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Mysql)),
            SqlDialect::MysqlFamily
        );
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Mariadb)),
            SqlDialect::MysqlFamily
        );
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Postgresql)),
            SqlDialect::Postgres
        );
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Sqlite)),
            SqlDialect::Other
        );
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Mssql)),
            SqlDialect::Other
        );
        // #1455 P3-4 — Oracle maps to its own dialect (q-quote lexer).
        assert_eq!(
            safety_dialect(Some(&DatabaseType::Oracle)),
            SqlDialect::Oracle
        );
        assert_eq!(safety_dialect(None), SqlDialect::Other);
    }

    // Issue #1529 — the read-only gate's write classifier wiring: a write is
    // reported as a write and a read is not, with the connection dialect
    // resolved from the active adapter.
    #[tokio::test]
    async fn rdb_sql_is_write_flags_writes_not_reads() {
        use crate::commands::test_util::state_with;
        use crate::db::testing::StubRdbAdapter;
        use crate::db::ActiveAdapter;
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        assert!(rdb_sql_is_write(&state, "c", "INSERT INTO t VALUES (1)").await);
        assert!(rdb_sql_is_write(&state, "c", "DROP TABLE t").await);
        assert!(rdb_sql_is_write(&state, "c", "UPDATE t SET x = 1 WHERE id = 1").await);
        assert!(!rdb_sql_is_write(&state, "c", "SELECT * FROM t").await);
        assert!(!rdb_sql_is_write(&state, "c", "EXPLAIN SELECT * FROM t").await);
        // Batch: any write flips the whole batch.
        assert!(
            rdb_batch_is_write(
                &state,
                "c",
                &["SELECT 1".to_string(), "DELETE FROM t".to_string()],
            )
            .await
        );
        assert!(
            !rdb_batch_is_write(
                &state,
                "c",
                &["SELECT 1".to_string(), "SELECT 2".to_string()],
            )
            .await
        );
    }

    // Issue #1529 — the dry-run gate. `execute_query_dry_run` classifies its
    // batch with `rdb_batch_is_write` and, on a write, calls
    // `safe_mode::enforce_read_only` BEFORE the BEGIN/execute/ROLLBACK — a
    // read-only dry-run of an implicit-commit DDL (CREATE/DROP on MySQL/Oracle,
    // where the ROLLBACK cannot undo the write) is rejected up front. This locks
    // the classification link; `enforce_read_only`'s rejection is covered by
    // `commands::safe_mode::tests::read_only_connection_blocks_a_write`.
    #[tokio::test]
    async fn dry_run_write_classification_covers_implicit_commit_ddl() {
        use crate::commands::test_util::state_with;
        use crate::db::testing::StubRdbAdapter;
        use crate::db::ActiveAdapter;
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        for stmt in [
            "CREATE TABLE t (id int)",
            "DROP TABLE t",
            "INSERT INTO t VALUES (1)",
        ] {
            assert!(
                rdb_batch_is_write(&state, "c", &[stmt.to_string()]).await,
                "dry-run must gate a write statement: {stmt}"
            );
        }
        // A read-only dry-run of a pure read is still allowed.
        assert!(!rdb_batch_is_write(&state, "c", &["SELECT * FROM t".to_string()]).await);
    }

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

    #[test]
    fn validate_batch_inputs_rejects_empty_connection_id() {
        let result = validate_batch_inputs("", &["SELECT 1".to_string()]);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Connection ID cannot be empty"));
    }

    #[test]
    fn validate_batch_inputs_rejects_empty_batch() {
        let result = validate_batch_inputs("conn-1", &[]);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Query batch cannot be empty"));
    }

    #[test]
    fn validate_batch_inputs_rejects_whitespace_only_statement() {
        let result = validate_batch_inputs("conn-1", &["SELECT 1".to_string(), "   ".to_string()]);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Statement 2 of 2 is empty"));
    }

    #[test]
    fn validate_batch_inputs_accepts_valid_batch() {
        let result =
            validate_batch_inputs("conn-1", &["SELECT 1".to_string(), "SELECT 2".to_string()]);
        assert!(result.is_ok());
    }

    // ── Spec-first dispatch tests (2026-05-08) ───────────────────────────
    //
    // Reason: the dispatch contract of the query.rs Tauri commands
    // (execute_query, execute_query_batch, cancel_query, query_table_data) was
    // unverified — the existing tests covered only the input-validation pure
    // functions. A shared stub (`StubRdbAdapter`) covers the 4-step dispatcher
    // contract plus the cancel-token registry lifecycle. `AppState` is built
    // directly, bypassing the Tauri `State` wrapper.

    use crate::commands::connection::AppState;
    use crate::commands::test_util::{document_default, state_with};
    use crate::db::testing::{clone_app_error, StubRdbAdapter};
    use crate::db::{ActiveAdapter, RdbQueryResult};
    use crate::models::{ColumnCategory, DatabaseType, QueryColumn, QueryType, TableData};
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
                truncated: false,
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
        // Validation runs *before* the lookup. Even for an unregistered
        // connection, empty SQL must surface Validation, not NotFound.
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
        // On normal completion the registered id must disappear from
        // query_tokens so the retry path gets a clean next attempt (AC-180-05).
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        let _ = execute_query_inner(&state, "c", "SELECT 1", "qid-eq", None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("qid-eq"));
    }

    // ── Issue #1230 — native cancel pid capture ──────────────────────────

    #[tokio::test]
    async fn execute_query_records_no_pid_for_non_native_adapter() {
        // Adapters without native cancel inherit the default
        // `execute_sql_tracked`, which drops the pid channel. So after a
        // normal run the pid registry must stay empty — the frontend then
        // keeps cooperative-token cancel for these DBMS.
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        let _ = execute_query_inner(&state, "c", "SELECT 1", "qid-nopid", None).await;
        assert!(
            state.query_server_pids.lock().await.is_empty(),
            "non-native adapter must not record a server pid"
        );
    }

    #[tokio::test]
    async fn get_query_server_pid_inner_returns_recorded_pid() {
        // The frontend fetch resolves the pid `execute_query` recorded for a
        // still-running query.
        let state = AppState::new();
        state
            .query_server_pids
            .lock()
            .await
            .insert("qid-live".to_string(), 4242);
        assert_eq!(
            super::get_query_server_pid_inner(&state, "qid-live").await,
            Some(4242)
        );
    }

    // ── Issue #1087 — lock-scope regression ──────────────────────────────
    //
    // Reason: execute_query used to hold the `active_connections` lock for the
    // whole query await, so every command on the same or another connection —
    // and `cancel_query_native` with them — serialized behind that lock (which
    // makes native cancel useless by definition). This test parks a long query
    // on connection "c" in flight and freezes that (a) a query on connection
    // "d" and (b) a native cancel on connection "c" both complete without
    // waiting for the lock. Before the fix (a)/(b) failed on the 5s timeout
    // (RED).
    #[tokio::test]
    async fn long_query_does_not_serialize_other_commands_or_native_cancel_1087() {
        use crate::commands::cancel_query::cancel_query_native_inner;
        use std::sync::Arc;
        use tokio::sync::Notify;
        use tokio::time::{timeout, Duration};

        fn empty_result() -> RdbQueryResult {
            RdbQueryResult {
                truncated: false,
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
                query_type: QueryType::Select,
            }
        }

        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());

        let mut blocking = StubRdbAdapter {
            execute_sql_gate: Some((entered.clone(), release.clone())),
            ..StubRdbAdapter::default()
        };
        blocking.execute_sql_fn = Some(Box::new(|_| Ok(empty_result())));

        let mut fast = StubRdbAdapter::default();
        fast.execute_sql_fn = Some(Box::new(|_| Ok(empty_result())));

        let state = Arc::new(state_with("c", ActiveAdapter::Rdb(Box::new(blocking))).await);
        {
            let mut conns = state.active_connections.lock().await;
            conns.insert("d".into(), Arc::new(ActiveAdapter::Rdb(Box::new(fast))));
        }

        // Spawn the long query on connection "c" — it parks inside execute_sql
        // waiting for release.
        let long_state = Arc::clone(&state);
        let long = tokio::spawn(async move {
            execute_query_inner(&long_state, "c", "SELECT pg_sleep(60)", "q-long", None).await
        });

        // Wait until the query actually enters execute_sql (past the lock).
        entered.notified().await;

        // (a) The query on the other connection "d" completes without waiting
        // for the lock.
        let other = timeout(
            Duration::from_secs(5),
            execute_query_inner(&state, "d", "SELECT 1", "q-d", None),
        )
        .await;
        assert!(
            matches!(other, Ok(Ok(_))),
            "connection B command serialized behind connection A's long query (#1087): {other:?}"
        );

        // (b) The native cancel is issued without waiting for the lock (success
        // or failure does not matter, it only must not block).
        let cancel = timeout(
            Duration::from_secs(5),
            cancel_query_native_inner(&state, "c", 1234, None),
        )
        .await;
        assert!(
            cancel.is_ok(),
            "native cancel blocked on active_connections lock held by the long query (#1087)"
        );

        // Release the long query and clean up.
        release.notify_one();
        let _ = long.await;
    }

    // ── expected_database guard ──────────────────────────────────────────
    //
    // Reason (2026-05-12): when an in-flight query arrives while DbSwitcher is
    // changing the backend pool's active db, it races and runs against the
    // wrong db. The guard is opt-in — `None` keeps the existing path, `Some`
    // compares the value against `current_database` and returns `DbMismatch`
    // when they differ.

    #[tokio::test]
    async fn execute_query_expected_db_mismatch_returns_dbmismatch() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        // A call to execute_sql means the guard leaked — intentional sentinel.
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
                truncated: false,
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
    async fn execute_query_oracle_expected_service_name_match_dispatches() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Oracle,
            ..StubRdbAdapter::default()
        };
        s.current_database_fn = Some(Box::new(|| Ok(Some("XEPDB1".into()))));
        s.execute_sql_fn = Some(Box::new(|sql: &str| {
            Ok(RdbQueryResult {
                truncated: false,
                columns: vec![QueryColumn {
                    name: "oracle".into(),
                    data_type: "text".into(),
                    category: ColumnCategory::Text,
                }],
                rows: vec![vec![serde_json::Value::String(sql.to_string())]],
                total_count: 1,
                execution_time_ms: 0,
                query_type: QueryType::Select,
            })
        }));
        let state = state_with("oracle", ActiveAdapter::Rdb(Box::new(s))).await;

        let result =
            execute_query_inner(&state, "oracle", "SELECT 1 FROM DUAL", "q1", Some("XEPDB1"))
                .await
                .unwrap();

        assert_eq!(
            result.rows[0][0],
            serde_json::Value::String("SELECT 1 FROM DUAL".into())
        );
    }

    #[tokio::test]
    async fn execute_query_expected_db_none_skips_check_backwards_compat() {
        // current_database_fn must not be called — `None` keeps the fast path.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| {
            panic!("current_database must not be probed when expected_database is None")
        }));
        s.execute_sql_fn = Some(Box::new(|_| {
            Ok(RdbQueryResult {
                truncated: false,
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
    async fn execute_query_mysql_delimiter_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_fn = Some(Box::new(|_| {
            panic!("execute_sql must not run for unsupported MySQL DELIMITER scripts")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;

        match execute_query_inner(
            &state,
            "c",
            "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END //",
            "q-delimiter",
            None,
        )
        .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("DELIMITER")),
            other => panic!("Expected Unsupported(DELIMITER), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_mysql_stored_routine_body_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_fn = Some(Box::new(|_| {
            panic!("execute_sql must not run for unsupported MySQL stored routine bodies")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;

        match execute_query_inner(
            &state,
            "c",
            "CREATE PROCEDURE refresh_users() BEGIN UPDATE users SET touched = 1",
            "q-routine-body",
            None,
        )
        .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("stored routine")),
            other => panic!("Expected Unsupported(stored routine), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_expected_db_mismatch_releases_cancel_token() {
        // Even when the guard short-circuits early, the registered token must
        // be released so the next attempt starts clean.
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
        // When the 2nd of 3 statements is empty, the message carries the
        // position as "Statement 2 of 3".
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
                    truncated: false,
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

    // ── execute_query_batch mismatch guard ───────────────────────────────
    //
    // Reason (2026-05-12): mirrors the single-query guard (the
    // execute_query_expected_db_* tests above) onto the batch path. Even when
    // some statement in the batch is a stateful command such as `USE
    // other_db`, the check runs once at batch start (spec §AC-266-03).

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
                    truncated: false,
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

    #[tokio::test]
    async fn execute_query_batch_oracle_expected_service_name_match_dispatches() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Oracle,
            ..StubRdbAdapter::default()
        };
        s.current_database_fn = Some(Box::new(|| Ok(Some("XEPDB1".into()))));
        s.execute_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|sql| RdbQueryResult {
                    truncated: false,
                    columns: Vec::new(),
                    rows: vec![vec![serde_json::Value::String(sql.clone())]],
                    total_count: 1,
                    execution_time_ms: 0,
                    query_type: QueryType::Dml { rows_affected: 1 },
                })
                .collect())
        }));
        let state = state_with("oracle", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec![
            "INSERT INTO users(id) VALUES (1)".to_string(),
            "UPDATE users SET id = 2 WHERE id = 1".to_string(),
        ];

        let result = execute_query_batch_inner(&state, "oracle", &stmts, "qb", Some("XEPDB1"))
            .await
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0].rows[0][0],
            serde_json::Value::String(stmts[0].clone())
        );
    }

    #[tokio::test]
    async fn execute_query_batch_mariadb_load_data_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mariadb,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_batch_fn = Some(Box::new(|_| {
            panic!("execute_sql_batch must not run for unsupported MySQL LOAD DATA")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec![
            "SELECT 1".to_string(),
            "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users".to_string(),
        ];

        match execute_query_batch_inner(&state, "c", &stmts, "qb-load-data", None).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("LOAD DATA")),
            other => panic!("Expected Unsupported(LOAD DATA), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_mariadb_control_flow_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mariadb,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_batch_fn = Some(Box::new(|_| {
            panic!("execute_sql_batch must not run for unsupported MariaDB control-flow scripts")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec![
            "SELECT 1".to_string(),
            "IF user_id IS NULL THEN SELECT 1".to_string(),
        ];

        match execute_query_batch_inner(&state, "c", &stmts, "qb-control-flow", None).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("control-flow")),
            other => panic!("Expected Unsupported(control-flow), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_mysql_transaction_begin_is_not_control_flow_boundary() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_fn = Some(Box::new(|_| {
            Ok(RdbQueryResult {
                truncated: false,
                columns: vec![],
                rows: vec![],
                total_count: 0,
                execution_time_ms: 0,
                query_type: QueryType::Dml { rows_affected: 0 },
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;

        let result = execute_query_inner(&state, "c", "BEGIN", "q-transaction-begin", None).await;

        assert!(
            result.is_ok(),
            "transaction BEGIN must not be treated as routine control-flow"
        );
    }

    #[tokio::test]
    async fn execute_query_mysql_executable_comment_load_data_returns_unsupported() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_fn = Some(Box::new(|_| {
            panic!("execute_sql must not run for unsupported MySQL LOAD DATA")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;

        match execute_query_inner(
            &state,
            "c",
            "/*!40101 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */",
            "q-load-data-comment",
            None,
        )
        .await
        {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("LOAD DATA")),
            other => panic!("Expected Unsupported(LOAD DATA), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_batch_mariadb_executable_comment_load_data_returns_unsupported() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mariadb,
            ..StubRdbAdapter::default()
        };
        s.execute_sql_batch_fn = Some(Box::new(|_| {
            panic!("execute_sql_batch must not run for unsupported MariaDB LOAD DATA")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts =
            vec!["/*M!100100 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */".to_string()];

        match execute_query_batch_inner(&state, "c", &stmts, "qb-load-data-comment", None).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("LOAD DATA")),
            other => panic!("Expected Unsupported(LOAD DATA), got: {:?}", other),
        }
    }

    // ── ADR 0022 — dry-run dispatch tests ────────────────────────────────
    //
    // Reason (2026-05-09): the input validation, paradigm guard and adapter
    // dispatch contract of execute_query_dry_run_inner were unverified. Its
    // signature matches execute_query_batch_inner, so the six cases below
    // mirror that one (B1..B6). The default trait impl (B7) is verified
    // separately in db/tests.rs — that file owns the call path through
    // `RdbAdapter`'s default body.

    #[tokio::test]
    async fn dry_run_empty_connection_id_rejected() {
        // [AC-247-B1] — a connection_id that is empty after trimming
        // short-circuits with Validation, without reaching the lookup.
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        match execute_query_dry_run_inner(&state, "  ", &stmts, "qd", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Connection ID cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_empty_statements_rejected() {
        // [AC-247-B2] — an empty Vec yields Validation. The outer guard runs
        // before the PG inherent empty short-circuit (Ok(vec![])).
        let state = AppState::new();
        match execute_query_dry_run_inner(&state, "c", &[], "qd", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Query batch cannot be empty"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_empty_statement_at_index_reports_position() {
        // [AC-247-B3] — when the 2nd of 3 statements is empty the message
        // carries the position as "Statement 2 of 3". Same copy as
        // execute_query_batch.
        let state = AppState::new();
        let stmts = vec!["a".into(), "".into(), "".into()];
        match execute_query_dry_run_inner(&state, "c", &stmts, "qd", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Statement 2 of 3"), "위치 누락: {msg}")
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_unknown_connection_returns_notfound() {
        // [AC-247-B4] — an unregistered connection yields NotFound. Validation
        // passes first, then the active_connections lookup rejects.
        let state = AppState::new();
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_dry_run_inner(&state, "absent", &stmts, "qd", None).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn dry_run_document_paradigm_returns_unsupported() {
        // [AC-247-B5] — an RDB command rejects a Mongo connection. The paradigm
        // guard in as_rdb blocks it before the dry-run is even attempted.
        let state = state_with("doc", document_default()).await;
        let stmts = vec!["SELECT 1".to_string()];
        assert!(matches!(
            execute_query_dry_run_inner(&state, "doc", &stmts, "qd", None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn dry_run_rdb_propagates_results() {
        // [AC-247-B6] — the adapter's dry_run_sql_batch result propagates
        // verbatim. The mock returns total_count=3, so the command result also
        // carries total_count=3.
        let mut s = StubRdbAdapter::default();
        s.dry_run_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|_| RdbQueryResult {
                    truncated: false,
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
        let r = execute_query_dry_run_inner(&state, "c", &stmts, "qd", None)
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].total_count, 3);
        assert_eq!(r[0].execution_time_ms, 7);
    }

    #[tokio::test]
    async fn dry_run_mysql_load_data_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.dry_run_sql_batch_fn = Some(Box::new(|_| {
            panic!("dry_run_sql_batch must not run for unsupported MySQL LOAD DATA")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users".to_string()];

        match execute_query_dry_run_inner(&state, "c", &stmts, "qd-load-data", None).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("LOAD DATA")),
            other => panic!("Expected Unsupported(LOAD DATA), got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn dry_run_mysql_hash_comment_load_data_returns_unsupported_before_dispatch() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Mysql,
            ..StubRdbAdapter::default()
        };
        s.dry_run_sql_batch_fn = Some(Box::new(|_| {
            panic!("dry_run_sql_batch must not run for unsupported MySQL LOAD DATA")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts =
            vec!["# import\nLOAD DATA INFILE '/tmp/users.csv' INTO TABLE users".to_string()];

        match execute_query_dry_run_inner(&state, "c", &stmts, "qd-load-data-hash", None).await {
            Err(AppError::Unsupported(msg)) => assert!(msg.contains("LOAD DATA")),
            other => panic!("Expected Unsupported(LOAD DATA), got: {:?}", other),
        }
    }

    // ── execute_query_dry_run mismatch guard ─────────────────────────────
    //
    // Reason (2026-05-13): checks that the dry-run path picked up the
    // expected_database guard pattern byte-equivalently. A stateful USE is
    // uncommon in production, but if SqlPreviewDialog's destructive preview
    // runs against the wrong db, the user is falsely reassured by a "prepared
    // dry-run result" and commits — a large risk.

    #[tokio::test]
    async fn execute_query_dry_run_mismatch_returns_dbmismatch_without_dispatching() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        // A call to dry_run_sql_batch means the guard leaked — intentional
        // sentinel.
        s.dry_run_sql_batch_fn = Some(Box::new(|_| {
            panic!("dry_run_sql_batch must not run on db mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["DELETE FROM t WHERE id = 1".to_string()];
        match execute_query_dry_run_inner(&state, "c", &stmts, "qd", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_query_dry_run_mismatch_releases_cancel_token() {
        // Even when the mismatch returns early, the registered token must be
        // released so the next attempt starts clean (AC-180-05 retry contract).
        // A second registration under the same query_id must then succeed.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["SELECT 1".to_string()];
        let _ = execute_query_dry_run_inner(&state, "c", &stmts, "qd-mismatch", Some("dbB")).await;
        let tokens = state.query_tokens.lock().await;
        assert!(
            !tokens.contains_key("qd-mismatch"),
            "cancel token must be released on mismatch (got tokens: {:?})",
            tokens.keys().collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn execute_query_dry_run_match_dispatches_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s.dry_run_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|_| RdbQueryResult {
                    truncated: false,
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                    query_type: QueryType::Dml { rows_affected: 0 },
                })
                .collect())
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["DELETE FROM t WHERE id = 1".to_string()];
        assert!(
            execute_query_dry_run_inner(&state, "c", &stmts, "qd", Some("dbA"))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn execute_query_dry_run_oracle_expected_service_name_match_dispatches() {
        let mut s = StubRdbAdapter {
            kind_value: DatabaseType::Oracle,
            ..StubRdbAdapter::default()
        };
        s.current_database_fn = Some(Box::new(|| Ok(Some("XEPDB1".into()))));
        s.dry_run_sql_batch_fn = Some(Box::new(|stmts: &[String]| {
            Ok(stmts
                .iter()
                .map(|_| RdbQueryResult {
                    truncated: false,
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 1,
                    execution_time_ms: 0,
                    query_type: QueryType::Dml { rows_affected: 1 },
                })
                .collect())
        }));
        let state = state_with("oracle", ActiveAdapter::Rdb(Box::new(s))).await;
        let stmts = vec!["DELETE FROM users WHERE id = 1".to_string()];

        let result = execute_query_dry_run_inner(&state, "oracle", &stmts, "qd", Some("XEPDB1"))
            .await
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].total_count, 1);
    }

    // ── query_table_data — dispatch contract ─────────────────────────────

    #[tokio::test]
    async fn query_table_data_unknown_connection_returns_notfound() {
        let state = AppState::new();
        assert!(matches!(
            query_table_data_inner(
                &state, "absent", "users", "public", None, None, None, None, None, None, None
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
                &state, "doc", "users", "public", None, None, None, None, None, None, None
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
            &state, "c", "tbl_w", "ns_q", None, None, None, None, None, None, None,
        )
        .await
        .unwrap();
        assert_eq!(r.executed_query, "SELECT FROM ns_q.tbl_w");
        assert_eq!(r.total_count, 7);
    }

    // ── query_table_data mismatch guard ──────────────────────────────────
    //
    // Reason (2026-05-13): when a DataGrid user-initiated row fetch runs
    // against the wrong db, the grid the user sees diverges from the real
    // database. These tests check that the backend guard catches the mismatch
    // before the `query_table_data` trait dispatch and releases the cancel
    // token cleanly.

    #[tokio::test]
    async fn query_table_data_mismatch_returns_dbmismatch_without_dispatching() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        // A call to query_table_data means the guard leaked — intentional
        // sentinel.
        s.query_table_data_fn = Some(Box::new(|_ns: &str, _tbl: &str| {
            panic!("query_table_data must not run on db mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match query_table_data_inner(
            &state,
            "c",
            "users",
            "public",
            None,
            None,
            None,
            None,
            None,
            None,
            Some("dbB"),
        )
        .await
        {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn query_table_data_mismatch_releases_cancel_token() {
        // The cancel-token registration lives in query_table_data_inner, so the
        // release ordering is what this test pins down. Even when the mismatch
        // returns early, the id leaves query_tokens and a retry is possible.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let _ = query_table_data_inner(
            &state,
            "c",
            "users",
            "public",
            None,
            None,
            None,
            None,
            None,
            Some("qtd-mismatch"),
            Some("dbB"),
        )
        .await;
        let tokens = state.query_tokens.lock().await;
        assert!(
            !tokens.contains_key("qtd-mismatch"),
            "cancel token must be released on mismatch (got tokens: {:?})",
            tokens.keys().collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn query_table_data_match_dispatches_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s.query_table_data_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(TableData {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                page: 1,
                page_size: 100,
                executed_query: format!("SELECT FROM {ns}.{tbl}"),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = query_table_data_inner(
            &state,
            "c",
            "users",
            "public",
            None,
            None,
            None,
            None,
            None,
            None,
            Some("dbA"),
        )
        .await
        .unwrap();
        assert_eq!(r.executed_query, "SELECT FROM public.users");
    }

    // ── Issue #1269 — grid browse native cancel pid capture ──────────────
    //
    // Reason (2026-07-10): on the SQL tab, execute_query records the server pid
    // of the running connection and drives native cancel (pg_cancel_backend /
    // KILL QUERY). Grid browsing (query_table_data) recorded no pid, so the
    // frontend's getQueryServerPid was always null and the native branch stayed
    // dormant. The tests below freeze that browse routes through the
    // pid-tracked path, registers the pid while running, and drops it on
    // completion.

    #[tokio::test]
    async fn query_table_data_records_server_pid_for_native_adapter_1269() {
        use std::sync::Arc;
        use tokio::sync::Notify;
        use tokio::time::{timeout, Duration};

        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let mut stub = StubRdbAdapter {
            query_table_data_pid: Some(9191),
            query_table_data_gate: Some((entered.clone(), release.clone())),
            ..StubRdbAdapter::default()
        };
        stub.query_table_data_fn = Some(Box::new(|ns: &str, tbl: &str| {
            Ok(TableData {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                page: 1,
                page_size: 100,
                executed_query: format!("SELECT FROM {ns}.{tbl}"),
            })
        }));
        let state = Arc::new(state_with("c", ActiveAdapter::Rdb(Box::new(stub))).await);

        let browse_state = Arc::clone(&state);
        let browse = tokio::spawn(async move {
            query_table_data_inner(
                &browse_state,
                "c",
                "t",
                "public",
                Some(1),
                Some(100),
                None,
                None,
                None,
                Some("qid-grid"),
                None,
            )
            .await
        });

        // The gate fires only once the grid browse enters the pid-tracked path.
        // On the old (untracked) path the gate never fires → timeout → RED.
        let reached = timeout(Duration::from_secs(5), entered.notified()).await;
        assert!(
            reached.is_ok(),
            "browse did not route through the pid-tracked path (#1269)"
        );

        assert_eq!(
            super::get_query_server_pid_inner(&state, "qid-grid").await,
            Some(9191),
            "server pid must be recorded while the browse is in flight"
        );

        release.notify_one();
        let _ = browse.await;

        assert!(
            state.query_server_pids.lock().await.is_empty(),
            "pid record must be dropped after the browse completes"
        );
    }

    #[tokio::test]
    async fn query_table_data_records_no_pid_for_non_native_adapter_1269() {
        // An adapter that reports no pid (default tracked → pid_tx dropped) must
        // record nothing, so the grid falls back to cooperative token cancel.
        let mut stub = StubRdbAdapter::default();
        stub.query_table_data_fn = Some(Box::new(|_ns: &str, _tbl: &str| {
            Ok(TableData {
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                page: 1,
                page_size: 100,
                executed_query: String::new(),
            })
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(stub))).await;
        let _ = query_table_data_inner(
            &state,
            "c",
            "t",
            "public",
            Some(1),
            Some(100),
            None,
            None,
            None,
            Some("qid-nopid"),
            None,
        )
        .await;
        assert!(
            state.query_server_pids.lock().await.is_empty(),
            "non-native adapter must not record a server pid for a browse"
        );
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
        // Register up front (simulating mid-flight in the normal lifecycle).
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert("q-1".into(), token.clone());
        }

        let r = cancel_query_inner(&state, "q-1").await.unwrap();
        assert!(r.contains("q-1"), "msg: {r}");
        // 1) The token transitions to the cancelled state.
        assert!(
            token.is_cancelled(),
            "cancel_query 가 token.cancel() 호출 안 함"
        );
        // 2) It is removed from the registry, so a second call is NotFound.
        match cancel_query_inner(&state, "q-1").await {
            Err(AppError::NotFound(_)) => (),
            other => panic!("두번째 호출은 NotFound 여야 함: {:?}", other),
        }
    }

    // ── count_null_rows dispatch + identifier guard ──────────────────────
    //
    // Reason (2026-05-13): pins the contract of the Tauri command ColumnsEditor
    // calls when SET NOT NULL is toggled. 5 cases:
    //   (1..3) identifier validation (an invalid schema / table / column each
    //          yields Validation without reaching the connection lookup).
    //   (4)    happy-path interpolation — a stub override asserts the SQL string
    //          contains "schema"."table" WHERE "column" IS NULL.
    //   (5)    mismatch panic-closure — when the adapter is at dbA and the
    //          caller asks for dbB, the trait's count_null_rows must not
    //          surface as a panic (that is, it is never called) and
    //          DbMismatch must be returned.

    #[tokio::test]
    async fn count_null_rows_rejects_invalid_schema_identifier() {
        let state = AppState::new();
        match count_null_rows_inner(&state, "absent", "bad schema!", "users", "email", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Schema name"), "label 누락: {msg}");
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn count_null_rows_rejects_invalid_table_identifier() {
        // A `;` mixed into the table name violates the identifier rule
        // (alnum+underscore).
        let state = AppState::new();
        match count_null_rows_inner(&state, "absent", "public", "users; DROP", "email", None).await
        {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Table name"), "label 누락: {msg}");
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn count_null_rows_rejects_invalid_column_identifier() {
        // A `"` (quote) in the column name is a character identifiers do not
        // allow → Validation.
        let state = AppState::new();
        match count_null_rows_inner(&state, "absent", "public", "users", "em\"ail", None).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Column name"), "label 누락: {msg}");
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn count_null_rows_happy_path_dispatches_with_args_propagated() {
        // Checks that (ns, table, column) reach the adapter trait unchanged.
        // The count itself is up to the stub — returning 7 surfaces 7 as i64.
        let mut s = StubRdbAdapter::default();
        s.count_null_rows_fn = Some(Box::new(|ns: &str, tbl: &str, col: &str| {
            assert_eq!(ns, "public");
            assert_eq!(tbl, "users");
            assert_eq!(col, "email");
            Ok(7)
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let count = count_null_rows_inner(&state, "c", "public", "users", "email", None)
            .await
            .unwrap();
        assert_eq!(count, 7);
    }

    #[tokio::test]
    async fn count_null_rows_expected_db_mismatch_returns_dbmismatch_without_dispatch() {
        // The caller passes dbB while the adapter is at dbA. The
        // trait `count_null_rows` MUST NOT be invoked; stub panics if
        // it is.
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("dbA".into()))));
        s.count_null_rows_fn = Some(Box::new(|_, _, _| {
            panic!("count_null_rows must not run on db mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match count_null_rows_inner(&state, "c", "public", "users", "email", Some("dbB")).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "dbB");
                assert_eq!(actual, "dbA");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    // ── U2 — explain_rdb_query ───────────────────────────────────────────

    #[tokio::test]
    async fn explain_rdb_query_rejects_empty_sql() {
        let state = AppState::new();
        match explain_rdb_query_inner(&state, "c", "  ", None, None).await {
            Err(AppError::Validation(msg)) => assert!(msg.contains("must not be empty")),
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_rdb_query_unknown_connection_returns_notfound() {
        let state = AppState::new();
        match explain_rdb_query_inner(&state, "absent", "SELECT 1", None, None).await {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_rdb_query_document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            explain_rdb_query_inner(&state, "doc", "SELECT 1", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn explain_rdb_query_routes_to_trait_method_with_sql() {
        let mut s = StubRdbAdapter::default();
        s.explain_query_fn = Some(Box::new(|sql| {
            Ok(serde_json::json!([{ "Plan": { "Node Type": "Seq Scan", "echo": sql } }]))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = explain_rdb_query_inner(&state, "c", "SELECT 42", None, None)
            .await
            .unwrap();
        assert_eq!(
            r[0]["Plan"]["echo"],
            serde_json::Value::String("SELECT 42".into())
        );
    }

    #[tokio::test]
    async fn explain_rdb_query_expected_db_mismatch_returns_dbmismatch_before_dispatch() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        s.explain_query_fn = Some(Box::new(|_| {
            panic!("explain_query must not run on db mismatch")
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        match explain_rdb_query_inner(&state, "c", "SELECT 1", Some("db2"), None).await {
            Err(AppError::DbMismatch { expected, actual }) => {
                assert_eq!(expected, "db2");
                assert_eq!(actual, "db1");
            }
            other => panic!("Expected DbMismatch, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn explain_rdb_query_expected_db_match_dispatches_normally() {
        let mut s = StubRdbAdapter::default();
        s.current_database_fn = Some(Box::new(|| Ok(Some("db1".into()))));
        s.explain_query_fn = Some(Box::new(|sql| {
            Ok(serde_json::json!([{ "Plan": { "Node Type": "Seq Scan", "echo": sql } }]))
        }));
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(s))).await;
        let r = explain_rdb_query_inner(&state, "c", "SELECT 42", Some("db1"), None)
            .await
            .unwrap();
        assert_eq!(
            r[0]["Plan"]["echo"],
            serde_json::Value::String("SELECT 42".into())
        );
    }

    #[tokio::test]
    async fn explain_rdb_query_cancel_via_registry_aborts_1269() {
        use std::sync::Arc;
        use tokio::sync::Notify;
        use tokio::time::{timeout, Duration};

        // Gate the stub explain inside the trait future so the cancel lands
        // while the command is parked in its `tokio::select!`.
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let mut s = StubRdbAdapter {
            explain_query_gate: Some((entered.clone(), release.clone())),
            ..StubRdbAdapter::default()
        };
        s.explain_query_fn = Some(Box::new(|_| Ok(serde_json::json!([]))));
        let state = Arc::new(state_with("c", ActiveAdapter::Rdb(Box::new(s))).await);

        let explain_state = Arc::clone(&state);
        let task = tokio::spawn(async move {
            explain_rdb_query_inner(&explain_state, "c", "SELECT 1", None, Some("exp-1")).await
        });

        // Wait until the explain future is parked, then fire the cooperative
        // cancel the same way the frontend Stop button does.
        entered.notified().await;
        cancel_query_inner(&state, "exp-1").await.unwrap();

        let outcome = timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(outcome, Err(AppError::Database(ref m)) if m.contains("cancelled")),
            "expected cooperative cancel, got: {outcome:?}"
        );
        // Token must be released so a retry can re-register the same id.
        assert!(state.query_tokens.lock().await.get("exp-1").is_none());
        release.notify_one();
    }
}
