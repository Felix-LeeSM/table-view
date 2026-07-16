//! SQL snippet/template persistence (#1528).
//!
//! Mirrors `persist_favorites` / `persist_table_activity` (SQLite SOT) with
//! one simplification: snippets have no connection scope (global reusable
//! templates), so the full replace is unscoped.
//!
//! Every mutate ships the full list through `persist_snippets`: a
//! transaction that DELETEs the whole table then re-inserts the caller's
//! canonical list, so a removed snippet is actually dropped (a plain
//! INSERT OR REPLACE would leave deleted rows to be resurrected by
//! `list_snippets` on the next boot). Boot hydration reads it back via
//! `list_snippets`. `guard_legacy_import_done` runs first per the
//! `guard.rs` invariant that every A/C mutate IPC guards the legacy-import
//! window, and write failures propagate to the IPC boundary (direct `?`).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
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
    // Full replace — wipe the table then re-insert the caller's canonical list
    // so a removed snippet is actually dropped (global table, no scope). An
    // INSERT OR REPLACE alone would leave deleted rows behind.
    sqlx::query("DELETE FROM snippets")
        .execute(&mut *tx)
        .await?;
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
    guard_legacy_import_done(pool).await?;
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
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
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
    }

    fn req(id: &str, name: &str) -> PersistSnippetRequest {
        PersistSnippetRequest {
            id: id.into(),
            name: name.into(),
            body: "SELECT 1".into(),
            sort_order: 0,
            created_at: 1,
            updated_at: 1,
        }
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

    // Blocking-1 regression (PR #1538 review) — a persist of a shrunken list
    // must actually DROP the removed snippet. Before the DELETE-then-insert
    // fix the mirror only ran INSERT OR REPLACE, so a removed row survived and
    // `list_snippets` resurrected it on the next boot, making the delete button
    // a no-op after restart.
    #[tokio::test]
    #[serial]
    async fn full_replace_drops_removed_snippets() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_snippet_inner(&pool, vec![req("snip-1", "a"), req("snip-2", "b")])
            .await
            .unwrap();
        // Second persist omits snip-2 (the user deleted it).
        persist_snippet_inner(&pool, vec![req("snip-1", "a")])
            .await
            .unwrap();
        let rows = list_snippets_inner(&pool).await.unwrap();
        assert_eq!(
            rows.len(),
            1,
            "deleted snippet must not survive the replace"
        );
        assert_eq!(rows[0].id, "snip-1");
        cleanup();
    }

    // Blocking-2 (PR #1538 review) — the legacy-import guard must reject a
    // mutate while the import is not Done (guard.rs invariant).
    #[tokio::test]
    #[serial]
    async fn rejects_when_legacy_not_done() {
        cleanup();
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        // leave at Pending (default) — do NOT set Done.
        let err = persist_snippet_inner(&pool, vec![]).await.unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }
}
