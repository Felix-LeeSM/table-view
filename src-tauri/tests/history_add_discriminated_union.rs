//! Written 2026-05-17 (AC-371-01) — verifies the discriminated union of
//! `add_history_entry`.
//!
//! Wire shape:
//!   `{ paradigm: "rdb",      queryMode: "sql" }`  → OK
//!   `{ paradigm: "rdb",      queryMode: "find" }` → 400 (serde reject)
//!   `{ paradigm: "document", queryMode: "find" }` → OK
//!   `{ paradigm: "document", queryMode: "sql" }`  → 400 (serde reject)
//!
//! The invariant here uses the same wire shape as the frontend wrapper test
//! (`src/lib/tauri/history.test.ts`) — it runs the req payload of
//! invoke("add_history_entry", { req: {...} }) through serde as
//! byte-equivalent JSON and checks that the backend's validation accepts it
//! (rdb+sql) or rejects it (rdb+find).

use serde_json::json;
use serial_test::serial;
use sqlx::SqlitePool;
use table_view_lib::commands::history::{add_history_entry_inner, AddHistoryEntryRequest};
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

/// AC-371-01 case 1: rdb + sql → OK. The INSERT succeeds and returns a row id.
#[tokio::test]
#[serial]
async fn rdb_sql_round_trips_successfully() {
    let (_dir, pool) = setup().await;

    let payload = json!({
        "connectionId": "c-1",
        "tabId": "tab-1",
        "paradigm": "rdb",
        "queryMode": "sql",
        "database": "appdb",
        "collection": null,
        "source": "raw",
        "sql": "SELECT * FROM users WHERE email = 'a@b.com'",
        "status": "success",
        "errorMessage": null,
        "rowsAffected": 42,
        "durationMs": 17,
        "executedAt": now_ms(),
        "serverPid": null,
    });

    let req: AddHistoryEntryRequest = serde_json::from_value(payload).unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();

    assert!(
        resp.id > 0,
        "AUTOINCREMENT id must be positive, got {}",
        resp.id
    );
    assert_eq!(
        resp.sql_redacted, "SELECT * FROM users WHERE email = ?",
        "backend must apply sql_redact regex masking"
    );
    cleanup();
}

/// AC-371-01 case 2: rdb + find → serde reject (400 mapped to Validation /
/// serde error). The wire test asserts that a payload with the invalid
/// combination fails to deserialize into `AddHistoryEntryRequest`, which is
/// the path Tauri's IPC layer takes (serde deserialize first → handler).
#[tokio::test]
#[serial]
async fn rdb_find_serde_reject_returns_error_400() {
    let _setup = setup().await;

    let payload = json!({
        "connectionId": "c-1",
        "paradigm": "rdb",
        "queryMode": "find",
        "source": "raw",
        "sql": "db.users.find({})",
        "status": "success",
        "durationMs": 5,
        "executedAt": now_ms(),
    });

    let result = serde_json::from_value::<AddHistoryEntryRequest>(payload);
    assert!(
        result.is_err(),
        "rdb+find must be rejected by serde — got Ok"
    );
    cleanup();
}

/// AC-371-01 case 3: document + find → OK.
#[tokio::test]
#[serial]
async fn document_find_round_trips_successfully() {
    let (_dir, pool) = setup().await;

    let payload = json!({
        "connectionId": "c-mongo",
        "paradigm": "document",
        "queryMode": "find",
        "database": "shop",
        "collection": "orders",
        "source": "raw",
        "sql": "db.orders.find({status: 'paid'})",
        "status": "success",
        "durationMs": 8,
        "executedAt": now_ms(),
    });

    let req: AddHistoryEntryRequest = serde_json::from_value(payload).unwrap();
    let resp = add_history_entry_inner(&pool, req).await.unwrap();

    assert!(resp.id > 0);
    assert!(
        resp.sql_redacted.contains("?"),
        "'paid' literal must be redacted, got {}",
        resp.sql_redacted
    );
    cleanup();
}

/// AC-371-01 case 4: document + sql → serde reject.
#[tokio::test]
#[serial]
async fn document_sql_serde_reject_returns_error_400() {
    let _setup = setup().await;

    let payload = json!({
        "connectionId": "c-mongo",
        "paradigm": "document",
        "queryMode": "sql",
        "source": "raw",
        "sql": "SELECT * FROM orders",
        "status": "success",
        "durationMs": 5,
        "executedAt": now_ms(),
    });

    let result = serde_json::from_value::<AddHistoryEntryRequest>(payload);
    assert!(
        result.is_err(),
        "document+sql must be rejected by serde — got Ok"
    );
    cleanup();
}
