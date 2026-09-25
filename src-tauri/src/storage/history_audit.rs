//! Boot-time invariant audit for `query_history.tab_id` (2026-05-17).
//!
//! state-management-strategy doc F.5 (schema 0001) defines `tab_id` as a
//! nullable column. Per source the invariant is narrower: **only
//! `sidebar-prefetch` may leave `tab_id=NULL`** (when the sidebar opens a
//! collection/table preview no tab exists yet). The remaining sources (`raw`,
//! `grid-edit`, `ddl-structure`, `mongo-op`, `explain`) are all user actions
//! that happen inside a tab, so `tab_id` must always be set.
//!
//! This audit runs `SELECT COUNT(*) FROM query_history WHERE tab_id IS NULL AND
//! source != 'sidebar-prefetch'` right after boot. A result greater than 0 means
//! something in the frontend called the IPC without filling `tab_id` — under the
//! Q10 zero-telemetry policy nothing goes outside (no Sentry or the like), only
//! a single `tracing::error!` line in the dev console. There is no user-visible
//! surface (toast / dialog) and no effect at all on users of a release build.
//!
//! `lib.rs`'s `setup` spawns `boot_audit_history_tab_id_null` as a detached task
//! — the same paradigm as `mismatch_metric` / `boot_history_retention_vacuum`
//! (best-effort, zero blocking of first paint).

use crate::commands::sqlite_pool;
use sqlx::SqlitePool;
use tracing::{error, info, warn};

/// Count the `tab_id IS NULL` rows whose `source != 'sidebar-prefetch'`.
/// Takes an injected pool, so an integration test can call it directly with a
/// TempDir-based pool. In production the `boot_audit_history_tab_id_null()`
/// wrapper calls it through `sqlite_pool::get_or_init_pool()`.
pub async fn count_history_tab_id_null_non_prefetch(pool: &SqlitePool) -> i64 {
    let row: Result<(i64,), sqlx::Error> = sqlx::query_as(
        "SELECT COUNT(*) FROM query_history \
         WHERE tab_id IS NULL AND source != 'sidebar-prefetch'",
    )
    .fetch_one(pool)
    .await;
    match row {
        Ok((n,)) => n,
        Err(e) => {
            warn!(
                target: "history_audit",
                "count query failed (treating as 0): {}",
                e
            );
            0
        }
    }
}

/// Inner form taking an injected pool. The integration-test entry point.
/// 0 logs an info-level summary, 1 or more reports at error level.
pub async fn boot_audit_history_tab_id_null_inner(pool: &SqlitePool) {
    let count = count_history_tab_id_null_non_prefetch(pool).await;
    if count > 0 {
        // **invariant violation**: some source other than sidebar-prefetch
        // called the IPC without filling tab_id.
        // Q10 zero-telemetry — nothing leaves the process, one error line in the
        // dev console. `target` is the identifier for grep / log filtering.
        error!(
            target: "history_audit",
            tab_id_null_count = count,
            "INVARIANT VIOLATION: query_history rows with tab_id=NULL and source != 'sidebar-prefetch' \
             detected. Only sidebar-prefetch is allowed to omit tab_id; investigate the frontend \
             caller that elided tabId in recordHistoryEntry()."
        );
    } else {
        info!(
            target: "history_audit",
            "query_history tab_id invariant holds (0 violations)"
        );
    }
}

/// Detached task entry, called from `tauri::async_runtime::spawn` inside
/// `lib.rs::setup`. Self-contained — pool init and audit query are handled in
/// one place, and a failure at either step leaves a `tracing::warn` and returns
/// normally.
pub async fn boot_audit_history_tab_id_null() {
    let pool = match sqlite_pool::get_or_init_pool().await {
        Ok(p) => p,
        Err(e) => {
            warn!(
                target: "history_audit",
                "skipped — pool init failed: {}",
                e
            );
            return;
        }
    };
    boot_audit_history_tab_id_null_inner(&pool).await;
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-17. Verifies the behavior of the count query itself.
    //! The full integration (boot simulation, log verification) lives in
    //! `tests/history_tab_id_null_audit.rs`.

    use super::*;
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

    /// Seed-row helper — takes only `tab_id` and `source` and INSERTs.
    async fn insert_row(pool: &SqlitePool, tab_id: Option<&str>, source: &str) {
        sqlx::query(
            "INSERT INTO query_history \
             (connection_id, tab_id, paradigm, query_mode, source, \
              sql, sql_redacted, status, duration_ms, executed_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("conn-A")
        .bind(tab_id)
        .bind("rdb")
        .bind("sql")
        .bind(source)
        .bind("SELECT 1")
        .bind("SELECT 1")
        .bind("success")
        .bind(10_i64)
        .bind(1700000000000_i64)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn count_is_zero_when_no_history_rows() {
        let (_dir, pool) = setup().await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn sidebar_prefetch_with_null_tab_id_is_not_counted() {
        let (_dir, pool) = setup().await;
        // Normal path — sidebar-prefetch + tab_id NULL.
        insert_row(&pool, None, "sidebar-prefetch").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 0, "sidebar-prefetch 는 NULL tab_id 허용");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn non_prefetch_with_null_tab_id_is_counted() {
        let (_dir, pool) = setup().await;
        // Violating path — `raw` source with tab_id NULL.
        insert_row(&pool, None, "raw").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 1, "raw + NULL tab_id 는 invariant 위반");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn non_prefetch_with_filled_tab_id_is_not_counted() {
        let (_dir, pool) = setup().await;
        // Normal path — raw with tab_id filled.
        insert_row(&pool, Some("tab-1"), "raw").await;
        insert_row(&pool, Some("tab-2"), "grid-edit").await;
        insert_row(&pool, Some("tab-3"), "explain").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn mixed_rows_count_only_violations() {
        let (_dir, pool) = setup().await;
        // Normal (4)
        insert_row(&pool, Some("tab-1"), "raw").await;
        insert_row(&pool, Some("tab-2"), "grid-edit").await;
        insert_row(&pool, Some("tab-3"), "explain").await;
        insert_row(&pool, None, "sidebar-prefetch").await;
        // Violations (3)
        insert_row(&pool, None, "raw").await;
        insert_row(&pool, None, "mongo-op").await;
        insert_row(&pool, None, "explain").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 3);
        cleanup();
    }
}
