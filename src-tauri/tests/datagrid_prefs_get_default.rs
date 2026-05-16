//! 작성 2026-05-16 (Phase 4 sprint-369) — `get_datagrid_prefs` row 부재 시 응답.
//!
//! Contract Q20.4: row 0 → `{ widths: {}, hiddenColumns: [], updatedAt: null }`.
//! UI 코드는 "exists" check 불필요 — 빈 default 가 정상 첫 사용 표현.
//!
//! AC mapping:
//!   - AC-369-04 row 없음 → 빈 응답
//!   - row 존재 시 모든 필드가 round-trip

use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::datagrid_prefs::{
    get_datagrid_prefs_inner, set_datagrid_prefs_inner, ColumnPrefsPk, SetDatagridPrefsRequest,
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

// ---------------------------------------------------------------------------
// AC-369-04 — row 없음 → { widths:{}, hiddenColumns:[], updatedAt: null }.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn ac_369_04_get_missing_row_returns_empty_defaults_and_null_updated_at() {
    let (_dir, pool) = setup().await;

    let response = get_datagrid_prefs_inner(&pool, pk("absent")).await.unwrap();

    assert_eq!(response.widths, serde_json::json!({}));
    assert_eq!(response.hidden_columns, Vec::<String>::new());
    assert_eq!(response.updated_at, None);
    cleanup();
}

// ---------------------------------------------------------------------------
// row 존재 시 widths / hidden / updatedAt 모두 round-trip.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn get_existing_row_returns_widths_hidden_and_updated_at() {
    let (_dir, pool) = setup().await;

    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk("present"),
            widths: Some(serde_json::json!({ "id": 60, "label": 200 })),
            hidden_columns: Some(vec!["secret".into(), "internal".into()]),
        },
    )
    .await
    .unwrap();

    let response = get_datagrid_prefs_inner(&pool, pk("present"))
        .await
        .unwrap();

    assert_eq!(
        response.widths,
        serde_json::json!({ "id": 60, "label": 200 })
    );
    assert_eq!(response.hidden_columns, vec!["secret", "internal"]);
    assert!(
        response.updated_at.is_some(),
        "updatedAt must be Some(unix_ms) after write"
    );
    cleanup();
}

// ---------------------------------------------------------------------------
// PK 5-tuple 격리 — 다른 paradigm / db_name / namespace 의 같은 table_name 은
// 서로 다른 row.
// ---------------------------------------------------------------------------

#[tokio::test]
#[serial]
async fn get_is_partitioned_by_full_pk_tuple() {
    let (_dir, pool) = setup().await;

    let pk_rdb = ColumnPrefsPk {
        connection_id: "c".into(),
        paradigm: "rdb".into(),
        db_name: "db1".into(),
        namespace: "public".into(),
        table_name: "items".into(),
    };
    let pk_doc = ColumnPrefsPk {
        connection_id: "c".into(),
        paradigm: "document".into(),
        db_name: "db1".into(),
        namespace: "db1".into(),
        table_name: "items".into(),
    };

    set_datagrid_prefs_inner(
        &pool,
        SetDatagridPrefsRequest {
            pk: pk_rdb.clone(),
            widths: Some(serde_json::json!({ "rdb_col": 10 })),
            hidden_columns: None,
        },
    )
    .await
    .unwrap();

    let rdb_res = get_datagrid_prefs_inner(&pool, pk_rdb).await.unwrap();
    let doc_res = get_datagrid_prefs_inner(&pool, pk_doc).await.unwrap();

    assert_eq!(rdb_res.widths, serde_json::json!({ "rdb_col": 10 }));
    assert_eq!(
        doc_res.widths,
        serde_json::json!({}),
        "다른 paradigm 의 PK 매치 → 부재 응답"
    );
    cleanup();
}
