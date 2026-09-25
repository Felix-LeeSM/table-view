//! Window lifecycle commands keyed by `WebviewWindow.label`.
//!
//! The app has two real Tauri window shapes: `launcher` (720×560 fixed) and
//! `workspace` (1280×800 resizable). The frontend needs a small,
//! label-addressable command surface that can show / hide / focus those
//! windows and exit the app cleanly when the user closes the launcher. This
//! module owns that surface; `lib.rs` registers the commands in the
//! `invoke_handler`.
//!
//! These commands are the primitives; the activation / Back / close lifecycle
//! is wired on top of them in `lib.rs` `on_window_event`. ADR 0011 is
//! superseded by ADR 0012.

use crate::error::AppError;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Look the window up by label and produce a typed `AppError::NotFound`
/// when it is missing — the frontend can map that to a toast.
fn window_by_label<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<tauri::WebviewWindow<R>, AppError> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::Window(format!("window '{label}' not found")))
}

/// Build the launcher `WebviewWindow` from hardcoded defaults that mirror
/// the entry in `tauri.conf.json` `app.windows[]`. Used as the recovery
/// path when the launcher has been destroyed (e.g. user closed the
/// launcher window directly on macOS where the app stays alive without
/// any windows) and we need to bring it back — notably from the macOS
/// File > New Connection menu item and the dock-icon reopen handler
/// (2026-05-01).
///
/// Shape MUST stay byte-for-byte identical to the static config so the
/// re-created window is indistinguishable from the boot one. Any future
/// edit to the launcher's geometry/title in `tauri.conf.json` must be
/// mirrored here.
fn build_launcher_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    tauri::WebviewWindowBuilder::new(app, "launcher", tauri::WebviewUrl::App("index.html".into()))
        .title("Table View")
        .inner_size(720.0, 560.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .visible(true)
        .disable_drag_drop_handler()
        .build()
        .map(|_| ())
        .map_err(|e| AppError::Window(format!("launcher build failed: {e}")))
}

/// Build the workspace `WebviewWindow` from hardcoded defaults instead of
/// `tauri.conf.json` `app.windows[]`.
///
/// The workspace was removed from the static config (commit landed alongside
/// this fn) because Tauri eagerly creates EVERY config-declared window at
/// `tauri::Builder::run()`, including those marked `visible: false`. The
/// sub-instrumentation showed that `rust:entry → rust:setup-done` runs
/// 1124ms median (75% of the 1490ms cold-boot segment), with both
/// launcher and workspace `page-load:Started` events firing within 0.1ms of
/// each other on every trial — i.e. the workspace WKWebView was being
/// spawned + bundle-loaded at boot in parallel with the launcher even when
/// hidden. Skipping the workspace at boot is the AC-175-02-04 ≥30%
/// shrinkage target picked by data.
///
/// Hardcoded values mirror the previous `tauri.conf.json` entry so the
/// runtime window shape is byte-for-byte identical to the earlier
/// behavior; the only diff is *when* the window is constructed (on first
/// `workspace_show` / `workspace_ensure` instead of at boot).
fn build_workspace_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    tauri::WebviewWindowBuilder::new(
        app,
        "workspace",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Table View — Workspace")
    .inner_size(1280.0, 800.0)
    .min_inner_size(960.0, 600.0)
    .resizable(true)
    .maximizable(true)
    .center()
    .visible(false)
    .disable_drag_drop_handler()
    .build()
    .map(|_| ())
    .map_err(|e| AppError::Window(format!("workspace build failed: {e}")))
}

/// Show the launcher window. Idempotent — calling on an already-visible
/// window is a no-op from the user's perspective.
///
/// Lazy-builds the window if it was destroyed. macOS-only scenario: the
/// app remains alive after the launcher window is closed, and the native
/// File > New Connection menu (Cmd+N) plus the dock-icon reopen handler
/// both call into this command to bring the launcher back. On
/// Windows/Linux the app would have terminated when the last window
/// closed, so the lazy-build path is dormant there.
#[tauri::command]
pub async fn launcher_show<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    if app.get_webview_window("launcher").is_none() {
        build_launcher_window(&app)?;
    }
    window_by_label(&app, "launcher")?
        .show()
        .map_err(|e| AppError::Window(format!("launcher.show failed: {e}")))
}

/// Hide the launcher window (does not close it — re-showing must be
/// instant). Used by the activation flow.
#[tauri::command]
pub async fn launcher_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "launcher")?
        .hide()
        .map_err(|e| AppError::Window(format!("launcher.hide failed: {e}")))
}

/// Focus the launcher window. Used after `launcher_show()` to ensure the
/// recovered launcher takes input focus on the workspace → launcher swap.
#[tauri::command]
pub async fn launcher_focus<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "launcher")?
        .set_focus()
        .map_err(|e| AppError::Window(format!("launcher.focus failed: {e}")))
}

/// Show the workspace window. The window is **lazy-built**: the first call
/// to `workspace_show` constructs the `WebviewWindow` via
/// `build_workspace_window`, subsequent calls hit the already-built window
/// and just `.show()` it. This defers ~700ms of
/// WKWebView spawn from boot to the user's first activation click — a
/// latency the user is already prepared for since they explicitly clicked
/// a connection.
#[tauri::command]
pub async fn workspace_show<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    if app.get_webview_window("workspace").is_none() {
        build_workspace_window(&app)?;
    }
    window_by_label(&app, "workspace")?
        .show()
        .map_err(|e| AppError::Window(format!("workspace.show failed: {e}")))
}

/// Hide the workspace window. Used by the "Back to connections" flow — the
/// connection pool stays alive so re-activation is instant.
#[tauri::command]
pub async fn workspace_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "workspace")?
        .hide()
        .map_err(|e| AppError::Window(format!("workspace.hide failed: {e}")))
}

/// Focus the workspace window. Called immediately after `workspace_show()`
/// so the workspace receives input focus on activation.
#[tauri::command]
pub async fn workspace_focus<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    window_by_label(&app, "workspace")?
        .set_focus()
        .map_err(|e| AppError::Window(format!("workspace.focus failed: {e}")))
}

/// 2026-05-16 — destroy the window that invoked the command.
///
/// Tauri injects the caller's `WebviewWindow` automatically when a command
/// signature includes one as a parameter — that handle resolves to the
/// per-conn `workspace-{conn_id}` window (or legacy `workspace`) without the
/// frontend needing to know its own label.
///
/// **Why the backend is called directly**: a regression report observed
/// JS-side `WebviewWindow.destroy()` degrading to a silent no-op depending on
/// the environment (a user environment where fixing it through the frontend's
/// `await win.destroy()` alone left the window on screen). Calling the
/// backend's `Window::destroy()` directly sidesteps every quirk of the JS↔Rust
/// binding layer, and `tracing::info!` records the call so even a silent
/// failure stays debuggable.
#[tauri::command]
pub async fn workspace_close<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), AppError> {
    let label = window.label().to_string();
    window.destroy().map_err(|e| {
        AppError::Window(format!(
            "workspace_close destroy failed (label={label}): {e}"
        ))
    })?;
    tracing::info!(target: "launcher", "workspace_close: destroyed window label={label}");
    Ok(())
}

/// Ensure the workspace window exists. If it has not yet been constructed
/// (the workspace is lazy-built; see `build_workspace_window`) or was
/// destroyed (e.g. the OS closed it before the `onCloseRequested` listener
/// was registered), build it now from hardcoded defaults.
///
/// This is the recovery / first-activation path: the frontend's
/// `showWindow("workspace")` calls `getByLabel` first; when that returns
/// `null` it invokes `workspace_ensure` to construct the window, then
/// retries the show. With workspace removed from `tauri.conf.json`
/// `app.windows[]`, the very first `workspace_ensure` (or `workspace_show`,
/// which now calls into the same builder) is the *creation* event, not a
/// recovery from destruction.
#[tauri::command]
pub async fn workspace_ensure<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    if app.get_webview_window("workspace").is_some() {
        return Ok(());
    }
    build_workspace_window(&app)
}

/// Exit the app cleanly — the whole process, workspace windows included.
/// Registered in `commands/registry.rs` and reached from the frontend through
/// `exitApp()` in `src/lib/window-controls.ts`.
#[tauri::command]
pub async fn app_exit<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    app.exit(0);
    Ok(())
}

/// #1437 P2-4 — whether the running install can self-update via the Tauri
/// updater.
///
/// The updater rewrites the running binary in place only on macOS / Windows
/// and on Linux **AppImage** bundles. The AppImage runtime injects the
/// `APPIMAGE` env var (absolute path to the mounted `.AppImage`); a `.deb` /
/// `.rpm` install has no such target, so `downloadAndInstall` is a silent
/// no-op there. The frontend calls this before prompting so deb/rpm users get
/// a "update via your package manager" hint instead of an install prompt that
/// no-ops and re-appears every boot.
#[tauri::command]
pub fn updater_can_self_install() -> bool {
    can_self_install_impl(cfg!(target_os = "linux"), std::env::var_os("APPIMAGE"))
}

/// Pure decision core, split out so the branch is unit-testable without
/// mutating the process environment. Linux can self-update only inside an
/// AppImage (identified by the `APPIMAGE` env var); every other OS always can.
fn can_self_install_impl(is_linux: bool, appimage_env: Option<std::ffi::OsString>) -> bool {
    !is_linux || appimage_env.is_some()
}

/// Q13 / strategy line 773 — launcher close-request handler. The launcher
/// window's `tauri://close-requested` event is wired in `lib.rs`
/// `on_window_event` to call this function and `prevent_close()` the event. The strategy doc requires that the launcher's close button
/// hides the window (process stays alive, workspace windows stay alive)
/// instead of exiting the app — the user can resurface the launcher via
/// the macOS dock icon (RunEvent::Reopen) or system tray.
///
/// Idempotent + tolerant by design:
///   - If the launcher is missing (rare — single-instance plugin keeps the
///     process alive even when the user destroyed the launcher), return
///     Ok(()) so the close-request handler doesn't poison the call site.
///   - If `hide()` fails (e.g. OS rejected the hide call), log and return
///     Ok(()) — destroying or letting the OS close the window after a
///     failed hide is strictly worse than the launcher staying visible
///     for the user to retry.
///
/// Workspace windows (`workspace-{conn_id}`) are explicitly NOT touched
/// here. Their close policy is owned by `emit_workspace_close_request`
/// below (#1101) — the launcher-close handler stays launcher-only.
pub fn handle_launcher_close_request<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let Some(launcher) = app.get_webview_window("launcher") else {
        // Silent no-op: launcher already gone, nothing to hide.
        return Ok(());
    };
    if let Err(e) = launcher.hide() {
        // Log but don't fail — the alternative (letting the OS close the
        // window) is worse than a stuck-visible launcher the user can
        // retry.
        tracing::warn!(
            target: "launcher",
            "handle_launcher_close_request: hide() failed: {e}"
        );
    }
    Ok(())
}

/// #1101 — workspace close-request delegation. The frontend tracks unsaved
/// changes (`dirtyTabIds`, pending grid edits) in window-local state the
/// backend can't see. So instead of destroying a workspace window when the
/// OS/menu asks to close it, `lib.rs` `on_window_event` intercepts the
/// close (`api.prevent_close()`) and calls this to emit
/// `window:close-requested` to that window. The window's JS then runs the
/// discard confirmation and only invokes `workspace_close` (real destroy)
/// once the user confirms.
///
/// Targeted with `emit_to(label, ...)` — a bare `emit()` broadcasts to all
/// windows, which would close every open workspace when the user clicks one
/// window's X. Generic over `Emitter` so both the `on_window_event`
/// `&Window` and a test `&WebviewWindow` satisfy it.
pub fn emit_workspace_close_request<R, E>(emitter: &E, label: &str) -> tauri::Result<()>
where
    R: Runtime,
    E: Emitter<R>,
{
    emitter.emit_to(label, "window:close-requested", ())
}

/// 2026-05-16 — safety net for a destroyed workspace window.
///
/// While the workspace label was the single `"workspace"` literal, the
/// `on_window_event` handler in `lib.rs` matched only that literal. Once the
/// per-conn label (`workspace-{conn_id}`) arrived, that match no longer fired,
/// so closing a workspace window left the safety net idle and the launcher
/// stuck hidden — the regression this function closes.
///
/// UX the user asked for (2026-05-16):
/// - "I'd rather the connections window never closed at all" — closing the
///   launcher is forbidden (already locked by `handle_launcher_close_request`).
/// - "when every connection window is gone, focus should gather on the
///   connections window" — once the last workspace is destroyed, show the
///   launcher and set_focus.
///
/// While another workspace (`workspace-` prefix or the legacy `"workspace"`)
/// is alive, the launcher stays off-screen (still hidden) — otherwise it pops
/// up over the workspace the user is working in.
pub fn handle_workspace_destroyed_safety_net<R: Runtime>(
    app: &AppHandle<R>,
    destroyed_label: &str,
) {
    let other_workspace_count = app
        .webview_windows()
        .iter()
        .filter(|(label, _)| {
            label.as_str() != destroyed_label
                && (label.starts_with("workspace-") || label.as_str() == "workspace")
        })
        .count();
    if other_workspace_count > 0 {
        // Another workspace is alive — leave the launcher hidden.
        return;
    }
    let Some(launcher) = app.get_webview_window("launcher") else {
        // Silent no-op: the launcher does not exist in the process at all.
        return;
    };
    if let Err(e) = launcher.show() {
        tracing::warn!(
            target: "launcher",
            "handle_workspace_destroyed_safety_net: launcher.show() failed: {e}"
        );
    }
    if let Err(e) = launcher.set_focus() {
        tracing::warn!(
            target: "launcher",
            "handle_workspace_destroyed_safety_net: launcher.set_focus() failed: {e}"
        );
    }
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

    /// Reason 2026-05-16 — AC-363-04 + AC-363-05.
    ///
    /// The launcher lifecycle from Q13 / strategy line 773: pressing the
    /// launcher's close button does not end the process, it only hides the
    /// launcher. The workspace-{conn} windows must stay alive (the user
    /// clearing away only the launcher in the middle of multi-conn use). This
    /// unit test locks that the `handle_launcher_close_request` helper:
    ///
    ///   - does not destroy the launcher window
    ///   - has zero side effects on the workspace-{conn} windows
    ///   - returns Ok (a failed hide is silently recoverable, unlike a destroy)
    ///
    /// The real `tauri://close-requested` prevent_default + hide branch is
    /// wrapped by `on_window_event` in `lib.rs`.
    fn make_app_with_launcher_and_two_workspaces() -> tauri::App<tauri::test::MockRuntime> {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        tauri::WebviewWindowBuilder::new(
            &app,
            "launcher",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("launcher build");

        tauri::WebviewWindowBuilder::new(
            &app,
            "workspace-conn-1",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("workspace-conn-1 build");

        tauri::WebviewWindowBuilder::new(
            &app,
            "workspace-conn-2",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("workspace-conn-2 build");

        app
    }

    #[test]
    fn ac_363_04_handle_launcher_close_hides_without_destroying() {
        let app = make_app_with_launcher_and_two_workspaces();
        let labels_before: Vec<String> = app.webview_windows().keys().cloned().collect();
        assert_eq!(labels_before.len(), 3, "pre: 3 windows");

        let result = handle_launcher_close_request(app.handle());
        assert!(
            result.is_ok(),
            "handle_launcher_close_request must return Ok, got {:?}",
            result.err()
        );

        // Window count invariant — launcher and both workspaces still alive.
        let labels_after: Vec<String> = app.webview_windows().keys().cloned().collect();
        assert_eq!(
            labels_after.len(),
            3,
            "post: 3 windows unchanged (launcher hidden, NOT destroyed), got {:?}",
            labels_after
        );
        assert!(
            app.get_webview_window("launcher").is_some(),
            "launcher must still exist after close-request (hide, not destroy)"
        );
        assert!(
            app.get_webview_window("workspace-conn-1").is_some(),
            "workspace-conn-1 must be untouched"
        );
        assert!(
            app.get_webview_window("workspace-conn-2").is_some(),
            "workspace-conn-2 must be untouched"
        );
    }

    /// Reason 2026-05-16 — AC-363-04 boundary: even without any workspace
    /// open, the launcher-close helper must still succeed and keep the
    /// launcher addressable so a later dock-icon re-open path (or
    /// `launcher_show`) can resurface it without rebuilding. This is the
    /// "lonely launcher" baseline.
    #[test]
    fn handle_launcher_close_returns_ok_when_only_launcher_exists() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");
        tauri::WebviewWindowBuilder::new(
            &app,
            "launcher",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("launcher build");

        let result = handle_launcher_close_request(app.handle());
        assert!(
            result.is_ok(),
            "handle_launcher_close_request must succeed even without workspaces, got {:?}",
            result.err()
        );
        assert!(
            app.get_webview_window("launcher").is_some(),
            "launcher must remain alive after close-request"
        );
    }

    /// Reason 2026-05-16 — launcher missing edge case.
    /// If a future code path destroys the launcher (today: nothing does
    /// — `app_exit` is the only teardown), the helper still returns
    /// `Ok(())` rather than poisoning the close path. The behaviour
    /// is: the OS-level close prevent_default is moot because there's
    /// no window to prevent on, and the user's app process stays alive
    /// to be revived via the macOS dock-icon-reopen handler.
    #[test]
    fn handle_launcher_close_is_silent_noop_when_launcher_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");
        // No launcher.

        let result = handle_launcher_close_request(app.handle());
        assert!(
            result.is_ok(),
            "missing launcher must not propagate as error (silent no-op), got {:?}",
            result.err()
        );
    }

    /// #1101 — the workspace close-request path must delegate to the
    /// frontend, NOT destroy the window. Before the fix the native close
    /// paths (`win.destroy()`) discarded unsaved changes with no
    /// confirmation. This locks: emitting the close-request signal succeeds
    /// and leaves the workspace window alive so JS can run the discard
    /// guard and decide whether to invoke `workspace_close`.
    #[test]
    fn ac_1101_workspace_close_request_delegates_without_destroying() {
        let app = make_app_with_windows();
        let win = app
            .get_webview_window("workspace")
            .expect("workspace window present");

        let result = emit_workspace_close_request(&win, win.label());
        assert!(
            result.is_ok(),
            "emit_workspace_close_request must succeed, got {:?}",
            result.err()
        );

        assert!(
            app.get_webview_window("workspace").is_some(),
            "workspace window must NOT be destroyed by the close-request \
             emit — the frontend discard guard owns that decision (#1101)"
        );
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
    fn window_by_label_returns_window_error_for_missing_label() {
        let app = make_app_with_windows();
        let result = window_by_label(app.handle(), "ghost-label");
        match result {
            Err(AppError::Window(msg)) => {
                assert!(
                    msg.contains("ghost-label"),
                    "Window message should embed the missing label, got {msg:?}"
                );
            }
            other => panic!("Expected AppError::Window, got {other:?}"),
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

    /// Reason: workspace_ensure must be a noop when the window already exists
    /// (the common case — window was hidden, not destroyed). (2026-04-28)
    #[tokio::test]
    async fn workspace_ensure_is_noop_when_workspace_exists() {
        let app = make_app_with_windows();
        let result = workspace_ensure(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "workspace_ensure should succeed when workspace already exists, got {:?}",
            result.err()
        );
        // Workspace should still be accessible after ensure.
        assert!(
            app.get_webview_window("workspace").is_some(),
            "workspace window should still exist after ensure"
        );
    }

    /// Reason: workspace was removed from tauri.conf.json `app.windows[]` to
    /// skip its WKWebView spawn during boot (saving ~75% of the 1490ms
    /// cold-boot rust:entry → rust:first-ipc segment per the
    /// sub-instrumentation). workspace_ensure must lazy-build the window from
    /// hardcoded defaults regardless of whether the mock config carries a
    /// workspace entry — the earlier NotFound path is gone because the
    /// workspace's runtime shape is owned by `build_workspace_window`, not by
    /// the static config. (2026-04-30)
    #[tokio::test]
    async fn workspace_ensure_lazy_creates_when_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        // No workspace window pre-created; mock config carries no workspace
        // entry. Previously this would error with NotFound.
        assert!(app.get_webview_window("workspace").is_none());

        let result = workspace_ensure(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "workspace_ensure should lazy-build from hardcoded defaults, got {:?}",
            result.err()
        );
        assert!(
            app.get_webview_window("workspace").is_some(),
            "workspace window should exist after lazy ensure"
        );
    }

    /// 2026-05-16 — the per-conn `workspace-{conn_id}` label must also be a
    /// match for the safety net. User report: closing a workspace window left
    /// the launcher hidden instead of surfacing it. This test locks that the
    /// launcher receives show + set_focus once the last workspace is
    /// destroyed.
    #[test]
    fn wave_9_5_safety_net_shows_launcher_after_last_per_conn_workspace_destroyed() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");
        tauri::WebviewWindowBuilder::new(
            &app,
            "launcher",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("launcher build");
        tauri::WebviewWindowBuilder::new(
            &app,
            "workspace-conn-1",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("workspace-conn-1 build");

        let launcher = app.get_webview_window("launcher").expect("launcher exists");
        // Simulate the hidden state explicitly — the `.visible(false)` builder
        // argument is sometimes ignored under MockRuntime, so `.hide()` settles it.
        launcher.hide().expect("hide launcher");
        // Sanity: `webview_windows()` enumerates a hidden launcher too.
        assert!(
            app.get_webview_window("launcher").is_some(),
            "hidden launcher still addressable via get_webview_window"
        );

        handle_workspace_destroyed_safety_net(app.handle(), "workspace-conn-1");

        assert!(
            launcher.is_visible().unwrap_or(false),
            "launcher must be visible after the last per-conn workspace destroyed (회귀 1 잠금)"
        );
    }

    /// 2026-05-16 — the invariant when another workspace is still alive. If
    /// the launcher popped up when a multi-conn user closed only one
    /// workspace, it would rise over the workspace they are working in and get
    /// in the way. So the safety net handles only the last workspace and is a
    /// no-op otherwise.
    #[test]
    fn wave_9_5_safety_net_noop_when_other_workspaces_still_alive() {
        let app = make_app_with_launcher_and_two_workspaces();
        let launcher = app.get_webview_window("launcher").expect("launcher exists");
        // `make_app_with_launcher_and_two_workspaces` does not pin
        // visible(false), and the absence of a launcher call cannot itself show
        // that the helper never ran, so the preserved window count is the only
        // invariant here.
        let labels_before: Vec<String> = app.webview_windows().keys().cloned().collect();
        assert_eq!(labels_before.len(), 3, "pre: launcher + 2 workspaces");

        handle_workspace_destroyed_safety_net(app.handle(), "workspace-conn-1");

        // Another workspace (workspace-conn-2) is alive, so the helper returns
        // early. The launcher is not destroyed and the other workspace is intact.
        assert!(
            app.get_webview_window("launcher").is_some(),
            "launcher remains addressable"
        );
        assert!(
            app.get_webview_window("workspace-conn-2").is_some(),
            "workspace-conn-2 untouched by safety net"
        );
        // Whether the launcher's visible state stayed unchanged is not
        // asserted directly, because MockRuntime cannot show it — the precise
        // lock is the `wave_9_5_*_after_last_per_conn_workspace_destroyed` test
        // above, which checks the visibility change in the last-destroyed case,
        // so this test only checks that nothing was destroyed.
        let _ = launcher;
    }

    /// 2026-05-16 — the edge case where the launcher is not in the process.
    /// The helper is a no-op and does not panic. (Rare — the single-instance
    /// plugin keeps the launcher alive, but it may be briefly destroyed before
    /// a dock-reopen.)
    #[test]
    fn wave_9_5_safety_net_noop_when_launcher_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");
        tauri::WebviewWindowBuilder::new(
            &app,
            "workspace-conn-1",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .build()
        .expect("workspace-conn-1 build");

        assert!(app.get_webview_window("launcher").is_none());

        // Silent, no panic.
        handle_workspace_destroyed_safety_net(app.handle(), "workspace-conn-1");

        // workspace-conn-1 stands in for the destroyed window; the helper
        // touches no other window.
        assert!(app.get_webview_window("workspace-conn-1").is_some());
    }

    /// Reason: macOS native File > New Connection menu (Cmd+N) and the
    /// dock-icon reopen handler both call `launcher_show` after the
    /// launcher window has been destroyed. Pre-2026-05-01 this returned
    /// `NotFound` and silently failed; now it must lazy-build the
    /// launcher from the same hardcoded shape as the static config.
    /// (2026-05-01)
    #[tokio::test]
    async fn launcher_show_lazy_creates_when_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        // No launcher window pre-created (mock_context's noop assets do
        // not declare any). Pre-2026-05-01 this was a NotFound.
        assert!(app.get_webview_window("launcher").is_none());

        let result = launcher_show(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "launcher_show should lazy-build + show, got {:?}",
            result.err()
        );
        assert!(
            app.get_webview_window("launcher").is_some(),
            "launcher window should exist after lazy show"
        );
    }

    /// Reason: workspace_show used to require a pre-built workspace window
    /// (the static config eagerly constructed it at boot). Now the first
    /// workspace_show is the lazy-creation event; verify it both builds and
    /// shows the window in one call so frontend ensure→show retry chains stay
    /// optional. (2026-04-30)
    /// #1437 P2-4 — self-install capability decision core. Non-Linux always
    /// self-updates; Linux only inside an AppImage (APPIMAGE env present). A
    /// deb/rpm install (Linux, no APPIMAGE) must report `false` so the frontend
    /// suppresses the no-op install prompt.
    #[test]
    fn updater_can_self_install_decision_core() {
        use std::ffi::OsString;
        // macOS / Windows: always capable regardless of APPIMAGE.
        assert!(can_self_install_impl(false, None));
        assert!(can_self_install_impl(
            false,
            Some(OsString::from("/x.AppImage"))
        ));
        // Linux AppImage: capable.
        assert!(can_self_install_impl(
            true,
            Some(OsString::from("/tmp/table-view.AppImage"))
        ));
        // Linux deb/rpm: NOT capable — this is the #1437 no-op case.
        assert!(!can_self_install_impl(true, None));
    }

    #[tokio::test]
    async fn workspace_show_lazy_creates_when_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        assert!(app.get_webview_window("workspace").is_none());

        let result = workspace_show(app.handle().clone()).await;
        assert!(
            result.is_ok(),
            "workspace_show should lazy-create + show, got {:?}",
            result.err()
        );
        assert!(
            app.get_webview_window("workspace").is_some(),
            "workspace window should exist after lazy show"
        );
    }
}
