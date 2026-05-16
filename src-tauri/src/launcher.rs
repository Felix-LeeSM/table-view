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

/// Sprint 175 Sprint 2 iteration 2 — build the workspace `WebviewWindow`
/// from hardcoded defaults instead of `tauri.conf.json` `app.windows[]`.
///
/// The workspace was removed from the static config (commit landed alongside
/// this fn) because Tauri eagerly creates EVERY config-declared window at
/// `tauri::Builder::run()`, including those marked `visible: false`. The
/// iteration 1.5 sub-instrumentation showed that `rust:entry → rust:setup-done`
/// runs 1124ms median (75% of the 1490ms cold-boot segment), with both
/// launcher and workspace `page-load:Started` events firing within 0.1ms of
/// each other on every trial — i.e. the workspace WKWebView was being
/// spawned + bundle-loaded at boot in parallel with the launcher even when
/// hidden. Skipping the workspace at boot is the AC-175-02-04 ≥30%
/// shrinkage target picked by data.
///
/// Hardcoded values mirror the previous `tauri.conf.json` entry so the
/// runtime window shape is byte-for-byte identical to Sprint 154's
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
/// instant). Used by Sprint 154's activation flow.
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

/// Show the workspace window. The window is **lazy-built** (Sprint 175
/// Sprint 2 iteration 2): the first call to `workspace_show` constructs the
/// `WebviewWindow` via `build_workspace_window`, subsequent calls hit the
/// already-built window and just `.show()` it. This defers ~700ms of
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

/// Hide the workspace window. Used by Sprint 154's "Back to connections"
/// flow — the connection pool stays alive so re-activation is instant.
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

/// Wave 9.5 회귀 4 (2026-05-16) — destroy the window that invoked the command.
///
/// Tauri injects the caller's `WebviewWindow` automatically when a command
/// signature includes one as a parameter — that handle resolves to the
/// per-conn `workspace-{conn_id}` window (or legacy `workspace`) without the
/// frontend needing to know its own label.
///
/// **Why backend 직접 호출**: JS-side `WebviewWindow.destroy()` 가 환경에
/// 따라 silent no-op 으로 떨어지는 사례가 회귀 보고로 관찰되었다 (Wave 9.5
/// 회귀 4 의 fix 가 frontend `await win.destroy()` 만으로는 실제 window 가
/// 사라지지 않는 사용자 환경). backend 의 `Window::destroy()` 직접 호출은
/// JS↔Rust binding layer 의 모든 quirk 를 우회하며, `tracing::info!` 로
/// 호출 확인이 가능해 silent failure 도 디버그 가능하다.
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
/// (Sprint 175 Sprint 2 iteration 2 — workspace is lazy-built; see
/// `build_workspace_window`) or was destroyed (e.g. OS closed it before the
/// `onCloseRequested` listener was registered), build it now from
/// hardcoded defaults.
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

/// Exit the app cleanly. Used by Sprint 154's launcher-close handler so
/// closing the launcher tears down the whole process (workspace included).
#[tauri::command]
pub async fn app_exit<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    app.exit(0);
    Ok(())
}

/// Sprint 363 (Phase 3, Q13 / strategy line 773) — launcher close-request
/// handler. The launcher window's `tauri://close-requested` event is wired
/// in `lib.rs` `on_window_event` to call this function and `prevent_close()`
/// the event. The strategy doc requires that the launcher's close button
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
/// Workspace windows (`workspace-{conn_id}`) are explicitly NOT touched.
/// Their lifecycle is owned by their own `close-requested` handlers (out
/// of scope for this sprint; tracked separately by the contract's "Out
/// of Scope: Workspace window 의 close 정책").
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

/// Wave 9.5 회귀 1 (2026-05-16) — workspace 윈도우 destroyed safety net.
///
/// sprint-361 이전엔 workspace label 이 `"workspace"` literal 하나뿐이라
/// `lib.rs` 의 `on_window_event` 핸들러도 그 literal 만 매칭했다. sprint-361
/// 의 per-conn label (`workspace-{conn_id}`) 도입 후 그 매칭이 빠져, 사용자가
/// workspace 윈도우를 close 해도 safety net 이 작동하지 않아 launcher 가
/// hide 된 채로 남는 회귀가 발생.
///
/// 사용자 desired UX (2026-05-16):
/// - "connections 창은 아예 안 꺼졌으면 좋겠어" — launcher close 금지 (이미
///   `handle_launcher_close_request` 가 잠금).
/// - "모든 connection 창이 다 꺼지면 connections 창에 포커스가 몰리고" —
///   마지막 workspace 가 destroyed 되면 launcher show + set_focus.
///
/// 다른 workspace (`workspace-` prefix 또는 legacy `"workspace"`) 가
/// 살아있으면 launcher 를 surfaceless 로 유지 (hide 그대로) — 그렇지 않으면
/// 사용자가 작업 중인 workspace 위로 launcher 가 튀어나옴.
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
        // 다른 workspace 살아있음 — launcher 그대로 hide 유지.
        return;
    }
    let Some(launcher) = app.get_webview_window("launcher") else {
        // Silent no-op: launcher 가 process 내 아예 존재하지 않음.
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

    /// Reason 2026-05-16 (Phase 3 sprint-363) — AC-363-04 + AC-363-05.
    ///
    /// Q13 / strategy line 773 의 launcher lifecycle: 사용자가 launcher 의
    /// close 버튼을 눌러도 process 가 종료되지 않고 launcher 만 hide 된다.
    /// workspace-{conn} 윈도우들은 그대로 살아있어야 한다 (multi-conn 사용
    /// 도중에 사용자가 launcher 만 정리하는 경우). 본 unit 테스트는
    /// `handle_launcher_close_request` helper 가:
    ///
    ///   - launcher 윈도우를 destroy 하지 않고
    ///   - workspace-{conn} 윈도우들에 부수효과 0
    ///   - Ok 반환 (hide 자체가 실패해도 destroy 보다는 silent recoverable)
    ///
    /// 임을 잠근다. 실제 `tauri://close-requested` event prevent_default +
    /// hide 분기는 `lib.rs` 의 `on_window_event` 가 wrap 한다.
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

    /// Reason 2026-05-16 (Phase 3 sprint-363) — AC-363-04 boundary: even
    /// without any workspace open, the launcher-close helper must still
    /// succeed and keep the launcher addressable so a later dock-icon
    /// re-open path (or `launcher_show`) can resurface it without
    /// rebuilding. This is the "lonely launcher" baseline.
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

    /// Reason 2026-05-16 (Phase 3 sprint-363) — launcher missing edge case.
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

    /// Reason: Sprint 175 Sprint 2 iteration 2 — workspace was removed from
    /// tauri.conf.json `app.windows[]` to skip its WKWebView spawn during
    /// boot (saving ~75% of the 1490ms cold-boot rust:entry → rust:first-ipc
    /// segment per iteration 1.5 sub-instrumentation). workspace_ensure must
    /// now lazy-build the window from hardcoded defaults regardless of
    /// whether the mock config carries a workspace entry — the
    /// pre-iteration-2 NotFound path is gone because the workspace's
    /// runtime shape is owned by `build_workspace_window`, not by the
    /// static config. (2026-04-30)
    #[tokio::test]
    async fn workspace_ensure_lazy_creates_when_missing() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build");

        // No workspace window pre-created; mock config carries no workspace
        // entry. Pre-iteration-2 this would error with NotFound.
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

    /// Wave 9.5 회귀 1 (2026-05-16) — workspace-{conn_id} per-conn label
    /// 도 safety net 의 매칭 대상이어야 한다. 사용자 보고: workspace 윈도우
    /// close 시 launcher 가 안 뜨고 hide 된 채로 남는 회귀. 본 test 는
    /// 마지막 workspace 가 destroyed 됐을 때 launcher 가 show + set_focus
    /// 호출 받음을 잠근다.
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
        // 명시적으로 hidden 상태 시뮬 — `.visible(false)` 빌더 인자는 MockRuntime
        // 에서 무시되는 경우가 있으므로 `.hide()` 호출로 확정.
        launcher.hide().expect("hide launcher");
        // `webview_windows()` 가 hidden launcher 도 enumerate 한다는 sanity:
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

    /// Wave 9.5 회귀 1 (2026-05-16) — 다른 workspace 가 살아있는 경우의
    /// invariant. 사용자가 multi-conn 환경에서 한 workspace 만 닫았을 때
    /// launcher 가 튀어나오면 작업 중 workspace 위로 올라와 방해된다.
    /// 따라서 safety net 은 마지막 workspace 만 처리하고 그 외엔 noop.
    #[test]
    fn wave_9_5_safety_net_noop_when_other_workspaces_still_alive() {
        let app = make_app_with_launcher_and_two_workspaces();
        let launcher = app.get_webview_window("launcher").expect("launcher exists");
        // make_app_with_launcher_and_two_workspaces 는 visible(false) 안 박지만
        // helper 가 호출되지 않아야 함을 launcher 의 호출 부재로 검증할 수
        // 없으므로 windows 갯수 보존만 invariant 로 둔다.
        let labels_before: Vec<String> = app.webview_windows().keys().cloned().collect();
        assert_eq!(labels_before.len(), 3, "pre: launcher + 2 workspaces");

        handle_workspace_destroyed_safety_net(app.handle(), "workspace-conn-1");

        // 다른 workspace (workspace-conn-2) 가 살아있으므로 helper 는 early
        // return. launcher 의 destroy 안 됨, 다른 workspace 도 그대로.
        assert!(
            app.get_webview_window("launcher").is_some(),
            "launcher remains addressable"
        );
        assert!(
            app.get_webview_window("workspace-conn-2").is_some(),
            "workspace-conn-2 untouched by safety net"
        );
        // launcher 의 visible state 가 변경 안 됐는지는 MockRuntime 한계로
        // 직접 단언하지 않는다 — 정확한 lock 은 위 wave_9_5_*_after_last_
        // per_conn_workspace_destroyed 테스트에서 last-destroyed case 의
        // visibility 변경을 검증하므로, 본 테스트는 destruction 부재만
        // 검증한다.
        let _ = launcher;
    }

    /// Wave 9.5 회귀 1 (2026-05-16) — launcher 가 process 에 없는
    /// edge case. helper 는 panic 없이 noop. (rare — single-instance plugin
    /// 가 launcher 를 유지하지만 dock-reopen 전 잠시 destroyed 됐을 가능성)
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

        // panic 없이 silent.
        handle_workspace_destroyed_safety_net(app.handle(), "workspace-conn-1");

        // workspace-conn-1 은 destroyed 시뮬했지만 helper 가 다른 윈도우 건드리지 않음.
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

    /// Reason: Sprint 175 Sprint 2 iteration 2 — workspace_show used to
    /// require a pre-built workspace window (the static config eagerly
    /// constructed it at boot). After iteration 2, the first workspace_show
    /// is the lazy-creation event; verify it both builds and shows the
    /// window in one call so frontend ensure→show retry chains stay
    /// optional. (2026-04-30)
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
