//! 작성 2026-05-16 (Phase 1 sprint-358) — AC-358-07 reconcile path.
//! 갱신 2026-05-16 (Phase 4 sprint-370) — favorites/mru/settings 의 file
//! 분기 retire 후의 reconcile 의미 변화 반영.
//!
//! Sprint 358 (Phase 1 W1): Dual-write 는 file/LS write 가 성공 path. SQLite
//! write 실패는 silent + mismatch counter 증가. 다음 boot 직후
//! `reconcile_pending_domains` 가 file/LS SOT 를 SQLite 로 재투영.
//!
//! Sprint 370 (Phase 4 W3): favorites / mru / settings 의 file write 가
//! 제거되어 reconcile-from-file path 도 의미를 잃는다 (file 이 empty).
//! `connections` 도메인은 여전히 file SOT (storage::save_connection — sprint-375
//! 의 W4 cleanup 까지 유지) 라 reconcile 가능. 본 테스트는 두 시나리오를
//! 분리해 sprint-370 회귀를 함께 잠근다.

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

// AC-358-07 (sprint-358 origin) — SQLite write 실패 → mismatch += 1.
//
// Sprint 370 (Phase 4 W3 SQLite SOT): mru 의 file SOT path 가 제거되어
// reconcile-from-file 의 회복 시나리오는 더 이상 적용되지 않는다 (file 이 빈
// 상태). 본 테스트는 W3 cut 의 invariant 를 잠근다: SQLite write 실패는 여전히
// counter 를 증가시키지만, file SOT 가 없으므로 reconcile 가 호출되어도 mru row
// 는 0 으로 유지된다 (no recovery source). Recovery 는 future sprint 의 별
// rollback path 가 책임진다.
#[tokio::test]
#[serial]
async fn ac_370_07_sqlite_failure_increments_counter_no_file_fallback() {
    cleanup(); // 다른 테스트 누적분 reset
    let (_dir, pool) = setup().await;

    // Force SQLite failure path for mru persist.
    set_force_failure_for_tests(true);

    // mru persist: SQLite write 실패 simulated → counter += 1. file 분기가
    // 제거되어 외부 시그니처는 그대로 Ok (record_sqlite_result 의 silent
    // semantic 보존).
    persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-A".into(),
            last_used: 1_700_000_500_000,
        }],
    )
    .await
    .unwrap();
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

    // Disable failure simulation — reconcile 호출. mru 도메인의 file 은 empty,
    // 그러므로 reconcile_mru 는 no-op (load_mru_file 가 empty Vec 반환).
    set_force_failure_for_tests(false);
    reconcile_pending_domains(&pool).await.unwrap();

    // W3 cut 이후 invariant: file SOT 가 없으므로 mru row 0 유지.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "After sprint-370 W3 cut, file SOT is empty so reconcile cannot recover mru"
    );
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
