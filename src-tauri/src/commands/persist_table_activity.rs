//! #1218 — table-level pin + recent-usage persistence.
//!
//! `tableActivityStore.recordTableUsed` / `togglePin` call this backend
//! mirror. Like `persist_mru` the SQLite table is the single SOT (no file
//! fallback). The frontend holds the entire canonical list and ships it in
//! full on every mutate, so this replaces the whole `table_activity` table in
//! one transaction — a full replace (not an upsert) is what makes unpin /
//! recent-eviction actually propagate to the next boot.
//!
//! Race ceiling (ponytail): a mutate that fires before boot hydrate resolves
//! could persist a short list and lose rows. In practice the SchemaTree
//! sections only render after `list_schemas` (network-bound, far slower than
//! the boot hydrate IPC), so a table click can't beat hydrate. Left as-is; a
//! hydration gate would only matter if recording moved off the tree.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::storage::reconcile::is_force_failure_for_tests;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableActivityRow {
    pub connection_id: String,
    pub db: String,
    /// `None` for schemaless (no-schema MySQL, flat SQLite). Stored as '' so
    /// the composite PRIMARY KEY dedupes (SQLite treats NULL PK parts as
    /// distinct).
    #[serde(default)]
    pub schema: Option<String>,
    pub table: String,
    #[serde(default)]
    pub last_used: Option<i64>,
    #[serde(default)]
    pub pinned_at: Option<i64>,
}

pub async fn persist_table_activity_inner(
    pool: &SqlitePool,
    entries: Vec<TableActivityRow>,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    // #1092 — no fallback source, so a write failure propagates to the IPC
    // boundary instead of being swallowed.
    if is_force_failure_for_tests() {
        return Err(AppError::Storage("forced failure for tests".into()));
    }

    let mut tx = pool.begin().await?;
    // Full replace — the frontend list is canonical, so unpins / evictions
    // must not linger.
    sqlx::query("DELETE FROM table_activity")
        .execute(&mut *tx)
        .await?;
    for e in &entries {
        sqlx::query(
            "INSERT OR REPLACE INTO table_activity \
             (connection_id, db_name, schema_name, table_name, last_used, pinned_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&e.connection_id)
        .bind(&e.db)
        .bind(e.schema.as_deref().unwrap_or(""))
        .bind(&e.table)
        .bind(e.last_used)
        .bind(e.pinned_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// `(connection_id, db_name, schema_name, table_name, last_used, pinned_at)`.
type ActivityRowTuple = (String, String, String, String, Option<i64>, Option<i64>);

pub async fn list_table_activity_inner(
    pool: &SqlitePool,
) -> Result<Vec<TableActivityRow>, AppError> {
    let rows: Vec<ActivityRowTuple> = sqlx::query_as(
        "SELECT connection_id, db_name, schema_name, table_name, last_used, pinned_at \
         FROM table_activity \
         ORDER BY pinned_at ASC, last_used DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(connection_id, db, schema_name, table, last_used, pinned_at)| TableActivityRow {
                connection_id,
                db,
                // '' sentinel maps back to null for the schemaless paradigm.
                schema: if schema_name.is_empty() {
                    None
                } else {
                    Some(schema_name)
                },
                table,
                last_used,
                pinned_at,
            },
        )
        .collect())
}

#[tauri::command]
pub async fn persist_table_activity(
    entries: Vec<TableActivityRow>,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    persist_table_activity_inner(&pool, entries).await
}

#[tauri::command]
pub async fn list_table_activity(
    _state: State<'_, AppState>,
) -> Result<Vec<TableActivityRow>, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    list_table_activity_inner(&pool).await
}

#[cfg(test)]
mod tests {
    //! Inline `--lib` smoke for the coverage gate. Mirrors the persist_mru /
    //! persist_favorites test shape.

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

    fn row(schema: Option<&str>, table: &str) -> TableActivityRow {
        TableActivityRow {
            connection_id: "c1".into(),
            db: "app".into(),
            schema: schema.map(|s| s.to_string()),
            table: table.into(),
            last_used: Some(100),
            pinned_at: None,
        }
    }

    #[tokio::test]
    #[serial]
    async fn propagates_sqlite_write_failure() {
        cleanup();
        let (_dir, pool) = setup().await;
        set_force_failure_for_tests(true);
        let result = persist_table_activity_inner(&pool, vec![row(Some("public"), "users")]).await;
        assert!(
            result.is_err(),
            "SQLite write failure must propagate to the IPC boundary, not be swallowed as Ok"
        );
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn happy_path_round_trip_with_and_without_schema() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_table_activity_inner(
            &pool,
            vec![
                TableActivityRow {
                    connection_id: "c1".into(),
                    db: "app".into(),
                    schema: Some("public".into()),
                    table: "users".into(),
                    last_used: Some(200),
                    pinned_at: Some(5),
                },
                // schemaless (flat SQLite) — schema None round-trips through ''.
                TableActivityRow {
                    connection_id: "c1".into(),
                    db: "main.db".into(),
                    schema: None,
                    table: "todos".into(),
                    last_used: None,
                    pinned_at: Some(9),
                },
            ],
        )
        .await
        .unwrap();

        let rows = list_table_activity_inner(&pool).await.unwrap();
        assert_eq!(rows.len(), 2);
        let users = rows.iter().find(|r| r.table == "users").unwrap();
        assert_eq!(users.schema.as_deref(), Some("public"));
        assert_eq!(users.last_used, Some(200));
        assert_eq!(users.pinned_at, Some(5));
        let todos = rows.iter().find(|r| r.table == "todos").unwrap();
        assert!(
            todos.schema.is_none(),
            "empty schema sentinel must map back to None"
        );
        assert_eq!(todos.last_used, None);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn full_replace_drops_removed_rows() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_table_activity_inner(
            &pool,
            vec![row(Some("public"), "users"), row(Some("public"), "orders")],
        )
        .await
        .unwrap();
        // Second persist omits `orders` (e.g. it was unpinned + evicted).
        persist_table_activity_inner(&pool, vec![row(Some("public"), "users")])
            .await
            .unwrap();
        let rows = list_table_activity_inner(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].table, "users");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn empty_vec_clears_the_table() {
        cleanup();
        let (_dir, pool) = setup().await;
        persist_table_activity_inner(&pool, vec![row(Some("public"), "users")])
            .await
            .unwrap();
        persist_table_activity_inner(&pool, vec![]).await.unwrap();
        let rows = list_table_activity_inner(&pool).await.unwrap();
        assert!(rows.is_empty());
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn schemaless_upsert_does_not_duplicate() {
        cleanup();
        let (_dir, pool) = setup().await;
        // Two persists of the same schemaless table must dedupe on the PK
        // despite the NULL schema (stored as '').
        persist_table_activity_inner(&pool, vec![row(None, "todos")])
            .await
            .unwrap();
        persist_table_activity_inner(&pool, vec![row(None, "todos")])
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM table_activity")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn rejects_when_legacy_not_done() {
        cleanup();
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        // leave at Pending.
        let err = persist_table_activity_inner(&pool, vec![])
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::LegacyImportInProgress));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_empty_when_table_empty() {
        cleanup();
        let (_dir, pool) = setup().await;
        let rows = list_table_activity_inner(&pool).await.unwrap();
        assert!(rows.is_empty());
        cleanup();
    }
}
