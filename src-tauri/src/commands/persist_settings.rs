//! Sprint 358 (Phase 1 W1 dual-write) — `persist_setting` IPC.
//!
//! key-value settings 의 backend mirror. file SOT (settings.json) + SQLite
//! mirror. 6 known keys (`theme`, `safe_mode`, `home_recent_collapsed`,
//! `sidebar_width`, `query_history_retention_days`, `query_history_enabled`)
//! 외에도 임의 key/JSON value 를 받아 dual-write — Phase 1 시점에서는
//! validation 을 strategic 하게 frontend 에 위임.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::storage::local_files::{load_settings_file, save_settings_file};
use crate::storage::reconcile::{is_force_failure_for_tests, record_sqlite_result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistSettingRequest {
    pub key: String,
    /// Raw JSON string (already serialized by frontend). value 자체는 어떤
    /// shape 이든 OK — settings.value_json 컬럼이 그대로 저장.
    pub value_json: String,
}

pub async fn persist_setting_inner(
    pool: &SqlitePool,
    req: PersistSettingRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // file SOT — merge into the existing map.
    let mut current = load_settings_file()?;
    current.insert(req.key.clone(), req.value_json.clone());
    save_settings_file(&current)?;

    let sqlite_result = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        write_sqlite_mirror(pool, &req).await
    };
    record_sqlite_result("settings", sqlite_result);

    Ok(())
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    req: &PersistSettingRequest,
) -> Result<(), AppError> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    sqlx::query(
        "INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, \
            updated_at = excluded.updated_at",
    )
    .bind(&req.key)
    .bind(&req.value_json)
    .bind(now_ms)
    .execute(pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn persist_setting(
    req: PersistSettingRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_setting_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-358) — inline lib smoke for `--lib`
    //! coverage gate. 통합 시나리오는 `tests/dual_write_connections.rs`.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use crate::storage::reconcile::mismatch_counter;
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
        mismatch_counter::reset();
    }

    #[tokio::test]
    #[serial]
    async fn happy_path_writes_one_key_to_file_and_sqlite() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "theme".into(),
                value_json: r#"{"themeId":"x","mode":"dark"}"#.into(),
            },
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn second_setting_call_for_same_key_overwrites() {
        cleanup();
        let (_dir, pool) = setup().await;
        for value in ["\"a\"", "\"b\"", "\"c\""] {
            persist_setting_inner(
                &pool,
                PersistSettingRequest {
                    key: "k".into(),
                    value_json: value.into(),
                },
            )
            .await
            .unwrap();
        }
        let value: String = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = 'k'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(value, "\"c\"");
        cleanup();
    }
}
