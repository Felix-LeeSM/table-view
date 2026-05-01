//! RDB query execution, cancellation, and tabular paging.
//!
//! Every handler resolves the connection via
//! `state.active_connections.lock().await`, then dispatches through
//! `ActiveAdapter::as_rdb()?` so that non-RDB connections fail cleanly with
//! `AppError::Unsupported` before any concrete method is invoked.

use tauri::State;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::{FilterCondition, QueryResult, TableData};

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

fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
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
#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
    query_id: String,
) -> Result<QueryResult, AppError> {
    info!(
        connection_id = %connection_id,
        query_id = %query_id,
        sql_len = sql.len(),
        "Executing query"
    );

    validate_query_inputs(&sql, &connection_id)?;

    // Create cancellation token for this query
    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();

    // Store the token for potential cancellation before taking the
    // connections lock, so cancel_query can run without contending.
    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.insert(query_id.clone(), cancel_token);
    }

    // Execute the query through the enum dispatch. We hold the
    // `active_connections` lock for the duration of the query — the same
    // shape used by every other RDB command post Sprint 64 — which is safe
    // because PostgresAdapter's inherent `execute_query` drives the query
    // through an internal pool guarded by its own `Arc<Mutex<…>>`.
    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active.as_rdb()?.execute_sql(&sql, Some(&child_token)).await
    };

    // Clean up the token after execution (whether success or failure)
    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(&query_id);
    }

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
#[tauri::command]
pub async fn execute_query_batch(
    state: State<'_, AppState>,
    connection_id: String,
    statements: Vec<String>,
    query_id: String,
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

    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();

    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.insert(query_id.clone(), cancel_token);
    }

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_rdb()?
            .execute_sql_batch(&statements, Some(&child_token))
            .await
    };

    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(&query_id);
    }

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
    info!(query_id = %query_id, "Attempting to cancel query");

    validate_cancel_inputs(&query_id)?;

    // Find and cancel the token
    let token = {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(&query_id)
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
    // Hoist token registration outside the active_connections lock so
    // `cancel_query` can flip the flag without contention. Mirrors the
    // shape used by `execute_query` at lines 73-81 above.
    let cancel_handle: Option<(String, CancellationToken)> = if let Some(qid) = query_id.as_ref() {
        let token = CancellationToken::new();
        let stored = token.clone();
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert(qid.clone(), stored);
        }
        Some((qid.clone(), token))
    } else {
        None
    };

    let result = {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(&connection_id)
            .ok_or_else(|| not_connected(&connection_id))?;
        active
            .as_rdb()?
            .query_table_data(
                &schema,
                &table,
                page.unwrap_or(1),
                page_size.unwrap_or(100),
                order_by.as_deref(),
                filters.as_deref(),
                raw_where.as_deref(),
                cancel_handle.as_ref().map(|(_, tok)| tok),
            )
            .await
    };

    // Always remove the token after the call completes (success, error,
    // or cancelled) so the registry stays clean for the next attempt
    // (AC-180-05 retry contract).
    if let Some((qid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(&qid);
    }

    result
}

#[cfg(test)]
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
}
