//! 작성 2026-05-16 (Phase 1 sprint-355) — Q2 corrupt recovery 시나리오.
//!
//! AC-355-04: 디스크에 corrupt 파일 시뮬 (header 첫 16 byte XOR / overwrite)
//! → app boot → `.bak` rename + fresh DB 생성. 사용자 toast 0.
//!
//! 본 통합 테스트는 `storage::local::open_pool()` 가 corrupt 파일을
//! 만났을 때 silently quarantine 후 fresh start 하는지를 검증.

use serial_test::serial;
use std::fs;
use table_view_lib::storage::local;
use tempfile::TempDir;

fn setup_env() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    dir
}

fn cleanup_env() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

fn list_files(dir: &std::path::Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

// AC-355-04: Pre-existing corrupt SQLite file (bad magic header) → boot →
// fresh DB created + `.bak` quarantine file present.
#[tokio::test]
#[serial]
async fn test_corrupt_header_triggers_quarantine_and_fresh_db() {
    let dir = setup_env();
    let db = dir.path().join("state.db");

    // Write a 200-byte file with a bad header — guarantees probe rejects.
    let mut content = vec![0xCDu8; 200];
    content[..16].copy_from_slice(b"NOT-SQLITE-HDR\0\0");
    fs::write(&db, &content).unwrap();

    // Boot: open_pool must transparently quarantine + create fresh.
    let pool = local::open_pool().await.expect("open_pool must succeed");

    // 1. Fresh DB exists at state.db.
    assert!(db.exists(), "Fresh state.db must exist after recovery");

    // 2. Backup with `.bak` suffix exists.
    let files = list_files(dir.path());
    assert!(
        files
            .iter()
            .any(|n| n == "state.db.bak" || n.starts_with("state.db.bak")),
        "Expected state.db.bak in {:?}",
        files
    );

    // 3. Fresh DB is queryable — migrations applied → 9 tables exist.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 9);

    cleanup_env();
}

// AC-355-04 invariant: XOR-ed header (first 16 byte flipped) is detected
// regardless of file size > 100 bytes.
#[tokio::test]
#[serial]
async fn test_xor_first_16_bytes_triggers_recovery() {
    let dir = setup_env();
    let db = dir.path().join("state.db");

    // Start with a valid-shaped SQLite header then XOR first 16 bytes.
    let mut content = b"SQLite format 3\0".to_vec();
    content.resize(4096, 0u8);
    for byte in content.iter_mut().take(16) {
        *byte ^= 0x5A;
    }
    fs::write(&db, &content).unwrap();

    let _pool = local::open_pool()
        .await
        .expect("must recover transparently");

    let files = list_files(dir.path());
    let bak_present = files.iter().any(|n| n.contains("state.db.bak"));
    assert!(bak_present, "Quarantine .bak missing in {:?}", files);

    cleanup_env();
}

// AC-355-04 invariant: a clean (non-corrupt) DB does NOT trigger quarantine
// on subsequent boots — silent recovery must not destroy good data.
#[tokio::test]
#[serial]
async fn test_clean_boot_does_not_quarantine() {
    let dir = setup_env();
    // First boot — creates fresh DB.
    let _pool = local::open_pool().await.unwrap();
    drop(_pool);

    // Second boot on the now-valid DB.
    let _pool2 = local::open_pool().await.unwrap();

    let files = list_files(dir.path());
    let bak_present = files.iter().any(|n| n.contains("state.db.bak"));
    assert!(
        !bak_present,
        "Clean DB must NOT be quarantined on second boot — files: {:?}",
        files
    );

    cleanup_env();
}
