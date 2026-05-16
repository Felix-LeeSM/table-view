//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-05) — `list_history` 응답
//! 의 **어떤 row 에도 `sql` 필드 부재**.
//!
//! Privacy invariant (strategy doc F.5 line 540) — 원본 SQL 은 detail IPC
//! 에서만 노출. list 응답이 우연히라도 `sql` key 를 carry 하면 toast / UI
//! 가 무의식적으로 노출할 수 있어 row-level 검증으로 잠근다.
//!
//! 검증 전략: backend 의 `ListHistoryResponse` 를 `serde_json::Value` 로
//! serialize 한 뒤 `rows[i]` 의 key set 에 `"sql"` 이 부재한지 확인.
//! `sqlRedacted` 는 반드시 있어야 한다 (redacted 표시용).

use serde_json::{json, Value};
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{
    add_history_entry_inner, list_history_inner, AddHistoryEntryRequest, ListHistoryRequest,
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tokio::test]
#[serial]
async fn ac_371_05_list_response_omits_sql_field_for_every_row() {
    let (_dir, pool) = setup().await;

    // 5 entries with secrets in SQL bodies — if any leak into the
    // response we want to detect them.
    let secrets = vec![
        "SELECT * FROM users WHERE email = 'leak1@example.com'",
        "SELECT * FROM users WHERE password = 'super_secret_password'",
        "SELECT * FROM users WHERE token = 'leak_token_value'",
        "SELECT * FROM users WHERE pin = 1234",
        "INSERT INTO secret_audit VALUES ('this_should_not_leak')",
    ];
    for sql in &secrets {
        let req: AddHistoryEntryRequest = serde_json::from_value(json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": *sql,
            "status": "success",
            "durationMs": 5,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(&pool, req).await.unwrap();
    }

    let req: ListHistoryRequest = serde_json::from_value(json!({})).unwrap();
    let resp = list_history_inner(&pool, req).await.unwrap();
    assert_eq!(resp.rows.len(), 5);

    // Serialize to JSON to inspect the wire shape.
    let serialized: Value = serde_json::to_value(&resp).unwrap();
    let rows = serialized
        .get("rows")
        .and_then(|v| v.as_array())
        .expect("rows must be a JSON array");

    for (i, row) in rows.iter().enumerate() {
        let obj = row.as_object().expect("each row must be a JSON object");
        assert!(
            !obj.contains_key("sql"),
            "row {} contains forbidden `sql` key — privacy invariant violation: {:?}",
            i,
            obj.keys().collect::<Vec<_>>()
        );
        assert!(
            obj.contains_key("sqlRedacted"),
            "row {} missing `sqlRedacted`",
            i
        );
        // 어떤 row 의 value 에도 secret 원문이 등장하면 안 됨.
        let serialized_row = serde_json::to_string(row).unwrap();
        for needle in [
            "leak1@example.com",
            "super_secret_password",
            "leak_token_value",
            "this_should_not_leak",
        ] {
            assert!(
                !serialized_row.contains(needle),
                "row {} leaks secret '{}': {}",
                i,
                needle,
                serialized_row
            );
        }
    }

    cleanup();
}
