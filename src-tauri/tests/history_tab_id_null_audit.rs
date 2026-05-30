//! 작성 2026-05-17 (Phase 6 sprint-375, AC-375-05) — boot 후 audit 가
//! `tab_id IS NULL AND source != 'sidebar-prefetch'` row 를 정확히 카운트
//! 하는지 검증.
//!
//! 사유 (test scenarios 8 원칙 적용):
//!   - **user journey end-to-end**: 사용자 app 을 boot — `lib.rs::setup` 의
//!     detached task 가 `boot_audit_history_tab_id_null_inner(pool)` 를
//!     호출 → 정상/위반 source row 를 시드 → count 단언.
//!   - **lego 맞물림**: history.rs (sprint-371) 의 schema (`tab_id`
//!     nullable + `source TEXT NOT NULL`) + sprint-375 의 audit query 두
//!     piece 가 함께 동작해야 통과.
//!   - **sentinel 양극**: count = 0 (clean) / count > 0 (위반) 양 쪽
//!     lock 으로 "audit query 가 광범위" / "audit query 가 너무 보수적"
//!     회귀 모두 잡힘.
//!
//! 본 테스트는 `boot_audit_history_tab_id_null_inner(&pool)` 을 직접 호출
//! — 실제 tauri 부팅을 spawn 하지 않고 같은 entrypoint 를 시뮬레이션 (lib.rs
//! 의 `tauri::async_runtime::spawn` 안에서 호출되는 함수와 동일).

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::storage::history_audit::{
    boot_audit_history_tab_id_null_inner, count_history_tab_id_null_non_prefetch,
};
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
async fn boot_audit_zero_when_clean() {
    // sprint-375 — empty table 시 audit 가 0 을 보고하고 boot 흐름이 throw
    // 없이 종료. user journey: 신규 설치 사용자 / fresh DB / 첫 boot 시나리오.
    let (_dir, pool) = setup().await;
    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(count, 0, "empty table 은 audit clean");

    // boot 함수 자체도 panic 없이 종료해야 함 (logging 만).
    boot_audit_history_tab_id_null_inner(&pool).await;
    cleanup();
}

#[tokio::test]
#[serial]
async fn boot_audit_counts_only_non_prefetch_null_tabs() {
    // sprint-375 — source별 invariant rule 을 정확히 enforce 하는지
    // user journey 끝-까지 검증:
    //   - sidebar-prefetch + tab_id NULL  → 허용 (count 미포함)
    //   - raw / grid-edit / ddl-structure / mongo-op / explain + tab_id NULL → 위반
    //   - 모두 tab_id 채워짐 → 허용
    let (_dir, pool) = setup().await;

    // 정상 path 3종
    insert_row(&pool, Some("tab-1"), "raw").await;
    insert_row(&pool, Some("tab-2"), "grid-edit").await;
    insert_row(&pool, None, "sidebar-prefetch").await;

    // 위반 path 2종 — 다른 source / 모두 NULL tab_id
    insert_row(&pool, None, "raw").await;
    insert_row(&pool, None, "ddl-structure").await;

    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(
        count, 2,
        "raw / ddl-structure + NULL tab_id 2건만 위반 count 에 포함"
    );

    // boot inner — count > 0 이라도 panic 안 됨 (error log 한 줄).
    boot_audit_history_tab_id_null_inner(&pool).await;
    cleanup();
}

#[tokio::test]
#[serial]
async fn boot_audit_all_non_prefetch_sources_flagged() {
    // sprint-375 — 회귀 가드: non-prefetch source 각각 NULL tab_id 시
    // count 에 포함되는지 individual 확인. user journey: 회귀가 한 source
    // 만 break 했을 때 (예: ddl-structure caller 가 tab_id elide) 도 잡힘.
    let (_dir, pool) = setup().await;

    insert_row(&pool, None, "raw").await;
    insert_row(&pool, None, "grid-edit").await;
    insert_row(&pool, None, "ddl-structure").await;
    insert_row(&pool, None, "mongo-op").await;
    insert_row(&pool, None, "explain").await;
    // 그리고 정상 path 도 같이 — 둘이 섞여도 정확.
    insert_row(&pool, None, "sidebar-prefetch").await;
    insert_row(&pool, Some("tab-9"), "raw").await;

    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(count, 5);
    cleanup();
}
