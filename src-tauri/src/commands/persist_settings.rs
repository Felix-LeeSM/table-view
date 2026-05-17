//! Sprint 358 (Phase 1 W1 dual-write) → Sprint 370 (Phase 4 W3 SQLite SOT)
//!
//! key-value settings 의 backend mirror.
//!
//! Sprint 368 (Phase 4 Q12) — `get_setting` IPC 추가. `state-changed`
//! 수신자가 key 별 단일 refetch 로 store 를 갱신 (strategy F.4 line 1388).
//! Sprint 370 부터 SQLite 가 read SOT — `settings` table 에서 직접 조회.
//!
//! Sprint 370 (Phase 4 W3): `persist_setting` 는 file (`settings.json`)
//! write 분기를 제거하고 SQLite-only. `get_setting` 도 file 대신 SQLite
//! row 를 직접 읽는다.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::events::{emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry};
use crate::storage::reconcile::{is_force_failure_for_tests, record_sqlite_result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime, State};

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

    // Sprint 370 (Phase 4 W3) — file SOT 분기 제거. SQLite-only.
    let sqlite_result = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        write_sqlite_mirror(pool, &req).await
    };
    record_sqlite_result("settings", sqlite_result);

    Ok(())
}

/// Wave 9.5 회귀 7 (2026-05-17) — cross-window 테마/safe_mode broadcast 가
/// 누락되어 사용자가 "테마가 창 단위로 적용된다" 보고. sprint-365 가 만든
/// `emit_state_changed` 를 호출하는 site 가 0개였음 — sprint-368 의
/// backend-first contract 의 마지막 piece. SQLite write 후 항상
/// `setting.update` 이벤트를 발사.
///
/// `origin_window` 은 frontend 의 dispatcher self-echo skip 의 핵심
/// discriminator (sprint-365 line 1389) — 호출 측 window label 을 그대로
/// 전달. emit 이 SQLite write 보다 앞서면 receiver 의 `get_setting` refetch
/// 가 stale 값을 봐서 idempotent 한 update 가 nothing-update 로 떨어진다 →
/// 순서 invariant 유지.
pub async fn persist_setting_with_emit<R: Runtime>(
    pool: &SqlitePool,
    registry: &EventVersionRegistry,
    app: &AppHandle<R>,
    origin_window: Option<String>,
    req: PersistSettingRequest,
) -> Result<(), AppError> {
    let key = req.key.clone();
    persist_setting_inner(pool, req).await?;

    emit_state_changed(
        app,
        registry,
        EmitArgs {
            domain: EventDomain::Setting,
            op: EventOp::Update,
            entity_id: Some(key),
            origin_window,
            snapshot_version: 0,
            field: None,
        },
    )?;
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
pub async fn persist_setting<R: Runtime>(
    req: PersistSettingRequest,
    _state: State<'_, AppState>,
    app: AppHandle<R>,
    registry: State<'_, EventVersionRegistry>,
    window: tauri::Window<R>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let origin = Some(window.label().to_string());
    persist_setting_with_emit(&pool, registry.inner(), &app, origin, req).await
}

/// Sprint 368 (Phase 4 Q12) — read a single settings key. Frontend
/// `state-changed` receiver calls this after a `setting:update` event to
/// refetch the canonical value (strategy F.4 line 1388).
///
/// Sprint 370 (Phase 4 W3) — file SOT 폐기. SQLite 의 `settings` table 을
/// 직접 read. Returns `Some(value_json)` if the row exists, else `None`.
pub async fn get_setting_inner(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value_json FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(v,)| v))
}

#[tauri::command]
pub async fn get_setting(
    key: String,
    _state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    get_setting_inner(&pool, &key).await
}

/// Sprint 376 (Phase 6 Q21) — reset a single settings key to default by
/// removing its row. Strategy doc line 1389: `setting.reset` is the
/// **row-delete** path — receivers MUST NOT refetch (the row is gone);
/// they read their frontend `SETTING_DEFAULTS[entityId]` constant
/// directly. Backend therefore (a) deletes the row, (b) emits
/// `state-changed { domain:"setting", op:"reset", entityId: key }`.
///
/// Idempotent: deleting a non-existent row is a no-op (DELETE returns 0
/// affected rows) but still emits the event so receivers can converge
/// even if they were out of sync (e.g. cached a value backend never
/// stored).
pub async fn reset_setting_inner(pool: &SqlitePool, key: &str) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let sqlite_result: Result<(), AppError> = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(key)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(AppError::from)
    };
    // Mirror sibling persist_setting_inner's reconcile bookkeeping —
    // AppError is not Clone, so re-construct a parallel ok/err signal
    // for the counter without leaking the original error message.
    let counter_signal: Result<(), AppError> = match &sqlite_result {
        Ok(()) => Ok(()),
        Err(_) => Err(AppError::Storage(
            "reset_setting sqlite delete failed".into(),
        )),
    };
    record_sqlite_result("settings", counter_signal);
    sqlite_result
}

/// `reset_setting` 의 wrapper — SQLite delete 후 `setting.reset` emit.
/// Strategy doc F.4 line 1306 contract: `op = "reset"`, refetch
/// 안 함 (receiver 가 frontend default 상수로 set). origin_window 채워
/// frontend dispatcher 의 self-echo skip 가 동작하게 한다.
pub async fn reset_setting_with_emit<R: Runtime>(
    pool: &SqlitePool,
    registry: &EventVersionRegistry,
    app: &AppHandle<R>,
    origin_window: Option<String>,
    key: String,
) -> Result<(), AppError> {
    reset_setting_inner(pool, &key).await?;
    emit_state_changed(
        app,
        registry,
        EmitArgs {
            domain: EventDomain::Setting,
            op: EventOp::Reset,
            entity_id: Some(key),
            origin_window,
            snapshot_version: 0,
            field: None,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn reset_setting<R: Runtime>(
    key: String,
    _state: State<'_, AppState>,
    app: AppHandle<R>,
    registry: State<'_, EventVersionRegistry>,
    window: tauri::Window<R>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let origin = Some(window.label().to_string());
    reset_setting_with_emit(&pool, registry.inner(), &app, origin, key).await
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
    async fn happy_path_writes_one_key_to_sqlite_only() {
        cleanup();
        let (dir, pool) = setup().await;
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
        // Sprint 370 invariant — file SOT 분기 retired.
        assert!(
            !dir.path().join("settings.json").exists(),
            "settings.json must not exist after W3 cut"
        );
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
    // path + missing-key 시나리오.
    // Sprint 370 (Phase 4 W3) — SQLite SOT 가 read source. file 미사용.
    #[tokio::test]
    #[serial]
    async fn get_setting_returns_none_for_missing_key() {
        cleanup();
        let (_dir, pool) = setup().await;
        let value = get_setting_inner(&pool, "theme").await.unwrap();
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
        let value = get_setting_inner(&pool, "theme").await.unwrap();
        assert_eq!(
            value.as_deref(),
            Some(r#"{"themeId":"github","mode":"dark"}"#)
        );
        cleanup();
    }
}
