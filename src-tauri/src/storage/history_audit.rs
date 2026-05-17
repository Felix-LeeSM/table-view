//! Sprint 375 (Phase 6 cleanup, 2026-05-17) — boot-time invariant audit for
//! `query_history.tab_id`.
//!
//! state-management-strategy doc F.5 (sprint-371 의 schema 0001) 는
//! `tab_id` 가 nullable column 으로 정의되어 있다. 그러나 source 차원에서
//! invariant 가 좁다: 5 source 중 **`sidebar-prefetch` 만 `tab_id=NULL` 을
//! 허용**한다 (sidebar 가 collection/table preview 를 열 때는 tab 이 아직
//! 만들어지지 않음). 나머지 4 source (`raw`, `grid-edit`, `ddl-structure`,
//! `mongo-op`) 는 모두 tab 안에서 발생하는 사용자 action 이므로 `tab_id`
//! 가 항상 set 되어야 한다.
//!
//! 본 audit 는 boot 직후 `SELECT COUNT(*) FROM query_history WHERE tab_id
//! IS NULL AND source != 'sidebar-prefetch'` 를 실행한다. 결과가 0 보다
//! 크면 frontend 의 어딘가에서 `tab_id` 를 채우지 않은 채 IPC 를 호출한
//! 회귀가 있다 — Q10 zero-telemetry 정책상 외부 (Sentry 등) 으로 전송하지
//! 않고 dev console 에 `tracing::error!` 한 줄만 남긴다. 사용자 visible
//! surface (toast / dialog) 는 0. release 빌드의 사용자에게는 아무 영향
//! 없음.
//!
//! `lib.rs` 의 `setup` 안에서 `boot_audit_history_tab_id_null` 를 detached
//! task 로 spawn — `mismatch_metric` / `boot_history_retention_vacuum` 과
//! 동일한 paradigm (best-effort, first paint 블록 0).

use crate::commands::sqlite_pool;
use sqlx::SqlitePool;
use tracing::{error, info, warn};

/// `tab_id IS NULL` row 중 `source != 'sidebar-prefetch'` 갯수를 count.
/// pool 이 주입된 형태 — integration 테스트가 TempDir 기반 pool 로 직접
/// 호출 가능. production 에서는 `boot_audit_history_tab_id_null()` wrapper
/// 가 `sqlite_pool::get_or_init_pool()` 를 통해 호출한다.
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

/// Inner — pool 이 주입된 형태. 통합 테스트 entry point.
/// 0 이면 info-level summary log, 1 이상이면 error-level 로 알림.
pub async fn boot_audit_history_tab_id_null_inner(pool: &SqlitePool) {
    let count = count_history_tab_id_null_non_prefetch(pool).await;
    if count > 0 {
        // **invariant 위반**: 4 source (raw / grid-edit / ddl-structure /
        // mongo-op) 중 어딘가가 tab_id 를 채우지 않은 채 IPC 를 호출했다.
        // Q10 zero-telemetry — 외부 전송 0, dev console 에 error 한 줄.
        // `target` 은 grep / log filter 용 identifier.
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

/// Detached task entry. `lib.rs::setup` 의 `tauri::async_runtime::spawn`
/// 안에서 호출. self-contained — pool init / audit query 까지 한 곳에서
/// 처리, 어느 단계 실패해도 `tracing::warn` 만 남기고 정상 종료.
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
    //! 작성 2026-05-17 (Phase 6 sprint-375). count query 자체의 동작 검증.
    //! 본격 integration (boot 시뮬, log 검증) 은
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

    /// 시드 row 헬퍼 — `tab_id` 와 `source` 만 받아 INSERT.
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
        // 정상 path — sidebar-prefetch + tab_id NULL.
        insert_row(&pool, None, "sidebar-prefetch").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 0, "sidebar-prefetch 는 NULL tab_id 허용");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn non_prefetch_with_null_tab_id_is_counted() {
        let (_dir, pool) = setup().await;
        // 위반 path — `raw` source 인데 tab_id NULL.
        insert_row(&pool, None, "raw").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 1, "raw + NULL tab_id 는 invariant 위반");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn non_prefetch_with_filled_tab_id_is_not_counted() {
        let (_dir, pool) = setup().await;
        // 정상 path — raw + tab_id 채워짐.
        insert_row(&pool, Some("tab-1"), "raw").await;
        insert_row(&pool, Some("tab-2"), "grid-edit").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn mixed_rows_count_only_violations() {
        let (_dir, pool) = setup().await;
        // 정상 (3)
        insert_row(&pool, Some("tab-1"), "raw").await;
        insert_row(&pool, Some("tab-2"), "grid-edit").await;
        insert_row(&pool, None, "sidebar-prefetch").await;
        // 위반 (2)
        insert_row(&pool, None, "raw").await;
        insert_row(&pool, None, "mongo-op").await;
        let count = count_history_tab_id_null_non_prefetch(&pool).await;
        assert_eq!(count, 2);
        cleanup();
    }
}
