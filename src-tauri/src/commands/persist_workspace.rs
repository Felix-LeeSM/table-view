//! Sprint 358 (Phase 1 W1 dual-write) — `persist_workspace` IPC.
//!
//! **SQLite-only** (codex 6차 #5). 다른 4 도메인 (connections/favorites/mru/
//! settings) 와 달리 workspaces 는 file/LS write 사이트 0. boot 시점의 atomic
//! snapshot 은 SQLite 의 BEGIN IMMEDIATE 로만 일관성 보장 가능.
//!
//! 호출 flow:
//!   1. guard_legacy_import_done — pending/importing/failed reject.
//!   2. SQLite UPSERT — (connection_id, db_name) PK 충돌 시 update in place.
//!      reconcile / mismatch counter 와 무관 (file SOT 가 없으므로).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistWorkspaceRequest {
    pub connection_id: String,
    pub db_name: String,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    pub tabs_json: String,
    pub sidebar_expanded_json: String,
    pub closed_tabs_json: String,
}

pub async fn persist_workspace_inner(
    pool: &SqlitePool,
    req: PersistWorkspaceRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    sqlx::query(
        "INSERT INTO workspaces \
         (connection_id, db_name, active_tab_id, tabs_json, sidebar_expanded_json, \
         closed_tabs_json, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(connection_id, db_name) DO UPDATE SET \
            active_tab_id = excluded.active_tab_id, \
            tabs_json = excluded.tabs_json, \
            sidebar_expanded_json = excluded.sidebar_expanded_json, \
            closed_tabs_json = excluded.closed_tabs_json, \
            updated_at = excluded.updated_at",
    )
    .bind(&req.connection_id)
    .bind(&req.db_name)
    .bind(&req.active_tab_id)
    .bind(&req.tabs_json)
    .bind(&req.sidebar_expanded_json)
    .bind(&req.closed_tabs_json)
    .bind(now_ms)
    .execute(pool)
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn persist_workspace(
    req: PersistWorkspaceRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_workspace_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-358) — inline lib smoke for `--lib`
    //! coverage gate. 통합 시나리오는 `tests/workspace_sqlite_only.rs`.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, sqlx::SqlitePool) {
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

    #[tokio::test]
    #[serial]
    async fn happy_path_persists_one_workspace_row() {
        let (_dir, pool) = setup().await;
        persist_workspace_inner(
            &pool,
            PersistWorkspaceRequest {
                connection_id: "c-w".into(),
                db_name: "db".into(),
                active_tab_id: None,
                tabs_json: "[]".into(),
                sidebar_expanded_json: "[]".into(),
                closed_tabs_json: "[]".into(),
            },
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        cleanup();
    }
}
