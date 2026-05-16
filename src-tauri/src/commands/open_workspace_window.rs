//! Sprint 361 (Phase 3, Q13) — Per-connection workspace window launcher.
//!
//! Pre-sprint-361 the app had a single bare `"workspace"` window label.
//! Q13 of the state-management strategy made workspace windows per-connection:
//! each open connection mints (or focuses) its own window with the label
//! `workspace-{connection_id}`. This matches TablePlus — clicking the same
//! connection twice re-focuses the existing window instead of spawning a
//! second one. Different connections each own a distinct window.
//!
//! Contract surface:
//!   - `open_workspace_window(connection_id: String)` → `Result<(), AppError>`.
//!   - Idempotent: a window already keyed by `workspace-{connection_id}`
//!     is `.set_focus()`-ed; no new window is built.
//!   - Validates `connection_id` is non-empty so a degenerate "workspace-"
//!     label can never reach the OS.
//!
//! The hardcoded geometry / title mirror `launcher::build_workspace_window`
//! (the legacy single-workspace builder) byte-for-byte so the runtime shape
//! is identical — the only diff is the per-conn label.
//!
//! Test seam: the `#[tauri::command]` wrapper is a thin trampoline over
//! `open_workspace_window_inner`, exposed `pub` so the integration test in
//! `src-tauri/tests/open_workspace_window_idempotent.rs` can drive the
//! Mock runtime directly without going through invoke / serialization.

use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime};

/// Build the per-conn workspace window. Mirrors the geometry / chrome of
/// `launcher::build_workspace_window` so the user-visible window is
/// indistinguishable from the pre-sprint-361 single-workspace shape; only
/// the `WebviewWindow.label` differs (per-conn instead of bare).
fn build_per_conn_workspace_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<(), AppError> {
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Table View — Workspace")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .resizable(true)
        .maximizable(true)
        .center()
        .visible(true)
        .disable_drag_drop_handler()
        .build()
        .map(|_| ())
        .map_err(|e| AppError::Window(format!("workspace window build failed for {label}: {e}")))
}

/// Inner handler — pure (no `#[tauri::command]` macro) so integration tests
/// can call it directly with a `MockRuntime` AppHandle.
///
/// Returns `Ok(())` once the window keyed by `workspace-{connection_id}`
/// exists (either pre-existed and was focused, or just got built).
/// Returns `AppError::Validation` for empty `connection_id` so frontend
/// programmer errors surface loudly instead of leaking a degenerate label.
pub async fn open_workspace_window_inner<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<(), AppError> {
    if connection_id.is_empty() {
        return Err(AppError::Validation(
            "open_workspace_window: connection_id must not be empty".into(),
        ));
    }
    let label = format!("workspace-{connection_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        // Idempotent path — same conn, refocus the live window.
        existing
            .set_focus()
            .map_err(|e| AppError::Window(format!("set_focus failed for {label}: {e}")))?;
        return Ok(());
    }
    build_per_conn_workspace_window(&app, &label)
}

/// Tauri command surface — registered in `lib.rs` `invoke_handler!`.
#[tauri::command]
pub async fn open_workspace_window<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<(), AppError> {
    open_workspace_window_inner(app, connection_id).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 3 sprint-361)
    //!
    //! 사유: integration test (`tests/open_workspace_window_idempotent.rs`)
    //! 는 AC 위주 검증이고, unit 측은 input validation 분기 단독을
    //! 잠근다 — empty connection_id 가 Validation error 로 즉시 거부되어
    //! window 생성 부수효과가 0 임을 unit 단계에서 확인해야 회귀 시
    //! integration 보다 먼저 잡힌다.
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    fn make_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build")
    }

    #[tokio::test]
    async fn empty_connection_id_returns_validation_error() {
        let app = make_app();
        let result = open_workspace_window_inner(app.handle().clone(), String::new()).await;
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "expected Validation error for empty conn_id, got {:?}",
            result
        );
    }

    #[tokio::test]
    async fn nonempty_connection_id_builds_window_with_per_conn_label() {
        let app = make_app();
        let result = open_workspace_window_inner(app.handle().clone(), "abc".into()).await;
        assert!(result.is_ok(), "expected Ok, got {:?}", result.err());
        assert!(
            app.get_webview_window("workspace-abc").is_some(),
            "workspace-abc window should have been built"
        );
    }
}
