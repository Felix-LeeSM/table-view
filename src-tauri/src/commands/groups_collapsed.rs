//! Sprint 369 (Phase 4, Q20.3) — `set_group_collapsed` IPC.
//!
//! Strategy doc Q20.3: 기존 `table-view-group-collapsed` LS map → SQLite
//! `connection_groups.collapsed` boolean. Cross-window 일관성 (group 의 collapse
//! 가 한 window 에서 바뀌면 다른 window 의 sidebar 도 자동 반영) 을 위해 LS 대신
//! SQLite SOT.
//!
//! 본 IPC 는 file/LS dual-write 가 아닌 **SQLite-only UPDATE** 다. file 의
//! `ConnectionGroup.collapsed` 는 기존 save_group 흐름에서 placeholder 로 남아
//! 있고, 본 sprint 이후 권위는 SQLite. (legacy LS map 은 frontend boot
//! migration 단계에서 drop.)
//!
//! Flow:
//!   1. guard_legacy_import_done — A/C mutate IPC 의 표준.
//!   2. SQLite UPDATE connection_groups SET collapsed = ? WHERE id = ?
//!   3. row 가 없으면 NotFound — group 자체가 SQLite 에 등록되지 않은 상태에서
//!      collapse 만 들어오면 race; 호출자가 group create 후 retry.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetGroupCollapsedRequest {
    pub group_id: String,
    pub collapsed: bool,
}

pub async fn set_group_collapsed_inner(
    pool: &SqlitePool,
    req: SetGroupCollapsedRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let collapsed_int: i64 = if req.collapsed { 1 } else { 0 };

    let result = sqlx::query(
        "UPDATE connection_groups \
         SET collapsed = ?, updated_at = ? \
         WHERE id = ?",
    )
    .bind(collapsed_int)
    .bind(now_ms)
    .bind(&req.group_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "Group '{}' not found",
            req.group_id
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_group_collapsed(
    req: SetGroupCollapsedRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    set_group_collapsed_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 4 sprint-369) — inline smoke. 통합 시나리오는
    //! `tests/groups_collapsed.rs`.

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

    async fn seed_group(pool: &sqlx::SqlitePool, id: &str, collapsed: bool) {
        let now_ms: i64 = 1_700_000_000_000;
        sqlx::query(
            "INSERT INTO connection_groups(id, name, color, collapsed, sort_order, created_at, updated_at) \
             VALUES (?, 'g', NULL, ?, 0, ?, ?)",
        )
        .bind(id)
        .bind(if collapsed { 1i64 } else { 0i64 })
        .bind(now_ms)
        .bind(now_ms)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn happy_path_flips_collapsed_true_then_false() {
        cleanup();
        let (_dir, pool) = setup().await;
        seed_group(&pool, "g-1", false).await;

        set_group_collapsed_inner(
            &pool,
            SetGroupCollapsedRequest {
                group_id: "g-1".into(),
                collapsed: true,
            },
        )
        .await
        .unwrap();
        let v: i64 = sqlx::query_scalar("SELECT collapsed FROM connection_groups WHERE id = 'g-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(v, 1);

        set_group_collapsed_inner(
            &pool,
            SetGroupCollapsedRequest {
                group_id: "g-1".into(),
                collapsed: false,
            },
        )
        .await
        .unwrap();
        let v: i64 = sqlx::query_scalar("SELECT collapsed FROM connection_groups WHERE id = 'g-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(v, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn unknown_group_returns_not_found() {
        cleanup();
        let (_dir, pool) = setup().await;
        let err = set_group_collapsed_inner(
            &pool,
            SetGroupCollapsedRequest {
                group_id: "g-missing".into(),
                collapsed: true,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn rejects_when_legacy_import_not_done() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Pending)
            .await
            .unwrap();
        let err = set_group_collapsed_inner(
            &pool,
            SetGroupCollapsedRequest {
                group_id: "any".into(),
                collapsed: true,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }
}
