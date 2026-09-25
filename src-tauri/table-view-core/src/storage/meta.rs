//! `meta` key-value table access. In particular it manages the
//! `meta.legacy_imported` 4-state enum and the `meta.last_legacy_import_at`
//! sentinel.
//!
//! Strategy line 1184: `pending | importing | done | failed`.
//!
//! - `pending`: a new user, or before the first boot. A legacy LS read may be
//!   attempted in this state.
//! - `importing`: a legacy import IPC is in flight — A/C mutate IPC is blocked.
//! - `done`: import finished. Normal operation.
//! - `failed`: import failed. Retried on the next boot. A/C mutate stays blocked
//!   until then.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// `meta.legacy_imported` 4-state. Serialized as snake_case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LegacyImportState {
    Pending,
    Importing,
    Done,
    Failed,
}

impl LegacyImportState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Importing => "importing",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "pending" => Ok(Self::Pending),
            "importing" => Ok(Self::Importing),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            other => Err(AppError::Storage(format!(
                "Unknown legacy_imported state '{}'",
                other
            ))),
        }
    }
}

/// Reads the current `legacy_imported` state. A fresh DB has `pending`
/// pre-seeded by the migration's `INSERT OR IGNORE`.
pub async fn get_legacy_import_state(pool: &SqlitePool) -> Result<LegacyImportState, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM meta WHERE key = 'legacy_imported'")
            .fetch_optional(pool)
            .await?;
    match row {
        Some((v,)) => LegacyImportState::parse(&v),
        None => Ok(LegacyImportState::Pending),
    }
}

/// Sets the `legacy_imported` state and updates `last_legacy_import_at` in the
/// same transaction. Idempotent — setting the same state twice is safe.
pub async fn set_legacy_import_state(
    pool: &SqlitePool,
    state: LegacyImportState,
) -> Result<(), AppError> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('legacy_imported', ?)")
        .bind(state.as_str())
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_legacy_import_at', ?)")
        .bind(now_ms.to_string())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-16 — LegacyImportState parse/serialize plus the get/set
    //! round-trip, verified for each of the 4 states.

    use super::*;
    use crate::storage::local;
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

    #[test]
    fn test_parse_round_trip_all_four_states() {
        for s in &["pending", "importing", "done", "failed"] {
            let state = LegacyImportState::parse(s).unwrap();
            assert_eq!(state.as_str(), *s);
        }
    }

    #[test]
    fn test_parse_unknown_state_rejected() {
        let err = LegacyImportState::parse("loading").unwrap_err();
        match err {
            AppError::Storage(_) => {}
            other => panic!("Expected Storage error, got {:?}", other),
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_get_legacy_import_state_returns_pending_on_fresh_db() {
        let (_dir, pool) = setup().await;
        let state = get_legacy_import_state(&pool).await.unwrap();
        assert_eq!(state, LegacyImportState::Pending);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn test_set_then_get_round_trip_for_each_state() {
        let (_dir, pool) = setup().await;
        for state in [
            LegacyImportState::Importing,
            LegacyImportState::Done,
            LegacyImportState::Failed,
            LegacyImportState::Pending,
        ] {
            set_legacy_import_state(&pool, state).await.unwrap();
            let actual = get_legacy_import_state(&pool).await.unwrap();
            assert_eq!(actual, state, "Round-trip failed for {:?}", state);
        }
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn test_set_updates_last_legacy_import_at() {
        let (_dir, pool) = setup().await;
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM meta WHERE key = 'last_legacy_import_at'")
                .fetch_optional(&pool)
                .await
                .unwrap();
        let v = row.unwrap().0;
        let parsed: i64 = v.parse().expect("last_legacy_import_at must be unix ms");
        assert!(parsed > 0, "last_legacy_import_at must be > 0 after set");
        cleanup();
    }
}
