//! 작성 2026-05-16 (Phase 1 sprint-358) — AC-358-07 reconcile path.
//!
//! Dual-write 는 file/LS write 가 성공 path. SQLite write 실패는 silent +
//! mismatch counter 증가. 다음 boot 직후 `reconcile_pending_domains` 가
//! file/LS SOT 를 SQLite 로 재투영 — 3회까지 retry, 그 후 stop + dev console
//! error.
//!
//! 본 테스트는 mismatch 누적 → reconcile 호출 → counter 0 으로 회복하는
//! E2E flow 검증. SQLite write 실패 시뮬레이션은 `simulate_sqlite_failure`
//! flag 로 강제.

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::persist_mru::{persist_mru_inner, PersistMruRequest};
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use table_view_lib::storage::reconcile::{
    mismatch_counter, reconcile_pending_domains, set_force_failure_for_tests,
};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    set_legacy_import_state(&pool, LegacyImportState::Done)
        .await
        .unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    set_force_failure_for_tests(false);
    mismatch_counter::reset();
}

// AC-358-07: SQLite write 실패 → mismatch += 1; reconcile 호출 → SQLite mirror
// 가 file/LS SOT 로 회복.
#[tokio::test]
#[serial]
async fn ac_358_07_simulated_sqlite_failure_increments_mismatch_then_reconcile_clears_it() {
    cleanup(); // 다른 테스트 누적분 reset
    let (_dir, pool) = setup().await;

    // Force SQLite failure path for mru dual-write.
    set_force_failure_for_tests(true);

    // mru dual-write: file write 성공 → SQLite write 실패 simulated → counter += 1.
    persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-A".into(),
            last_used: 1_700_000_500_000,
        }],
    )
    .await
    .unwrap(); // dual-write 자체는 file write 성공이므로 Ok.
    assert_eq!(
        mismatch_counter::current(),
        1,
        "SQLite failure must increment mismatch counter"
    );

    // SQLite row 0 (실패 path 였으므로).
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "SQLite row must NOT exist (simulated failure)");

    // Disable failure simulation — 정상 path 로 reconcile 호출.
    set_force_failure_for_tests(false);

    // reconcile: file/LS SOT 를 SQLite 에 반영.
    reconcile_pending_domains(&pool).await.unwrap();

    // 이제 SQLite mru row 1 — file SOT 로부터 복원.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "reconcile must restore SQLite from file SOT");

    let row: (String, i64) = sqlx::query_as("SELECT connection_id, last_used FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.0, "conn-A");
    assert_eq!(row.1, 1_700_000_500_000);

    // counter reset.
    assert_eq!(mismatch_counter::current(), 0);
    cleanup();
}

// 3회 retry 후 stop — failure 가 영속이면 reconcile 가 retry 카운터로 3회
// 시도 후 포기.
#[tokio::test]
#[serial]
async fn ac_358_07_reconcile_gives_up_after_three_persistent_failures() {
    cleanup();
    let (_dir, pool) = setup().await;

    // 우선 normal write 1회 — file SOT 에 entry 가 있어야 reconcile 가 의미가 있음.
    persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-X".into(),
            last_used: 42,
        }],
    )
    .await
    .unwrap();
    assert_eq!(mismatch_counter::current(), 0);

    // SQLite row 를 강제로 삭제 → file SOT 와 mirror 가 불일치.
    sqlx::query("DELETE FROM mru").execute(&pool).await.unwrap();
    // mismatch counter 를 수동 += 1 — file SOT vs SQLite mirror 의 diff 발견을
    // boot 시 simulate.
    mismatch_counter::increment();

    // 영속 실패 모드 — reconcile 의 3회 시도가 모두 실패.
    set_force_failure_for_tests(true);

    // reconcile 호출은 Ok — 3회 retry 시 stop 하고 dev console error 만.
    reconcile_pending_domains(&pool).await.unwrap();

    // SQLite row 0 (실패 지속).
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    // counter 는 reset 되지 않음 — 실패 후 stop.
    assert!(mismatch_counter::current() >= 1);

    cleanup();
}
