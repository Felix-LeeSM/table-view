//! Sprint 355 (Phase 1) — SQLite SOT 스켈레톤.
//!
//! 본 모듈은 state-management-strategy-2026-05-15 의 SQLite 단일 path 도입을
//! 위한 토대다. 향후 Phase 1+ 에서 dual-write, snapshot IPC, dual-read 가 이
//! 위에 쌓인다.
//!
//! 책임:
//! - 앱 데이터 디렉토리 안의 `state.db` 파일 경로 결정
//! - SQLite pool init (sqlx, runtime-tokio-rustls + sqlite feature)
//! - Migration 적용 (sqlx migrate! 매크로) — 멱등 (재실행 안전)
//! - Q2 corrupt recovery — `open_pool()` 가 corruption 을 감지하면
//!   `state.db.bak` 으로 quarantine 후 fresh DB 생성. 사용자 toast 0.
//!
//! Q22 (keyring 이주) 는 별 sprint (356) — 본 모듈은 schema 만 안다.

use crate::error::AppError;
use crate::storage::corrupt_recovery;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::str::FromStr;
use tracing::{info, warn};

/// 앱 데이터 디렉토리 (storage::app_data_dir 와 동일 정책 — TABLE_VIEW_TEST_DATA_DIR
/// env 우선). 분리해서 두는 이유: storage/mod.rs 는 file-based connections.json
/// 영역, 이 파일은 SQLite 영역. 디렉토리는 공유.
pub fn app_data_dir() -> Result<PathBuf, AppError> {
    if let Ok(dir) = std::env::var("TABLE_VIEW_TEST_DATA_DIR") {
        let dir = PathBuf::from(dir);
        std::fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("table-view");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// SQLite DB 파일 경로. Phase 1 부터 영구 위치.
pub fn db_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("state.db"))
}

/// SQLite pool 을 열고 migration 을 적용. corrupt 파일은 자동으로 quarantine
/// (Q2). 호출자는 결과 pool 을 AppState 또는 `OnceCell` 에 등록.
pub async fn open_pool() -> Result<SqlitePool, AppError> {
    let path = db_path()?;

    // Pre-open corruption check — pool 이 open 한 뒤 query 실행 시 fail 하면
    // 그제서야 quarantine 시도하면 race 가 생긴다. boot 시점에 1회 체크.
    if path.exists() {
        if let Err(e) = corrupt_recovery::probe(&path).await {
            warn!(
                target: "storage",
                error = %e,
                path = %path.display(),
                "SQLite file appears corrupt — quarantining and starting fresh"
            );
            corrupt_recovery::quarantine(&path)?;
        }
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .map_err(|e| AppError::Storage(format!("SQLite connect options: {}", e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    run_migrations(&pool).await?;

    info!(target: "storage", path = %path.display(), "SQLite pool opened, migrations applied");
    Ok(pool)
}

/// Migration runner — `sqlx::migrate!()` 로 `src-tauri/migrations/*.sql` 적용.
/// 재실행 안전 (sqlx 가 `_sqlx_migrations` table 로 적용 이력 관리).
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::Storage(format!("Migration failed: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-355) — open_pool / run_migrations 의
    //! happy-path 단위 검증. 자세한 PK / 인덱스 / corrupt recovery 검증은
    //! `tests/migration_apply.rs`, `tests/corrupt_recovery.rs` 통합 테스트
    //! 파일에 있음.

    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn setup_env() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn test_open_pool_creates_db_when_missing() {
        let _dir = setup_env();
        let path = db_path().unwrap();
        assert!(!path.exists(), "precondition: db file absent");

        let _pool = open_pool().await.unwrap();
        assert!(path.exists(), "open_pool should create state.db");

        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn test_run_migrations_is_idempotent() {
        let _dir = setup_env();
        let pool = open_pool().await.unwrap();
        // Calling again must not error.
        run_migrations(&pool).await.unwrap();
        cleanup_env();
    }
}
