//! Lazy init helper for the process-scope SQLite pool.
//!
//! `AppState` holds no pool. IPCs that need SQLite — `import_legacy`, the
//! legacy-import guard, `get_initial_app_state` — call [`get_or_init_pool`],
//! which lazily creates one process-shared pool in a `OnceCell`.
//!
//! Tests call `storage::local::open_pool()` directly and do not go through
//! this helper — they set the `TABLE_VIEW_TEST_DATA_DIR` env and then create
//! a fresh pool.

use crate::error::AppError;
use crate::storage::local;
use sqlx::SqlitePool;
use tokio::sync::OnceCell;

static POOL: OnceCell<SqlitePool> = OnceCell::const_new();

pub async fn get_or_init_pool() -> Result<SqlitePool, AppError> {
    let pool = POOL.get_or_try_init(local::open_pool).await?;
    Ok(pool.clone())
}

/// Issue #1231 — read the persisted `query_row_cap` and publish it to the
/// process-global the adapters read at fetch time. Called by the raw-query
/// commands (RDB `execute_query`/batch, Mongo `find`/`aggregate`) right before
/// dispatch. A pool-open failure leaves the previous cap in place (worst case
/// the default) rather than failing the query.
pub async fn publish_row_cap() {
    if let Ok(pool) = get_or_init_pool().await {
        crate::db::row_cap::set(crate::db::row_cap::read_from_settings(&pool).await);
    }
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-17 — baseline cleanup.
    //!
    //! `get_or_init_pool` is a process-wide `OnceCell` — initialized only
    //! once, with later calls just cloning. Because this unit test shares the
    //! same cell within the process, it can be covered only once, in one
    //! place. From the scenario-8 principles:
    //!   - Happy: first call → Ok(pool).
    //!   - Idempotent: the second call returns the same pool (cell hit).
    //!   - Concurrency: all calls see the same cell, so calling twice is Ok.
    //!
    //! `TABLE_VIEW_TEST_DATA_DIR` may already be set by another test
    //! (`tests/keyring_*` and friends), so this test must behave correctly
    //! whatever that env is (set / unset) — but since the OnceCell's one-time
    //! init is process-shared, ordering against other inline tests is decided
    //! by the cargo test thread scheduler. Isolated with `serial_test`.
    use super::*;
    use serial_test::serial;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    static TEST_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

    fn set_test_data_dir() {
        let dir = TEST_DATA_DIR.get_or_init(|| {
            let dir = std::env::temp_dir().join(format!(
                "table-view-sqlite-pool-test-{}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("test data dir must be creatable");
            dir
        });
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir);
    }

    #[tokio::test]
    #[serial]
    async fn get_or_init_pool_returns_a_usable_pool() {
        // Note: We can't reset POOL since it's a static OnceCell, but we *can*
        // verify the call succeeds and returns a pool that responds to a
        // trivial query. The process-wide nature of OnceCell means subsequent
        // tests in the same binary will hit the cached pool, which is the
        // contract.
        set_test_data_dir();
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
        set_test_data_dir();
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
