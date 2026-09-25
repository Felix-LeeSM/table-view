//! v0.3.1 — checks that the boot health check also catches body corruption
//! that slips past the probe. It overwrites the page-size field (header
//! bytes 16-17) of a healthy DB with garbage, which yields a fixture whose
//! SQLite magic header (0-15) is still valid but whose reads fail, then
//! confirms `open_pool()` detects it → quarantines to `state.db.bak` →
//! recreates a fresh DB. On recovery `corrupt_recovery::DID_RECOVER` is set.
//!
//! This case was the earlier regression point — `probe()` inspected only the
//! magic header and missed body damage, so at boot only the `BEGIN IMMEDIATE`
//! read in `get_initial_app_state` failed and the user was stuck with nothing
//! but a Retry button. The v0.3.1 health check catches that gap during init.

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
async fn open_pool_recovers_from_body_corruption_undetected_by_probe() {
    let _dir = setup_dir();

    // 1. Create a valid DB — migrations included.
    let pool = local::open_pool().await.unwrap();
    pool.close().await;
    // Drop the WAL sidecar so it cannot affect the read-back (only the main
    // file is corrupted).
    let path = local::db_path().unwrap();
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));

    // 2. Corrupt the page-size field (offset 16-17) — magic header (0-15) kept.
    let mut content = std::fs::read(&path).unwrap();
    assert!(content.len() >= 100, "fixture DB must be >= header size");
    content[16] = 0xFF;
    content[17] = 0xFF;
    std::fs::write(&path, &content).unwrap();

    // The probe still passes — only body corruption was injected, so the magic
    // check cannot catch it, and that is the point of this test (the old gap).
    corrupt_recovery::probe(&path).await.unwrap();

    // Keep the AtomicBool from leaking across tests.
    corrupt_recovery::DID_RECOVER.store(false, Ordering::SeqCst);

    // 3. Reopen → health check (= migrations/read path) fails → quarantine → fresh.
    let pool = local::open_pool().await.unwrap();

    assert!(
        corrupt_recovery::DID_RECOVER.load(Ordering::SeqCst),
        "DID_RECOVER must be set after body-corruption recovery"
    );
    assert!(
        path.with_extension("db.bak").exists(),
        "state.db.bak backup must exist after quarantine"
    );

    // 4. The fresh pool reads fine — the user is not stuck after recovery.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(count >= 0);

    cleanup();
}
