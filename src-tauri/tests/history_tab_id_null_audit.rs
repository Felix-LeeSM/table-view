//! Written 2026-05-17 (AC-375-05) — checks that the post-boot audit counts
//! `tab_id IS NULL AND source != 'sidebar-prefetch'` rows exactly.
//!
//! Reason (applying the 8 test-scenario principles):
//!   - **user journey end-to-end**: the user boots the app — the detached task in
//!     `lib.rs::setup` calls `boot_audit_history_tab_id_null_inner(pool)` → seed
//!     clean and violating source rows → assert the count.
//!   - **interlocking pieces**: the `query_history` schema (`tab_id` nullable +
//!     `source TEXT NOT NULL`) and the audit query are two pieces that have to
//!     work together for this to pass.
//!   - **both sentinel poles**: locking count = 0 (clean) and count > 0
//!     (violation) catches the "audit query is too broad" regression and the
//!     "audit query is too conservative" one alike.
//!
//! This test calls `boot_audit_history_tab_id_null_inner(&pool)` directly — it
//! does not spawn a real tauri boot, it simulates the same entrypoint (the same
//! function that runs inside `lib.rs`'s `tauri::async_runtime::spawn`).

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
    // With an empty table the audit reports 0 and the boot flow finishes without
    // throwing. user journey: new install / fresh DB / first boot.
    let (_dir, pool) = setup().await;
    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(count, 0, "empty table 은 audit clean");

    // The boot function itself must also finish without panicking (logging only).
    boot_audit_history_tab_id_null_inner(&pool).await;
    cleanup();
}

#[tokio::test]
#[serial]
async fn boot_audit_counts_only_non_prefetch_null_tabs() {
    // Checks end to end through the user journey that the per-source invariant
    // rule is enforced exactly:
    //   - sidebar-prefetch + tab_id NULL  → allowed (not counted)
    //   - raw / grid-edit / ddl-structure / mongo-op / explain + tab_id NULL → violation
    //   - tab_id filled in everywhere → allowed
    let (_dir, pool) = setup().await;

    // 3 clean paths
    insert_row(&pool, Some("tab-1"), "raw").await;
    insert_row(&pool, Some("tab-2"), "grid-edit").await;
    insert_row(&pool, None, "sidebar-prefetch").await;

    // 2 violating paths — different sources, both with NULL tab_id
    insert_row(&pool, None, "raw").await;
    insert_row(&pool, None, "ddl-structure").await;

    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(
        count, 2,
        "raw / ddl-structure + NULL tab_id 2건만 위반 count 에 포함"
    );

    // boot inner — no panic even when count > 0 (a single error log line).
    boot_audit_history_tab_id_null_inner(&pool).await;
    cleanup();
}

#[tokio::test]
#[serial]
async fn boot_audit_all_non_prefetch_sources_flagged() {
    // Regression guard: check one source at a time that every non-prefetch source
    // is counted when its tab_id is NULL. user journey: a regression that breaks
    // only one source (a ddl-structure caller eliding tab_id, say) is still
    // caught.
    let (_dir, pool) = setup().await;

    insert_row(&pool, None, "raw").await;
    insert_row(&pool, None, "grid-edit").await;
    insert_row(&pool, None, "ddl-structure").await;
    insert_row(&pool, None, "mongo-op").await;
    insert_row(&pool, None, "explain").await;
    // Plus the clean paths — the count stays exact when the two are mixed.
    insert_row(&pool, None, "sidebar-prefetch").await;
    insert_row(&pool, Some("tab-9"), "raw").await;

    let count = count_history_tab_id_null_non_prefetch(&pool).await;
    assert_eq!(count, 5);
    cleanup();
}
