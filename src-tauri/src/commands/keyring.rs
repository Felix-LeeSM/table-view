//! Q22 — keyring fallback sentinel IPC.
//!
//! Single responsibility: when the user presses dismiss on `KeyringFallbackToast`,
//! set the file sidecar `.keyring-fallback-dismissed` in the user-data dir. On
//! the next boot the frontend combines the backend's boot-time signal with the
//! presence of this sidecar to decide whether to show the toast (AC-356-06).
//!
//! This command is deliberately independent of SQLite/AppState — the keyring
//! migration itself runs **before** the SQLite migration stage, so the meta
//! table does not exist yet (fix).

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
    //! Written 2026-05-17 — baseline cleanup.
    //!
    //! The `set_keyring_fallback_dismissed` IPC does not touch SQLite/AppState —
    //! it is a plain file sidecar write. The Tauri::command attribute only wraps
    //! it, so it can be called directly without `tauri::test::mock_app`.
    //!
    //! Test scenarios:
    //!   - Happy: sidecar created in an empty dir.
    //!   - Idempotent: a second call also succeeds (overwrite is fine).
    //!   - File content: empty body (only the location matters).
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
        // Also fine in a separate fresh TempDir — isolated from the same-dir
        // idempotency check.
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
