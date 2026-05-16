//! Sprint 358 (Phase 1 W1 dual-write) — `persist_favorites` IPC.
//!
//! `favoritesStore` 의 every change 가 IPC 로 backend 에 mirror 된다. 호출 흐름:
//!   1. guard_legacy_import_done — pending/importing/failed reject.
//!   2. file SOT (favorites.json) write — atomic.
//!   3. SQLite mirror — INSERT OR REPLACE 로 본 호출의 모든 entry 를 덮어쓰기.
//!      실패 시 dev 로그 + counter (silent).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::storage::local_files::{save_favorites_file, FavoriteRecord};
use crate::storage::reconcile::{is_force_failure_for_tests, record_sqlite_result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistFavoriteRequest {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

pub async fn persist_favorite_inner(
    pool: &SqlitePool,
    favorites: Vec<PersistFavoriteRequest>,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let records: Vec<FavoriteRecord> = favorites
        .iter()
        .map(|f| FavoriteRecord {
            id: f.id.clone(),
            name: f.name.clone(),
            sql: f.sql.clone(),
            connection_id: f.connection_id.clone(),
            created_at: f.created_at,
            updated_at: f.updated_at,
        })
        .collect();
    save_favorites_file(&records)?;

    let sqlite_result = if is_force_failure_for_tests() {
        Err(AppError::Storage("forced failure for tests".into()))
    } else {
        write_sqlite_mirror(pool, &favorites).await
    };
    record_sqlite_result("favorites", sqlite_result);

    Ok(())
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    favorites: &[PersistFavoriteRequest],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for (idx, f) in favorites.iter().enumerate() {
        sqlx::query(
            "INSERT OR REPLACE INTO favorites \
             (id, name, sql, connection_id, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&f.id)
        .bind(&f.name)
        .bind(&f.sql)
        .bind(&f.connection_id)
        .bind(if f.sort_order != 0 {
            f.sort_order
        } else {
            idx as i64
        })
        .bind(f.created_at)
        .bind(f.updated_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn persist_favorites(
    favorites: Vec<PersistFavoriteRequest>,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_favorite_inner(&pool, favorites).await
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
    async fn happy_path_persists_two_favorites_to_file_and_sqlite() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_favorite_inner(
            &pool,
            vec![
                PersistFavoriteRequest {
                    id: "fav-a".into(),
                    name: "A".into(),
                    sql: "SELECT 1".into(),
                    connection_id: None,
                    sort_order: 0,
                    created_at: 1,
                    updated_at: 1,
                },
                PersistFavoriteRequest {
                    id: "fav-b".into(),
                    name: "B".into(),
                    sql: "SELECT 2".into(),
                    connection_id: Some("c1".into()),
                    sort_order: 0,
                    created_at: 2,
                    updated_at: 2,
                },
            ],
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn guard_pending_rejects() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Pending)
            .await
            .unwrap();
        let err = persist_favorite_inner(&pool, vec![]).await.unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }
}
