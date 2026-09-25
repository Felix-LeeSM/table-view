pub mod cancel_query;
pub mod connection;
pub mod datagrid_prefs;
pub mod document;
pub mod export;
pub mod file_analytics;
pub mod groups_collapsed;
pub mod guard;
pub mod history;
pub mod import_csv;
pub mod import_file;
pub mod import_legacy;
pub mod keyring;
pub mod kv;
pub mod meta;
pub mod meta_sentinel;
pub mod open_log_dir;
pub mod open_workspace_window;
pub mod persist_connections;
pub mod persist_favorites;
pub mod persist_mru;
pub mod persist_settings;
pub mod persist_snippets;
pub mod persist_table_activity;
pub mod persist_workspace;
pub mod query;
pub mod rdb;
pub mod registry;
pub mod release_tab_connection;
// Issue #1112 (2026-07-03) — RDB Safe Mode backend gate. Re-reads the
// persisted Safe Mode + connection environment and refuses destructive
// statements that carry no confirmation proof (IPC chokepoint).
pub mod safe_mode;
pub mod search;
pub mod single_instance;
pub mod snapshot;
// Backend SQL parser IPC, mirrors the frontend
// `src/lib/sql/sqlAst.ts` facade through the same `sql-parser-core`
// crate (native compile here, WASM compile in the renderer).
pub mod sql_parser;
pub mod sqlite_pool;

#[cfg(test)]
pub(crate) mod test_util;

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;
use crate::error::AppError;

/// `AppError::NotFound` for an unknown `connection_id`. The identical helper
/// was scattered word-for-word across commands/{meta,rdb/{schema,query,ddl},
/// document/{browse,query,mutate}}.rs and is unified here. The message format
/// is surfaced verbatim by the frontend's `useToast` — do not change it.
pub(crate) fn not_connected(connection_id: &str) -> AppError {
    AppError::NotFound(format!("Connection '{}' not found", connection_id))
}

/// Register a cancellation token under `query_id` in the shared
/// `query_tokens` registry so the existing `cancel_query` command can fire
/// it. Returns the registered (id, token) pair, or `None` when no id was
/// provided. Caller passes the returned token's clone into the actual work,
/// then calls `release_cancel_token` to drop the registration.
///
/// History:
/// - AC-180-04 — initial form on `rdb/schema.rs`.
/// - audit m14 (2026-05-05) — hoisted to `rdb/mod.rs` so all RDB commands share.
/// - 2026-05-08 — `&AppState` signature for `_inner` testability.
/// - 2026-05-08 — hoisted again from `rdb/mod.rs` and
///   `document/mod.rs` (twin copies) to the paradigm-neutral `commands/mod.rs`.
///   `export/mod.rs` also held an inline copy of the same helper and was
///   folded in as follow-up cleanup.
pub(crate) async fn register_cancel_token(
    state: &AppState,
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

pub(crate) async fn release_cancel_token(
    state: &AppState,
    cancel_handle: &Option<(String, CancellationToken)>,
) {
    if let Some((qid, _)) = cancel_handle {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(qid);
    }
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-08:
    //! Verifies the lifecycle branches of register_cancel_token /
    //! release_cancel_token.
    //!   - query_id None → no-op (returns None, registry unchanged)
    //!   - query_id Some(id) → inserts (id, fresh token) into the registry, returns Some
    //!   - release None → no-op (registry unchanged)
    //!   - release Some(handle) → removes that id from the registry
    //!
    //! See the unification history on `register_cancel_token`.

    use super::{register_cancel_token, release_cancel_token};
    use crate::commands::connection::AppState;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn register_with_none_query_id_returns_none_and_does_not_touch_registry() {
        let state = AppState::new();
        let result = register_cancel_token(&state, None).await;
        assert!(result.is_none());
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.is_empty(), "registry 가 변경되어선 안 됨");
    }

    #[tokio::test]
    async fn register_with_some_query_id_inserts_entry_and_returns_paired_token() {
        let state = AppState::new();
        let result = register_cancel_token(&state, Some("q-abc")).await;
        let (qid, returned_token) = result.expect("Some 가 와야 함");
        assert_eq!(qid, "q-abc");

        let tokens = state.query_tokens.lock().await;
        assert!(tokens.contains_key("q-abc"), "registry 에 'q-abc' 누락");
        // The returned token and the stored token are in a child/parent
        // relation — cancelling from outside must cancel the stored one too,
        // or `cancel_query` would not work.
        let stored = tokens.get("q-abc").unwrap();
        assert!(!stored.is_cancelled());
        returned_token.cancel();
        assert!(
            stored.is_cancelled(),
            "returned/stored token 이 같은 cancellation 을 공유해야 함"
        );
    }

    #[tokio::test]
    async fn release_with_none_handle_is_noop() {
        let state = AppState::new();
        // Add one other token first so the registry does not start empty.
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert("untouched".into(), CancellationToken::new());
        }
        release_cancel_token(&state, &None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.contains_key("untouched"), "기존 항목 사라지면 안 됨");
    }

    #[tokio::test]
    async fn release_with_some_handle_removes_only_that_id() {
        let state = AppState::new();
        let handle_a = register_cancel_token(&state, Some("a")).await;
        let _handle_b = register_cancel_token(&state, Some("b")).await;
        release_cancel_token(&state, &handle_a).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("a"), "release 한 a 가 남아있음");
        assert!(tokens.contains_key("b"), "release 안 한 b 가 사라짐");
    }

    #[tokio::test]
    async fn register_then_release_is_balanced_round_trip() {
        let state = AppState::new();
        let handle = register_cancel_token(&state, Some("rt")).await;
        assert!(handle.is_some());
        release_cancel_token(&state, &handle).await;
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.is_empty(), "round-trip 후 registry 가 비어야 함");
    }

    #[tokio::test]
    async fn register_same_id_twice_overwrites_previous_token() {
        // This behavior is intentional (HashMap::insert semantics) — when a
        // second register comes in with the same query_id, the first token
        // becomes garbage. The real code flow never hits this because release
        // is paired with register, but the contract must be spelled out so a
        // regression gets noticed.
        let state = AppState::new();
        let h1 = register_cancel_token(&state, Some("dup")).await;
        let h2 = register_cancel_token(&state, Some("dup")).await;

        let (_, token1) = h1.unwrap();
        let (_, token2) = h2.unwrap();
        let tokens = state.query_tokens.lock().await;
        let stored = tokens.get("dup").unwrap();

        // Cancel via the first token — the stored token in the registry is
        // unaffected.
        token1.cancel();
        assert!(
            !stored.is_cancelled(),
            "두 번째 register 가 첫 번째 token 을 분리시켜야 함"
        );
        token2.cancel();
        assert!(
            stored.is_cancelled(),
            "두 번째 token 은 stored 와 같은 cancellation 공유"
        );
    }
}
