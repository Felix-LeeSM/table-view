//! 작성 2026-05-16 (Phase 1 sprint-358) — workspace 도메인은 W1 시작 시점부터
//! SQLite-only. LS write 0 (codex 6차 #5). 본 테스트는 backend persist_workspace
//! IPC 의 (1) guard 통과 후 SQLite UPDATE, (2) LS-equivalent file write 0,
//! (3) row 의 PK (connection_id, db_name) 충돌 시 UPSERT 동작 검증.
//!
//! AC mapping:
//!   - AC-358-05 workspaces SQLite-only (file/LS write 0)
//!   - AC-358-08 guard 4-state (workspace persist 도 동일 guard)

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::persist_workspace::{
    persist_workspace_inner, PersistWorkspaceRequest,
};
use table_view_lib::error::AppError;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    set_legacy_import_state(&pool, LegacyImportState::Done)
        .await
        .unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

fn sample_workspace_req(conn_id: &str, db: &str) -> PersistWorkspaceRequest {
    PersistWorkspaceRequest {
        connection_id: conn_id.into(),
        db_name: db.into(),
        active_tab_id: Some("tab-1".into()),
        tabs_json: r#"[{"id":"tab-1","type":"query"}]"#.into(),
        sidebar_expanded_json: r#"["schema.public"]"#.into(),
        closed_tabs_json: "[]".into(),
    }
}

// AC-358-05: persist_workspace writes only to SQLite; never to LS file.
#[tokio::test]
#[serial]
async fn ac_358_05_persist_workspace_writes_only_to_sqlite() {
    let (dir, pool) = setup().await;

    persist_workspace_inner(&pool, sample_workspace_req("conn-W", "db1"))
        .await
        .unwrap();

    // SQLite row 1 — UPSERT 결과.
    let row: (String, String, Option<String>, String) = sqlx::query_as(
        "SELECT connection_id, db_name, active_tab_id, tabs_json FROM workspaces \
         WHERE connection_id = ? AND db_name = ?",
    )
    .bind("conn-W")
    .bind("db1")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "conn-W");
    assert_eq!(row.1, "db1");
    assert_eq!(row.2.as_deref(), Some("tab-1"));
    assert!(row.3.contains("tab-1"));

    // 어떤 file 도 workspace JSON 을 wirte 하지 않아야 함.
    let workspaces_json = dir.path().join("workspaces.json");
    assert!(
        !workspaces_json.exists(),
        "workspaces.json file write was supposed to be removed (codex 6차 #5)"
    );

    cleanup();
}

#[tokio::test]
#[serial]
async fn ac_358_05_persist_workspace_upserts_in_place_on_pk_conflict() {
    let (_dir, pool) = setup().await;

    persist_workspace_inner(&pool, sample_workspace_req("conn-W", "db1"))
        .await
        .unwrap();
    let mut second = sample_workspace_req("conn-W", "db1");
    second.active_tab_id = Some("tab-2".into());
    second.tabs_json = r#"[{"id":"tab-2","type":"query"}]"#.into();
    persist_workspace_inner(&pool, second).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1, "UPSERT must keep one row on PK conflict");

    let row: (Option<String>, String) =
        sqlx::query_as("SELECT active_tab_id, tabs_json FROM workspaces")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0.as_deref(), Some("tab-2"));
    assert!(row.1.contains("tab-2"));

    cleanup();
}

// AC-358-08: workspace persist 도 같은 guard. pending → reject.
#[tokio::test]
#[serial]
async fn ac_358_08_persist_workspace_rejects_when_legacy_import_pending() {
    let (_dir, pool) = setup().await;
    set_legacy_import_state(&pool, LegacyImportState::Pending)
        .await
        .unwrap();

    let err = persist_workspace_inner(&pool, sample_workspace_req("conn-W", "db1"))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::LegacyImportInProgress));

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    cleanup();
}
