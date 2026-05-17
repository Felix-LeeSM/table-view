//! 작성 2026-05-17 (Phase 6 sprint-375, AC-375-06 / AC-375-07) — 30일
//! retention boundary + silent (no-toast) 보장 검증.
//!
//! 사유 (test scenarios 8 원칙 적용):
//!   - **user journey end-to-end**: 사용자가 sprint-370 의 legacy rename
//!     으로 `.legacy.json` 파일을 만든 뒤 약 한 달 후 app 을 다시 boot —
//!     31일 전 mtime 파일은 자동 정리, 29일 전 mtime 파일은 manual recovery
//!     기간 동안 유지.
//!   - **lego 맞물림**: helper (`cleanup_legacy_files_in`) + boot wrapper
//!     (`boot_legacy_file_cleanup`) 두 piece + cron CLI 가 동일한 정책을
//!     공유. cron script 자체는 별 셸 테스트 없이 같은 함수를 부르는 thin
//!     wrapper 이라 본 cargo test 가 invariant 의 source of truth.
//!   - **boundary 양극**: 31일 (정리) / 29일 (유지) 둘 다 단언 — "vacuum
//!     이 광범위" / "vacuum 이 너무 보수적" 회귀 모두 잡힘.
//!   - **silent**: `tracing::info!` / `warn!` 만 — toast / dialog 0.
//!     Rust 레이어에서 user-facing surface 가 없음을 (frontend event emit
//!     없음, return 값 없음) 함수 시그너처 만으로 lock — 본 테스트는
//!     return 값 invariant 만 확인.

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

/// `.legacy.json` 파일을 만든 뒤 mtime 을 `days_ago` 일 전으로 강제 set.
/// `File::set_modified` (stable since 1.75) 로 cross-platform unix/macOS/win.
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
    // sprint-375 (AC-375-06) — 31일 전 mtime 의 `.legacy.json` 은 retention
    // 외이므로 boot cleanup 후 disk 에서 제거.
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
    // sprint-375 (AC-375-06) — 29일 전 mtime 파일은 manual recovery 기간
    // 동안 유지. user journey: 사용자가 W4 직후 rename 한 파일을 며칠 후
    // 직접 복구하고 싶어 디스크 탐색.
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
    // sprint-375 — boundary 의 양 쪽이 한 cleanup pass 에서 정확히 분리.
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
    // sprint-375 (AC-375-07) — boot wrapper 는 빈 디렉토리에서 panic /
    // toast / error return 없이 silent 종료. return 값이 없음 (void) →
    // user-facing surface 0 invariant 가 함수 시그너처 자체로 lock 되는데,
    // 본 단언은 boot path 가 단순히 throw 안 됨을 확인.
    let _dir = setup();
    let fut = boot_legacy_file_cleanup();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(fut);
    cleanup();
}

#[test]
#[serial]
fn boot_wrapper_cleans_31d_legacy_silently() {
    // sprint-375 (AC-375-06 + AC-375-07) — boot path 가 lib.rs 의
    // detached task 와 동일한 entry 로 31일 파일을 정리한다 (silent).
    let dir = setup();
    write_legacy_with_mtime(dir.path(), "connections.legacy.json", 31);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(boot_legacy_file_cleanup());

    assert!(!dir.path().join("connections.legacy.json").exists());
    cleanup();
}
