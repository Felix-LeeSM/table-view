//! Sprint 362 (Phase 3, Q3) — Single-instance plugin 2nd-launch callback.
//!
//! Background
//! ----------
//! The state-management strategy (Q3, line 406) locked single-instance:
//! attempting a 2nd launch must focus the existing process's launcher
//! window rather than spinning up a parallel app process. `lib.rs` wires
//! `tauri_plugin_single_instance::init(...)` with a callback that, on
//! every spurious launch, runs the logic in this module against the
//! living `AppHandle`.
//!
//! Why a separate `_inner` function?
//! ---------------------------------
//! The plugin's callback signature is `Fn(&AppHandle<R>, Vec<String>, String)`
//! and fires only when a real second OS process invokes the platform-specific
//! IPC (Unix socket on macOS/Linux, named pipe on Windows). That spawn cannot
//! be reproduced under `tauri::test::MockRuntime`. By extracting the
//! window-effecting body into `handle_second_instance_inner` we:
//!   1. Test the body directly with MockRuntime + a pre-built launcher
//!      window (`tests/single_instance_2nd_launch.rs`).
//!   2. Keep the plugin registration in `lib.rs` a one-liner that simply
//!      forwards to `handle_second_instance_inner` — both paths share the
//!      same semantics by construction.
//!
//! Contract
//! --------
//!   - Looks up the launcher window by the hardcoded label `"launcher"`
//!     (same label used by `tauri.conf.json` `app.windows[]` and by
//!     `launcher::build_launcher_window`).
//!   - On success: `.unminimize()` → `.show()` → `.set_focus()` on the
//!     launcher only. Errors on any of those steps surface as
//!     `AppError::Window`.
//!   - Touches no other window. Workspace windows
//!     (`workspace-{conn_id}`) remain untouched — visibility, focus,
//!     minimize state are all preserved.
//!   - When the launcher does not exist (rare — macOS user closed the
//!     launcher entirely while keeping the app alive in the dock; the
//!     `RunEvent::Reopen` handler in `lib.rs` would normally lazy-rebuild
//!     it on a dock click, but a 2nd-launch can arrive before that
//!     rebuild) the function returns `AppError::Window`. The caller
//!     (plugin callback) logs and continues — we do NOT lazy-build here
//!     because the 2nd-launch path should be a no-op fall-through if the
//!     1st process's UI is already gone.

use crate::error::AppError;
use tauri::{AppHandle, Manager, Runtime};

/// Label of the launcher window. Mirrors `tauri.conf.json`
/// `app.windows[0].label` and `launcher::build_launcher_window`'s second
/// argument byte-for-byte. Centralized here so a future rename of the
/// launcher only touches three call sites in lockstep.
const LAUNCHER_LABEL: &str = "launcher";

/// Body of the single-instance 2nd-launch callback. Pulled out of the
/// `tauri_plugin_single_instance::init` closure so MockRuntime-based
/// integration tests can drive it directly.
///
/// Cost: O(1) — three Tauri window calls behind a single label lookup.
/// Safe to call on the calling thread (no async, no blocking).
pub fn handle_second_instance_inner<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let launcher = app.get_webview_window(LAUNCHER_LABEL).ok_or_else(|| {
        AppError::Window(format!(
            "single-instance 2nd-launch: window '{LAUNCHER_LABEL}' not found"
        ))
    })?;

    // Order matters: unminimize first so `set_focus` on a minimized window
    // actually surfaces it on macOS (unminimize is a no-op when not
    // minimized, so this is also the warm-path order without branching).
    launcher
        .unminimize()
        .map_err(|e| AppError::Window(format!("launcher.unminimize failed: {e}")))?;
    launcher
        .show()
        .map_err(|e| AppError::Window(format!("launcher.show failed: {e}")))?;
    launcher
        .set_focus()
        .map_err(|e| AppError::Window(format!("launcher.set_focus failed: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 3 sprint-362)
    //!
    //! 사유: integration test (`tests/single_instance_2nd_launch.rs`) 가
    //! AC-362-02 / AC-362-04 의 multi-window 시나리오를 잠근다. 본 unit
    //! 측은 minimal happy-path + launcher missing 분기를 모듈 안에서
    //! 잠가, integration 실패가 inner 함수 자체의 회귀인지 plugin wiring
    //! 회귀인지 빠르게 좁힐 수 있게 한다.
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    fn make_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build")
    }

    #[test]
    fn returns_window_error_when_launcher_missing() {
        let app = make_app();
        let result = handle_second_instance_inner(app.handle());
        assert!(
            matches!(result, Err(AppError::Window(_))),
            "expected Window error for missing launcher, got {:?}",
            result
        );
    }

    #[test]
    fn returns_ok_when_launcher_exists() {
        let app = make_app();
        tauri::WebviewWindowBuilder::new(
            &app,
            "launcher",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("launcher build");

        let result = handle_second_instance_inner(app.handle());
        assert!(result.is_ok(), "expected Ok, got {:?}", result.err());
    }
}
