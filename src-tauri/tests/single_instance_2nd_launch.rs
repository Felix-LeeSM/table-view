//! 작성 2026-05-16 (Phase 3 sprint-362) — single-instance plugin 의
//! 2nd-launch callback 행동 검증.
//!
//! sprint-362 (Q3): `tauri-plugin-single-instance` 가 2번째 process 진입을
//! 가로채면 첫 process 의 launcher 윈도우를 unminimize + show + set_focus
//! 한다. 다른 윈도우 (workspace-{conn_id}) 는 건드리지 않는다.
//!
//! 실제 process spawn 은 OS 레벨이므로 (`UnixListener` macOS, named pipe
//! Windows) MockRuntime 으로는 재현 불가. 대신 callback 본체를
//! `handle_second_instance_inner` 로 분리하고 본 테스트가 그 inner 를
//! 직접 호출하여 윈도우 부수효과를 잠근다. `init` (plugin) 은 동일한
//! inner 를 wrap 하므로 두 경로의 의미가 동일함을 보장.
//!
//! MockRuntime 의 `is_visible()` 은 hardcoded `Ok(true)`, `set_focus()` /
//! `show()` / `hide()` / `unminimize()` 도 mutate-free no-op 이다. 따라서
//! 검증 가능한 것은: (a) inner 가 성공/실패하는지, (b) 새 윈도우가
//! 생기지 않는지, (c) 기존 윈도우 set 이 보존되는지.
//!
//! 검증 매트릭스 (Acceptance Criteria):
//!   - AC-362-02 launcher 존재 시 inner 가 Ok 반환 (callback 정상 동작).
//!   - AC-362-04 workspace 윈도우들이 동시에 존재해도 inner 가 Ok 반환 +
//!     윈도우 count 변동 0 + 모든 라벨 그대로 — 부수효과 0.
//!   - 추가: launcher 가 없을 때 `Window` 에러로 명확히 실패 (silent no-op
//!     금지 — single-instance 플러그인이 작동 중인데 launcher 가 destroy 된
//!     희귀 상태는 회귀로 분류).

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
