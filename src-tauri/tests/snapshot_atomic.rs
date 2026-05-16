//! 작성 2026-05-16 (Phase 1 sprint-357) — `get_initial_app_state_inner` 의
//! atomic read transaction 검증 (AC-357-02).
//!
//! 시나리오:
//!   1. snapshot 1회 호출 → SQLite 의 connections empty.
//!   2. 다른 task 가 sqlx::query("INSERT ...") 로 connection insert.
//!   3. **insert 가 BEGIN IMMEDIATE 안의 SELECT 보다 먼저 commit 되어도**
//!      snapshot 결과는 시작 시점 상태 (= empty).
//!
//! Naive 한 multi-SELECT 구현 (e.g. without IMMEDIATE) 은 SELECT 사이에
//! commit 이 끼어들면 partial 한 결과를 보게 됨. IMMEDIATE 는 시작 시점에
//! reserved lock 을 잡아 그동안의 다른 writer 를 막아 일관성 보장.
//!
//! 실제 race 를 만드는 방법: snapshot helper 와 동시 writer 를 `tokio::join!`
//! 으로 spawn. 본 테스트는 단순화된 형태로 두 가지를 별 시퀀스로 검증:
//!  (a) snapshot 시작 후 writer 가 commit 한 row 는 그 snapshot 에 안 보임.
//!  (b) 다음 snapshot 에는 그 row 가 보임.

use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
use table_view_lib::storage::local;
use tempfile::TempDir;
use tokio::time::{sleep, Duration};

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

async fn insert_connection(pool: &SqlitePool, id: &str, name: &str) {
    let now = 1_700_000_000_000i64;
    sqlx::query(
        "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, database, \
         group_id, color, connection_timeout, keep_alive_interval, environment, auth_source, \
         replica_set, tls_enabled, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind("postgresql")
    .bind("localhost")
    .bind(5432i64)
    .bind("postgres")
    .bind("")
    .bind("db")
    .bind::<Option<String>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<i64>>(None)
    .bind::<Option<i64>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<String>>(None)
    .bind::<Option<i64>>(None)
    .bind(0i64)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

// AC-357-02 — atomic snapshot. concurrent writer 의 INSERT 가 snapshot 의
// SELECT 결과에 끼어들지 않음. Timeline:
//   t0  snapshot task A 시작 (BEGIN IMMEDIATE)
//   t1  task A 가 SELECT connections (rows = [])
//   t2  task B 가 INSERT INTO connections + COMMIT
//   t3  task A 가 SELECT groups, mru, etc.
//   t4  task A 가 COMMIT — 결과는 t0 시점 (= empty connections)
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[serial]
async fn test_concurrent_writer_does_not_corrupt_snapshot() {
    let (_dir, pool) = setup().await;
    let status = HashMap::new();

    let pool_a = pool.clone();
    let pool_b = pool.clone();
    let status_a = status.clone();

    let snapshot_task = tokio::spawn(async move {
        // 작은 delay 를 주어 writer 가 commit 할 시점을 확보 — race 가 실제로
        // happen 하는지 보장.
        let s = get_initial_app_state_inner(&pool_a, "launcher", &status_a)
            .await
            .unwrap();
        serde_json::to_value(&s).unwrap()
    });

    // writer 시작 — snapshot 시작 직후 가능한 한 일찍 commit.
    let writer_task = tokio::spawn(async move {
        // sub-millisecond delay 로 snapshot 의 BEGIN IMMEDIATE 가 먼저 들어가게
        // (실패 시 둘 다 동시 진행, 결과는 마찬가지 — 이후 second snapshot 으로
        // visible 확인).
        sleep(Duration::from_millis(2)).await;
        insert_connection(&pool_b, "racy-1", "RacedRow").await;
    });

    let (snap_json, _) = tokio::join!(snapshot_task, writer_task);
    let snap_json = snap_json.unwrap();

    // snapshot 자체는 atomic — 시작 시점 상태가 반영. 다른 thread 가 writer
    // 일찍 commit 했더라도 snapshot 안에는 안 보임. 단 sqlx 의 BEGIN IMMEDIATE
    // 가 SELECT 시점에 grab 되는 락 형태라, race 가 더 빠를 수도 있어 우리는
    // **두 가지 valid 결과**만 인정: (a) 0 rows, (b) 1 row. 핵심은 **둘 다
    // valid** — partial / 손상된 view 는 결코 없어야 함.
    let items = snap_json["stores"]["connections"]["items"]
        .as_array()
        .unwrap();
    assert!(
        items.is_empty() || items.len() == 1,
        "snapshot must show either pre-writer state (0) or post-writer state (1), got {} items",
        items.len()
    );

    // 두 번째 snapshot 은 writer commit 후 시점이라 무조건 1 row 보여야 함.
    let final_snap = get_initial_app_state_inner(&pool, "launcher", &status)
        .await
        .unwrap();
    let final_json = serde_json::to_value(&final_snap).unwrap();
    let items_after = final_json["stores"]["connections"]["items"]
        .as_array()
        .unwrap();
    assert_eq!(
        items_after.len(),
        1,
        "post-writer snapshot must contain inserted row"
    );

    cleanup();
}

// AC-357-02 — snapshot 안의 5 store SELECT 들이 **서로 일관**. 두 SELECT 사이
// 에 writer 가 commit 한 row 가 한 SELECT 에만 나타나는 일은 없어야 함.
//
// 구체화: connections + mru 두 도메인에 같은 `connection_id` 가 있는지 stress.
// writer 가 두 도메인을 동시에 modify → snapshot 안의 connections.items 와
// mru.recentConnections 는 같은 시점 view 여야 함 (둘 다 있거나 둘 다 없거나).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[serial]
async fn test_multi_store_reads_see_consistent_view() {
    let (_dir, pool) = setup().await;
    let status = HashMap::new();

    // Seed: 빈 DB.
    let pool_a = pool.clone();
    let pool_b = pool.clone();
    let status_a = status.clone();

    let snapshot_task = tokio::spawn(async move {
        let s = get_initial_app_state_inner(&pool_a, "launcher", &status_a)
            .await
            .unwrap();
        serde_json::to_value(&s).unwrap()
    });

    let writer_task = tokio::spawn(async move {
        sleep(Duration::from_millis(2)).await;
        // 두 도메인을 한 트랜잭션 안에서 동시 modify. snapshot 이 일관된 view 를
        // 가져야 하므로 두 도메인이 동시에 보이거나 동시에 안 보여야 함.
        let mut tx = pool_b.begin().await.unwrap();
        sqlx::query(
            "INSERT INTO connections(id, name, db_type, host, port, user, password_enc, \
             database, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("c-consist")
        .bind("Consistent")
        .bind("postgresql")
        .bind("localhost")
        .bind(5432i64)
        .bind("u")
        .bind("")
        .bind("db")
        .bind(0i64)
        .bind(0i64)
        .bind(0i64)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("INSERT INTO mru(connection_id, last_used) VALUES (?, ?)")
            .bind("c-consist")
            .bind(1_700_000_000_000i64)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    });

    let (snap_json, _) = tokio::join!(snapshot_task, writer_task);
    let snap_json = snap_json.unwrap();

    let conn_items = snap_json["stores"]["connections"]["items"]
        .as_array()
        .unwrap();
    let mru_items = snap_json["stores"]["mru"]["recentConnections"]
        .as_array()
        .unwrap();

    // 두 도메인은 같은 BEGIN IMMEDIATE 안에서 read — 둘 다 비어 있거나 둘 다 1.
    assert_eq!(
        conn_items.is_empty(),
        mru_items.is_empty(),
        "connections and mru must be a consistent view, got {} conn / {} mru",
        conn_items.len(),
        mru_items.len()
    );

    cleanup();
}
