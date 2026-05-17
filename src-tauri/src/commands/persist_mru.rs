//! Sprint 358 (Phase 1 W1 dual-write) → Sprint 370 (Phase 4 W3 SQLite SOT).
//!
//! `mruStore.markConnectionUsed` / `removeRecentConnection` 가 호출하는
//! backend mirror. W3 cut 이후 file (`mru.json`) 분기는 제거되고 SQLite-only.

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
pub struct PersistMruRequest {
    pub connection_id: String,
    pub last_used: i64,
}

pub async fn persist_mru_inner(
    pool: &SqlitePool,
    entries: Vec<PersistMruRequest>,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // Sprint 370 (Phase 4 W3) — file SOT 분기 제거. SQLite-only.
    let sqlite_result = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        write_sqlite_mirror(pool, &entries).await
    };
    record_sqlite_result("mru", sqlite_result);

    Ok(())
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    entries: &[PersistMruRequest],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for e in entries {
        sqlx::query("INSERT OR REPLACE INTO mru(connection_id, last_used) VALUES (?, ?)")
            .bind(&e.connection_id)
            .bind(e.last_used)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn persist_mru(
    entries: Vec<PersistMruRequest>,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_mru_inner(&pool, entries).await
}

/// Sprint 376 (Phase 6 Q21 #8) — "Clear recent" affordance on Home /
/// launcher. Deletes every `mru` row + emits `state-changed
/// { domain:"mru", op:"bulk", entityId:null }` so every window's
/// `RecentConnections` panel converges to empty without re-fetching the
/// table.
///
/// `Bulk` op is the contract for `mru` domain (strategy doc F.4 line
/// 1305-1306 + frontend dispatcher `routeNormalHandler` `case "mru"`
/// which only knows `bulk`).
pub async fn clear_mru_inner(pool: &SqlitePool) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let sqlite_result: Result<(), AppError> = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        sqlx::query("DELETE FROM mru")
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(AppError::from)
    };
    let counter_signal: Result<(), AppError> = match &sqlite_result {
        Ok(()) => Ok(()),
        Err(_) => Err(AppError::Storage("clear_mru sqlite delete failed".into())),
    };
    record_sqlite_result("mru", counter_signal);
    sqlite_result
}

pub async fn clear_mru_with_emit<R: Runtime>(
    pool: &SqlitePool,
    registry: &EventVersionRegistry,
    app: &AppHandle<R>,
    origin_window: Option<String>,
) -> Result<(), AppError> {
    clear_mru_inner(pool).await?;
    emit_state_changed(
        app,
        registry,
        EmitArgs {
            domain: EventDomain::Mru,
            op: EventOp::Bulk,
            entity_id: None,
            origin_window,
            snapshot_version: 0,
            field: None,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn clear_mru<R: Runtime>(
    _state: State<'_, AppState>,
    app: AppHandle<R>,
    registry: State<'_, EventVersionRegistry>,
    window: tauri::Window<R>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let origin = Some(window.label().to_string());
    clear_mru_with_emit(&pool, registry.inner(), &app, origin).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 1 sprint-358) — inline lib smoke for `--lib`
    //! coverage gate. 통합 시나리오는 `tests/dual_write_connections.rs` /
    //! `tests/dual_write_reconcile.rs`.

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
    async fn happy_path_writes_sqlite_only() {
        cleanup();
        let (dir, pool) = setup().await;
        persist_mru_inner(
            &pool,
            vec![PersistMruRequest {
                connection_id: "c1".into(),
                last_used: 42,
            }],
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        // Sprint 370 invariant — file SOT 분기 retired.
        assert!(
            !dir.path().join("mru.json").exists(),
            "mru.json must not exist after W3 cut"
        );
        cleanup();
    }
}
