//! Sprint 358 (Phase 1 W1 dual-write) → Sprint 370 (Phase 4 W3 SQLite SOT).
//!
//! `mruStore.markConnectionUsed` / `removeRecentConnection` 가 호출하는
//! backend mirror. W3 cut 이후 file (`mru.json`) 분기는 제거되고 SQLite-only.

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
pub struct PersistMruRequest {
    pub connection_id: String,
    pub last_used: i64,
}

pub async fn persist_mru_inner(
    pool: &SqlitePool,
    entries: Vec<PersistMruRequest>,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // Sprint 370 (Phase 4 W3) — file SOT 분기 제거. SQLite 가 유일한 SOT.
    // #1092 — write 실패를 삼키지 않고 IPC 경계로 전파한다 (대체 원본 없음).
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    write_sqlite_mirror(pool, &entries).await
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

    // #1092 — delete 실패를 그대로 전파 (이전 counter-only 삼킴 제거).
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    sqlx::query("DELETE FROM mru")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(AppError::from)
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
    // MRU entry vanishes on next boot while the UI believed it was saved.
    #[tokio::test]
    #[serial]
    async fn persist_mru_inner_propagates_sqlite_write_failure() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_force_failure_for_tests(true);
        let result = persist_mru_inner(
            &pool,
            vec![PersistMruRequest {
                connection_id: "c-fail".into(),
                last_used: 1,
            }],
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

    // ---------------------------------------------------------------------
    // 작성 2026-05-17 — sprint-376 직후 baseline cleanup.
    //
    // `clear_mru_inner` (sprint-376 Q21 #8) 는 baseline 측정 set 의
    // `tests/clear_mru.rs` 가 별 binary 라 본 모듈에서 직접 cover 되지 않음.
    // 또한 `persist_mru_inner` 의 다중 entry / upsert path 도 inline 보강.
    // ---------------------------------------------------------------------

    #[tokio::test]
    #[serial]
    async fn persist_mru_inner_multiple_entries_in_one_tx() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_mru_inner(
            &pool,
            vec![
                PersistMruRequest {
                    connection_id: "c1".into(),
                    last_used: 100,
                },
                PersistMruRequest {
                    connection_id: "c2".into(),
                    last_used: 200,
                },
                PersistMruRequest {
                    connection_id: "c3".into(),
                    last_used: 300,
                },
            ],
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 3);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn persist_mru_inner_upsert_overwrites_same_connection_id() {
        cleanup();
        let (_dir, pool) = setup().await;
        for ts in [10_i64, 20, 30] {
            persist_mru_inner(
                &pool,
                vec![PersistMruRequest {
                    connection_id: "c1".into(),
                    last_used: ts,
                }],
            )
            .await
            .unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "upsert must not multiply rows");
        let last_used: i64 =
            sqlx::query_scalar("SELECT last_used FROM mru WHERE connection_id='c1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(last_used, 30);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn persist_mru_inner_empty_vec_is_noop() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_mru_inner(&pool, vec![]).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn clear_mru_inner_deletes_every_row() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_mru_inner(
            &pool,
            vec![
                PersistMruRequest {
                    connection_id: "c1".into(),
                    last_used: 1,
                },
                PersistMruRequest {
                    connection_id: "c2".into(),
                    last_used: 2,
                },
            ],
        )
        .await
        .unwrap();
        clear_mru_inner(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn clear_mru_inner_on_empty_table_is_idempotent() {
        cleanup();
        let (_dir, pool) = setup().await;
        clear_mru_inner(&pool).await.unwrap();
        // Second call still Ok.
        clear_mru_inner(&pool).await.unwrap();
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn clear_mru_inner_rejects_when_legacy_not_done() {
        cleanup();
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        // leave at Pending — do not transition to Done.
        let err = clear_mru_inner(&pool).await.unwrap_err();
        match err {
            AppError::LegacyImportInProgress => {}
            other => panic!("Expected LegacyImportInProgress, got {other:?}"),
        }
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn persist_mru_inner_rejects_when_legacy_not_done() {
        cleanup();
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        let err = persist_mru_inner(
            &pool,
            vec![PersistMruRequest {
                connection_id: "c1".into(),
                last_used: 1,
            }],
        )
        .await
        .unwrap_err();
        match err {
            AppError::LegacyImportInProgress => {}
            other => panic!("Expected LegacyImportInProgress, got {other:?}"),
        }
        cleanup();
    }
}
