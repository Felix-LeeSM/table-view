//! Sprint 358 (Phase 1 W1 dual-write) — `persist_setting` IPC.
//!
//! key-value settings 의 backend mirror. file SOT (settings.json) + SQLite
//! mirror. 6 known keys (`theme`, `safe_mode`, `home_recent_collapsed`,
//! `sidebar_width`, `query_history_retention_days`, `query_history_enabled`)
//! 외에도 임의 key/JSON value 를 받아 dual-write — Phase 1 시점에서는
//! validation 을 strategic 하게 frontend 에 위임.
//!
//! Sprint 368 (Phase 4 Q12) — `get_setting` IPC 추가. `state-changed`
//! 수신자가 key 별 단일 refetch 로 store 를 갱신 (strategy F.4 line 1388).
//! file SOT 가 진실 — `settings.json` 의 key 가 있으면 value_json 그대로
//! 반환, 없으면 `None` 반환 (frontend 에서 default 적용).

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

/// Sprint 368 (Phase 4 Q12) — read a single settings key. Frontend
/// `state-changed` receiver calls this after a `setting:update` event to
/// refetch the canonical value (strategy F.4 line 1388).
///
/// Returns `Some(value_json)` if the key exists in `settings.json`, else
/// `None`. The frontend applies a per-key default constant when `None`.
pub fn get_setting_inner(key: &str) -> Result<Option<String>, AppError> {
    let map = load_settings_file()?;
    Ok(map.get(key).cloned())
}

#[tauri::command]
pub async fn get_setting(
    key: String,
    _state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    get_setting_inner(&key)
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

    // 작성 2026-05-16 (Phase 4 sprint-368) — `get_setting` 의 happy
    // path + missing-key 시나리오. 통합 round-trip 은
    // `tests/dual_write_*` 가 담당.
    #[tokio::test]
    #[serial]
    async fn get_setting_returns_none_for_missing_key() {
        cleanup();
        let (_dir, _pool) = setup().await;
        let value = get_setting_inner("theme").unwrap();
        assert_eq!(value, None);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn get_setting_returns_value_after_persist() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "theme".into(),
                value_json: r#"{"themeId":"github","mode":"dark"}"#.into(),
            },
        )
        .await
        .unwrap();
        let value = get_setting_inner("theme").unwrap();
        assert_eq!(
            value.as_deref(),
            Some(r#"{"themeId":"github","mode":"dark"}"#)
        );
        cleanup();
    }
}
