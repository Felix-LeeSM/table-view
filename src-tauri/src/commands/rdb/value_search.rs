//! Issue #1525 — read-only cross-table value search command.
//!
//! Resolves the active adapter, dispatches to `RdbAdapter::search_values`
//! (PostgreSQL-only override; other RDB dialects and non-RDB paradigms
//! surface `Unsupported`), and threads the shared cancel-token +
//! db-mismatch + row-cap plumbing used by the rest of the query family.

use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::models::ValueSearchResult;

use super::{ensure_expected_db, not_connected, register_cancel_token, release_cancel_token};

/// Validate value-search inputs before touching the connection registry, so a
/// blank term / empty scope short-circuits without a lock or a DB round-trip.
/// Extracted for unit testing without a Tauri `AppState`.
pub fn validate_value_search_inputs(term: &str, schemas: &[String]) -> Result<(), AppError> {
    if term.trim().is_empty() {
        return Err(AppError::Validation("Search term cannot be empty".into()));
    }
    if schemas.is_empty() {
        return Err(AppError::Validation(
            "At least one schema must be selected".into(),
        ));
    }
    Ok(())
}

async fn pg_search_values_inner(
    state: &AppState,
    connection_id: &str,
    schemas: &[String],
    term: &str,
    query_id: Option<&str>,
    expected_database: Option<&str>,
) -> Result<ValueSearchResult, AppError> {
    info!(
        connection_id = %connection_id,
        schema_count = schemas.len(),
        term_len = term.len(),
        "Cross-table value search"
    );

    validate_value_search_inputs(term, schemas)?;

    // Cooperative cancel only (like EXPLAIN, #1269): the scan issues a series
    // of short bound SELECTs and the frontend Stop button fires
    // `cancel_query(query_id)` to abort between/within tables. No native pid
    // capture — the individual statements are LIMIT-bounded.
    let cancel_handle = register_cancel_token(state, query_id).await;

    let result = async {
        let active = state
            .active_adapter(connection_id)
            .await
            .ok_or_else(|| not_connected(connection_id))?;
        let adapter = active.as_rdb()?;
        ensure_expected_db(adapter, expected_database).await?;
        let cancel_tok = cancel_handle.as_ref().map(|(_, tok)| tok);
        adapter
            .search_values(schemas, term, cancel_tok, crate::db::row_cap::current())
            .await
    }
    .await;

    release_cancel_token(state, &cancel_handle).await;

    match &result {
        Ok(r) => info!(
            matches = r.matches.len(),
            scanned_tables = r.scanned_tables,
            truncated = r.truncated,
            "Value search completed"
        ),
        Err(e) => warn!(error = %e, "Value search failed"),
    }

    result
}

/// Issue #1525 — read-only cross-table ILIKE search over the TEXT columns of
/// base tables in the selected `schemas`. PostgreSQL-only; other adapters
/// return `Unsupported`. `query_id` registers a cooperative cancel token that
/// `cancel_query` can fire; `expected_database` is the opt-in db-mismatch
/// guard shared with `execute_query`.
#[tauri::command]
pub async fn pg_search_values(
    state: State<'_, AppState>,
    connection_id: String,
    schemas: Vec<String>,
    term: String,
    query_id: Option<String>,
    expected_database: Option<String>,
) -> Result<ValueSearchResult, AppError> {
    // Issue #1231 — publish the persisted row cap so the scan's per-table
    // LIMIT + total match budget honour the user's configured ceiling. Kept in
    // the command wrapper (not `_inner`) so unit tests that drive `_inner`
    // never touch the process-global SQLite pool — mirrors `execute_query`.
    crate::commands::sqlite_pool::publish_row_cap().await;
    pg_search_values_inner(
        state.inner(),
        &connection_id,
        &schemas,
        &term,
        query_id.as_deref(),
        expected_database.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::connection::AppState;
    use crate::commands::test_util::{document_default, state_with};
    use crate::db::testing::StubRdbAdapter;
    use crate::db::ActiveAdapter;

    // ── validate_value_search_inputs — pure guard ────────────────────────

    #[test]
    fn validate_rejects_empty_term() {
        let err = validate_value_search_inputs("   ", &["public".to_string()]).unwrap_err();
        assert!(err.to_string().contains("Search term cannot be empty"));
    }

    #[test]
    fn validate_rejects_empty_schemas() {
        let err = validate_value_search_inputs("foo", &[]).unwrap_err();
        assert!(err.to_string().contains("At least one schema"));
    }

    #[test]
    fn validate_accepts_valid_inputs() {
        assert!(validate_value_search_inputs("foo", &["public".to_string()]).is_ok());
    }

    // ── dispatch contract ────────────────────────────────────────────────
    // 작성 이유 (#1525): 빈 입력이 connection lookup 보다 먼저 short-circuit
    // 하고, 미지원 adapter (non-PG RDB / document paradigm) 가 정확히
    // Unsupported 를 반환해 frontend 의 "PostgreSQL only" 게이트가 보장됨을
    // 동결한다.

    #[tokio::test]
    async fn empty_term_short_circuits_before_lookup() {
        // Unregistered connection + blank term ⇒ Validation, not NotFound:
        // the input guard runs before the registry lookup.
        let state = AppState::new();
        match pg_search_values_inner(&state, "absent", &["public".to_string()], "  ", None, None)
            .await
        {
            Err(AppError::Validation(msg)) => assert!(msg.contains("Search term")),
            other => panic!("Expected Validation, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn unknown_connection_returns_notfound() {
        let state = AppState::new();
        match pg_search_values_inner(&state, "absent", &["public".to_string()], "foo", None, None)
            .await
        {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("absent")),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn document_paradigm_returns_unsupported() {
        let state = state_with("doc", document_default()).await;
        assert!(matches!(
            pg_search_values_inner(&state, "doc", &["public".to_string()], "foo", None, None).await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn non_pg_rdb_adapter_returns_unsupported() {
        // A non-PG RDB adapter inherits the default `search_values` (Unsupported)
        // so the feature stays PostgreSQL-scoped without a capability flag.
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        match pg_search_values_inner(&state, "c", &["public".to_string()], "foo", None, None).await
        {
            Err(AppError::Unsupported(_)) => {}
            other => panic!("Expected Unsupported, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn round_trip_releases_cancel_token() {
        // Even on the Unsupported early path, the registered token is released
        // so a retry under the same query id starts clean.
        let state = state_with("c", ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))).await;
        let _ = pg_search_values_inner(
            &state,
            "c",
            &["public".to_string()],
            "foo",
            Some("vs-1"),
            None,
        )
        .await;
        assert!(!state.query_tokens.lock().await.contains_key("vs-1"));
    }
}
