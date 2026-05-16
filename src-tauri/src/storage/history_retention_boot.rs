//! Sprint 373 (Phase 5 F.5) — boot-time wiring for the history retention
//! vacuum.
//!
//! 작성 2026-05-17. sprint-371 의 `boot_vacuum_old_history()` 함수 자체는
//! 이미 구현 + unit tested (AC-371-10). 본 sprint 는 boot orchestration —
//! `tauri::async_runtime::spawn` 으로 detached task 안에서 다음 단계 진행:
//!
//!   1. `sqlite_pool::get_or_init_pool()` 로 backend pool 확보.
//!   2. `settings.query_history_retention_days` row read (없으면 30 default).
//!   3. `boot_vacuum_old_history(&pool, retention_days).await` 호출.
//!   4. 결과는 best-effort — 실패 시 `tracing::warn` 만, 사용자에게는
//!      toast 등 surface 안 함 (사용자 visible 영향 0; AC-373-05 + sprint
//!      contract Invariants line 39).
//!
//! `lib.rs` 의 `setup` 안에서 `boot_history_retention_vacuum` 을 spawn —
//! mismatch_metric 과 동일한 paradigm (best-effort detached task,
//! launcher first paint blocking 0).

use crate::commands::history::boot_vacuum_old_history;
use crate::commands::sqlite_pool;
use sqlx::SqlitePool;
use tracing::{info, warn};

/// `settings.query_history_retention_days` 의 default. AC-373-07 의 30d.
/// 신규 사용자 (settings row 미존재) 의 boot 에 적용.
const DEFAULT_RETENTION_DAYS: i64 = 30;

/// 본 함수 가 `boot_history_retention_vacuum_inner` 에 위임하기 전에
/// `settings.query_history_retention_days` row 를 read. JSON parse 실패 /
/// row 부재 / 잘못된 type 은 default (30d) 로 fall back.
pub(crate) async fn read_retention_days(pool: &SqlitePool) -> i64 {
    let row: Option<(String,)> =
        match sqlx::query_as("SELECT value_json FROM settings WHERE key = ?")
            .bind("query_history_retention_days")
            .fetch_optional(pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!(
                    target: "history_retention_boot",
                    "settings read failed (using default {}d): {}",
                    DEFAULT_RETENTION_DAYS,
                    e
                );
                return DEFAULT_RETENTION_DAYS;
            }
        };

    let Some((value_json,)) = row else {
        // row 가 없으면 신규 사용자 boot — default.
        return DEFAULT_RETENTION_DAYS;
    };

    // JSON number 만 허용 — 그 외 (string / array / object) 는 schema
    // drift / 사용자 tamper 로 보고 default. sprint-371 의 vacuum function
    // 은 retention_days <= 0 에서 no-op 이라 음수도 안전.
    match serde_json::from_str::<i64>(&value_json) {
        Ok(n) => n,
        Err(e) => {
            warn!(
                target: "history_retention_boot",
                "settings JSON parse failed (using default {}d): {} — raw='{}'",
                DEFAULT_RETENTION_DAYS,
                e,
                value_json
            );
            DEFAULT_RETENTION_DAYS
        }
    }
}

/// Inner — pool 이 주입된 형태. 통합 테스트가 본 함수를 직접 호출해
/// `TABLE_VIEW_TEST_DATA_DIR` 기반의 TempDir pool 을 통과시킨다 (OnceCell
/// 우회). production 에서는 `boot_history_retention_vacuum()` wrapper 가
/// `sqlite_pool::get_or_init_pool()` 를 통해 호출.
pub async fn boot_history_retention_vacuum_inner(pool: &SqlitePool) {
    let retention_days = read_retention_days(pool).await;
    match boot_vacuum_old_history(pool, retention_days).await {
        Ok(deleted) => {
            // info-level 로 단일 라인 — 디버깅 / metric 추출 모두 단순.
            // user-visible surface 는 없으므로 toast emit 0 (AC-373-05).
            info!(
                target: "history_retention_boot",
                retention_days = retention_days,
                deleted_rows = deleted,
                "history retention vacuum complete"
            );
        }
        Err(e) => {
            warn!(
                target: "history_retention_boot",
                retention_days = retention_days,
                "history retention vacuum failed: {}",
                e
            );
        }
    }
}

/// Detached task entry. `lib.rs::setup` 의 `tauri::async_runtime::spawn`
/// closure 안에서 호출. self-contained — pool init / settings read /
/// vacuum 까지 한 곳에서 처리, 어느 단계 실패해도 `tracing::warn` 만 남기고
/// 정상 종료 (사용자 visible 영향 0).
pub async fn boot_history_retention_vacuum() {
    let pool = match sqlite_pool::get_or_init_pool().await {
        Ok(p) => p,
        Err(e) => {
            warn!(
                target: "history_retention_boot",
                "skipped — pool init failed: {}",
                e
            );
            return;
        }
    };
    boot_history_retention_vacuum_inner(&pool).await;
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 (Phase 5 sprint-373). `read_retention_days` 의
    //! default fall-back + JSON parse 동작. 본격 integration 검증은
    //! `tests/history_retention_31d.rs`.

    use super::*;
    use crate::commands::persist_settings::{persist_setting_inner, PersistSettingRequest};
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, SqlitePool) {
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

    #[tokio::test]
    #[serial]
    async fn read_retention_days_returns_default_when_row_absent() {
        let (_dir, pool) = setup().await;
        let days = read_retention_days(&pool).await;
        assert_eq!(days, DEFAULT_RETENTION_DAYS);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn read_retention_days_returns_persisted_value() {
        let (_dir, pool) = setup().await;
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "query_history_retention_days".into(),
                value_json: "7".into(),
            },
        )
        .await
        .unwrap();
        let days = read_retention_days(&pool).await;
        assert_eq!(days, 7);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn read_retention_days_falls_back_on_invalid_json() {
        let (_dir, pool) = setup().await;
        // schema drift / tamper — string 이 들어와도 default 로 fall back.
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "query_history_retention_days".into(),
                value_json: "\"not-a-number\"".into(),
            },
        )
        .await
        .unwrap();
        let days = read_retention_days(&pool).await;
        assert_eq!(days, DEFAULT_RETENTION_DAYS);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn read_retention_days_accepts_forever_zero() {
        let (_dir, pool) = setup().await;
        persist_setting_inner(
            &pool,
            PersistSettingRequest {
                key: "query_history_retention_days".into(),
                value_json: "0".into(),
            },
        )
        .await
        .unwrap();
        let days = read_retention_days(&pool).await;
        assert_eq!(days, 0, "0 = forever 가 정상 propagate (vacuum no-op)");
        cleanup();
    }
}
