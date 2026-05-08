pub mod connection;
pub mod document;
pub mod export;
pub mod meta;
pub mod query;
pub mod rdb;

#[cfg(test)]
pub(crate) mod test_util;

use tokio_util::sync::CancellationToken;

use crate::commands::connection::AppState;
use crate::error::AppError;

/// Sprint 237 P5+ (2026-05-08) — `AppError::NotFound` for an unknown
/// `connection_id`. 7개 파일 (commands/{meta,rdb/{schema,query,ddl},
/// document/{browse,query,mutate}}.rs) 에 word-for-word 동일한 helper 가
/// 분산돼 있어 통합. 메시지 포맷은 frontend 의 `useToast` 가 그대로
/// 노출하므로 변경하지 말 것.
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
/// - Sprint 180 (AC-180-04) — initial form on `rdb/schema.rs`.
/// - audit m14 (2026-05-05) — hoisted to `rdb/mod.rs` so all RDB commands share.
/// - Sprint 237 P5 (2026-05-08) — `&AppState` signature for `_inner` testability.
/// - Sprint 237 P5+ (2026-05-08) — hoisted again from `rdb/mod.rs` and
///   `document/mod.rs` (twin copies) to the paradigm-neutral `commands/mod.rs`.
///   `export/mod.rs` 도 같은 헬퍼를 inline 으로 들고 있어 후속 정리.
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
    //! 작성 이유 (2026-05-08, spec-first 라운드 2; Sprint 237 P5+ hoist):
    //! register_cancel_token / release_cancel_token 의 lifecycle 분기를 검증.
    //!   - query_id None → no-op (None 반환, registry 변동 없음)
    //!   - query_id Some(id) → registry 에 (id, fresh token) 삽입, Some 반환
    //!   - release None → no-op (registry 변동 없음)
    //!   - release Some(handle) → registry 에서 해당 id 제거
    //!
    //! 헬퍼는 rdb/mod.rs, document/mod.rs 에 각각 존재했으나 본체가 word-for-
    //! word 동일이라 commands/mod.rs 에 통합. export/mod.rs 도 inline 사본을
    //! 보유하다 같은 helper 로 통합 (Step 3).

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
        // 이 동작은 의도된 것 (HashMap::insert 의 의미론) — same query_id 로
        // 두 번째 register 가 들어오면 첫 번째 token 은 garbage. 실제 코드
        // 흐름에서는 release 가 register 와 paired 라 발생하지 않지만,
        // contract 가 명시되어 있어야 회귀 시 알아차릴 수 있음.
        let state = AppState::new();
        let h1 = register_cancel_token(&state, Some("dup")).await;
        let h2 = register_cancel_token(&state, Some("dup")).await;

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
