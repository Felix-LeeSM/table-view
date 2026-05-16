//! 작성 2026-05-16 (Phase 4 sprint-369) — `set_datagrid_prefs` partial patch.
//!
//! Contract Q20.4 + Q20.5 + codex 7차 #1 / 8차 #5.
//!   - widths 만 patch → widths_json 만 갱신, hidden_columns_json 기존 값 유지.
//!   - hiddenColumns 만 patch → hidden_columns_json 만 갱신, widths_json 유지.
//!   - 빈 patch (둘 다 None) → `AppError::Validation` 400.
//!
//! AC mapping:
//!   - AC-369-01 widths 만 patch (hidden 보존)
//!   - AC-369-02 hiddenColumns 만 patch (widths 보존)
//!   - AC-369-03 빈 patch → 400 Validation

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
    // guard_legacy_import_done 통과 보장 — datagrid_prefs 의 set 역시 mutate IPC.
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
// AC-369-01 — widths 만 patch 시 hidden_columns_json 유지
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_01_widths_only_patch_preserves_hidden_columns() {
    let (_dir, pool) = setup().await;

    // seed: 둘 다 채워진 row.
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

    // patch: widths 만.
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
// AC-369-02 — hiddenColumns 만 patch 시 widths_json 유지
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
// AC-369-03 — 빈 patch (둘 다 None) → AppError::Validation 400.
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

    // row 가 생성되지 않았어야 함.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    cleanup();
}

// ---------------------------------------------------------------------------
// 초기 INSERT — row 가 없는 상태에서 widths 만 patch → 그 column 만 채우고
// hidden 은 default `[]` 유지.
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
