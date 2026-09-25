//! Written 2026-05-16 — verifies the 2nd-launch callback behaviour of the
//! single-instance plugin.
//!
//! Q3: when `tauri-plugin-single-instance` intercepts a second process entry,
//! it unminimizes + shows + focuses the first process's launcher window. It
//! touches no other window (workspace-{conn_id}).
//!
//! A real process spawn happens at the OS level (`UnixListener` on macOS, a
//! named pipe on Windows), so MockRuntime cannot reproduce it. Instead the
//! callback body is split out as `handle_second_instance_inner` and this test
//! calls that inner directly to lock the window side effects. `init` (the
//! plugin) wraps the same inner, which guarantees both paths mean the same
//! thing.
//!
//! MockRuntime's `is_visible()` is a hardcoded `Ok(true)`, and `set_focus()` /
//! `show()` / `hide()` / `unminimize()` are mutate-free no-ops. What can be
//! verified is therefore: (a) whether the inner succeeds or fails, (b) that no
//! new window appears, (c) that the existing window set is preserved.
//!
//! Verification matrix (Acceptance Criteria):
//!   - AC-362-02 the inner returns Ok when the launcher exists (the callback
//!     works).
//!   - AC-362-04 the inner returns Ok even with workspace windows alive at the
//!     same time, with zero change in window count and every label intact —
//!     zero side effects.
//!   - Additionally: when the launcher is missing it fails clearly with a
//!     `Window` error (no silent no-op — the rare state where the
//!     single-instance plugin is running while the launcher has been destroyed
//!     is classified as a regression).

use table_view_lib::commands::single_instance::handle_second_instance_inner;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

/// Build a mock Tauri app with the `launcher` window only. Mirrors the
/// production boot state before any workspace window has been opened.
fn make_app_with_launcher() -> tauri::App<tauri::test::MockRuntime> {
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

    app
}

/// Build a mock Tauri app with `launcher` + two per-conn workspace windows.
/// Mirrors the production state after the user has activated two
/// connections — the callback must NOT touch the workspace windows.
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
    .expect("launcher window build");

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
fn ac_362_02_2nd_launch_callback_succeeds_when_launcher_present() {
    let app = make_app_with_launcher();

    // Pre-condition: launcher exists. MockRuntime's is_visible is hardcoded
    // to true, so the .hide()/.show() side effects aren't observable here —
    // the AC under MockRuntime collapses to "callback runs cleanly when the
    // launcher window is reachable by label". The cold-boot benchmark
    // (AC-362-03) and the live e2e (AC-362-04 real-process) verify the
    // user-visible behavior end-to-end.
    assert!(
        app.get_webview_window("launcher").is_some(),
        "pre-condition: launcher must exist"
    );

    let result = handle_second_instance_inner(app.handle());
    assert!(
        result.is_ok(),
        "handle_second_instance_inner should succeed with launcher present, got {:?}",
        result.err()
    );

    // Post-condition: launcher still resolvable by its label — the
    // callback did not destroy or rename it.
    assert!(
        app.get_webview_window("launcher").is_some(),
        "launcher should still exist after callback"
    );
}

#[test]
fn ac_362_04_callback_preserves_workspace_windows_when_launcher_focused() {
    let app = make_app_with_launcher_and_two_workspaces();

    // Pre-condition: 3 windows exist.
    let labels_before: Vec<String> = app.webview_windows().keys().cloned().collect();
    assert_eq!(
        labels_before.len(),
        3,
        "pre-condition: 3 windows (launcher + 2 workspaces), got {:?}",
        labels_before
    );

    let result = handle_second_instance_inner(app.handle());
    assert!(
        result.is_ok(),
        "callback should succeed when launcher exists, got {:?}",
        result.err()
    );

    // Post-condition: the exact same window set is still alive. The
    // callback must not mint, rename, or destroy any window. Workspace
    // windows are still reachable by their per-conn labels.
    let labels_after: Vec<String> = app.webview_windows().keys().cloned().collect();
    assert_eq!(
        labels_after.len(),
        3,
        "callback must not change window count, got {:?}",
        labels_after
    );
    assert!(
        app.get_webview_window("launcher").is_some(),
        "launcher must still exist"
    );
    assert!(
        app.get_webview_window("workspace-conn-1").is_some(),
        "workspace-conn-1 must still exist"
    );
    assert!(
        app.get_webview_window("workspace-conn-2").is_some(),
        "workspace-conn-2 must still exist"
    );
}

/// Edge case: launcher destroyed (e.g. macOS user closed the launcher
/// window) but the app process kept running. The single-instance plugin
/// is still active in this process. The callback should fail loudly with
/// `AppError::Window` so the failure is logged — silent no-op would mean
/// the 2nd-launch user perceives "nothing happened".
#[test]
fn launcher_missing_returns_window_error() {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app build");
    assert!(
        app.get_webview_window("launcher").is_none(),
        "pre-condition: no launcher"
    );

    // Even with no launcher, build a workspace so we can confirm the
    // callback doesn't accidentally fall back onto it.
    tauri::WebviewWindowBuilder::new(
        &app,
        "workspace-conn-x",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .build()
    .expect("workspace build");

    let result = handle_second_instance_inner(app.handle());
    assert!(
        result.is_err(),
        "callback must error when launcher is missing, got Ok"
    );
}
