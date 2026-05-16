//! 작성 2026-05-16 (Phase 3 sprint-361) — `open_workspace_window` IPC 의
//! per-conn 라벨 + idempotent 계약 검증.
//!
//! sprint-361 (Q13): 워크스페이스 윈도우는 connection 당 1개 — `open_workspace_window`
//! 가 두 번 호출돼도 새 윈도우는 생기지 않고 기존 `workspace-{connection_id}` 윈도우
//! 가 focus 만 받는다. 서로 다른 connection 끼리는 독립 — 동시에 N개 가능.
//!
//! 검증 매트릭스 (Acceptance Criteria):
//!   - AC-361-01 첫 호출 → label `workspace-conn-1` 윈도우 1개 생성.
//!   - AC-361-02 같은 conn 두 번째 호출 → 새 윈도우 0개 (idempotent).
//!   - AC-361-03 서로 다른 conn → 윈도우 2개 (`workspace-conn-1`, `workspace-conn-2`)
//!     동시 존재.
//!   - 추가: launcher 윈도우 label `"launcher"` 변경 0 (Invariant).
//!
//! Tauri 의 `MockRuntime` 은 OS 윈도우를 띄우지 않으므로 CI / pre-push 에서도
//! 안전. `tests/` 경로에 둠으로써 `lib.rs` 의 `invoke_handler` 가 등록한 IPC
//! 시그니처 (Sprint contract: `open_workspace_window(connection_id: String)`)
//! 가 모듈 public 으로 노출돼 있는지도 함께 잠금.

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

/// 사유: connection_id 빈 문자열은 frontend caller 가 잘못 호출했을 때만 발생
/// 가능 — backend 가 validation 으로 즉시 거부하면 잘못된 label 윈도우
/// (`workspace-` 단독) 가 생기는 회귀를 막을 수 있다.
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
