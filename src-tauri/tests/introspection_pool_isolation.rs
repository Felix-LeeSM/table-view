//! AC-359-02b: introspection_pool isolation + a round-robin call spy.
//!
//! Strategy doc lines 478–480: sidebar / autocomplete / prefetch run an idle
//! round-robin separate from the tab pool. The isolation surface is
//! `AppState.introspection_pools: HashMap<conn_id, IntrospectionPool>`, and
//! each `IntrospectionPool::acquire_slot()` returns a round-robin index
//! modulo cap=5. This test asserts:
//!
//! 1. `AppState.introspection_pools` is empty right after boot (lazy).
//! 2. A separate pool per connection — one connection's acquire does not
//!    touch another connection's counter (key isolation).
//! 3. 12 acquires yield a slot sequence repeating 0..4 — `cap=5`
//!    round-robin.

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
    // The first acquire for a new connection lazily builds an
    // IntrospectionPool::new(); assert that instance has max_size=5.
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
    // conn-A and conn-B keep separate round-robin counters.
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
    // B is fresh — starts at 0.
    assert_eq!(b.acquire_slot(), 0);

    let a2 = map.get("conn-A").unwrap();
    // A continues from 2 (B's acquire must not touch A's counter).
    assert_eq!(a2.acquire_slot(), 2);
}
