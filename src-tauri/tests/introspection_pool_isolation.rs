//! 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-02b:
//! introspection_pool 격리 + round-robin 호출 spy.
//!
//! Strategy doc lines 478–480: sidebar / autocomplete / prefetch 가
//! tab pool 과 별도로 idle round-robin 한다. 본 sprint 의 격리 surface
//! 는 `AppState.introspection_pools: HashMap<conn_id, IntrospectionPool>`
//! 이고, 각 `IntrospectionPool::acquire_slot()` 가 cap=5 modulo 의
//! round-robin index 를 반환한다. 본 테스트는:
//!
//! 1. boot 직후 `AppState.introspection_pools` 가 비어 있다 (lazy).
//! 2. connection 별로 별도 pool — 한 connection 의 acquire 가 다른
//!    connection 의 counter 를 건드리지 않는다 (key isolation).
//! 3. 12 회 acquire 시 슬롯 sequence 가 0..4 반복 — `cap=5` round-robin.

use table_view_lib::commands::connection::AppState;
use table_view_lib::state::introspection_pool::IntrospectionPool;

#[tokio::test]
async fn boot_state_has_empty_introspection_pools() {
    let state = AppState::new();
    let map = state.introspection_pools.lock().await;
    assert!(map.is_empty(), "boot 직후 introspection_pools 가 비어야");
}

#[tokio::test]
async fn lazy_insert_per_connection_uses_default_capacity() {
    // 새 connection 의 첫 acquire 가 IntrospectionPool::new() 를 lazy 로
    // 만들고 그 인스턴스가 max_size=5 임을 단언.
    let state = AppState::new();

    {
        let mut map = state.introspection_pools.lock().await;
        map.entry("conn-A".to_string())
            .or_insert_with(IntrospectionPool::new);
    }

    let map = state.introspection_pools.lock().await;
    let p = map.get("conn-A").unwrap();
    assert_eq!(p.max_size(), 5);
}

#[tokio::test]
async fn round_robin_yields_0_to_4_then_wraps() {
    let state = AppState::new();
    let mut map = state.introspection_pools.lock().await;
    let pool = map.entry("c".into()).or_insert_with(IntrospectionPool::new);

    let mut seen = Vec::new();
    for _ in 0..12 {
        seen.push(pool.acquire_slot());
    }
    assert_eq!(seen, vec![0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
}

#[tokio::test]
async fn pools_are_isolated_across_connections() {
    // conn-A 와 conn-B 의 round-robin counter 가 분리되어 있다.
    let state = AppState::new();
    let mut map = state.introspection_pools.lock().await;
    let a = map
        .entry("conn-A".into())
        .or_insert_with(IntrospectionPool::new);
    assert_eq!(a.acquire_slot(), 0);
    assert_eq!(a.acquire_slot(), 1);

    let b = map
        .entry("conn-B".into())
        .or_insert_with(IntrospectionPool::new);
    // B 는 처음 — 0 부터 시작.
    assert_eq!(b.acquire_slot(), 0);

    let a2 = map.get("conn-A").unwrap();
    // A 는 2 부터 이어진다 (B 의 acquire 가 A counter 를 건드리면 안 됨).
    assert_eq!(a2.acquire_slot(), 2);
}
