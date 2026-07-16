//! Sprint 358 (Phase 1 W1 dual-write) → Sprint 370 (Phase 4 W3 SQLite SOT)
//!
//! Sprint 358 시점에는 `favoritesStore` 의 every change 가 file SOT
//! (favorites.json) + SQLite mirror 의 dual-write 였다. Sprint 370 의 W3
//! cut 이후 file 분기는 제거되고 SQLite-only path 가 된다:
//!
//!   1. guard_legacy_import_done — pending/importing/failed reject.
//!   2. SQLite write — tx 안에서 DELETE FROM favorites 후 본 호출의 모든 entry
//!      재삽입 (full replace). #1547 — INSERT OR REPLACE 만 하면 삭제된 favorite
//!      row 가 잔존해 다음 boot 의 list 경로가 부활시킨다.
//!
//! W3 진입의 invariant: file SOT 와 LS write 사이트 0. `list_favorites` 가
//! 추가되어 frontend 는 boot 시점에 SQLite 에서 직접 hydrate.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::storage::reconcile::is_force_failure_for_tests;
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

    // Sprint 370 (Phase 4 W3) — file/LS write 분기 제거. SQLite 가 유일한 SOT.
    // #1092 (2026-07-02) — W3 cut 이후 SQLite 가 SOT 인데도 실패를 삼키고
    // Ok 를 반환하던 것이 데이터 무음 소실의 근본 원인. file/LS 대체 원본이
    // 없으므로 (그리고 boot reconcile 이 배선되어 있지 않으므로) write 실패는
    // 그대로 IPC 경계로 전파해 frontend 가 사용자에게 알리게 한다.
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    write_sqlite_mirror(pool, &favorites).await
}

// ---------------------------------------------------------------------------
// `list_favorites` — Sprint 370 (Phase 4 W3 read SOT).
//
// frontend `favoritesStore.loadPersistedFavorites` 가 호출. `favorites.json`
// 의 LS read 사이트를 0 으로 만든다. Returned shape 는 camelCase
// frontend 타입에 맞춤 (serde rename_all).
// ---------------------------------------------------------------------------

/// SQLite favorites row → frontend wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoritePublic {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub connection_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_favorites_inner(pool: &SqlitePool) -> Result<Vec<FavoritePublic>, AppError> {
    let rows: Vec<(String, String, String, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT id, name, sql, connection_id, created_at, updated_at \
         FROM favorites ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, sql, connection_id, created_at, updated_at)| FavoritePublic {
                id,
                name,
                sql,
                connection_id,
                created_at,
                updated_at,
            },
        )
        .collect())
}

#[tauri::command]
pub async fn list_favorites(_state: State<'_, AppState>) -> Result<Vec<FavoritePublic>, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    list_favorites_inner(&pool).await
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    favorites: &[PersistFavoriteRequest],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    // #1547 full replace — wipe the table then re-insert the caller's canonical
    // list so a removed favorite is actually dropped. The frontend ships the
    // entire (unscoped) favorites list on every mutate, so an INSERT OR REPLACE
    // alone would leave deleted rows behind for `list_favorites` to resurrect on
    // the next boot (mirrors persist_snippets / persist_table_activity).
    sqlx::query("DELETE FROM favorites")
        .execute(&mut *tx)
        .await?;
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
    //!
    //! Sprint 370 (Phase 4 W3 SQLite SOT) — file write 분기 retire 이후의
    //! invariant 추가: `persist_favorite_inner` 호출 후 file (favorites.json)
    //! 미생성, SQLite row 만. `list_favorites_inner` 가 SQLite 만 read.

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

    // Regression (#1092, 2026-07-02) — before the fix a failing SQLite mirror
    // write was handed to `record_sqlite_result` and the inner returned
    // `Ok(())` regardless, so the IPC boundary reported success while the row
    // never landed and favorites vanished on the next boot. The write result
    // MUST propagate so the frontend can surface the failure.
    #[tokio::test]
    #[serial]
    async fn persist_favorite_inner_propagates_sqlite_write_failure() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_force_failure_for_tests(true);
        let result = persist_favorite_inner(
            &pool,
            vec![PersistFavoriteRequest {
                id: "fav-fail".into(),
                name: "n".into(),
                sql: "SELECT 1".into(),
                connection_id: None,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
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
    async fn happy_path_persists_two_favorites_to_sqlite_only() {
        cleanup();
        let (dir, pool) = setup().await;
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

        // Sprint 370 invariant — file SOT 분기 제거. favorites.json 이 디렉토리
        // 에 생성되지 않아야 한다.
        let file = dir.path().join("favorites.json");
        assert!(
            !file.exists(),
            "favorites.json must not exist after W3 cut (file write retired)"
        );
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

    // 작성 2026-05-16 (Phase 4 sprint-370 AC-370-04) — `list_favorites_inner`
    // 가 SQLite 의 favorites 를 sort_order 순으로 반환.
    #[tokio::test]
    #[serial]
    async fn list_favorites_returns_rows_in_sort_order() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_favorite_inner(
            &pool,
            vec![
                PersistFavoriteRequest {
                    id: "fav-second".into(),
                    name: "Second".into(),
                    sql: "SELECT 2".into(),
                    connection_id: None,
                    sort_order: 1,
                    created_at: 2,
                    updated_at: 2,
                },
                PersistFavoriteRequest {
                    id: "fav-first".into(),
                    name: "First".into(),
                    sql: "SELECT 1".into(),
                    connection_id: None,
                    sort_order: 2,
                    created_at: 1,
                    updated_at: 1,
                },
            ],
        )
        .await
        .unwrap();
        // The second batch entry overwrites sort_order so we explicitly
        // re-write to verify retrieval ordering.
        sqlx::query("UPDATE favorites SET sort_order = ? WHERE id = ?")
            .bind(0i64)
            .bind("fav-first")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE favorites SET sort_order = ? WHERE id = ?")
            .bind(1i64)
            .bind("fav-second")
            .execute(&pool)
            .await
            .unwrap();

        let rows = list_favorites_inner(&pool).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "fav-first");
        assert_eq!(rows[1].id, "fav-second");
        cleanup();
    }

    // Regression (#1547, mirrors persist_snippets `full_replace_drops_removed_snippets`)
    // — a persist of a shrunken list must actually DROP the removed favorite.
    // Before the DELETE-then-insert fix the mirror only ran INSERT OR REPLACE,
    // so a removed row survived and `list_favorites` resurrected it on the next
    // boot, making the delete a no-op after restart.
    #[tokio::test]
    #[serial]
    async fn full_replace_drops_removed_favorites() {
        cleanup();
        let (_dir, pool) = setup().await;
        fn req(id: &str) -> PersistFavoriteRequest {
            PersistFavoriteRequest {
                id: id.into(),
                name: id.into(),
                sql: "SELECT 1".into(),
                connection_id: None,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            }
        }
        persist_favorite_inner(&pool, vec![req("fav-1"), req("fav-2")])
            .await
            .unwrap();
        // Second persist omits fav-2 (the user deleted it).
        persist_favorite_inner(&pool, vec![req("fav-1")])
            .await
            .unwrap();
        let rows = list_favorites_inner(&pool).await.unwrap();
        assert_eq!(
            rows.len(),
            1,
            "deleted favorite must not survive the replace"
        );
        assert_eq!(rows[0].id, "fav-1");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_favorites_empty_when_table_empty() {
        cleanup();
        let (_dir, pool) = setup().await;
        let rows = list_favorites_inner(&pool).await.unwrap();
        assert!(rows.is_empty());
        cleanup();
    }
}
