//! SQL snippet/template persistence (#1528).
//!
//! Mirrors `persist_favorites` (SQLite SOT) with two simplifications: snippets
//! have no connection scope (global reusable templates) and no legacy-import
//! guard — the `snippets` table is brand new (migration 0005) with no
//! file/LS origin, so there is nothing a legacy import could clobber.
//!
//! Every mutate ships the full list through `persist_snippets` (INSERT OR
//! REPLACE inside one transaction); boot hydration reads it back via
//! `list_snippets`. Write failures propagate to the IPC boundary (direct
//! `?`), so a swallowed-error data-loss path like the favorites #1092
//! regression cannot exist here.

use crate::commands::connection::AppState;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistSnippetRequest {
    pub id: String,
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// SQLite snippet row → frontend wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetPublic {
    pub id: String,
    pub name: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

async fn write_sqlite_mirror(
    pool: &SqlitePool,
    snippets: &[PersistSnippetRequest],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for (idx, s) in snippets.iter().enumerate() {
        sqlx::query(
            "INSERT OR REPLACE INTO snippets \
             (id, name, body, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&s.id)
        .bind(&s.name)
        .bind(&s.body)
        .bind(if s.sort_order != 0 {
            s.sort_order
        } else {
            idx as i64
        })
        .bind(s.created_at)
        .bind(s.updated_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn persist_snippet_inner(
    pool: &SqlitePool,
    snippets: Vec<PersistSnippetRequest>,
) -> Result<(), AppError> {
    write_sqlite_mirror(pool, &snippets).await
}

pub async fn list_snippets_inner(pool: &SqlitePool) -> Result<Vec<SnippetPublic>, AppError> {
    let rows: Vec<(String, String, String, i64, i64)> = sqlx::query_as(
        "SELECT id, name, body, created_at, updated_at \
         FROM snippets ORDER BY sort_order ASC, id ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, body, created_at, updated_at)| SnippetPublic {
            id,
            name,
            body,
            created_at,
            updated_at,
        })
        .collect())
}

#[tauri::command]
pub async fn persist_snippets(
    snippets: Vec<PersistSnippetRequest>,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_snippet_inner(&pool, snippets).await
}

#[tauri::command]
pub async fn list_snippets(_state: State<'_, AppState>) -> Result<Vec<SnippetPublic>, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    list_snippets_inner(&pool).await
}

#[cfg(test)]
mod tests {
    //! Inline lib smoke for the `--lib` coverage gate, mirroring
    //! `persist_favorites` — persist writes SQLite rows and `list_snippets`
    //! returns them in `sort_order`.

    use super::*;
    use crate::storage::local;
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn happy_path_persists_two_snippets() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_snippet_inner(
            &pool,
            vec![
                PersistSnippetRequest {
                    id: "snip-a".into(),
                    name: "A".into(),
                    body: "SELECT * FROM {{table}}".into(),
                    sort_order: 0,
                    created_at: 1,
                    updated_at: 1,
                },
                PersistSnippetRequest {
                    id: "snip-b".into(),
                    name: "B".into(),
                    body: "SELECT 2".into(),
                    sort_order: 0,
                    created_at: 2,
                    updated_at: 2,
                },
            ],
        )
        .await
        .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM snippets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_snippets_returns_rows_in_sort_order() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_snippet_inner(
            &pool,
            vec![
                PersistSnippetRequest {
                    id: "snip-second".into(),
                    name: "Second".into(),
                    body: "SELECT 2".into(),
                    sort_order: 1,
                    created_at: 2,
                    updated_at: 2,
                },
                PersistSnippetRequest {
                    id: "snip-first".into(),
                    name: "First".into(),
                    body: "SELECT 1".into(),
                    sort_order: 2,
                    created_at: 1,
                    updated_at: 1,
                },
            ],
        )
        .await
        .unwrap();
        sqlx::query("UPDATE snippets SET sort_order = ? WHERE id = ?")
            .bind(0i64)
            .bind("snip-first")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE snippets SET sort_order = ? WHERE id = ?")
            .bind(1i64)
            .bind("snip-second")
            .execute(&pool)
            .await
            .unwrap();

        let rows = list_snippets_inner(&pool).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "snip-first");
        assert_eq!(rows[1].id, "snip-second");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_snippets_empty_when_table_empty() {
        cleanup();
        let (_dir, pool) = setup().await;
        let rows = list_snippets_inner(&pool).await.unwrap();
        assert!(rows.is_empty());
        cleanup();
    }
}
