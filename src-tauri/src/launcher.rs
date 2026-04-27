//! Sprint 150 — window lifecycle commands keyed by `WebviewWindow.label`.
//!
//! Phase 12 splits the app into two real Tauri windows: `launcher` (720×560
//! fixed) and `workspace` (1280×800 resizable). The frontend needs a small,
//! label-addressable command surface that can show / hide / focus those
//! windows and exit the app cleanly when the user closes the launcher. This
//! module owns that surface; `lib.rs` registers the commands in the
//! `invoke_handler`.
//!
//! Sprint 150 is foundation only — the real activation / Back / close
//! lifecycle wiring lands in Sprint 154 on top of these primitives. ADR 0011
//! is superseded by ADR 0012 in Sprint 155 once the full lifecycle is live.

use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime};

/// Look the window up by label and produce a typed `AppError::NotFound`
/// when it is missing — the frontend can map that to a toast.
fn window_by_label<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<tauri::WebviewWindow<R>, AppError> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::NotFound(format!("window '{label}' not found")))
}

/// Show the launcher window. Idempotent — calling on an already-visible
/// window is a no-op from the user's perspective.
#[tauri::command]
pub async fn launcher_show<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "launcher")?
        .show()
        .map_err(|e| AppError::Connection(format!("launcher.show failed: {e}")))
}

/// Hide the launcher window (does not close it — re-showing must be
/// instant). Used by Sprint 154's activation flow.
#[tauri::command]
pub async fn launcher_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "launcher")?
        .hide()
        .map_err(|e| AppError::Connection(format!("launcher.hide failed: {e}")))
}

/// Focus the launcher window. Used after `launcher_show()` to ensure the
/// recovered launcher takes input focus on the workspace → launcher swap.
#[tauri::command]
pub async fn launcher_focus<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "launcher")?
        .set_focus()
        .map_err(|e| AppError::Connection(format!("launcher.focus failed: {e}")))
}

/// Show the workspace window. The window is born hidden (`visible: false`
/// in `tauri.conf.json`) so the first show is the activation event.
#[tauri::command]
pub async fn workspace_show<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "workspace")?
        .show()
        .map_err(|e| AppError::Connection(format!("workspace.show failed: {e}")))
}

/// Hide the workspace window. Used by Sprint 154's "Back to connections"
/// flow — the connection pool stays alive so re-activation is instant.
#[tauri::command]
pub async fn workspace_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "workspace")?
        .hide()
        .map_err(|e| AppError::Connection(format!("workspace.hide failed: {e}")))
}

/// Focus the workspace window. Called immediately after `workspace_show()`
/// so the workspace receives input focus on activation.
#[tauri::command]
pub async fn workspace_focus<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "workspace")?
        .set_focus()
        .map_err(|e| AppError::Connection(format!("workspace.focus failed: {e}")))
}

/// Exit the app cleanly. Used by Sprint 154's launcher-close handler so
/// closing the launcher tears down the whole process (workspace included).
#[tauri::command]
pub async fn app_exit<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    /// Build a mock Tauri app with both `launcher` and `workspace` webview
    /// windows so the command bodies have something to find. The test app
    /// uses `tauri::test::MockRuntime` — no real OS window is opened.
    fn make_app_with_windows() -> tauri::App<tauri::test::MockRuntime> {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        tauri::WebviewWindowBuilder::new(
            &app,
            "launcher",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("launcher window build");

        tauri::WebviewWindowBuilder::new(
            &app,
            "workspace",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("workspace window build");

        app
    }

    #[test]
    fn window_by_label_returns_window_when_present() {
        let app = make_app_with_windows();
        let result = window_by_label(app.handle(), "launcher");
        assert!(
            result.is_ok(),
            "expected launcher window to resolve, got {:?}",
            result.err()
        );
    }

    #[test]
    fn window_by_label_returns_not_found_for_missing_label() {
        let app = make_app_with_windows();
        let result = window_by_label(app.handle(), "ghost-label");
        match result {
            Err(AppError::NotFound(msg)) => {
                assert!(
                    msg.contains("ghost-label"),
                    "NotFound message should embed the missing label, got {msg:?}"
                );
            }
            other => panic!("Expected AppError::NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn launcher_show_succeeds_when_window_exists() {
        let app = make_app_with_windows();
        let result = launcher_show(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "launcher_show should succeed on a registered window, got {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn workspace_focus_succeeds_when_window_exists() {
        let app = make_app_with_windows();
        let result = workspace_focus(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "workspace_focus should succeed on a registered window, got {:?}",
            result.err()
        );
    }
}
