//! dual-write → SQLite-only SOT
//!
//! `favoritesStore` used to dual-write every change to the file SOT
//! (favorites.json) plus the SQLite mirror. After the W3 cut the file branch
//! was removed and the path became SQLite-only:
//!
//!   1. guard_legacy_import_done — rejects pending/importing/failed.
//!   2. SQLite write — inside a tx, DELETE FROM favorites then re-insert every
//!      entry of this call (full replace). #1547 — with INSERT OR REPLACE alone
//!      a deleted favorite row survives and the next boot's list path
//!      resurrects it.
//!
//! Invariant since entering W3: zero file-SOT and LS write sites.
//! `list_favorites` was added so the frontend hydrates directly from SQLite at
//! boot.

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

    // The file/LS write branch is gone — SQLite is the only SOT.
    // #1092 (2026-07-02) — after the W3 cut, swallowing failures and returning
    // Ok while SQLite is the SOT was the root cause of silent data loss. There
    // is no file/LS fallback copy (and boot reconcile is not wired), so a write
    // failure propagates straight to the IPC boundary and the frontend tells
    // the user.
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }
    write_sqlite_mirror(pool, &favorites).await
}

// ---------------------------------------------------------------------------
// `list_favorites` — the W3 read SOT.
//
// Called by the frontend `favoritesStore.loadPersistedFavorites`. Reduces the
// `favorites.json` LS read sites to zero. The returned shape matches the
// camelCase frontend type (serde rename_all).
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
    //! Written 2026-05-16 — inline lib smoke for the `--lib` coverage gate.
    //! The integration scenarios live in `tests/dual_write_connections.rs`.
    //!
    //! After the file write branch retired (SQLite SOT), one more invariant:
    //! after a `persist_favorite_inner` call no file (favorites.json) is
    //! created — only the SQLite row. `list_favorites_inner` reads SQLite only.

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

        // Invariant — the file SOT branch is gone. favorites.json must not be
        // created in the directory.
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

    // Written 2026-05-16 (AC-370-04) — `list_favorites_inner` returns the
    // SQLite favorites in sort_order order.
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
