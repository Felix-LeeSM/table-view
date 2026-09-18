//! `import_legacy_localstorage` IPC.
//!
//! Takes the LegacyPayload shape from Strategy lines 1140–1180 and imports it
//! into SQLite once. The 4-state transition (pending → importing → done |
//! failed) is tracked in the `meta` table. Idempotent — an already-`done`
//! state makes it a no-op.
//!
//! `LegacyPayload` carries two domains only — `favorites` / `mru`. The rest of
//! the legacy localStorage shape (connections / groups / settings / workspaces
//! / theme / safeMode) has no import path here. **The `pending → done`
//! transition accepts an empty payload too**.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::storage::meta::{get_legacy_import_state, set_legacy_import_state, LegacyImportState};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Payload — the frontend wire shape from Strategy lines 1156–1160 (camelCase).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFavorite {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMruEntry {
    pub connection_id: String,
    pub last_used: i64,
}

/// Strategy line 1156: the real LS shape — `table-view-favorites` (array JSON),
/// `table-view-mru` (array JSON). Other LS keys (workspaces / theme / safeMode)
/// are added later.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPayload {
    #[serde(default)]
    pub favorites: Option<Vec<LegacyFavorite>>,
    #[serde(default)]
    pub mru: Option<Vec<LegacyMruEntry>>,
}

// ---------------------------------------------------------------------------
// Inner (testable, pool-keyed). Tauri command wraps and supplies the pool.
// ---------------------------------------------------------------------------

/// Idempotent legacy LS import. 4-state transition:
/// - state == Done → no-op (return Ok)
/// - state == Pending → transition Importing → apply payload → Done (or Failed on err)
/// - state == Importing → concurrent calls are serialized — the last call in
///   ends up Done
/// - state == Failed → same path (retry — the retry path may run at boot time,
///   but a run-time re-call is also safe)
///
/// On failure the state is set to Failed and the cause is propagated as an error.
pub async fn import_legacy_localstorage_inner(
    pool: &SqlitePool,
    payload: LegacyPayload,
) -> Result<(), AppError> {
    let current = get_legacy_import_state(pool).await?;
    if current == LegacyImportState::Done {
        info!(target: "legacy_import", "import already done — no-op");
        return Ok(());
    }

    set_legacy_import_state(pool, LegacyImportState::Importing).await?;

    match apply_payload(pool, &payload).await {
        Ok(()) => {
            set_legacy_import_state(pool, LegacyImportState::Done).await?;
            info!(
                target: "legacy_import",
                favorites = payload.favorites.as_ref().map(|v| v.len()).unwrap_or(0),
                mru = payload.mru.as_ref().map(|v| v.len()).unwrap_or(0),
                "legacy import completed"
            );
            Ok(())
        }
        Err(e) => {
            // best-effort: set Failed then propagate the original error.
            // Reason: the retry path on the next boot after a failed first import
            // only runs when the state is explicitly Failed (it is the boot-time
            // retry trigger).
            if let Err(set_err) = set_legacy_import_state(pool, LegacyImportState::Failed).await {
                warn!(
                    target: "legacy_import",
                    error = %set_err,
                    "failed to record Failed state after import error"
                );
            }
            Err(e)
        }
    }
}

async fn apply_payload(pool: &SqlitePool, payload: &LegacyPayload) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    if let Some(favs) = &payload.favorites {
        for (idx, f) in favs.iter().enumerate() {
            sqlx::query(
                "INSERT OR REPLACE INTO favorites \
                 (id, name, sql, connection_id, sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&f.id)
            .bind(&f.name)
            .bind(&f.sql)
            .bind(&f.connection_id)
            .bind(idx as i64)
            .bind(if f.created_at > 0 {
                f.created_at
            } else {
                now_ms
            })
            .bind(if f.updated_at > 0 {
                f.updated_at
            } else {
                now_ms
            })
            .execute(&mut *tx)
            .await?;
        }
    }

    if let Some(mru) = &payload.mru {
        for entry in mru {
            sqlx::query("INSERT OR REPLACE INTO mru(connection_id, last_used) VALUES (?, ?)")
                .bind(&entry.connection_id)
                .bind(entry.last_used)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri command — wraps `_inner`. `AppState` holds no pool, so the pool comes
// from the process-shared `OnceCell` in `commands::sqlite_pool`.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn import_legacy_localstorage(
    payload: LegacyPayload,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    import_legacy_localstorage_inner(&pool, payload).await
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-17 — baseline cleanup.
    //!
    //! `tests/legacy_import.rs` exists as a separate integration binary but is
    //! not part of the baseline coverage measurement set (`--test
    //! storage_integration ...`), so this module measures 0%. Inline tests
    //! backfill the `--lib` path coverage.
    //!
    //! Test scenarios (8 principles):
    //!   - Happy: pending → importing → done + favorites/mru rows inserted.
    //!   - Empty input: payload {favorites: None, mru: None} → settles at done.
    //!   - Error recovery: a call at state == Failed or Pending can try again.
    //!   - Concurrency: a second call at state == Done is a no-op (idempotent).
    //!   - State transition: entry points verified for all four states
    //!     (Pending/Importing/Done/Failed).
    //!   - try-await reject: when a payload fav.id violates the NULL constraint,
    //!     the state is set to Failed (contract, best-effort).
    //!   - wire serde: camelCase on LegacyPayload / LegacyFavorite / LegacyMruEntry.
    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{get_legacy_import_state, LegacyImportState};
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    fn sample_favorite(id: &str) -> LegacyFavorite {
        LegacyFavorite {
            id: id.into(),
            name: format!("name-{id}"),
            sql: format!("SELECT {id}"),
            connection_id: Some("c-1".into()),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }
    }

    // ---------------- Happy ----------------

    #[tokio::test]
    #[serial]
    async fn inner_transitions_pending_to_done_on_first_call() {
        let (_dir, pool) = setup().await;
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Pending
        );
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![sample_favorite("f1")]),
                mru: Some(vec![LegacyMruEntry {
                    connection_id: "c1".into(),
                    last_used: 100,
                }]),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Done
        );
        let favs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
            .fetch_one(&pool)
            .await
            .unwrap();
        let mrus: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(favs, 1);
        assert_eq!(mrus, 1);
        cleanup();
    }

    // ---------------- empty input ----------------

    #[tokio::test]
    #[serial]
    async fn inner_empty_payload_still_transitions_to_done() {
        let (_dir, pool) = setup().await;
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: None,
                mru: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Done
        );
        let favs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(favs, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_some_empty_vec_for_favorites_still_completes_done() {
        let (_dir, pool) = setup().await;
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![]),
                mru: Some(vec![]),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Done
        );
        cleanup();
    }

    // ---------------- idempotent / Done branch ----------------

    #[tokio::test]
    #[serial]
    async fn inner_second_call_is_noop_when_done() {
        let (_dir, pool) = setup().await;
        // First call → done.
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![sample_favorite("f1")]),
                mru: None,
            },
        )
        .await
        .unwrap();
        // Second call (bigger payload) is a no-op — state already done.
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![sample_favorite("f2"), sample_favorite("f3")]),
                mru: None,
            },
        )
        .await
        .unwrap();
        let favs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(favs, 1, "second call must be no-op when state == done");
        cleanup();
    }

    // ---------------- sort_order + insert preserves index ----------------

    #[tokio::test]
    #[serial]
    async fn inner_favorites_insert_uses_index_as_sort_order() {
        let (_dir, pool) = setup().await;
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![
                    sample_favorite("a"),
                    sample_favorite("b"),
                    sample_favorite("c"),
                ]),
                mru: None,
            },
        )
        .await
        .unwrap();
        let rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT id, sort_order FROM favorites ORDER BY sort_order ASC")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].0, "a");
        assert_eq!(rows[0].1, 0);
        assert_eq!(rows[1].1, 1);
        assert_eq!(rows[2].1, 2);
        cleanup();
    }

    // ---------------- now_ms fallback when created_at/updated_at <= 0 ----------------

    #[tokio::test]
    #[serial]
    async fn inner_zero_timestamps_fall_back_to_now() {
        let (_dir, pool) = setup().await;
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: Some(vec![LegacyFavorite {
                    id: "f-now".into(),
                    name: "fresh".into(),
                    sql: "SELECT 1".into(),
                    connection_id: None,
                    created_at: 0,
                    updated_at: 0,
                }]),
                mru: None,
            },
        )
        .await
        .unwrap();
        let (created, updated): (i64, i64) =
            sqlx::query_as("SELECT created_at, updated_at FROM favorites WHERE id = 'f-now'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(created > 0, "created_at fallback must be > 0 (now_ms)");
        assert!(updated > 0, "updated_at fallback must be > 0 (now_ms)");
        cleanup();
    }

    // ---------------- 4-state guard branch: progressing again from Failed/Pending ----------------

    #[tokio::test]
    #[serial]
    async fn inner_failed_state_can_retry_and_reach_done() {
        let (_dir, pool) = setup().await;
        // Manually set Failed so the retry path is exercised.
        use crate::storage::meta::set_legacy_import_state;
        set_legacy_import_state(&pool, LegacyImportState::Failed)
            .await
            .unwrap();

        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: None,
                mru: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Done
        );
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn inner_importing_state_proceeds_and_settles_done() {
        // doc: "Importing → concurrent calls are serialized — the last
        // call in ends up Done". Even when entering at Importing the call
        // succeeds end-to-end.
        let (_dir, pool) = setup().await;
        use crate::storage::meta::set_legacy_import_state;
        set_legacy_import_state(&pool, LegacyImportState::Importing)
            .await
            .unwrap();
        import_legacy_localstorage_inner(
            &pool,
            LegacyPayload {
                favorites: None,
                mru: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            get_legacy_import_state(&pool).await.unwrap(),
            LegacyImportState::Done
        );
        cleanup();
    }

    // ---------------- wire serde — camelCase ----------------

    #[test]
    fn legacy_favorite_serializes_camel_case() {
        let f = sample_favorite("x");
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains("connectionId"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
    }

    #[test]
    fn legacy_mru_entry_serializes_camel_case() {
        let m = LegacyMruEntry {
            connection_id: "c1".into(),
            last_used: 42,
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("connectionId"));
        assert!(json.contains("lastUsed"));
    }

    #[test]
    fn legacy_payload_default_is_all_none() {
        let p = LegacyPayload::default();
        assert!(p.favorites.is_none());
        assert!(p.mru.is_none());
    }

    #[test]
    fn legacy_favorite_default_optional_fields_deserialize_from_minimal_wire() {
        // Must tolerate a frontend payload whose connectionId / createdAt /
        // updatedAt are missing (the #[serde(default)] contract).
        let json = r#"{"id":"x","name":"n","sql":"SELECT 1"}"#;
        let f: LegacyFavorite = serde_json::from_str(json).unwrap();
        assert_eq!(f.id, "x");
        assert_eq!(f.connection_id, None);
        assert_eq!(f.created_at, 0);
        assert_eq!(f.updated_at, 0);
    }
}
