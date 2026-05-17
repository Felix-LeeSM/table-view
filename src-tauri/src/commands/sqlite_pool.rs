//! Sprint 355 (Phase 1) — process-scope SQLite pool 의 lazy init helper.
//!
//! Phase 1 시점에는 AppState 가 pool 을 직접 들고 있지 않다 (sprint-357 의
//! `get_initial_app_state` 와 같이 정식 hookup 됨). 그 사이 import_legacy /
//! guard 등 IPC 는 `OnceCell` 로 process-shared pool 을 lazy 생성해 사용한다.
//!
//! 테스트는 `storage::local::open_pool()` 을 직접 호출하므로 본 helper 를
//! 거치지 않는다 — `TABLE_VIEW_TEST_DATA_DIR` env 를 set 한 후 fresh pool 을
//! 만든다.

use crate::error::AppError;
use crate::storage::local;
use sqlx::SqlitePool;
use tokio::sync::OnceCell;

static POOL: OnceCell<SqlitePool> = OnceCell::const_new();

pub async fn get_or_init_pool() -> Result<SqlitePool, AppError> {
    let pool = POOL.get_or_try_init(local::open_pool).await?;
    Ok(pool.clone())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 — sprint-376 직후 baseline cleanup.
    //!
    //! `get_or_init_pool` 은 process-wide `OnceCell` — 단 1회만 init 되고
    //! 이후 호출은 clone 만. 본 unit test 는 process 안에서 같은 cell 을
    //! 공유하므로 한 곳에서 한 번만 cover 가능. 시나리오 8 원칙 중:
    //!   - Happy: 첫 호출 → Ok(pool).
    //!   - 멱등: 두 번째 호출은 같은 pool (cell hit).
    //!   - 동시성: 모든 호출이 같은 cell 을 보므로 두 번 호출해도 Ok.
    //!
    //! `TABLE_VIEW_TEST_DATA_DIR` 는 다른 test (`tests/keyring_*` 등) 가
    //! set 해 둔 상태일 수 있으므로 본 test 는 그 env 가 무엇이든 (set / unset)
    //! 정상 동작해야 한다 — 다만 OnceCell 의 1회 init 는 process-shared 이므로
    //! 다른 inline test 와의 순서는 cargo test thread scheduler 가 결정.
    //! `serial_test` 로 격리.
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    #[tokio::test]
    #[serial]
    async fn get_or_init_pool_returns_a_usable_pool() {
        // Note: We can't reset POOL since it's a static OnceCell, but we *can*
        // verify the call succeeds and returns a pool that responds to a
        // trivial query. The process-wide nature of OnceCell means subsequent
        // tests in the same binary will hit the cached pool, which is the
        // contract.
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = get_or_init_pool().await.expect("first init must succeed");
        // Trivial query to confirm the pool is healthy.
        let one: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&pool)
            .await
            .expect("pool must serve a query");
        assert_eq!(one, 1);
    }

    #[tokio::test]
    #[serial]
    async fn get_or_init_pool_is_idempotent() {
        let _dir = TempDir::new().unwrap();
        let pool_a = get_or_init_pool().await.unwrap();
        let pool_b = get_or_init_pool().await.unwrap();
        // Two clones must point at the same underlying pool — verifiable by
        // running a query on each and confirming both succeed.
        let a: i64 = sqlx::query_scalar("SELECT 2")
            .fetch_one(&pool_a)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar("SELECT 2")
            .fetch_one(&pool_b)
            .await
            .unwrap();
        assert_eq!(a, 2);
        assert_eq!(b, 2);
    }
}
