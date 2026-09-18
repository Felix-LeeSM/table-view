//! Written 2026-05-16 — field-scoped `reset_datagrid_prefs`.
//!
//! Contract Q20.4: three field branches.
//!   - `widths` → widths_json = '{}', hidden kept.
//!   - `hiddenColumns` → hidden_columns_json = '[]', widths kept.
//!   - `all` → row DELETE.
//!
//! AC mapping:
//!   - AC-369-05 reset widths only
//!   - AC-369-06 reset hidden only
//!   - AC-369-07 reset all → row DELETE
//!
//! The two affordances are independent — a widths reset never unhides a column,
//! and a hidden reset never touches the widths.

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::datagrid_prefs::{
    reset_datagrid_prefs_inner, set_datagrid_prefs_inner, ColumnPrefsPk, ResetDatagridPrefsRequest,
    ResetField, SetDatagridPrefsRequest,
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

fn pk(table: &str) -> ColumnPrefsPk {
    ColumnPrefsPk {
        connection_id: "conn-1".into(),
        paradigm: "rdb".into(),
        db_name: "appdb".into(),
        namespace: "public".into(),
        table_name: table.into(),
    }
}

async fn seed(pool: &SqlitePool, table: &str) {
    set_datagrid_prefs_inner(
        pool,
        SetDatagridPrefsRequest {
            pk: pk(table),
            widths: Some(serde_json::json!({ "a": 100, "b": 200 })),
            hidden_columns: Some(vec!["a".into(), "c".into()]),
        },
    )
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// AC-369-05 — field="widths" → widths_json = '{}', hidden kept.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_05_reset_widths_field_only_clears_widths_and_preserves_hidden() {
    let (_dir, pool) = setup().await;
    seed(&pool, "tw").await;

    reset_datagrid_prefs_inner(
        &pool,
        ResetDatagridPrefsRequest {
            pk: pk("tw"),
            field: ResetField::Widths,
        },
    )
    .await
    .unwrap();

    let (widths_json, hidden_json): (String, String) = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json FROM datagrid_column_prefs \
         WHERE table_name = ?",
    )
    .bind("tw")
    .fetch_one(&pool)
    .await
    .unwrap();

    let widths_v: serde_json::Value = serde_json::from_str(&widths_json).unwrap();
    let hidden_v: serde_json::Value = serde_json::from_str(&hidden_json).unwrap();
    assert_eq!(widths_v, serde_json::json!({}));
    assert_eq!(
        hidden_v,
        serde_json::json!(["a", "c"]),
        "hidden 은 widths reset 의 영향 0"
    );
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-369-06 — field="hiddenColumns" → hidden_columns_json = '[]', widths kept.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_06_reset_hidden_field_only_clears_hidden_and_preserves_widths() {
    let (_dir, pool) = setup().await;
    seed(&pool, "th").await;

    reset_datagrid_prefs_inner(
        &pool,
        ResetDatagridPrefsRequest {
            pk: pk("th"),
            field: ResetField::HiddenColumns,
        },
    )
    .await
    .unwrap();

    let (widths_json, hidden_json): (String, String) = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json FROM datagrid_column_prefs \
         WHERE table_name = ?",
    )
    .bind("th")
    .fetch_one(&pool)
    .await
    .unwrap();

    let widths_v: serde_json::Value = serde_json::from_str(&widths_json).unwrap();
    let hidden_v: serde_json::Value = serde_json::from_str(&hidden_json).unwrap();
    assert_eq!(widths_v, serde_json::json!({ "a": 100, "b": 200 }));
    assert_eq!(hidden_v, serde_json::json!([]));
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-369-07 — field="all" → row DELETE.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_07_reset_all_deletes_row() {
    let (_dir, pool) = setup().await;
    seed(&pool, "ta").await;

    let count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs WHERE table_name = ?")
            .bind("ta")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_before, 1);

    reset_datagrid_prefs_inner(
        &pool,
        ResetDatagridPrefsRequest {
            pk: pk("ta"),
            field: ResetField::All,
        },
    )
    .await
    .unwrap();

    let count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs WHERE table_name = ?")
            .bind("ta")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_after, 0, "all reset 은 row 자체를 DELETE");
    cleanup();
}

// ---------------------------------------------------------------------------
// Reset with no row present — every field is a clean no-op (the UI can send it
// twice through a race, so it has to be idempotent).
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn reset_on_missing_row_is_noop_for_all_three_fields() {
    let (_dir, pool) = setup().await;

    for field in [
        ResetField::Widths,
        ResetField::HiddenColumns,
        ResetField::All,
    ] {
        reset_datagrid_prefs_inner(
            &pool,
            ResetDatagridPrefsRequest {
                pk: pk("missing"),
                field,
            },
        )
        .await
        .unwrap();
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    cleanup();
}
