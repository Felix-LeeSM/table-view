//! Sprint 355 (Phase 1) — SQLite SOT 스켈레톤.
//!
//! 본 모듈은 `memory/engineering/architecture/state-management/memory.md` 의 SQLite 단일 path 도입을
//! 위한 토대다. 향후 Phase 1+ 에서 dual-write, snapshot IPC, dual-read 가 이
//! 위에 쌓인다.
//!
//! 책임:
//! - 앱 데이터 디렉토리 안의 `state.db` 파일 경로 결정
//! - SQLite pool init (sqlx, runtime-tokio-rustls + sqlite feature)
//! - Migration 적용 (sqlx migrate! 매크로) — 멱등 (재실행 안전)
//! - Q2 corrupt recovery — `open_pool()` 가 corruption 을 감지하면
//!   `state.db.bak` 으로 quarantine 후 fresh DB 생성. v0.3.1: 복구 발생 시
//!   `corrupt_recovery::DID_RECOVER` 가 set 되고 frontend toast 로 알림.
//!
//! Q22 (keyring 이주) 는 별 sprint (356) — 본 모듈은 schema 만 안다.

use crate::error::AppError;
use crate::storage::corrupt_recovery;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::Ordering;
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

/// 렌더러가 지정한, Tauri command 가 파일로 쓸 대상 경로를 검증한다. 상대경로
/// (must be absolute) 와 내부 app 데이터 디렉토리(`app_data_dir()`) 안으로
/// resolve 되는 경로를 거부 — 침해된 렌더러가 export target 을 빌미로 `.key`
/// (마스터키) / `connections.json` (암호화 password blob) / `state.db`(+`.bak`·
/// `-wal` sidecar) 등 내부 credential 을 overwrite/삭제하지 못하게 막는다.
/// Issue #1094, #1449. sqlite connect/create 와 같은 `reject_internal_app_data_path`
/// 가드를 재사용한다.
pub fn validate_export_target_path(path: &Path) -> Result<(), AppError> {
    if !path.is_absolute() {
        return Err(AppError::Validation(
            "Export target path must be absolute".into(),
        ));
    }
    reject_internal_app_data_path(path)
}

/// 인자 경로가 내부 app 데이터 디렉토리(`app_data_dir()`) 안으로 resolve 되면
/// 거부. `state.db` 단일 파일이 아니라 디렉토리 전체를 confinement 한다 —
/// `connections.json`(암호화 비밀번호 blob) / `.key`(마스터키) / `state.db`
/// (+`.bak`·`-wal` sidecar) 등 앱 내부 state 를 export/import/connect/create
/// target 이나 DuckDB file analytics source 로 삼아 overwrite 하거나 read-exfil
/// 하는 것을 막는다 (Issue #1106, #1449). export/import/connect/create·file
/// analytics 가 공유하는 단일 가드. normalized (`..`·`.` 정리) 와 canonical
/// (symlink 해소) 두 방식으로 디렉토리 포함 여부를 비교한다 — 미존재 target
/// (신규 export/create) 은 canonicalize 가 실패하므로 normalized 비교가 잡고,
/// 존재 파일·symlink 는 canonical 비교가 잡는다. 호출자가 미리 canonicalize 해
/// 넘겨도 무방하다.
pub fn reject_internal_app_data_path(path: &Path) -> Result<(), AppError> {
    let data_dir = app_data_dir()?;
    let normalized_within =
        normalize_absolute_path(path).starts_with(normalize_absolute_path(&data_dir));
    let canonical_within = matches!(
        (std::fs::canonicalize(path), std::fs::canonicalize(&data_dir)),
        (Ok(candidate), Ok(dir)) if candidate.starts_with(&dir)
    );
    if normalized_within || canonical_within {
        return Err(AppError::Validation(
            "Local file path cannot target the internal app data directory".into(),
        ));
    }
    Ok(())
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

/// SQLite pool 을 열고 migration 을 적용. corrupt 파일은 자동으로 quarantine
/// (Q2). 호출자는 결과 pool 을 AppState 또는 `OnceCell` 에 등록.
pub async fn open_pool() -> Result<SqlitePool, AppError> {
    let path = db_path()?;

    // Pre-open corruption check — magic header 손상은 probe 로 잡는다. pool 이
    // open 한 뒤 query 실행 시 fail 하면 그제야 quarantine 시도하면 race 가
    // 생기므로 boot 시점에 1회 체크.
    if path.exists() {
        if let Err(e) = corrupt_recovery::probe(&path).await {
            warn!(
                target: "storage",
                error = %e,
                path = %path.display(),
                "SQLite file appears corrupt — quarantining and starting fresh"
            );
            corrupt_recovery::quarantine(&path)?;
            corrupt_recovery::DID_RECOVER.store(true, Ordering::SeqCst);
        }
    }

    // connect + migrate + boot health check 까지 묶어서 시도. body corruption
    // (probe 는 통과하지만 read path 가 죽는 손상) 은 이 단계에서 잡힌다.
    let pool = match open_pool_inner(&path).await {
        Ok(p) => p,
        Err(e) if is_lock_error(&e) => {
            // Lock (이중 실행 등) — quarantine+fresh 해봤자 같은 파일 lock 으로
            // 재실행도 실패하고 데이터만 유실시킨다. 근본 fix 는 single-instance
            // 보장 (별도 PR) 이므로 여기서는 그대로 에러 반환.
            return Err(e);
        }
        Err(e) => {
            warn!(
                target: "storage",
                error = %e,
                path = %path.display(),
                "SQLite health check failed — quarantining and retrying once"
            );
            corrupt_recovery::quarantine(&path)?;
            corrupt_recovery::DID_RECOVER.store(true, Ordering::SeqCst);
            // fresh 재시도 1회. 여기서도 실패하면 진짜 에러.
            open_pool_inner(&path).await?
        }
    };

    info!(target: "storage", path = %path.display(), "SQLite pool opened, migrations applied");
    Ok(pool)
}

/// connect + migrate + boot health check 까지 수행. 실패 시 pool 을 close 한
/// 뒤 에러를 반환한다 (background connection 정리 → quarantine rename 안전).
async fn open_pool_inner(path: &Path) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .map_err(|e| AppError::Storage(format!("SQLite connect options: {}", e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    if let Err(e) = run_migrations(&pool).await {
        let _ = pool.close().await;
        return Err(e);
    }
    if let Err(e) = health_check(&pool).await {
        let _ = pool.close().await;
        return Err(e);
    }
    // sqlx 가 state.db 와 WAL/SHM sidecar 를 process umask (umask 022 → 0644) 로
    // 만들고 sidecar 는 생성 시점 db mode 를 복사한다 — 셋 다 0600 으로 좁힌다.
    // 다른 credential 파일 (connections.json / .key) 과 동일 정책 (Issue #1452).
    restrict_state_db_permissions(path);
    Ok(pool)
}

/// state.db 와 WAL/SHM sidecar 를 Unix 0600 으로 제한한다. sqlx 는 파일 mode 를
/// 지정할 수 없어 생성 후 좁히며, 기존 0644 파일도 재부팅 시 교정된다. chmod 실패는
/// boot 를 막지 않고 경고만 남긴다 (DB 자체는 정상 동작).
#[cfg(unix)]
fn restrict_state_db_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    for suffix in ["", "-wal", "-shm"] {
        let mut os = path.as_os_str().to_os_string();
        os.push(suffix);
        let target = PathBuf::from(os);
        match std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!(
                target: "storage",
                error = %e,
                path = %target.display(),
                "failed to restrict state.db permissions to 0600"
            ),
        }
    }
}

#[cfg(not(unix))]
fn restrict_state_db_permissions(_path: &Path) {}

/// Boot health check — `get_initial_app_state_inner` 가 실행하는 read path 와
/// 동일한 트랜잭션(`BEGIN IMMEDIATE` + read)을 돌려, boot 시점에 실패할 손상
/// (page body corrupt 등; probe 의 magic 검사는 통과하는 케이스)을 init 단계
/// 에서 잡는다. 정상 DB 에서 sub-ms.
async fn health_check(pool: &SqlitePool) -> Result<(), AppError> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| AppError::Storage(format!("health check begin: {}", e)))?;
    let _: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::Storage(format!("health check read: {}", e)))?;
    tx.commit()
        .await
        .map_err(|e| AppError::Storage(format!("health check commit: {}", e)))?;
    Ok(())
}

/// 에러 메시지가 SQLite lock(busy) 관련이면 recovery 를 skip 한다 — lock 은
/// quarantine+fresh 로는 풀리지 않고 데이터만 유실시킨다.
fn is_lock_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("locked") || msg.contains("busy")
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

    /// state.db 는 credential 성 데이터를 담는 SQLite SOT 다. 다른 credential
    /// 파일 (connections.json / .key) 과 동일하게 Unix 0600 이어야 한다 (Issue
    /// #1452). WAL journal mode 라 sqlite 가 만드는 `-wal` / `-shm` sidecar 도
    /// 검증한다 — 존재하면 함께 0600 이어야 한다.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_state_db_files_are_0600() {
        use std::os::unix::fs::PermissionsExt;

        let _dir = setup_env();
        let path = db_path().unwrap();

        let pool = open_pool().await.unwrap();
        // 쓰기를 강제해 WAL/SHM sidecar 를 확실히 만든다.
        sqlx::query("CREATE TABLE IF NOT EXISTS _perm_probe (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();

        for suffix in ["", "-wal", "-shm"] {
            let mut os = path.as_os_str().to_os_string();
            os.push(suffix);
            let target = PathBuf::from(os);
            if !target.exists() {
                continue;
            }
            let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                mode,
                0o600,
                "{} must be 0600, got {:o}",
                target.display(),
                mode
            );
        }

        cleanup_env();
    }
}
