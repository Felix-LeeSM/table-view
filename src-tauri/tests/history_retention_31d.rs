//! Written 2026-05-17 (AC-373-05) — verifies that the retention vacuum after
//! boot deletes a 30-day + 1-second row and keeps a 29-day row.
//!
//! Reason (applying the 8 test-scenario principles):
//!   - User journey end-to-end: the user boots the app — the detached task in
//!     `lib.rs::setup` calls `boot_history_retention_vacuum()` → 0 rows at
//!     31 days, the 29-day row kept.
//!   - Lego interlock: reading the `settings.query_history_retention_days`
//!     row, the vacuum function, and the boot wiring — all three pieces must
//!     work together for this to pass.
//!   - Asserting both sides, the sentinel row (29 days) kept and the 31-day
//!     row dropped, catches both the "vacuum too broad" and the "vacuum too
//!     conservative" regressions.
//!
//! This test calls `boot_history_retention_vacuum()` directly — it simulates
//! the same entrypoint without spawning a real tauri boot (the same function
//! that is called inside `tauri::async_runtime::spawn` in lib.rs).

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::persist_settings::{persist_setting_inner, PersistSettingRequest};
use table_view_lib::storage::history_retention_boot::boot_history_retention_vacuum_inner;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn insert_row_at(pool: &SqlitePool, executed_at: i64, label: &str) -> i64 {
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO query_history \
         (connection_id, paradigm, query_mode, source, sql, sql_redacted, \
          status, duration_ms, executed_at) \
         VALUES ('c1', 'rdb', 'sql', 'raw', ?, ?, 'success', 5, ?) \
         RETURNING id",
    )
    .bind(format!("SELECT 1 -- {}", label))
    .bind(format!("SELECT ? -- {}", label))
    .bind(executed_at)
    .fetch_one(pool)
    .await
    .unwrap();
    row.0
}

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// AC-373-05 — a row 30 days + 1 second old is gone after the vacuum, a
/// 29-day row is kept.
///
/// User journey: the user sets retention to 30 days and launches the app →
/// right after boot the detached task runs the vacuum → opening the history
/// panel shows "only the 29-day row remains".
#[tokio::test]
#[serial]
async fn ac_373_05_boot_vacuum_drops_31day_row_keeps_29day() {
    let (_dir, pool) = setup().await;

    // settings.query_history_retention_days = 30 (default value, AC-373-07).
    persist_setting_inner(
        &pool,
        PersistSettingRequest {
            key: "query_history_retention_days".into(),
            value_json: "30".into(),
        },
    )
    .await
    .unwrap();

    let now = now_ms();

    // Row 30 days + 1 second old — the vacuum target.
    let old_id = insert_row_at(&pool, now - 30 * DAY_MS - 1_000, "31day").await;
    // Row 29 days old — must be kept (sentinel).
    let recent_id = insert_row_at(&pool, now - 29 * DAY_MS, "29day").await;

    // Pre-vacuum sanity: the post-vacuum assertions only mean something when
    // 2 rows are seeded.
    let pre_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pre_count, 2, "pre-vacuum 시점 2 row 가 시드되어 있어야 함");

    // Call the boot wiring directly — same as the spawn in `lib.rs::setup`.
    boot_history_retention_vacuum_inner(&pool).await;

    // 31-day row → gone. 29-day row → kept.
    let remaining_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM query_history ORDER BY id ASC")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(
        !remaining_ids.contains(&old_id),
        "31일 전 row id={} 는 vacuum 으로 삭제되어야 함 — got remaining={:?}",
        old_id,
        remaining_ids
    );
    assert!(
        remaining_ids.contains(&recent_id),
        "29일 전 row id={} 는 유지되어야 함 — got remaining={:?}",
        recent_id,
        remaining_ids
    );
    assert_eq!(remaining_ids.len(), 1, "정확히 29일 row 만 남아야 함");

    cleanup();
}

/// AC-373-07 — when the settings row is absent the 30d default applies (on a
/// new user's first boot the backend vacuums with the silent default). This
/// contrasts with the test above, which persists the setting explicitly.
#[tokio::test]
#[serial]
async fn ac_373_07_default_30d_when_setting_absent() {
    let (_dir, pool) = setup().await;
    // No settings.query_history_retention_days row (a new boot).

    let now = now_ms();
    let old_id = insert_row_at(&pool, now - 31 * DAY_MS, "31day-default").await;
    let recent_id = insert_row_at(&pool, now - 7 * DAY_MS, "7day-default").await;

    boot_history_retention_vacuum_inner(&pool).await;

    let remaining_ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM query_history ORDER BY id ASC")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(
        !remaining_ids.contains(&old_id),
        "default 30d 적용 — 31일 row 가 drop 되어야 함"
    );
    assert!(remaining_ids.contains(&recent_id), "7일 row 는 유지");

    cleanup();
}

/// 0 = "Forever" — the vacuum is a no-op. When the user sets history keeping
/// to unlimited, the boot vacuum does not touch a single row.
#[tokio::test]
#[serial]
async fn forever_retention_zero_keeps_all_rows() {
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

    let now = now_ms();
    // Row 1 year old — with retention=0 it never disappears.
    let ancient_id = insert_row_at(&pool, now - 365 * DAY_MS, "1year-ancient").await;

    boot_history_retention_vacuum_inner(&pool).await;

    let remaining: Vec<i64> = sqlx::query_scalar("SELECT id FROM query_history")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        remaining.len(),
        1,
        "retention=0 (forever) — 모든 row 유지 (1년 전 row 도 그대로)"
    );
    assert!(remaining.contains(&ancient_id));

    cleanup();
}
