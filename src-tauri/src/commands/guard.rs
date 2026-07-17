//! Sprint 355 (Phase 1) — `guard_legacy_import_done` 헬퍼.
//!
//! 모든 A/C 도메인 mutate IPC (connections / favorites / mru / settings /
//! workspaces / datagrid_column_prefs / query_history insert / connection_groups
//! CRUD) 가 첫 줄에서 본 helper 를 호출해야 한다. import 가 `done` 이 아니면
//! `AppError::LegacyImportInProgress` 로 reject (strategy line 1189).
//!
//! 적용 IPC 전체 목록 (strategy line 1194–1216):
//!   connection: add/update/delete/reorder
//!   group:      add/update/delete/reorder
//!   mru:        set_mru_lastused / reorder_mru / clear_mru
//!   favorite:   add/update/delete/reorder
//!   setting:    set_setting / reset_setting
//!   workspace:  persist_workspace / delete_workspace
//!   history:    add_history_entry / list_history / get_history_detail / clear_history
//!   datagrid_column_prefs: set / reset
//!
//! 예외 (guard 없음): connect / disconnect / execute_query / cancel_query /
//! get_runtime_status / get_initial_app_state / get_workspace_snapshot / get_* read.

use crate::error::AppError;
use crate::storage::meta::{get_legacy_import_state, LegacyImportState};
use sqlx::SqlitePool;

/// `legacy_imported != Done` 이면 `AppError::LegacyImportInProgress` 반환.
/// Phase 1 머지 시 backend grep CI 가 모든 mutate IPC entry 에 본 helper 호출이
/// 있는지 검증 (AC-355-07).
pub async fn guard_legacy_import_done(pool: &SqlitePool) -> Result<(), AppError> {
    let state = get_legacy_import_state(pool).await?;
    match state {
        LegacyImportState::Done => Ok(()),
        LegacyImportState::Pending | LegacyImportState::Importing | LegacyImportState::Failed => {
            Err(AppError::LegacyImportInProgress)
        }
    }
}

/// The window label of the launcher webview (connection manager). Workspace
/// windows use `workspace` / `workspace-{conn_id}` (launcher.rs).
pub const LAUNCHER_WINDOW_LABEL: &str = "launcher";

/// Issue #1584 — defense-in-depth window-label guard.
///
/// launcher and workspace webviews load the same SPA bundle and Tauri v2 ACL
/// does **not** gate app-defined commands (`capabilities/default.json` only
/// lists core/plugin defaults), so the frontend `AppRouter` label split is the
/// only thing keeping the launcher context away from destructive DB commands.
/// CSP `script-src 'self'` means there is no active exploit path today; this is
/// a hardening backstop. Sensitive command handlers take the injected
/// `window: tauri::Window` param (persist_settings.rs pattern) and call this on
/// the first line — a `launcher` label rejects with [`AppError::Forbidden`].
///
/// The `src-tauri/tests/launcher_command_guard.rs` grep guard enforces that
/// every `#[tauri::command]` is either in the guarded set (and calls this) or
/// on the launcher allowlist, so a new sensitive command cannot ship unguarded.
pub fn guard_not_launcher(window_label: &str) -> Result<(), AppError> {
    if window_label == LAUNCHER_WINDOW_LABEL {
        return Err(AppError::Forbidden(format!(
            "command not permitted from the '{LAUNCHER_WINDOW_LABEL}' window"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-355) — guard 의 4 state 응답 검증.
    //! 통합 시나리오 (legacy import + guard 조합) 는 `tests/legacy_import.rs`.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::set_legacy_import_state;
    use serial_test::serial;
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

    #[tokio::test]
    #[serial]
    async fn test_guard_rejects_pending() {
        let (_dir, pool) = setup().await;
        // Fresh DB → pending by default. No explicit set needed.
        let err = guard_legacy_import_done(&pool).await.unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn test_guard_rejects_importing() {
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Importing)
            .await
            .unwrap();
        let err = guard_legacy_import_done(&pool).await.unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn test_guard_rejects_failed() {
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Failed)
            .await
            .unwrap();
        let err = guard_legacy_import_done(&pool).await.unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn test_guard_accepts_done() {
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();
        guard_legacy_import_done(&pool).await.unwrap();
        cleanup();
    }

    // Issue #1584 — window-label guard. Sensitive commands must reject the
    // launcher webview and pass every workspace window.
    #[test]
    fn guard_not_launcher_rejects_launcher_label() {
        let err = guard_not_launcher(LAUNCHER_WINDOW_LABEL).unwrap_err();
        assert!(
            matches!(err, AppError::Forbidden(_)),
            "launcher label must reject with Forbidden, got {err:?}"
        );
    }

    #[test]
    fn guard_not_launcher_accepts_workspace_labels() {
        // legacy single label + sprint-361 per-connection labels.
        for label in ["workspace", "workspace-42", "workspace-abc123"] {
            guard_not_launcher(label)
                .unwrap_or_else(|e| panic!("workspace label {label:?} must pass, got {e:?}"));
        }
    }
}
