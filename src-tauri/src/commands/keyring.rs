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
