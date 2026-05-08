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

pub(super) async fn release_cancel_token(
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
    //! 작성 이유 (2026-05-08, spec-first 라운드 2): register_cancel_token /
    //! release_cancel_token 의 lifecycle 분기를 검증.
    //!   - query_id None → no-op (None 반환, registry 변동 없음)
    //!   - query_id Some(id) → registry 에 (id, fresh token) 삽입, Some 반환
    //!   - release None → no-op (registry 변동 없음)
    //!   - release Some(handle) → registry 에서 해당 id 제거
    //!
    //! 두 헬퍼는 (Sprint 237 P5 step 3) `&AppState` 직접 받도록 변경.
    //! production 함수를 그대로 호출해 검증 가능 — 별도 inner mirror 불필요.

    use super::{register_cancel_token as register_inner, release_cancel_token as release_inner};
    use crate::commands::connection::AppState;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn register_with_none_query_id_returns_none_and_does_not_touch_registry() {
        let state = AppState::new();
        let result = register_inner(&state, None).await;
        assert!(result.is_none());
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.is_empty(), "registry 가 변경되어선 안 됨");
    }

    #[tokio::test]
    async fn register_with_some_query_id_inserts_entry_and_returns_paired_token() {
        let state = AppState::new();
        let result = register_inner(&state, Some("q-abc")).await;
        let (qid, returned_token) = result.expect("Some 가 와야 함");
        assert_eq!(qid, "q-abc");

        let tokens = state.query_tokens.lock().await;
        assert!(tokens.contains_key("q-abc"), "registry 에 'q-abc' 누락");
        // returned token 과 stored token 은 child/parent 관계 — 외부에서 cancel
        // 하면 stored 도 함께 cancel 되어야 cancel_query 가 동작.
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
        // 미리 다른 토큰 하나 추가해서 registry 가 비지 않은 상태에서 시작.
        {
            let mut tokens = state.query_tokens.lock().await;
            tokens.insert("untouched".into(), CancellationToken::new());
        }
        release_inner(&state, &None).await;
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.contains_key("untouched"), "기존 항목 사라지면 안 됨");
    }

    #[tokio::test]
    async fn release_with_some_handle_removes_only_that_id() {
        let state = AppState::new();
        let handle_a = register_inner(&state, Some("a")).await;
        let _handle_b = register_inner(&state, Some("b")).await;
        release_inner(&state, &handle_a).await;
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("a"), "release 한 a 가 남아있음");
        assert!(tokens.contains_key("b"), "release 안 한 b 가 사라짐");
    }

    #[tokio::test]
    async fn register_then_release_is_balanced_round_trip() {
        let state = AppState::new();
        let handle = register_inner(&state, Some("rt")).await;
        assert!(handle.is_some());
        release_inner(&state, &handle).await;
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.is_empty(), "round-trip 후 registry 가 비어야 함");
    }

    #[tokio::test]
    async fn register_same_id_twice_overwrites_previous_token() {
        // 이 동작은 의도된 것 (HashMap::insert 의 의미론) — same query_id 로
        // 두 번째 register 가 들어오면 첫 번째 token 은 garbage. 실제 코드
        // 흐름에서는 release 가 register 와 paired 라 발생하지 않지만,
        // contract 가 명시되어 있어야 회귀 시 알아차릴 수 있음.
        let state = AppState::new();
        let h1 = register_inner(&state, Some("dup")).await;
        let h2 = register_inner(&state, Some("dup")).await;

        let (_, token1) = h1.unwrap();
        let (_, token2) = h2.unwrap();
        let tokens = state.query_tokens.lock().await;
        let stored = tokens.get("dup").unwrap();

        // 첫 번째 token 으로 cancel — registry 의 stored 는 영향 없음.
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
