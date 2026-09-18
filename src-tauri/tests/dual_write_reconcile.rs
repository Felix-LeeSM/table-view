//! Written 2026-05-16 — AC-358-07 reconcile path.
//! Updated 2026-05-16 — reflects how reconcile semantics changed once the file
//! branch of favorites/mru/settings was retired.
//! Updated 2026-07-02 (#1092) — reflects write-failure propagation for
//! SQLite-only domains.
//!
//! Originally: dual-write treated the file/LS write as the success path, a
//! SQLite write failure was silent and only bumped the mismatch counter, and on
//! the next boot `reconcile_pending_domains` re-projected the file/LS SOT into
//! SQLite.
//!
//! After W3: the file write for favorites / mru / settings is gone, so the
//! reconcile-from-file path lost its meaning for them as well (the file is
//! empty). The `connections` domain is still file SOT
//! (`storage::save_connection`), so it can still be reconciled.
//!
//! #1092 (2026-07-02): after W3, favorites/mru/settings have no fallback source,
//! so swallowing a failure means silent data loss; those commands now
//! **propagate** a SQLite write failure to the IPC boundary (the counter-only
//! silent swallow is retired). The counter/reconcile mechanism survives only for
//! domains that still have a file SOT (`connections`) and for tests that call the
//! function directly. This test locks both the propagation invariant and the
//! give-up behaviour of the reconcile function itself.

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::persist_mru::{persist_mru_inner, PersistMruRequest};
use table_view_lib::storage::local;
use table_view_lib::storage::local_files::{save_mru_file, MruRecord};
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

// #1092 (2026-07-02) — a SQLite write failure propagates to the IPC boundary.
//
// Previously (AC-358-07) a SQLite failure was swallowed: the counter went up by
// one and `Ok` came back. After the W3 cut, favorites/mru/settings have no
// file/LS fallback source and boot reconcile is not wired for them, so that
// swallow was silent data loss. This test locks the invariant: a SQLite write
// failure → `Err` propagates + 0 SQLite rows (no partial write). It no longer
// depends on the counter bump or on the swallow.
#[tokio::test]
#[serial]
async fn issue_1092_sqlite_failure_propagates_instead_of_silent_swallow() {
    cleanup(); // reset whatever other tests left behind
    let (_dir, pool) = setup().await;

    // Force SQLite failure path for mru persist.
    set_force_failure_for_tests(true);

    // mru persist: simulated SQLite write failure → `Err` propagates (no swallow).
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

    // 0 SQLite rows, because this was the failure path.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "SQLite row must NOT exist (simulated failure)");
    cleanup();
}

// Stop after 3 retries — when the failure is persistent, reconcile tries 3 times
// on its retry counter and then gives up.
#[tokio::test]
#[serial]
async fn ac_358_07_reconcile_gives_up_after_three_persistent_failures() {
    cleanup();
    let (_dir, pool) = setup().await;

    // Seed an mru entry into the file SOT — reconcile has to actually attempt the
    // re-projection before the force-failure give-up can fire. After W3 the
    // persist_* path is SQLite-only, so an empty mru file makes reconcile do
    // nothing and return Ok, and under the issue #1559 fix (reset only when every
    // domain is Ok) the counter then resets normally — this give-up scenario needs
    // file SOT data to hold.
    save_mru_file(&[MruRecord {
        connection_id: "conn-X".into(),
        last_used: 42,
    }])
    .unwrap();

    // Simulate boot finding a file SOT vs SQLite mirror diff.
    mismatch_counter::increment();

    // Persistent failure mode — all 3 reconcile attempts fail.
    set_force_failure_for_tests(true);

    // The reconcile call returns Ok — it stops after 3 retries and only logs a
    // dev console error.
    reconcile_pending_domains(&pool).await.unwrap();

    // 0 SQLite rows — the failure persists, forced failure blocks the write.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    // The counter is not reset — when the mru domain gives up, all_ok=false, so
    // the next boot retries (issue #1559).
    assert!(mismatch_counter::current() >= 1);

    cleanup();
}
