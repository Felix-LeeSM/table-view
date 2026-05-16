//! 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-07: release_tab_connection
//! 가 affinity entry 를 떨어뜨리고 (lazy) 후속 cancel 이 `AlreadyCompleted`
//! 로 분류된다.
//!
//! Phase 2 의 dedicated `PoolConnection` per tab 가 본 sprint 에선 server-
//! pid 만 추적 (codex 정합 — pool acquire 는 follow-up). 따라서 본 테스트는
//! IPC 의 lifecycle 만 단언:
//!
//! - `bind_tab_affinity` 후 entry 존재
//! - `release_tab_connection` 호출 → entry 제거
//! - 같은 server_pid 로 `cancel_query_native` → `AlreadyCompleted`
//!   (connection 자체가 미연결 / 미존재 path 이므로 silent suppression)
//!
//! Live PG rollback (실제 INSERT 가 rollback 되는 wire timeline) 은
//! `db/postgres/queries.rs` 의 transaction 통합 path 가 별도로 보장한다 —
//! 본 IPC 는 PoolConnection drop → sqlx auto-rollback 의 layer 1
//! orchestrator 다.

use table_view_lib::commands::cancel_query::{cancel_query_native_inner, CancelError};
use table_view_lib::commands::connection::AppState;
use table_view_lib::commands::release_tab_connection::{
    bind_tab_affinity_inner, release_tab_connection_inner,
};

#[tokio::test]
async fn release_after_bind_drops_entry_and_subsequent_cancel_is_already_completed() {
    let state = AppState::new();
    bind_tab_affinity_inner(&state, "conn-x", "tab-x", 7777)
        .await
        .unwrap();

    // Sanity: entry present before release.
    assert!(state
        .tab_affinity
        .lock()
        .await
        .contains_key(&("conn-x".to_string(), "tab-x".to_string())));

    let removed = release_tab_connection_inner(&state, "conn-x", "tab-x")
        .await
        .unwrap();
    assert!(removed, "release 가 bound entry 를 제거해야 한다");

    // 두 번째 release 는 silent no-op (이미 제거됨).
    let removed2 = release_tab_connection_inner(&state, "conn-x", "tab-x")
        .await
        .unwrap();
    assert!(!removed2, "absent entry 의 release 는 false 여야 한다");

    // cancel against the (now unmapped) pid — adapter 자체가 등록 안 됨 →
    // AlreadyCompleted 로 분류 (frontend silent path).
    let r = cancel_query_native_inner(&state, "conn-x", 7777).await;
    assert!(
        matches!(r, Err(CancelError::AlreadyCompleted)),
        "release 후 cancel 은 AlreadyCompleted 여야 한다, got {:?}",
        r
    );
}

#[tokio::test]
async fn release_does_not_touch_other_tabs() {
    // 한 tab 의 release 가 다른 tab 의 entry 를 보존하는지 — connection-
    // scoped key 의 핵심 invariant.
    let state = AppState::new();
    bind_tab_affinity_inner(&state, "c", "tab-A", 1)
        .await
        .unwrap();
    bind_tab_affinity_inner(&state, "c", "tab-B", 2)
        .await
        .unwrap();
    bind_tab_affinity_inner(&state, "c2", "tab-A", 3)
        .await
        .unwrap();

    release_tab_connection_inner(&state, "c", "tab-A")
        .await
        .unwrap();

    let map = state.tab_affinity.lock().await;
    assert!(!map.contains_key(&("c".to_string(), "tab-A".to_string())));
    assert!(map.contains_key(&("c".to_string(), "tab-B".to_string())));
    assert!(
        map.contains_key(&("c2".to_string(), "tab-A".to_string())),
        "다른 connection 의 같은 tab_id 가 영향받으면 안 된다"
    );
}
