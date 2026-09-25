//! Written 2026-05-16 — tab affinity lazy semantics.
//!
//! AC-359-01 / AC-359-02 / AC-359-02b: asserts `AppState.tab_affinity` is an
//! empty HashMap right after app boot. A tab has no entry right after it is
//! opened (full lazy). After the first
//! `bind_tab_affinity(connection_id, tab_id, server_pid)` call,
//! `Some(TabAffinity { server_pid })` is stored.

use table_view_lib::commands::connection::AppState;
use table_view_lib::commands::release_tab_connection::bind_tab_affinity_inner;

#[tokio::test]
async fn boot_state_has_empty_tab_affinity() {
    // AC-359-01: a fresh AppState must be empty, and nothing may persist
    // across restarts (matching Q5.6 lazy's "memory only, 0 at boot").
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
    // AC-359-02 (first half): a tab that is only registered carries no
    // affinity entry. Before the first `bind_tab_affinity` call the lookup
    // returns None.
    let state = AppState::new();
    let map = state.tab_affinity.lock().await;
    assert!(map
        .get(&("conn-1".to_string(), "tab-1".to_string()))
        .is_none());
}

#[tokio::test]
async fn bind_inserts_server_pid_under_composite_key() {
    // AC-359-02 (second half): after a `bind_tab_affinity` call,
    // `Some(server_pid)` is stored under the composite
    // `(connection_id, tab_id)` key. The same `tab_id` registered on two
    // different connections does not collide (connection-scoped key).
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

    // Kept separate from the same tab_id on another connection.
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
    // Rebinding the same (conn, tab) lets the last server_pid win — this
    // models the first-query → reconnect → second-query sequence. The guard
    // pins the in-place update of the existing entry as intended.
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
