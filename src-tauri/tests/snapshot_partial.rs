//! 작성 2026-05-16 (Phase 1 sprint-357) — `get_initial_app_state_inner` 의
//! partial fallback 검증 (AC-357-07). Strategy F.2 line 1125 — 한 store 의
//! SQLite query 실패 시 `{ error: "..." }` 만 그 슬롯에 채우고 `partial: true`.
//! 다른 store 는 정상 진행.
//!
//! 시나리오: `mru` 테이블을 drop 한 상태에서 snapshot 호출. mru 슬롯은
//! `{ error: "..." }` + partial=true; connections / workspaces / theme /
//! safe_mode 는 정상 (default 값).

use serial_test::serial;
use sqlx::SqlitePool;
use std::collections::HashMap;
use table_view_lib::commands::snapshot::get_initial_app_state_inner;
use table_view_lib::storage::local;
use tempfile::TempDir;

async fn setup() -> (TempDir, SqlitePool) {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    let pool = local::open_pool().await.unwrap();
    (dir, pool)
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

#[tokio::test]
#[serial]
async fn test_snapshot_partial_when_one_store_table_missing() {
    let (_dir, pool) = setup().await;

    // mru 테이블을 drop — read_mru 가 sqlx error 를 반환하게 만든다.
    sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();

    // partial: true.
    assert_eq!(
        json["partial"],
        serde_json::Value::Bool(true),
        "partial must be true when any store fails"
    );

    // mru slot 은 { error: "..." } 형태.
    let mru = json["stores"]["mru"].as_object().unwrap();
    assert!(
        mru.contains_key("error"),
        "mru slot must be {{ error: ... }} when table missing, got {:?}",
        mru.keys().collect::<Vec<_>>()
    );
    let err_msg = mru["error"].as_str().unwrap();
    assert!(
        !err_msg.is_empty(),
        "error message must be non-empty for debugging"
    );

    // 다른 store 들은 정상 (default).
    let conns = json["stores"]["connections"].as_object().unwrap();
    assert!(
        conns.contains_key("items"),
        "connections must remain non-error when its own table is intact"
    );
    let theme = json["stores"]["theme"].as_object().unwrap();
    assert!(theme.contains_key("themeId"));

    cleanup();
}

// 두 개의 store 가 동시에 fail 해도 둘 다 { error } 로 표현. partial=true.
#[tokio::test]
#[serial]
async fn test_snapshot_partial_with_multiple_failures() {
    let (_dir, pool) = setup().await;
    sqlx::query("DROP TABLE mru").execute(&pool).await.unwrap();
    sqlx::query("DROP TABLE settings")
        .execute(&pool)
        .await
        .unwrap();

    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();

    assert_eq!(json["partial"], serde_json::Value::Bool(true));
    assert!(json["stores"]["mru"]
        .as_object()
        .unwrap()
        .contains_key("error"));
    assert!(json["stores"]["theme"]
        .as_object()
        .unwrap()
        .contains_key("error"));
    assert!(json["stores"]["safeMode"]
        .as_object()
        .unwrap()
        .contains_key("error"));
}

// All-OK 인 경우 partial: false.
#[tokio::test]
#[serial]
async fn test_snapshot_partial_false_when_all_stores_ok() {
    let (_dir, pool) = setup().await;
    let snap = get_initial_app_state_inner(&pool, "launcher", &HashMap::new())
        .await
        .unwrap();
    let json = serde_json::to_value(&snap).unwrap();
    assert_eq!(json["partial"], serde_json::Value::Bool(false));
    cleanup();
}
