//! 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-05: Mongo native cancel
//! via `adminCommand({killOp: 1, op: <opid>})`.
//!
//! Driving a guaranteed-long Mongo query is awkward in a test container:
//! `$where: "sleep(60000)"` requires `runOnAtlas: false` + permissions
//! that the testcontainers default user lacks. Instead we verify the
//! IPC + trait path against the live `killOp`:
//!
//! 1. `cancel_query(0)` succeeds (Mongo accepts any opid; missing opid
//!    is a server-side no-op silently).
//! 2. The DbAdapter::cancel_query dispatch routes through `kill_op_impl`
//!    — proven by hitting the wire (server returns OK even for unknown
//!    opid, but the side trip exercises the auth + admin path).
//!
//! AC-359-05's "terminate within 0.5s" budget for the actual op is
//! validated by the sprint-336 currentOp/killOp integration test
//! (`mongo_integration.rs`); this sprint focuses on the IPC surface +
//! the cancel error classification.

mod common;

use std::time::{Duration, Instant};
use table_view_lib::db::traits::DbAdapter;

#[tokio::test]
#[serial_test::serial]
async fn mongo_cancel_query_round_trips_through_killop() {
    let adapter = match common::setup_mongo_adapter().await {
        Some(a) => a,
        None => {
            println!("SKIP: Mongo container unavailable");
            return;
        }
    };

    let start = Instant::now();
    // killOp 는 unknown opid 에 대해 server 가 OK 응답한다 (no-op). 따라서
    // round-trip 의 latency + auth + admin-db dispatch 가 살아있는지를
    // 검증하는 것이 본 테스트의 정수.
    adapter
        .cancel_query(99999)
        .await
        .expect("cancel_query (killOp) round-trip should succeed on unknown opid");
    let elapsed = start.elapsed();

    assert!(
        elapsed < Duration::from_secs(2),
        "killOp round-trip should be sub-2s, got {:?}",
        elapsed
    );

    let _ = adapter.disconnect().await;
}
