//! Sprint 355 (Phase 1) — `meta` key-value table 액세스. 특히
//! `meta.legacy_imported` 의 4-state enum 과 `meta.last_legacy_import_at`
//! sentinel 을 관리.
//!
//! Strategy line 1184: `pending | importing | done | failed`.
//!
//! - `pending`: 새 사용자 또는 첫 boot 전. legacy LS read 시도 가능 상태.
//! - `importing`: legacy import IPC 진행 중 — A/C mutate IPC block 대상.
//! - `done`: import 완료. 정상 동작.
//! - `failed`: import 실패. 다음 boot 에서 재시도. 그 동안 A/C mutate block.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// `meta.legacy_imported` 4-state. snake_case 로 serialize.
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

/// 현재 `legacy_imported` 상태 조회. 신규 fresh DB 는 migration 의
/// `INSERT OR IGNORE` 로 `pending` 이 사전 저장됨.
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

/// `legacy_imported` 상태 설정 + `last_legacy_import_at` 동시 갱신.
/// idempotent — 같은 state 로 두 번 set 해도 안전.
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
    //! 작성 2026-05-16 (Phase 1 sprint-355) — LegacyImportState parse/serialize
    //! + get/set round-trip 의 4 state 별 검증.

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
