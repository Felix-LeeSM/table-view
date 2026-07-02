//! 작성 2026-05-16 (Phase 1 sprint-358) — AC-358-07 reconcile path.
//! 갱신 2026-05-16 (Phase 4 sprint-370) — favorites/mru/settings 의 file
//! 분기 retire 후의 reconcile 의미 변화 반영.
//! 갱신 2026-07-02 (#1092) — SQLite-only 도메인의 write 실패 전파 반영.
//!
//! Sprint 358 (Phase 1 W1): Dual-write 는 file/LS write 가 성공 path. SQLite
//! write 실패는 silent + mismatch counter 증가. 다음 boot 직후
//! `reconcile_pending_domains` 가 file/LS SOT 를 SQLite 로 재투영.
//!
//! Sprint 370 (Phase 4 W3): favorites / mru / settings 의 file write 가
//! 제거되어 reconcile-from-file path 도 의미를 잃는다 (file 이 empty).
//! `connections` 도메인은 여전히 file SOT (storage::save_connection — sprint-375
//! 의 W4 cleanup 까지 유지) 라 reconcile 가능.
//!
//! #1092 (2026-07-02): W3 이후 대체 원본이 없는 favorites/mru/settings 는
//! 실패를 삼키면 무음 소실이므로, 그 커맨드들은 이제 SQLite write 실패를
//! IPC 경계로 **전파**한다 (counter-only silent 삼킴 폐기). counter/reconcile
//! 메커니즘은 file SOT 가 살아있는 도메인 (connections) + 함수 직접 호출
//! 테스트에만 남는다. 본 테스트는 전파 invariant 와 reconcile 함수 자체의
//! give-up 동작을 함께 잠근다.

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

// #1092 (2026-07-02) — SQLite write 실패는 IPC 경계로 전파된다.
//
// 이전(sprint-358 AC-358-07)에는 SQLite 실패를 삼키고 counter 만 +1 한 뒤
// Ok 를 반환했다. W3 cut 이후 favorites/mru/settings 는 file/LS 대체 원본이
// 없고 boot reconcile 이 배선되지 않아 그 삼킴이 무음 데이터 소실이었다.
// 본 테스트는 새 invariant 를 잠근다: SQLite write 실패 → `Err` 전파 + SQLite
// row 0 (부분 write 없음). counter 증가/삼킴에 더는 의존하지 않는다.
#[tokio::test]
#[serial]
async fn issue_1092_sqlite_failure_propagates_instead_of_silent_swallow() {
    cleanup(); // 다른 테스트 누적분 reset
    let (_dir, pool) = setup().await;

    // Force SQLite failure path for mru persist.
    set_force_failure_for_tests(true);

    // mru persist: SQLite write 실패 simulated → 이제 Err 전파 (삼킴 폐기).
    let result = persist_mru_inner(
        &pool,
        vec![PersistMruRequest {
            connection_id: "conn-A".into(),
            last_used: 1_700_000_500_000,
        }],
    )
    .await;
    assert!(
        result.is_err(),
        "SQLite write failure must propagate to the IPC boundary, not be swallowed as Ok"
    );

    // SQLite row 0 (실패 path 였으므로).
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "SQLite row must NOT exist (simulated failure)");
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
