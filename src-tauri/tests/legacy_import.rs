//! 작성 2026-05-16 (Phase 1 sprint-355) — `import_legacy_localstorage` IPC
//! 와 `guard_legacy_import_done` helper 의 시나리오 검증.
//!
//! AC-355-05: 첫 호출 → pending → importing → done transition + SQLite row
//! insert. 둘째 호출 (done) → no-op (idempotent).
//!
//! AC-355-06: guard 4-state — `pending` / `importing` 시 reject (LegacyImportInProgress),
//! `done` 시 정상 진행, `failed` 도 reject.

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::import_legacy::{
    import_legacy_localstorage_inner, LegacyFavorite, LegacyMruEntry, LegacyPayload,
};
use table_view_lib::error::AppError;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{
    get_legacy_import_state, set_legacy_import_state, LegacyImportState,
};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

fn sample_payload() -> LegacyPayload {
    LegacyPayload {
        favorites: Some(vec![LegacyFavorite {
            id: "fav-1".into(),
            name: "find users".into(),
            sql: "SELECT * FROM users".into(),
            connection_id: Some("conn-1".into()),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }]),
        mru: Some(vec![LegacyMruEntry {
            connection_id: "conn-1".into(),
            last_used: 1_700_000_000_000,
        }]),
    }
}

// AC-355-05: first call pending → importing → done. Rows inserted.
#[tokio::test]
#[serial]
async fn test_import_first_call_transitions_to_done_and_inserts_rows() {
    let (_dir, pool) = setup().await;
    // Precondition: fresh DB → pending.
    assert_eq!(
        get_legacy_import_state(&pool).await.unwrap(),
        LegacyImportState::Pending
    );

    import_legacy_localstorage_inner(&pool, sample_payload())
        .await
        .unwrap();

    // State 전이 완료 → done.
    assert_eq!(
        get_legacy_import_state(&pool).await.unwrap(),
        LegacyImportState::Done
    );

    // Favorites row 1개 inserted.
    let fav_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fav_count, 1);

    // MRU row 1개 inserted.
    let mru_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(mru_count, 1);

    cleanup();
}

// AC-355-05: idempotent — second call (state == done) is a no-op.
#[tokio::test]
#[serial]
async fn test_import_second_call_when_done_is_noop() {
    let (_dir, pool) = setup().await;
    import_legacy_localstorage_inner(&pool, sample_payload())
        .await
        .unwrap();

    // Second call with different (bigger) payload — still no-op because state == done.
    let mut second = sample_payload();
    second.favorites.as_mut().unwrap().push(LegacyFavorite {
        id: "fav-2".into(),
        name: "all logs".into(),
        sql: "SELECT * FROM logs".into(),
        connection_id: None,
        created_at: 1_700_000_001_000,
        updated_at: 1_700_000_001_000,
    });
    import_legacy_localstorage_inner(&pool, second)
        .await
        .unwrap();

    // Still 1 favorite (no-op).
    let fav_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        fav_count, 1,
        "Second import call must be no-op when state is done"
    );

    cleanup();
}

// AC-355-05: empty payload — pending → done immediately (legacy LS was empty).
#[tokio::test]
#[serial]
async fn test_import_empty_payload_transitions_to_done() {
    let (_dir, pool) = setup().await;
    let empty = LegacyPayload {
        favorites: None,
        mru: None,
    };
    import_legacy_localstorage_inner(&pool, empty)
        .await
        .unwrap();
    assert_eq!(
        get_legacy_import_state(&pool).await.unwrap(),
        LegacyImportState::Done
    );
    cleanup();
}

// AC-355-06: guard responds correctly to each of the 4 states.
#[tokio::test]
#[serial]
async fn test_guard_responds_per_state() {
    let (_dir, pool) = setup().await;
    use table_view_lib::commands::guard::guard_legacy_import_done;

    // pending → reject
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();
    match guard_legacy_import_done(&pool).await {
        Err(AppError::LegacyImportInProgress) => {}
        other => panic!("pending: expected LegacyImportInProgress, got {:?}", other),
    }

    // importing → reject
    set_legacy_import_state(&pool, LegacyImportState::Importing)
        .await
        .unwrap();
    match guard_legacy_import_done(&pool).await {
        Err(AppError::LegacyImportInProgress) => {}
        other => panic!(
            "importing: expected LegacyImportInProgress, got {:?}",
            other
        ),
    }

    // failed → reject (retry path is boot-time, not run-time)
    set_legacy_import_state(&pool, LegacyImportState::Failed)
        .await
        .unwrap();
    match guard_legacy_import_done(&pool).await {
        Err(AppError::LegacyImportInProgress) => {}
        other => panic!("failed: expected LegacyImportInProgress, got {:?}", other),
    }

    // done → accept (Ok(()))
    set_legacy_import_state(&pool, LegacyImportState::Done)
        .await
        .unwrap();
    guard_legacy_import_done(&pool).await.unwrap();

    cleanup();
}
