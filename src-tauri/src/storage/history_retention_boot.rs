//! F.5 — boot-time wiring for the history retention vacuum.
//!
//! Written 2026-05-17. `boot_vacuum_old_history()` itself is implemented and
//! unit tested in `commands/history.rs` (AC-371-10). This module is the boot
//! orchestration — a detached task under `tauri::async_runtime::spawn` that
//! walks these steps:
//!
//!   1. Get the backend pool from `sqlite_pool::get_or_init_pool()`.
//!   2. Read the `settings.query_history_retention_days` row (30 by default
//!      when absent).
//!   3. Call `boot_vacuum_old_history(&pool, retention_days).await`.
//!   4. The outcome is best-effort — a failure only logs `tracing::warn` and
//!      never surfaces to the user as a toast or anything else (zero
//!      user-visible effect; AC-373-05).
//!
//! `lib.rs`'s `setup` spawns `boot_history_retention_vacuum` — the same
//! paradigm as mismatch_metric (best-effort detached task, zero blocking of
//! the launcher's first paint).

use crate::commands::history::boot_vacuum_old_history;
use crate::commands::sqlite_pool;
use sqlx::SqlitePool;
use tracing::{info, warn};

/// Default for `settings.query_history_retention_days` — the 30d of
/// AC-373-07. Applied at boot for a new user (no settings row).
const DEFAULT_RETENTION_DAYS: i64 = 30;

/// Reads the `settings.query_history_retention_days` row that
/// `boot_history_retention_vacuum_inner` consults before it delegates to the
/// vacuum. A JSON parse failure, a missing row, or a wrong type falls back to
/// the default (30d).
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
        // No row means a new user's boot — use the default.
        return DEFAULT_RETENTION_DAYS;
    };

    // Only a JSON number is accepted — anything else (string / array /
    // object) is read as schema drift or user tampering and falls back to the
    // default. The vacuum function is a no-op for retention_days <= 0, so a
    // negative value is safe too.
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

/// Inner form with the pool injected. Integration tests call it directly to
/// pass a TempDir pool rooted at `TABLE_VIEW_TEST_DATA_DIR` (bypassing the
/// OnceCell). In production the `boot_history_retention_vacuum()` wrapper
/// calls it through `sqlite_pool::get_or_init_pool()`.
pub async fn boot_history_retention_vacuum_inner(pool: &SqlitePool) {
    let retention_days = read_retention_days(pool).await;
    match boot_vacuum_old_history(pool, retention_days).await {
        Ok(deleted) => {
            // One info-level line — simple both to debug and to extract as a
            // metric. There is no user-visible surface, so no toast is
            // emitted (AC-373-05).
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

/// Detached task entry. Called inside the `tauri::async_runtime::spawn`
/// closure in `lib.rs::setup`. Self-contained — pool init, settings read and
/// vacuum all happen in one place, and a failure at any step only leaves a
/// `tracing::warn` and returns normally (zero user-visible effect).
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
    //! Written 2026-05-17. The default fall-back and JSON parse behaviour of
    //! `read_retention_days`. The full integration check is in
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
        // schema drift / tamper — a string still falls back to the default.
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
