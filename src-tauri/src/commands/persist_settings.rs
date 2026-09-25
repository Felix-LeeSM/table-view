//! dual-write → SQLite-only SOT
//!
//! Backend mirror for key-value settings.
//!
//! Q12 — added the `get_setting` IPC. The `state-changed` receiver refreshes
//! its store with a single refetch per key (strategy F.4 line 1388). Since the
//! W3 cut SQLite is the read SOT — read directly from the `settings` table.
//!
//! The W3 cut: `persist_setting` dropped the file (`settings.json`)
//! write branch and became SQLite-only. `get_setting` also reads the SQLite
//! row directly instead of the file.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::events::{emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry};
use crate::storage::reconcile::is_force_failure_for_tests;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistSettingRequest {
    pub key: String,
    /// Raw JSON string (already serialized by the frontend). The value itself
    /// may be any shape — stored as-is in the settings.value_json column.
    pub value_json: String,
}

pub async fn persist_setting_inner(
    pool: &SqlitePool,
    req: PersistSettingRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // The file SOT branch is gone — SQLite is the only SOT.
    // #1092 — a write failure is not swallowed; it propagates to the IPC
    // boundary (there is no fallback copy).
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    write_sqlite_mirror(pool, &req).await
}

/// Regression 7 (2026-05-17) — the cross-window theme/safe_mode broadcast was
/// missing and users reported "the theme is applied per window". `emit_state_changed`
/// had zero call sites — this closed the last piece of the backend-first
/// contract. Always fire the `setting.update` event after the SQLite write.
///
/// `origin_window` is the core discriminator of the frontend dispatcher's
/// self-echo skip (strategy line 1389) — pass the calling window's label
/// as-is. If the emit ran before the SQLite write, the receiver's `get_setting`
/// refetch would see a stale value and an idempotent update would fall through
/// as a nothing-update → keep the ordering invariant.
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

/// Q12 — read a single settings key. Frontend
/// `state-changed` receiver calls this after a `setting:update` event to
/// refetch the canonical value (strategy F.4 line 1388).
///
/// The W3 cut retired the file SOT — read the SQLite `settings` table
/// directly. Returns `Some(value_json)` if the row exists, else `None`.
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

/// Q21 — reset a single settings key to default by
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

    // #1092 — a delete failure propagates as-is (the old counter-only
    // swallowing is gone).
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    sqlx::query("DELETE FROM settings WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

/// Wrapper for `reset_setting` — emits `setting.reset` after the SQLite delete.
/// Strategy doc F.4 line 1306 contract: `op = "reset"`, no refetch (receivers
/// set their frontend default constant). `origin_window` is filled so the
/// frontend dispatcher's self-echo skip works.
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
    //! Written 2026-05-16 — inline lib smoke for the `--lib` coverage gate.
    //! The integration scenarios live in `tests/dual_write_connections.rs`.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use crate::storage::reconcile::{mismatch_counter, set_force_failure_for_tests};
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
        set_force_failure_for_tests(false);
    }

    // Regression (#1092, 2026-07-02) — SQLite write failure must propagate to
    // the IPC boundary instead of being swallowed as `Ok(())`, otherwise the
    // setting silently reverts on next boot while the UI believed it saved.
    #[tokio::test]
    #[serial]
    async fn persist_setting_inner_propagates_sqlite_write_failure() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_force_failure_for_tests(true);
        let result = persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "theme".into(),
                value_json: r#"{"themeId":"x","mode":"dark"}"#.into(),
            },
        )
        .await;
        assert!(
            result.is_err(),
            "SQLite write failure must propagate to the IPC boundary, not be swallowed as Ok"
        );
        cleanup();
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
        // Invariant — the file SOT branch is retired.
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

    // Written 2026-05-16 (Q12) — `get_setting` happy path and missing-key
    // scenarios.
    // The SQLite SOT is the read source — the file is unused.
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

    // ---------------------------------------------------------------------
    // Written 2026-05-17 — baseline cleanup.
    //
    // `reset_setting_inner` is not covered directly in this module because
    // `tests/reset_setting.rs` is a separate binary in the baseline measurement
    // set. Inline locks four scenarios:
    //   - Happy: the existing row is DELETEd.
    //   - Idempotent: resetting an absent key is also Ok (no-op).
    //   - Sibling isolation: other keys are unaffected.
    //   - Guard branch: LegacyImportInProgress when legacy_imported != Done.
    // ---------------------------------------------------------------------

    #[tokio::test]
    #[serial]
    async fn reset_setting_inner_deletes_existing_row() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "theme".into(),
                value_json: r#"{"x":1}"#.into(),
            },
        )
        .await
        .unwrap();
        let pre: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key='theme'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(pre, 1);
        reset_setting_inner(&pool, "theme").await.unwrap();
        let post: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key='theme'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(post, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reset_setting_inner_missing_key_is_idempotent() {
        cleanup();
        let (_dir, pool) = setup().await;
        // No persist — directly reset.
        reset_setting_inner(&pool, "absent").await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reset_setting_inner_preserves_sibling_keys() {
        cleanup();
        let (_dir, pool) = setup().await;
        for key in ["theme", "safe_mode", "history_retention_days"] {
            persist_setting_inner(
                &pool,
                PersistSettingRequest {
                    key: key.into(),
                    value_json: r#""x""#.into(),
                },
            )
            .await
            .unwrap();
        }
        reset_setting_inner(&pool, "theme").await.unwrap();
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, 2);
        let theme_left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key='theme'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(theme_left, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reset_setting_inner_rejects_when_legacy_not_done() {
        cleanup();
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        // setup() above set Done — here we deliberately leave it at Pending.
        let err = reset_setting_inner(&pool, "theme").await.unwrap_err();
        match err {
            AppError::LegacyImportInProgress => {}
            other => panic!("Expected LegacyImportInProgress, got {other:?}"),
        }
        cleanup();
    }
}
