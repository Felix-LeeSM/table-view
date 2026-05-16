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
