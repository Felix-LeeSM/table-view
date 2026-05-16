//! 작성 2026-05-16 (Phase 2 sprint-359) — tab affinity lazy semantics.
//!
//! AC-359-01 / AC-359-02 / AC-359-02b: 앱 boot 직후 `AppState.tab_affinity`
//! 가 empty HashMap 임을 단언. Tab 이 열린 직후엔 entry 가 없다 (full
//! lazy). 첫 `bind_tab_affinity(connection_id, tab_id, server_pid)` 호출
//! 후엔 `Some(TabAffinity { server_pid })` 가 저장된다.

use table_view_lib::commands::connection::AppState;
use table_view_lib::commands::release_tab_connection::bind_tab_affinity_inner;

#[tokio::test]
async fn boot_state_has_empty_tab_affinity() {
    // AC-359-01: 새 AppState 는 비어 있어야 한다. 어떤 cross-restart
    // persist 도 없어야 한다 (Q5.6 lazy 의 "메모리만, boot 시 0" 정합).
    let state = AppState::new();
    let map = state.tab_affinity.lock().await;
    assert!(
        map.is_empty(),
        "boot 직후 tab_affinity 가 비어 있어야 한다, got {} entries",
        map.len()
    );
}

#[tokio::test]
async fn lazy_no_entry_before_first_bind() {
    // AC-359-02 (앞부분): tab 이 등록만 된 시점엔 affinity entry 가
    // 아직 없다. `bind_tab_affinity` 가 처음 호출되기 전엔 lookup 이
    // None 을 반환한다.
    let state = AppState::new();
    let map = state.tab_affinity.lock().await;
    assert!(map
        .get(&("conn-1".to_string(), "tab-1".to_string()))
        .is_none());
}

#[tokio::test]
async fn bind_inserts_server_pid_under_composite_key() {
    // AC-359-02 (뒷부분): `bind_tab_affinity` 호출 후엔
    // `(connection_id, tab_id)` 복합 키로 `Some(server_pid)` 가
    // 저장된다. 같은 `tab_id` 가 두 다른 connection 에 등록되어도
    // 충돌하지 않는다 (codex 7차 #4 — connection-scoped key).
    let state = AppState::new();

    bind_tab_affinity_inner(&state, "conn-1", "tab-1", 12345)
        .await
        .expect("bind should succeed");

    {
        let map = state.tab_affinity.lock().await;
        let entry = map
            .get(&("conn-1".to_string(), "tab-1".to_string()))
            .expect("bind 한 entry 가 존재해야 한다");
        assert_eq!(entry.server_pid, 12345);
    }

    // 다른 connection 의 같은 tab_id 와 분리되어 있다.
    bind_tab_affinity_inner(&state, "conn-2", "tab-1", 67890)
        .await
        .expect("collision-free bind on a different connection");

    let map = state.tab_affinity.lock().await;
    assert_eq!(
        map.get(&("conn-1".to_string(), "tab-1".to_string()))
            .unwrap()
            .server_pid,
        12345,
        "conn-1 entry 가 conn-2 의 bind 로 덮어쓰이면 안 된다"
    );
    assert_eq!(
        map.get(&("conn-2".to_string(), "tab-1".to_string()))
            .unwrap()
            .server_pid,
        67890,
    );
}

#[tokio::test]
async fn rebind_overwrites_server_pid_for_same_tab() {
    // 같은 (conn, tab) 으로 재bind 하면 마지막 server_pid 가 이긴다 —
    // first-query → reconnect → second-query 시퀀스를 표현. 기존 entry
    // 의 의도된 인-place update 임을 회귀 가드로 박는다.
    let state = AppState::new();
    bind_tab_affinity_inner(&state, "c", "t", 1).await.unwrap();
    bind_tab_affinity_inner(&state, "c", "t", 2).await.unwrap();
    let map = state.tab_affinity.lock().await;
    assert_eq!(
        map.get(&("c".to_string(), "t".to_string()))
            .unwrap()
            .server_pid,
        2
    );
}
