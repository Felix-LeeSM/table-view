//! Issue #1558 — `open_pool` 이 migration 실패를 corruption 으로 오판해
//! `state.db` 를 quarantine(.bak) 하고 fresh 빈 DB 를 만들면
//! connections/favorites/query_history/settings 가 조용히 사라진다.
//!
//! 회귀 재현: 정상 DB 에 "미래" 버전 마이그레이션 행을 `_sqlx_migrations` 에
//! 심어 downgrade(`MigrateError::VersionMissing`) 상황을 만든다 — 구버전
//! 바이너리로 downgrade 한 사용자와 동일한 실패. reopen 시 `run_migrations`
//! 가 실패하는데, 이는 storage corruption 이 아니라 논리적 마이그레이션
//! 실패이므로 quarantine 하지 말고 명확한 부팅 에러로 전파해야 한다
//! (`state.db` 보존, `.bak` 없음, `DID_RECOVER` unset).
//!
//! corruption(read-path 손상) 시 quarantine 은 `corrupt_body_recovery.rs` 가
//! 별도로 지킨다 — 본 테스트는 그 동작을 건드리지 않는다.

use serial_test::serial;
use std::sync::atomic::Ordering;
use table_view_lib::storage::corrupt_recovery;
use table_view_lib::storage::local;
use tempfile::TempDir;

fn setup_dir() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    dir
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

#[tokio::test]
#[serial]
async fn open_pool_preserves_db_when_migration_fails_on_downgrade() {
    let _dir = setup_dir();

    // 1. valid DB + migrations 적용.
    let pool = local::open_pool().await.unwrap();

    // 2. downgrade 시뮬레이션 — 번들된 어떤 마이그레이션보다 높은 버전이
    //    "적용됨" 으로 기록돼 있으면 sqlx 는 그 버전을 몰라 VersionMissing 으로
    //    실패한다 (구버전 바이너리로 되돌린 사용자와 동일).
    sqlx::query(
        "INSERT INTO _sqlx_migrations \
         (version, description, installed_on, success, checksum, execution_time) \
         VALUES (99990001, 'future migration', CURRENT_TIMESTAMP, 1, X'00', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let path = local::db_path().unwrap();
    let bak = path.with_extension("db.bak");
    corrupt_recovery::DID_RECOVER.store(false, Ordering::SeqCst);

    // 3. reopen → migration 실패는 corruption 이 아니므로 전파돼야 한다.
    let result = local::open_pool().await;
    assert!(
        result.is_err(),
        "migration downgrade must fail boot loudly, not silently 'recover'"
    );

    // 4. 데이터 손실 금지 — state.db 는 원래 이름 그대로 보존, quarantine 없음.
    assert!(
        path.exists(),
        "state.db must be preserved on migration failure"
    );
    assert!(
        !bak.exists(),
        "migration failure must NOT quarantine state.db to .bak"
    );
    assert!(
        !corrupt_recovery::DID_RECOVER.load(Ordering::SeqCst),
        "migration failure must NOT flag a corrupt-recovery"
    );

    // 5. 원본 DB 가 그대로 열려 사용자 데이터(여기선 심어둔 마이그레이션 행)를
    //    유지하는지 직접 확인 — fresh 빈 DB 로 교체되지 않았음을 증명.
    let verify = sqlx::SqlitePool::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 99990001")
            .fetch_one(&verify)
            .await
            .unwrap();
    verify.close().await;
    assert_eq!(n, 1, "original state.db (user data) must survive intact");

    cleanup();
}
