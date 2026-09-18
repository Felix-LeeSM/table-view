//! Written 2026-05-16 — `set_datagrid_prefs` partial patch.
//!
//! Contract Q20.4 + Q20.5.
//!   - widths-only patch → updates widths_json only, keeps the existing
//!     hidden_columns_json.
//!   - hiddenColumns-only patch → updates hidden_columns_json only, keeps
//!     widths_json.
//!   - empty patch (both None) → `AppError::Validation` 400.
//!
//! AC mapping:
//!   - AC-369-01 widths-only patch (hidden preserved)
//!   - AC-369-02 hiddenColumns-only patch (widths preserved)
//!   - AC-369-03 empty patch → 400 Validation

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::datagrid_prefs::{
    set_datagrid_prefs_inner, ColumnPrefsPk, SetDatagridPrefsRequest,
};
use table_view_lib::error::AppError;
use table_view_lib::storage::local;
use table_view_lib::storage::meta::{set_legacy_import_state, LegacyImportState};
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    // Make sure guard_legacy_import_done passes — the datagrid_prefs set is a
    // mutate IPC too.
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

// ---------------------------------------------------------------------------
// AC-369-01 — a widths-only patch keeps hidden_columns_json
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_01_widths_only_patch_preserves_hidden_columns() {
    let (_dir, pool) = setup().await;

    // seed: a row with both columns filled in.
    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("users"),
            widths: Some(serde_json::json!({ "a": 100 })),
            hidden_columns: Some(vec!["secret".into()]),
        },
    )
    .await
    .unwrap();

    // patch: widths only.
    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("users"),
            widths: Some(serde_json::json!({ "a": 200 })),
            hidden_columns: None,
        },
    )
    .await
    .unwrap();

    let (widths_json, hidden_json): (String, String) = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json FROM datagrid_column_prefs \
         WHERE connection_id = ? AND paradigm = ? AND db_name = ? AND namespace = ? AND table_name = ?",
    )
    .bind("conn-1")
    .bind("rdb")
    .bind("appdb")
    .bind("public")
    .bind("users")
    .fetch_one(&pool)
    .await
    .unwrap();

    let widths_v: serde_json::Value = serde_json::from_str(&widths_json).unwrap();
    let hidden_v: serde_json::Value = serde_json::from_str(&hidden_json).unwrap();
    assert_eq!(widths_v, serde_json::json!({ "a": 200 }));
    assert_eq!(
        hidden_v,
        serde_json::json!(["secret"]),
        "hidden 은 patch 에 미포함이므로 보존되어야 함"
    );
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-369-02 — a hiddenColumns-only patch keeps widths_json
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_02_hidden_only_patch_preserves_widths() {
    let (_dir, pool) = setup().await;

    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("orders"),
            widths: Some(serde_json::json!({ "x": 50 })),
            hidden_columns: Some(vec![]),
        },
    )
    .await
    .unwrap();

    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("orders"),
            widths: None,
            hidden_columns: Some(vec!["b".into(), "c".into()]),
        },
    )
    .await
    .unwrap();

    let (widths_json, hidden_json): (String, String) = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json FROM datagrid_column_prefs \
         WHERE connection_id = ? AND paradigm = ? AND db_name = ? AND namespace = ? AND table_name = ?",
    )
    .bind("conn-1")
    .bind("rdb")
    .bind("appdb")
    .bind("public")
    .bind("orders")
    .fetch_one(&pool)
    .await
    .unwrap();

    let widths_v: serde_json::Value = serde_json::from_str(&widths_json).unwrap();
    let hidden_v: serde_json::Value = serde_json::from_str(&hidden_json).unwrap();
    assert_eq!(widths_v, serde_json::json!({ "x": 50 }));
    assert_eq!(hidden_v, serde_json::json!(["b", "c"]));
    cleanup();
}

// ---------------------------------------------------------------------------
// AC-369-03 — empty patch (both None) → AppError::Validation 400.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_03_empty_patch_rejected_with_validation_400() {
    let (_dir, pool) = setup().await;

    let err = set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("empty_case"),
            widths: None,
            hidden_columns: None,
        },
    )
    .await
    .unwrap_err();

    match err {
        AppError::Validation(msg) => {
            assert!(
                msg.contains("widths") && msg.contains("hiddenColumns"),
                "validation message must reference both fields: {msg}"
            );
        }
        other => panic!("expected Validation, got: {other:?}"),
    }

    // No row must have been created.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    cleanup();
}

// ---------------------------------------------------------------------------
// First INSERT — a widths-only patch with no existing row fills that column
// only and leaves hidden at the default `[]`.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn first_patch_with_widths_only_inserts_row_with_default_hidden() {
    let (_dir, pool) = setup().await;

    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("fresh"),
            widths: Some(serde_json::json!({ "id": 80 })),
            hidden_columns: None,
        },
    )
    .await
    .unwrap();

    let (widths_json, hidden_json): (String, String) = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json FROM datagrid_column_prefs \
         WHERE table_name = ?",
    )
    .bind("fresh")
    .fetch_one(&pool)
    .await
    .unwrap();
    let widths_v: serde_json::Value = serde_json::from_str(&widths_json).unwrap();
    let hidden_v: serde_json::Value = serde_json::from_str(&hidden_json).unwrap();
    assert_eq!(widths_v, serde_json::json!({ "id": 80 }));
    assert_eq!(hidden_v, serde_json::json!([]));
    cleanup();
}
