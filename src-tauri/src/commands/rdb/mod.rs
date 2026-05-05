//! Commands scoped to the relational-database (RDB) paradigm.
//!
//! Sprint 64 split the former flat `commands/{schema,query}.rs` into three
//! submodules under `commands/rdb/`:
//!   - `schema` — read-only catalog introspection (list_schemas, list_tables,
//!     get_table_columns, list_schema_columns, get_table_indexes,
//!     get_table_constraints, list_views, list_functions, get_view_definition,
//!     get_view_columns, get_function_source).
//!   - `query`  — query execution/cancellation and tabular paging
//!     (`execute_query`, `cancel_query`, `query_table_data`).
//!   - `ddl`    — schema-changing operations (drop_table, rename_table,
//!     alter_table, create_index, drop_index, add_constraint, drop_constraint).
//!
//! All command function names are preserved unchanged so that frontend
//! `invoke("…")` call sites remain valid after the reorganization.

pub mod ddl;
pub mod query;
pub mod schema;

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;

/// Register a cancellation token under `query_id` in the shared
/// `query_tokens` registry so the existing `cancel_query` command can fire
/// it. Returns the registered (id, token) pair, or `None` when no id was
/// provided. Caller passes the returned token's clone into the actual work,
/// then calls `release_cancel_token` to drop the registration.
///
/// Sprint 180 (AC-180-04). audit m14 (2026-05-05): hoisted from
/// `rdb/schema.rs` so `rdb/query.rs` and any future RDB command share one
/// implementation.
pub(super) async fn register_cancel_token(
    state: &tauri::State<'_, AppState>,
    query_id: Option<&str>,
) -> Option<(String, CancellationToken)> {
    let qid = query_id?.to_string();
    let token = CancellationToken::new();
    let stored = token.clone();
    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.insert(qid.clone(), stored);
    }
    Some((qid, token))
}

pub(super) async fn release_cancel_token(
    state: &tauri::State<'_, AppState>,
    cancel_handle: &Option<(String, CancellationToken)>,
) {
    if let Some((qid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(qid);
    }
}
