//! 작성 2026-05-17 (Phase 5 sprint-373, AC-373-05) — boot 후 retention
//! vacuum 이 30일 + 1초 row 를 삭제하고 29일 row 를 유지하는지 검증.
//!
//! 사유 (test scenarios 8 원칙 적용):
//!   - user journey end-to-end: 사용자 app 을 boot — `lib.rs::setup` 의
//!     detached task 가 `boot_history_retention_vacuum()` 호출 → 31일 row
//!     0건, 29일 row 유지.
//!   - lego 맞물림: `settings.query_history_retention_days` row read +
//!     sprint-371 의 vacuum function + sprint-373 의 boot wiring 세 piece
//!     가 함께 동작해야 통과.
//!   - sentinel row (29일) 가 keep / 31일 row 가 drop 인 양 쪽 단언으로
//!     "vacuum 이 너무 광범위" / "vacuum 이 너무 보수적" 회귀 모두 잡힘.
//!
//! 본 테스트는 `boot_history_retention_vacuum()` 을 직접 호출 — 실제
//! tauri 부팅을 spawn 하지 않고 같은 entrypoint 를 시뮬레이션 (lib.rs 의
//! `tauri::async_runtime::spawn` 안에서 호출되는 함수와 동일).

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

/// AC-373-05 — 30일 + 1초 전 row 는 vacuum 후 0건, 29일 row 는 유지.
///
/// 사용자 journey: app 을 30일 retention 으로 설정 후 launch → boot 직후
/// detached task 가 vacuum 실행 → 사용자가 history panel 을 열어보면
/// "29일 row 만 남음".
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

    // 30일 + 1초 전 row — vacuum 대상.
    let old_id = insert_row_at(&pool, now - 30 * DAY_MS - 1_000, "31day").await;
    // 29일 전 row — 보존 대상 (sentinel).
    let recent_id = insert_row_at(&pool, now - 29 * DAY_MS, "29day").await;

    // Pre-vacuum sanity: 2 row 가 있어야 vacuum 결과 단언이 의미 있다.
    let pre_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pre_count, 2, "pre-vacuum 시점 2 row 가 시드되어 있어야 함");

    // boot wiring 직접 호출 — `lib.rs::setup` 의 spawn 안에서 부르는 것과 동일.
    boot_history_retention_vacuum_inner(&pool).await;

    // 31일 row → 0건. 29일 row → 유지.
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

/// AC-373-07 — settings row 가 부재하면 30d default 가 적용 (신규 사용자
/// 의 first boot 시 backend 가 silent default 로 vacuum). 위 테스트가
/// settings 를 명시 persist 한 것과 대비.
#[tokio::test]
#[serial]
async fn ac_373_07_default_30d_when_setting_absent() {
    let (_dir, pool) = setup().await;
    // settings.query_history_retention_days row 가 없는 상태 (신규 boot).

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

/// 0 = "Forever" — vacuum no-op. 사용자가 "기록 보관 무제한" 으로 설정한
/// 경우 boot vacuum 이 row 를 한 건도 안 건드림.
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
    // 1년 전 row — retention=0 이면 절대 안 사라짐.
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
