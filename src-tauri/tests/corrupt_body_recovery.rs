//! v0.3.1 — boot health check 가 probe 를 통과하는 body corruption 도 잡는지
//! 검증. 정상 DB 의 page-size field (header byte 16-17) 를 garbage 로 덮어
//! SQLite magic header(0-15)는 유효하지만 read 가 실패하는 fixture 를 만들고,
//! `open_pool()` 이 이를 감지 → `state.db.bak` quarantine → fresh DB 재생성
//! 하는지 확인. 복구 발생 시 `corrupt_recovery::DID_RECOVER` 가 set 됨.
//!
//! 이 케이스가 이전까지의 회귀 지점이다 — `probe()` 는 magic header 만 검사해
//! body 손상을 놓쳤고, boot 시 `get_initial_app_state` 의 `BEGIN IMMEDIATE`
//! read 만 실패해 사용자가 Retry 하나만 보고 갇혔다. v0.3.1 health check 가
//! 이 gap 을 init 단계에서 잡는다.

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

    // 1. valid DB 생성 — migrations 포함.
    let pool = local::open_pool().await.unwrap();
    pool.close().await;
    // WAL sidecar 가 read-back 에 영향 주지 않도록 제거 (main file 만 손상).
    let path = local::db_path().unwrap();
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));

    // 2. page-size field (offset 16-17) 손상 — magic header(0-15)는 보존.
    let mut content = std::fs::read(&path).unwrap();
    assert!(content.len() >= 100, "fixture DB must be >= header size");
    content[16] = 0xFF;
    content[17] = 0xFF;
    std::fs::write(&path, &content).unwrap();

    // probe 는 여전히 통과 — body corruption 만 주입했으므로 magic 검사로는
    // 잡히지 않는 게 이 테스트의 핵심 (이전까지의 gap).
    corrupt_recovery::probe(&path).await.unwrap();

    // test 간 AtomicBool 누출 차단.
    corrupt_recovery::DID_RECOVER.store(false, Ordering::SeqCst);

    // 3. reopen → health check(=migrations/read path) 실패 → quarantine → fresh.
    let pool = local::open_pool().await.unwrap();

    assert!(
        corrupt_recovery::DID_RECOVER.load(Ordering::SeqCst),
        "DID_RECOVER must be set after body-corruption recovery"
    );
    assert!(
        path.with_extension("db.bak").exists(),
        "state.db.bak backup must exist after quarantine"
    );

    // 4. fresh pool 은 정상 read 가능 — 복구 후 사용자 갇히지 않음.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(count >= 0);

    cleanup();
}
