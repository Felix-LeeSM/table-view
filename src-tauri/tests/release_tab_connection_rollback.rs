//! Written 2026-05-16 — AC-359-07: release_tab_connection drops the affinity
//! entry (lazy) and a later cancel is classified as `AlreadyCompleted`.
//!
//! The affinity record tracks the server pid only; holding a dedicated
//! `PoolConnection` per tab is a follow-up (see the module doc of
//! `commands/release_tab_connection.rs`). This test therefore asserts the IPC
//! lifecycle alone:
//!
//! - the entry exists after `bind_tab_affinity`
//! - calling `release_tab_connection` removes the entry
//! - `cancel_query_native` with the same server_pid → `AlreadyCompleted`
//!   (the connection itself is on the unconnected / absent path, so it is
//!   silently suppressed)
//!
//! Live PG rollback (the wire timeline where a real INSERT is rolled back) is
//! guaranteed separately by the transaction integration path in
//! `db/postgres/queries.rs` — this IPC is the layer-1 orchestrator of
//! PoolConnection drop → sqlx auto-rollback.

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

    // The second release is a silent no-op (the entry is already gone).
    let removed2 = release_tab_connection_inner(&state, "conn-x", "tab-x")
        .await
        .unwrap();
    assert!(!removed2, "absent entry 의 release 는 false 여야 한다");

    // cancel against the (now unmapped) pid — the adapter itself is not
    // registered → classified as AlreadyCompleted (frontend silent path).
    let r = cancel_query_native_inner(&state, "conn-x", 7777, None).await;
    assert!(
        matches!(r, Err(CancelError::AlreadyCompleted)),
        "release 후 cancel 은 AlreadyCompleted 여야 한다, got {:?}",
        r
    );
}

#[tokio::test]
async fn release_does_not_touch_other_tabs() {
    // Releasing one tab must preserve the other tabs' entries — the core
    // invariant of the connection-scoped key.
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
