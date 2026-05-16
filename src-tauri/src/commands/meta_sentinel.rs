//! Sprint 369 (Phase 4) — `meta` 키-밸류 sentinel IPC.
//!
//! `meta` 테이블은 `legacy_imported` / `last_legacy_import_at` 같은 boot-state
//! 외에 본 sprint 의 `legacy_column_prefs_drop_dismissed` 처럼 frontend 가 한
//! 번만 처리하는 toast / migration sentinel 도 보관한다. settings 의 "known
//! key" 와는 별도 — Q21 reset-audit 대상이 아니라 단순한 한 번 boolean.
//!
//! 노출 함수:
//!   - `get_meta_sentinel(key)` — 부재 시 `None`.
//!   - `set_meta_sentinel(key, value)` — INSERT OR REPLACE.
//!
//! Sentinel 은 frontend 가 toast 를 띄운 직후 set 한다. read 는 guard 없이
//! (boot 시점에 호출되어야 하므로). write 는 frontend 가 표시 후 best-effort
//! 호출이라 guard 적용 (다른 mutate IPC 와 동일 정책).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMetaSentinelRequest {
    pub key: String,
    pub value: String,
}

pub async fn get_meta_sentinel_inner(
    pool: &SqlitePool,
    key: &str,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM meta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(v,)| v))
}

pub async fn set_meta_sentinel_inner(
    pool: &SqlitePool,
    req: SetMetaSentinelRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;
    sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)")
        .bind(&req.key)
        .bind(&req.value)
        .execute(pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_meta_sentinel(
    key: String,
    _state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    get_meta_sentinel_inner(&pool, &key).await
}

#[tauri::command]
pub async fn set_meta_sentinel(
    req: SetMetaSentinelRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    set_meta_sentinel_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 4 sprint-369) — sentinel round-trip + guard 검증.

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
    async fn get_missing_sentinel_returns_none() {
        cleanup();
        let (_dir, pool) = setup().await;
        let v = get_meta_sentinel_inner(&pool, "absent").await.unwrap();
        assert_eq!(v, None);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn set_then_get_round_trips() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_meta_sentinel_inner(
            &pool,
            SetMetaSentinelRequest {
                key: "legacy_column_prefs_drop_dismissed".into(),
                value: "1".into(),
            },
        )
        .await
        .unwrap();
        let v = get_meta_sentinel_inner(&pool, "legacy_column_prefs_drop_dismissed")
            .await
            .unwrap();
        assert_eq!(v, Some("1".into()));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn set_replaces_existing_value() {
        cleanup();
        let (_dir, pool) = setup().await;
        for v in ["a", "b", "c"] {
            set_meta_sentinel_inner(
                &pool,
                SetMetaSentinelRequest {
                    key: "k".into(),
                    value: v.into(),
                },
            )
            .await
            .unwrap();
        }
        let v = get_meta_sentinel_inner(&pool, "k").await.unwrap();
        assert_eq!(v, Some("c".into()));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn set_rejects_when_legacy_import_not_done() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Pending)
            .await
            .unwrap();
        let err = set_meta_sentinel_inner(
            &pool,
            SetMetaSentinelRequest {
                key: "k".into(),
                value: "v".into(),
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }
}
