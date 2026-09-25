//! Verifies the per-conn label + idempotent contract of the
//! `open_workspace_window` IPC.
//!
//! Q13: one workspace window per connection — calling `open_workspace_window`
//! twice creates no second window; the existing `workspace-{connection_id}`
//! window only takes focus. Different connections stay independent — N can
//! exist at once.
//!
//! Verification matrix (Acceptance Criteria):
//!   - AC-361-01 first call → 1 window with label `workspace-conn-1`.
//!   - AC-361-02 second call for the same conn → 0 new windows (idempotent).
//!   - AC-361-03 different conns → 2 windows (`workspace-conn-1`,
//!     `workspace-conn-2`) coexist.
//!   - Extra: the launcher window label `"launcher"` is left untouched
//!     (Invariant).
//!
//! Tauri's `MockRuntime` opens no OS window, so this is safe on headless CI
//! too. Living under `tests/` also locks that the IPC signature registered
//! through `invoke_handler` (`open_workspace_window(connection_id: String)`)
//! is exposed as module public.

use table_view_lib::commands::open_workspace_window::open_workspace_window_inner;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

/// Build a barebones mock Tauri app — no pre-created windows. The
/// `open_workspace_window_inner` function (the testable seam under the
/// `#[tauri::command]` wrapper) is expected to lazy-build the window on
/// first call.
fn make_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app build")
}

#[tokio::test]
async fn ac_361_01_first_call_creates_window_with_per_conn_label() {
    let app = make_app();

    // Pre-condition: no workspace window exists.
    assert!(
        app.get_webview_window("workspace-conn-1").is_none(),
        "pre-condition: workspace-conn-1 should not exist"
    );

    let result = open_workspace_window_inner(app.handle().clone(), "conn-1".into()).await;
    assert!(
        result.is_ok(),
        "open_workspace_window_inner should succeed, got {:?}",
        result.err()
    );

    // Post-condition: exactly one workspace window with the per-conn label.
    assert!(
        app.get_webview_window("workspace-conn-1").is_some(),
        "workspace-conn-1 window should exist after first open"
    );
}

#[tokio::test]
async fn ac_361_02_same_conn_second_call_is_idempotent() {
    let app = make_app();

    // First call — creates the window.
    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("first open should succeed");
    let initial_count = app.webview_windows().len();
    assert_eq!(
        initial_count, 1,
        "exactly 1 window after first open, got {}",
        initial_count
    );

    // Second call with the SAME conn_id — must NOT spawn another window.
    let result = open_workspace_window_inner(app.handle().clone(), "conn-1".into()).await;
    assert!(
        result.is_ok(),
        "idempotent second call should succeed, got {:?}",
        result.err()
    );
    let after_count = app.webview_windows().len();
    assert_eq!(
        after_count, initial_count,
        "second open of same conn must NOT add a window (got {} → {})",
        initial_count, after_count
    );

    // The existing window is still accessible by its per-conn label.
    assert!(
        app.get_webview_window("workspace-conn-1").is_some(),
        "workspace-conn-1 should still exist after idempotent re-open"
    );
}

#[tokio::test]
async fn ac_361_03_two_different_conns_yield_two_distinct_windows() {
    let app = make_app();

    open_workspace_window_inner(app.handle().clone(), "conn-1".into())
        .await
        .expect("conn-1 open should succeed");
    open_workspace_window_inner(app.handle().clone(), "conn-2".into())
        .await
        .expect("conn-2 open should succeed");

    assert!(
        app.get_webview_window("workspace-conn-1").is_some(),
        "workspace-conn-1 should exist"
    );
    assert!(
        app.get_webview_window("workspace-conn-2").is_some(),
        "workspace-conn-2 should exist"
    );
    assert_eq!(
        app.webview_windows().len(),
        2,
        "exactly 2 distinct workspace windows for 2 distinct conns"
    );
}

/// Invariant guard — launcher label not touched by the per-conn migration.
/// The `"launcher"` label belongs to the launcher window, not any workspace
/// window. `open_workspace_window("launcher")` would mint the label
/// `"workspace-launcher"`, NOT collide with the launcher.
#[tokio::test]
async fn invariant_launcher_label_unchanged_by_workspace_open() {
    let app = make_app();

    open_workspace_window_inner(app.handle().clone(), "launcher".into())
        .await
        .expect("conn-id='launcher' (degenerate) open should still succeed");

    // The minted label is `workspace-launcher`, not `launcher`.
    assert!(
        app.get_webview_window("workspace-launcher").is_some(),
        "workspace-launcher window should exist for conn_id='launcher'"
    );
    assert!(
        app.get_webview_window("launcher").is_none(),
        "the bare 'launcher' label must NOT be claimed by open_workspace_window"
    );
}

/// Reason: an empty connection_id can only come from a frontend caller that
/// invoked this wrongly — rejecting it in backend validation right away
/// blocks the regression where a window with a malformed label (a bare
/// `workspace-`) gets created.
#[tokio::test]
async fn empty_connection_id_rejected_with_validation_error() {
    let app = make_app();

    let result = open_workspace_window_inner(app.handle().clone(), String::new()).await;
    assert!(
        result.is_err(),
        "empty connection_id must be rejected, got Ok"
    );
    assert!(
        app.webview_windows().is_empty(),
        "no window must be created for an empty connection_id"
    );
}
