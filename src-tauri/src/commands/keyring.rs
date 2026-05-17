//! Sprint 356 (Phase 1, Q22) — keyring fallback sentinel IPC.
//!
//! 단일 책임: 사용자가 `KeyringFallbackToast` 의 dismiss 를 눌렀을 때 file
//! sidecar `.keyring-fallback-dismissed` 를 user-data dir 에 set 한다. 다음
//! boot 의 frontend 는 backend 의 boot-time 신호와 이 sidecar 존재 여부를
//! 합쳐 toast 표시 여부를 결정한다 (AC-356-06).
//!
//! 본 명령은 의도적으로 SQLite/AppState 와 무관하다 — keyring 이주 자체가
//! SQLite migration **전** 단계이므로 meta table 부재 (codex 5차 #5 fix).

use crate::error::AppError;
use crate::storage::key_migration::{app_data_dir_for_keyring, fallback_dismissed_sentinel_path};

/// Set the `.keyring-fallback-dismissed` sentinel file in the app
/// user-data dir. Idempotent — re-clicking dismiss does nothing harmful
/// (the file already exists, write is a no-op rewrite).
#[tauri::command]
pub async fn set_keyring_fallback_dismissed() -> Result<(), AppError> {
    let dir = app_data_dir_for_keyring()?;
    let path = fallback_dismissed_sentinel_path(&dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, b"")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 — sprint-376 직후 baseline cleanup.
    //!
    //! `set_keyring_fallback_dismissed` IPC 는 SQLite/AppState 미관여 — 단순
    //! file sidecar write. Tauri::command attribute 가 wrapping 만 하기에
    //! `tauri::test::mock_app` 없이 직접 호출 가능.
    //!
    //! Test scenarios:
    //!   - Happy: 빈 dir 에서 sidecar 생성.
    //!   - 멱등: 두 번째 호출도 정상 (덮어쓰기 OK).
    //!   - File 내용: 빈 body (위치만 의미 있음).
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    #[tokio::test]
    #[serial]
    async fn happy_path_creates_sentinel_in_test_data_dir() {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        set_keyring_fallback_dismissed()
            .await
            .expect("must succeed in a writable temp dir");
        let path = fallback_dismissed_sentinel_path(dir.path());
        assert!(path.exists(), "sentinel file must be created");
        let body = std::fs::read(&path).unwrap();
        assert!(body.is_empty(), "sentinel body is intentionally empty");
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn idempotent_second_call_does_not_error() {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        set_keyring_fallback_dismissed().await.unwrap();
        // Second call — already exists, must still return Ok.
        set_keyring_fallback_dismissed()
            .await
            .expect("second call must be idempotent");
        let path = fallback_dismissed_sentinel_path(dir.path());
        assert!(path.exists());
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn third_call_in_isolated_dir_does_not_resurface_prior_body() {
        // 별도 새 TempDir 에서도 정상 — 동일 dir 에서의 idempotency 와 분리.
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        for _ in 0..3 {
            set_keyring_fallback_dismissed().await.unwrap();
        }
        let path = fallback_dismissed_sentinel_path(dir.path());
        assert!(path.exists());
        let body = std::fs::read(&path).unwrap();
        assert!(body.is_empty());
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }
}
