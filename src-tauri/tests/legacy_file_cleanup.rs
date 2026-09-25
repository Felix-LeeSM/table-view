//! Written 2026-05-17 (AC-375-06 / AC-375-07) — verifies the 30-day retention
//! boundary and the silent (no-toast) guarantee.
//!
//! Reason (applying the 8 test-scenario principles):
//!   - **user journey end-to-end**: a user creates a `.legacy.json` file
//!     through the legacy rename and boots the app again about a month later —
//!     a file with a 31-day-old mtime is cleaned up automatically, one with a
//!     29-day-old mtime is kept for the manual recovery window.
//!   - **lego interlock**: the helper (`cleanup_legacy_files_in`) and the boot
//!     wrapper (`boot_legacy_file_cleanup`) share one policy, and the wrapper
//!     is what `src-tauri/src/lib.rs` calls at boot, so this cargo test is the
//!     source of truth for the invariant.
//!   - **both ends of the boundary**: 31 days (cleaned) and 29 days (kept) are
//!     both asserted — this catches both the "vacuum too broad" and the
//!     "vacuum too conservative" regressions.
//!   - **silent**: `tracing::info!` / `warn!` only — zero toast / dialog. The
//!     absence of a user-facing surface in the Rust layer (no frontend event
//!     emit, no return value) is locked by the function signature alone; this
//!     test only checks the return-value invariant.

use serial_test::serial;
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{Duration, SystemTime};
use table_view_lib::storage::legacy_cleanup::{
    boot_legacy_file_cleanup, cleanup_legacy_files_in, RETENTION_MS,
};
use tempfile::TempDir;

fn setup() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    dir
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

/// Creates a `.legacy.json` file and then forces its mtime to `days_ago` days
/// ago. `File::set_modified` (stable since 1.75) keeps this cross-platform
/// across unix/macOS/win.
fn write_legacy_with_mtime(dir: &std::path::Path, name: &str, days_ago: u64) {
    let path = dir.join(name);
    let mut f = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path)
        .unwrap();
    f.write_all(b"{\"legacy\":true}").unwrap();
    f.sync_all().unwrap();
    let target = SystemTime::now() - Duration::from_secs(days_ago * 86_400);
    f.set_modified(target).unwrap();
    drop(f);
}

#[test]
#[serial]
fn cleanup_deletes_file_older_than_30_days() {
    // AC-375-06 — a `.legacy.json` with a 31-day-old mtime is outside
    // retention, so boot cleanup removes it from disk.
    let dir = setup();
    write_legacy_with_mtime(dir.path(), "connections.legacy.json", 31);

    let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), RETENTION_MS).unwrap();
    assert_eq!(n, 1, "31일 전 파일은 정리 대상");
    assert!(
        !dir.path().join("connections.legacy.json").exists(),
        "30일 retention 초과 파일은 삭제되어야 함"
    );
    cleanup();
}

#[test]
#[serial]
fn cleanup_keeps_file_within_30_days() {
    // AC-375-06 — a file with a 29-day-old mtime is kept for the manual
    // recovery window. user journey: a few days after the rename the user
    // wants to recover the file by hand and goes digging on disk.
    let dir = setup();
    write_legacy_with_mtime(dir.path(), "connections.legacy.json", 29);

    let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), RETENTION_MS).unwrap();
    assert_eq!(n, 0, "29일 전 파일은 retention 안쪽 — 유지");
    assert!(
        dir.path().join("connections.legacy.json").exists(),
        "30일 retention 미달 파일은 보존되어야 함"
    );
    cleanup();
}

#[test]
#[serial]
fn cleanup_mixed_30d_and_29d_files() {
    // Both sides of the boundary are separated exactly in one cleanup pass.
    let dir = setup();
    write_legacy_with_mtime(dir.path(), "connections.legacy.json", 45);
    write_legacy_with_mtime(dir.path(), "favorites.legacy.json", 31);
    write_legacy_with_mtime(dir.path(), "settings.legacy.json", 29);
    write_legacy_with_mtime(dir.path(), "mru.legacy.json", 1);

    let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), RETENTION_MS).unwrap();
    assert_eq!(n, 2);
    assert!(!dir.path().join("connections.legacy.json").exists());
    assert!(!dir.path().join("favorites.legacy.json").exists());
    assert!(dir.path().join("settings.legacy.json").exists());
    assert!(dir.path().join("mru.legacy.json").exists());
    cleanup();
}

#[test]
#[serial]
fn boot_wrapper_runs_silently_on_empty_dir() {
    // AC-375-07 — on an empty directory the boot wrapper finishes silently,
    // with no panic / toast / error return. It has no return value (void), so
    // the zero-user-facing-surface invariant is locked by the function
    // signature itself; this assertion only checks that the boot path does not
    // throw.
    let _dir = setup();
    let fut = boot_legacy_file_cleanup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(fut);
    cleanup();
}

#[test]
#[serial]
fn boot_wrapper_cleans_31d_legacy_silently() {
    // AC-375-06 + AC-375-07 — the boot path cleans up the 31-day file through
    // the same entry as lib.rs's detached task (silently).
    let dir = setup();
    write_legacy_with_mtime(dir.path(), "connections.legacy.json", 31);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(boot_legacy_file_cleanup());

    assert!(!dir.path().join("connections.legacy.json").exists());
    cleanup();
}
