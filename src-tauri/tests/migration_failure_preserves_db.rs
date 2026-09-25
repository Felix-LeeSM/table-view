//! Issue #1558 — when `open_pool` misjudges a migration failure as corruption,
//! quarantines `state.db` (.bak) and creates a fresh empty DB,
//! connections/favorites/query_history/settings silently disappear.
//!
//! Regression repro: plant a "future" version migration row in
//! `_sqlx_migrations` of a healthy DB to create a downgrade
//! (`MigrateError::VersionMissing`) — the same failure as a user who downgraded
//! to an older binary. `run_migrations` then fails on reopen, but that is a
//! logical migration failure rather than storage corruption, so it must
//! propagate as a clear boot error instead of quarantining (`state.db`
//! preserved, no `.bak`, `DID_RECOVER` unset).
//!
//! Quarantine on corruption (read-path damage) is guarded separately by
//! `corrupt_body_recovery.rs` — this test does not touch that behaviour.

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

    // 1. Valid DB with migrations applied.
    let pool = local::open_pool().await.unwrap();

    // 2. Simulate a downgrade — when a version higher than any bundled
    //    migration is recorded as "applied", sqlx does not know that version
    //    and fails with VersionMissing (same as a user who rolled back to an
    //    older binary).
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

    // 3. Reopen → a migration failure is not corruption, so it must propagate.
    let result = local::open_pool().await;
    assert!(
        result.is_err(),
        "migration downgrade must fail boot loudly, not silently 'recover'"
    );

    // 4. No data loss — state.db keeps its original name, no quarantine.
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

    // 5. Check directly that the original DB still opens and keeps the user
    //    data (here, the planted migration row) — proof that it was not
    //    replaced by a fresh empty DB.
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
