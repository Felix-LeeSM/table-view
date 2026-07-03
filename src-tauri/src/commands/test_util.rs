//! Sprint 237 P5+ (2026-05-08) — shared test helpers for `commands/**`
//! `mod tests` blocks. `state_with` / `rdb_default` / `document_default` 가
//! commands/{rdb,document}/{schema,query,ddl,browse,mutate}.rs 6곳에 word-for-
//! word 동일 본체로 분산돼 있던 것을 통합. `cfg(test)` 로만 컴파일되며
//! `pub(crate)` 노출 — production 빌드에는 영향 없음.

use std::sync::Arc;

use crate::commands::connection::AppState;
use crate::db::testing::{StubDocumentAdapter, StubRdbAdapter};
use crate::db::ActiveAdapter;

/// Build an `AppState` with a single named active connection. 모든 _inner
/// 핸들러 테스트가 이 형태로 fixture 를 만든다.
pub(crate) async fn state_with(id: &str, active: ActiveAdapter) -> AppState {
    let state = AppState::new();
    {
        let mut conns = state.active_connections.lock().await;
        conns.insert(id.to_string(), Arc::new(active));
    }
    state
}

/// Default RDB stub — trait method 호출 시 `Unsupported` 또는 sentinel
/// (test 마다 override 가능). 본 helper 는 시나리오 라인이 "어느 paradigm
/// 인가" 만 검증할 때 fixture 부담을 줄이기 위함.
pub(crate) fn rdb_default() -> ActiveAdapter {
    ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))
}

/// Default Document stub — `rdb_default` 의 sibling.
pub(crate) fn document_default() -> ActiveAdapter {
    ActiveAdapter::Document(Box::new(StubDocumentAdapter::default()))
}
