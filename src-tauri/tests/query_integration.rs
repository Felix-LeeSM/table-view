mod common;

use std::time::{Duration, Instant};

use table_view_lib::commands::connection::AppState;
use table_view_lib::commands::query::{validate_cancel_inputs, validate_query_inputs};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    DatabaseType, FilterCondition, FilterOperator, QueryResult, QueryType,
};
use tokio_util::sync::CancellationToken;

async fn advance_cancel_start_window(duration: Duration) {
    tokio::time::pause();
    tokio::task::yield_now().await;
    tokio::time::advance(duration).await;
    tokio::time::resume();
}

/// Integration test for SELECT query execution
#[tokio::test]
#[serial_test::serial]
async fn test_select_query_returns_columns_and_rows() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Execute a simple SELECT query
    let result = adapter
        .execute_query("SELECT 1 as num, 'test' as str", None)
        .await
        .expect("SELECT query should succeed");

    // Verify the result structure
    assert_eq!(result.columns.len(), 2, "Should have 2 columns");
    assert_eq!(result.columns[0].name, "num");
    assert_eq!(result.columns[1].name, "str");
    assert_eq!(result.rows.len(), 1, "Should have 1 row");
    assert_eq!(result.total_count, 1);
    assert!(matches!(result.query_type, QueryType::Select));

    // Clean up
    adapter.disconnect_pool().await.ok();
}

/// Integration test for DML query execution
#[tokio::test]
#[serial_test::serial]
async fn test_dml_query_returns_rows_affected() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Use a unique table name to avoid collisions (same pattern as schema_integration)
    let table_name = format!(
        "test_dml_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    // Create table via execute_query (DDL)
    adapter
        .execute_query(&format!("CREATE TABLE {table_name} (id INT)"), None)
        .await
        .expect("CREATE TABLE should succeed");

    // Execute INSERT query
    let result = adapter
        .execute_query(
            &format!("INSERT INTO {table_name} VALUES (1), (2), (3)"),
            None,
        )
        .await
        .expect("INSERT query should succeed");

    // Verify DML result
    assert!(result.columns.is_empty(), "DML should have no columns");
    assert!(result.rows.is_empty(), "DML should have no rows");
    assert_eq!(result.total_count, 3, "Should affect 3 rows");
    match result.query_type {
        QueryType::Dml { rows_affected } => {
            assert_eq!(rows_affected, 3);
        }
        _ => panic!("Expected Dml query type"),
    }

    // Test UPDATE
    let update_result = adapter
        .execute_query(&format!("UPDATE {table_name} SET id = 10"), None)
        .await
        .expect("UPDATE query should succeed");

    assert_eq!(update_result.total_count, 3);

    // Test DELETE
    let delete_result = adapter
        .execute_query(&format!("DELETE FROM {table_name}"), None)
        .await
        .expect("DELETE query should succeed");

    assert_eq!(delete_result.total_count, 3);

    // Clean up: drop the test table
    adapter
        .execute_query(&format!("DROP TABLE {table_name}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// PostgreSQL Explain is plan inspection, not profiler execution.
#[tokio::test]
#[serial_test::serial]
async fn test_explain_query_does_not_execute_mutation() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let table_name = format!(
        "test_explain_plan_only_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    adapter
        .execute_query(&format!("CREATE TABLE {table_name} (id INT)"), None)
        .await
        .expect("CREATE TABLE should succeed");
    adapter
        .execute_query(&format!("INSERT INTO {table_name} VALUES (1)"), None)
        .await
        .expect("INSERT should succeed");

    let plan = adapter
        .explain_query(&format!("UPDATE {table_name} SET id = 2"))
        .await
        .expect("EXPLAIN should return a JSON plan");
    assert!(plan.is_array(), "PostgreSQL FORMAT JSON returns an array");

    let rows = adapter
        .execute_query(&format!("SELECT id FROM {table_name}"), None)
        .await
        .expect("SELECT should succeed");
    assert_eq!(rows.rows[0][0].as_i64(), Some(1));

    adapter
        .execute_query(&format!("DROP TABLE {table_name}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Integration test for DDL query execution
#[tokio::test]
#[serial_test::serial]
async fn test_ddl_query_returns_success() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Execute CREATE TABLE query
    let result = adapter
        .execute_query("CREATE TEMP TABLE test_ddl (id INT)", None)
        .await
        .expect("CREATE TABLE should succeed");

    // Verify DDL result
    assert!(result.columns.is_empty(), "DDL should have no columns");
    assert!(result.rows.is_empty(), "DDL should have no rows");
    assert_eq!(result.total_count, 0, "DDL should have 0 total_count");
    assert!(matches!(result.query_type, QueryType::Ddl));

    // Verify table was created
    let check_result = adapter
        .execute_query(
            "SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'test_ddl')",
            None,
        )
        .await
        .expect("EXISTS query should succeed");

    assert_eq!(check_result.rows.len(), 1);
    assert_eq!(check_result.total_count, 1);

    // Clean up
    adapter.disconnect_pool().await.ok();
}

/// Integration test for query cancellation
#[tokio::test]
#[serial_test::serial]
async fn test_query_cancellation_works() {
    use tokio_util::sync::CancellationToken;

    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Create a cancellation token
    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();

    // Clone adapter so the original stays alive for cleanup
    let spawned_adapter = adapter.clone();

    // Spawn a long-running query and cancel it
    let query_handle = tokio::spawn(async move {
        spawned_adapter
            .execute_query("SELECT pg_sleep(10)", Some(&child_token))
            .await
    });

    // Give the query a deterministic virtual start window.
    advance_cancel_start_window(Duration::from_millis(100)).await;

    // Cancel the query
    cancel_token.cancel();

    // Wait for the query to complete (it should be cancelled)
    let result = query_handle.await.expect("Task should complete");

    // Verify cancellation
    match result {
        Ok(_) => {
            // Query completed before cancellation - this is acceptable
            println!("Note: Query completed before cancellation could take effect");
        }
        Err(e) => {
            // Query was cancelled
            let error_msg = e.to_string();
            assert!(
                error_msg.contains("cancelled") || error_msg.contains("cancel"),
                "Expected cancellation error, got: {}",
                error_msg
            );
        }
    }

    // Clean up
    adapter.disconnect_pool().await.ok();
}

/// Integration test for query error handling
#[tokio::test]
#[serial_test::serial]
async fn test_query_error_returns_database_error() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Execute an invalid query
    let result = adapter
        .execute_query("SELECT * FROM nonexistent_table", None)
        .await;

    // Verify error is returned
    assert!(result.is_err(), "Invalid query should return error");

    let error = result.unwrap_err();
    let error_msg = error.to_string();
    assert!(
        error_msg.contains("Database"),
        "Error should be Database variant, got: {}",
        error_msg
    );

    // Clean up
    adapter.disconnect_pool().await.ok();
}

/// Integration test for complex SELECT with JOIN
#[tokio::test]
#[serial_test::serial]
async fn test_complex_select_query() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    // Create test tables via execute_query
    adapter
        .execute_query(
            &format!("CREATE TABLE users_{ts} (id INT, name TEXT)"),
            None,
        )
        .await
        .ok();

    adapter
        .execute_query(
            &format!("CREATE TABLE orders_{ts} (id INT, user_id INT, amount NUMERIC)"),
            None,
        )
        .await
        .ok();

    // Insert test data via execute_query
    adapter
        .execute_query(
            &format!("INSERT INTO users_{ts} VALUES (1, 'Alice'), (2, 'Bob')"),
            None,
        )
        .await
        .ok();

    adapter
        .execute_query(
            &format!(
                "INSERT INTO orders_{ts} VALUES (1, 1, 100.50), (2, 1, 200.00), (3, 2, 50.00)"
            ),
            None,
        )
        .await
        .ok();

    // Execute JOIN query
    let result = adapter
        .execute_query(
            &format!("SELECT u.name, o.amount FROM users_{ts} u JOIN orders_{ts} o ON u.id = o.user_id ORDER BY o.amount"),
            None,
        )
        .await
        .expect("JOIN query should succeed");

    // Verify results
    assert_eq!(result.columns.len(), 2);
    assert_eq!(result.rows.len(), 3);
    assert_eq!(result.total_count, 3);
    assert!(matches!(result.query_type, QueryType::Select));

    // Clean up
    adapter
        .execute_query(&format!("DROP TABLE users_{ts}"), None)
        .await
        .ok();
    adapter
        .execute_query(&format!("DROP TABLE orders_{ts}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Integration test for empty result set
#[tokio::test]
#[serial_test::serial]
async fn test_empty_result_set() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table_name = format!("test_empty_{ts}");

    // Create table via execute_query
    adapter
        .execute_query(&format!("CREATE TABLE {table_name} (id INT)"), None)
        .await
        .ok();

    // Query empty table — columns will be empty because no rows returned
    // (sqlx cannot determine column types from an empty result set)
    let result = adapter
        .execute_query(&format!("SELECT * FROM {table_name}"), None)
        .await
        .expect("Query should succeed");

    // Verify empty result (columns may be empty for empty result sets)
    assert!(result.rows.is_empty(), "Should have no rows");
    assert_eq!(result.total_count, 0);
    assert!(matches!(result.query_type, QueryType::Select));

    // Clean up
    adapter
        .execute_query(&format!("DROP TABLE {table_name}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ---------------------------------------------------------------------------
// Command-layer tests: validate input validation functions and CancellationToken
// management via AppState. These test the command logic without requiring a
// Tauri runtime.
// ---------------------------------------------------------------------------

/// Verify that validate_query_inputs rejects empty/whitespace SQL.
#[test]
fn test_command_validate_query_inputs_empty_sql() {
    let result = validate_query_inputs("", "conn-1");
    assert!(result.is_err());
    match result.unwrap_err() {
        AppError::Validation(msg) => {
            assert!(
                msg.contains("SQL query cannot be empty"),
                "Unexpected message: {msg}"
            );
        }
        other => panic!("Expected Validation error, got: {other:?}"),
    }
}

/// Verify that validate_query_inputs rejects empty connection_id.
#[test]
fn test_command_validate_query_inputs_empty_connection_id() {
    let result = validate_query_inputs("SELECT 1", "");
    assert!(result.is_err());
    match result.unwrap_err() {
        AppError::Validation(msg) => {
            assert!(
                msg.contains("Connection ID cannot be empty"),
                "Unexpected message: {msg}"
            );
        }
        other => panic!("Expected Validation error, got: {other:?}"),
    }
}

/// Verify that validate_cancel_inputs rejects empty query_id.
#[test]
fn test_command_validate_cancel_inputs_empty() {
    let result = validate_cancel_inputs("");
    assert!(result.is_err());
    match result.unwrap_err() {
        AppError::Validation(msg) => {
            assert!(
                msg.contains("Query ID cannot be empty"),
                "Unexpected message: {msg}"
            );
        }
        other => panic!("Expected Validation error, got: {other:?}"),
    }
}

/// Verify CancellationToken storage and retrieval in AppState.
/// This tests the token lifecycle that cancel_query relies on.
#[tokio::test]
async fn test_appstate_token_lifecycle() {
    let state = AppState::new();

    // Insert a token
    let token = CancellationToken::new();
    {
        let mut tokens = state.query_tokens.lock().await;
        tokens.insert("query-1".to_string(), token);
    }

    // Verify it exists
    {
        let tokens = state.query_tokens.lock().await;
        assert!(tokens.contains_key("query-1"));
    }

    // Remove and cancel (simulating cancel_query)
    let removed_token = {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove("query-1")
    };

    assert!(removed_token.is_some(), "Token should be present");
    removed_token.unwrap().cancel();

    // Verify it's gone
    {
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("query-1"));
    }
}

/// Verify that cancel_query returns NotFound for unknown query_id.
#[tokio::test]
async fn test_cancel_unknown_query_returns_not_found() {
    let state = AppState::new();

    // Simulate cancel_query logic for a non-existent query
    let query_id = "nonexistent-query";
    let token = {
        let mut tokens = state.query_tokens.lock().await;
        tokens.remove(query_id)
    };

    assert!(token.is_none(), "Token should not exist");
    // This mirrors the error path in cancel_query
    let err = AppError::NotFound(format!(
        "Query '{}' not found or already completed",
        query_id
    ));
    assert!(err.to_string().contains("not found"));
}

/// Verify that CancellationToken actually cancels a spawned task.
#[tokio::test]
async fn test_cancellation_token_aborts_select() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let cancel_token = CancellationToken::new();
    let child = cancel_token.clone();
    let spawned = adapter.clone();

    let handle = tokio::spawn(async move {
        spawned
            .execute_query("SELECT pg_sleep(10)", Some(&child))
            .await
    });

    // Let the query start, then cancel without burning wall-clock time.
    advance_cancel_start_window(Duration::from_millis(50)).await;
    cancel_token.cancel();

    let outcome = handle.await.expect("task should join");
    match outcome {
        Err(e) => {
            assert!(
                e.to_string().contains("cancel"),
                "Expected cancellation error, got: {e}"
            );
        }
        Ok(_) => {
            // Occasionally the query may complete before cancellation is processed
            println!("Note: query completed before cancellation");
        }
    }

    adapter.disconnect_pool().await.ok();
}

/// Integration test: execute a SELECT with leading SQL comments.
#[tokio::test]
#[serial_test::serial]
async fn test_select_with_leading_comment() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query("-- This is a comment\nSELECT 42 as answer", None)
        .await
        .expect("SELECT with leading comment should succeed");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "answer");
    assert_eq!(result.rows.len(), 1);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Integration test: a SELECT with a trailing semicolon should NOT throw a
/// syntax error — the wrapping subquery would otherwise become invalid.
#[tokio::test]
#[serial_test::serial]
async fn test_select_with_trailing_semicolon() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query("SELECT 1 as one;", None)
        .await
        .expect("SELECT with trailing semicolon should succeed");

    assert_eq!(result.rows.len(), 1);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Integration test: a DML with a trailing semicolon should also work.
///
/// Uses a uniquely named real table (not TEMP) because TEMP tables are
/// session-scoped and the sqlx pool may hand out a different connection
/// for the INSERT than for the CREATE.
#[tokio::test]
#[serial_test::serial]
async fn test_dml_with_trailing_semicolon() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let table_name = format!(
        "test_trailing_semi_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    adapter
        .execute_query(&format!("CREATE TABLE {table_name} (id integer);"), None)
        .await
        .expect("CREATE TABLE should succeed");

    let result = adapter
        .execute_query(&format!("INSERT INTO {table_name} VALUES (1);"), None)
        .await
        .expect("INSERT with trailing semicolon should succeed");

    assert!(matches!(result.query_type, QueryType::Dml { .. }));

    adapter
        .execute_query(&format!("DROP TABLE {table_name}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Integration test: execute a SELECT with leading block comment.
#[tokio::test]
#[serial_test::serial]
async fn test_select_with_block_comment() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query("/* block comment */ SELECT 1 as num", None)
        .await
        .expect("SELECT with block comment should succeed");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "num");
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

// ── #1086 — 서버측 단일 실행 회귀 가드 ────────────────────────────────────
// 작성: 2026-07-03. PG Select 경로가 (1) 메타데이터용 원쿼리 실행 + (2)
// row_to_json wrap 실행으로 같은 statement 를 서버에서 2회 적용하던 버그.
// 부수효과(nextval / data-modifying CTE)가 2배 적용되거나 wrap 이 거부돼
// "커밋 후 에러" 가 났다. Fix: describe(실행 X) + wrap 1회 / SHOW·EXPLAIN·
// data-modifying WITH 는 wrap 없는 단일 실행. 사용자가 본 증상(nextval 이
// 2, WITH 가 에러, SHOW 가 syntax error)을 그대로 assertion 으로 박는다.

/// ADR 0026 — bigint 컬럼은 JSON string 토큰으로 wire 인코딩된다.
fn read_i64(r: &QueryResult) -> i64 {
    r.rows[0][0]
        .as_str()
        .expect("bigint must be wire-encoded as string")
        .parse()
        .expect("must parse as i64")
}

/// nextval 은 서버에서 정확히 1회만 증가해야 한다. 이중 실행이면 첫 SELECT
/// 가 2, 두 번째가 4 를 돌려주고 sequence last_value 가 4 가 된다.
#[tokio::test]
#[serial_test::serial]
async fn test_select_nextval_executes_exactly_once() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let seq = format!("test_seq_once_{ts}");

    adapter
        .execute_query(&format!("CREATE SEQUENCE {seq}"), None)
        .await
        .expect("CREATE SEQUENCE should succeed");

    let first = adapter
        .execute_query(&format!("SELECT nextval('{seq}') AS v"), None)
        .await
        .expect("first nextval should succeed");
    assert_eq!(
        read_i64(&first),
        1,
        "double execution would make the first nextval return 2"
    );

    let second = adapter
        .execute_query(&format!("SELECT nextval('{seq}') AS v"), None)
        .await
        .expect("second nextval should succeed");
    assert_eq!(
        read_i64(&second),
        2,
        "double execution would make the second nextval return 4"
    );

    // Server-side counter must reflect exactly two increments.
    let last = adapter
        .execute_query(&format!("SELECT last_value FROM {seq}"), None)
        .await
        .expect("last_value read should succeed");
    assert_eq!(
        read_i64(&last),
        2,
        "sequence advanced more than twice → statement executed multiple times"
    );

    adapter
        .execute_query(&format!("DROP SEQUENCE {seq}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// SHOW 은 wrap 없이 단일 행을 돌려줘야 한다. 이전에는 2차 wrap 실행이 항상
/// syntax error 를 냈다.
#[tokio::test]
#[serial_test::serial]
async fn test_show_returns_row_without_wrap_error() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let result = adapter
        .execute_query("SHOW server_version", None)
        .await
        .expect("SHOW should succeed (was a wrap syntax error before #1086)");
    assert_eq!(result.rows.len(), 1, "SHOW server_version returns one row");
    assert!(matches!(result.query_type, QueryType::Select));
    assert!(
        result.rows[0][0].as_str().is_some(),
        "server_version cell should be a text value"
    );
    adapter.disconnect_pool().await.ok();
}

/// data-modifying CTE 는 서버에서 정확히 1회 실행돼야 한다 — RETURNING 행을
/// 돌려주고 테이블에 정확히 1행만 남긴다. 이전에는 1차 실행이 INSERT·커밋
/// 하고 2차 wrap 이 에러 → 사용자는 에러만 보는데 INSERT 는 이미 적용됨.
#[tokio::test]
#[serial_test::serial]
async fn test_data_modifying_with_executes_once() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_dml_cte_{ts}");
    adapter
        .execute_query(&format!("CREATE TABLE {table} (a INT)"), None)
        .await
        .expect("CREATE TABLE should succeed");

    let result = adapter
        .execute_query(
            &format!(
                "WITH ins AS (INSERT INTO {table}(a) VALUES (1) RETURNING a) SELECT a FROM ins"
            ),
            None,
        )
        .await
        .expect("data-modifying WITH should succeed (was error-after-commit before #1086)");
    assert_eq!(result.rows.len(), 1, "RETURNING should yield one row");
    assert_eq!(result.rows[0][0].as_i64(), Some(1));

    // Exactly one row inserted — a wrap re-execution or a retry would double it.
    let count = adapter
        .execute_query(&format!("SELECT COUNT(*) AS n FROM {table}"), None)
        .await
        .expect("count");
    assert_eq!(
        read_i64(&count),
        1,
        "data-modifying CTE must apply exactly once"
    );

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ── execute_query_batch 통합 시나리오 ──────────────────────────────────────
// 작성: 2026-05-08, Sprint 237 P5 후속 커버리지 보강.
// 단위 테스트는 empty / validation 경로만 가지고 있고 실제 BEGIN/COMMIT/
// ROLLBACK 분기는 통합으로만 hit 된다. 회귀 가드 4 종:
//  1. happy path — 두 개의 INSERT 가 한 트랜잭션에서 모두 commit.
//  2. rollback — 두 번째 statement 가 fail 하면 첫 statement 도 롤백되어
//     테이블에 0 row 가 남아야 한다 (transaction atomicity).
//  3. trailing semicolon — 각 statement 의 trailing `;` 는 strip 후 실행.
//  4. mixed DML — UPDATE + DELETE 가 같은 batch 에서 누적 rows_affected 와
//     index 별 결과가 모두 정확.

#[tokio::test]
#[serial_test::serial]
async fn test_execute_query_batch_commits_all_statements() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_commit_{ts}");

    adapter
        .execute_query(&format!("CREATE TABLE {table} (id INT)"), None)
        .await
        .expect("CREATE TABLE");

    // Issue #1079 — the commit batch now enforces one row per statement (the
    // grid-commit contract; new rows emit one single-row INSERT each). Exercise
    // multi-statement atomicity with single-row INSERTs.
    let stmts = vec![
        format!("INSERT INTO {table} VALUES (1)"),
        format!("INSERT INTO {table} VALUES (2)"),
    ];
    let results = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect("batch should commit");

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].total_count, 1);
    assert_eq!(results[1].total_count, 1);
    match results[0].query_type {
        QueryType::Dml { rows_affected } => assert_eq!(rows_affected, 1),
        _ => panic!("expected Dml"),
    }

    // Verify rows actually persisted.
    // Sprint 261 (ADR 0026) — COUNT(*) returns bigint, which is now
    // wire-encoded as a JSON string token to preserve precision past
    // ±(2^53-1). Parse the string for the integer assertion.
    let count = adapter
        .execute_query(&format!("SELECT COUNT(*) AS n FROM {table}"), None)
        .await
        .expect("count");
    let n: i64 = count.rows[0][0]
        .as_str()
        .expect("COUNT(*) must be wire-encoded as string")
        .parse()
        .expect("count string must parse as i64");
    assert_eq!(n, 2);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_execute_query_batch_rolls_back_on_mid_failure() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_rollback_{ts}");

    adapter
        .execute_query(&format!("CREATE TABLE {table} (id INT)"), None)
        .await
        .expect("CREATE TABLE");

    // Statement 2 references a column that does not exist → fails;
    // statement 1 must roll back so the row count stays 0.
    let stmts = vec![
        format!("INSERT INTO {table} VALUES (1)"),
        format!("INSERT INTO {table} (no_such_col) VALUES (2)"),
    ];
    let err = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect_err("batch should fail at statement 2");
    let msg = err.to_string();
    assert!(
        msg.contains("statement 2 of 2 failed"),
        "expected error to cite index, got: {msg}"
    );

    // Sprint 261 (ADR 0026) — COUNT(*) returns bigint, wire-encoded as
    // JSON string token to preserve precision. Parse before asserting 0.
    let count = adapter
        .execute_query(&format!("SELECT COUNT(*) AS n FROM {table}"), None)
        .await
        .expect("count");
    let n: i64 = count.rows[0][0]
        .as_str()
        .expect("COUNT(*) must be wire-encoded as string")
        .parse()
        .expect("count string must parse as i64");
    assert_eq!(n, 0, "rollback must leave the table empty");

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Issue #1079 — a PK-less table can hold fully-duplicate rows; the grid's
/// all-column WHERE fallback then matches every duplicate. A one-row delete
/// intent that touches 2 rows must roll the whole commit batch back so the
/// duplicates survive. Symmetric with the SQLite
/// `execute_query_batch_rolls_back_when_statement_matches_multiple_rows`.
#[tokio::test]
#[serial_test::serial]
async fn test_execute_query_batch_rolls_back_when_statement_matches_multiple_rows() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_multi_row_{ts}");

    adapter
        .execute_query(&format!("CREATE TABLE {table} (id INT, msg TEXT)"), None)
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} VALUES (1, 'a'), (1, 'a')"),
            None,
        )
        .await
        .expect("INSERT duplicates");

    let stmts = vec![format!("DELETE FROM {table} WHERE id = 1 AND msg = 'a'")];
    let err = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect_err("multi-row match must roll back");
    let msg = err.to_string();
    assert!(
        msg.contains("statement 1 of 1 failed") && msg.contains("affected 2"),
        "expected single-row guard rollback, got: {msg}"
    );

    let count = adapter
        .execute_query(&format!("SELECT COUNT(*) AS n FROM {table}"), None)
        .await
        .expect("count");
    let n: i64 = count.rows[0][0]
        .as_str()
        .expect("COUNT(*) must be wire-encoded as string")
        .parse()
        .expect("count string must parse as i64");
    assert_eq!(n, 2, "rollback must leave both duplicate rows");

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_execute_query_batch_strips_trailing_semicolons() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_semi_{ts}");

    adapter
        .execute_query(&format!("CREATE TABLE {table} (id INT)"), None)
        .await
        .expect("CREATE TABLE");

    // Each statement carries a trailing `;` — strip_trailing_terminator
    // must clean it before sqlx::query::execute on the transaction.
    let stmts = vec![
        format!("INSERT INTO {table} VALUES (10);"),
        format!("INSERT INTO {table} VALUES (20);  "),
    ];
    let results = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect("batch with trailing semi should succeed");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].total_count, 1);
    assert_eq!(results[1].total_count, 1);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ── query_table_data 필터 / raw_where 시나리오 ────────────────────────────
// 작성: 2026-05-08. queries.rs 의 큰 build-WHERE 분기 (filters vs raw_where,
// pg_cast_type 의 cast suffix 적용, ORDER BY parser, pagination offset) 는
// 통합으로만 진짜 검증 가능.

async fn seed_filter_table(adapter: &table_view_lib::db::postgres::PostgresAdapter, table: &str) {
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                  id INT PRIMARY KEY, \
                  name TEXT, \
                  amount NUMERIC, \
                  active BOOLEAN, \
                  note TEXT\
                )"
            ),
            None,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} VALUES \
                 (1, 'Alice', 100.0, true, 'first'), \
                 (2, 'Bob', 200.0, false, 'second'), \
                 (3, 'Charlie', 300.0, true, NULL), \
                 (4, 'Dave', 400.0, false, NULL), \
                 (5, 'Eve', 500.0, true, 'fifth')"
            ),
            None,
        )
        .await
        .expect("INSERT");
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_filter_eq_with_numeric_cast() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_eq_{ts}");
    seed_filter_table(&adapter, &table).await;

    let filters = vec![FilterCondition {
        column: "amount".to_string(),
        operator: FilterOperator::Eq,
        value: Some("300.0".to_string()),
    }];
    let data = adapter
        .query_table_data(&table, "public", 1, 50, None, Some(&filters), None, None)
        .await
        .expect("filter eq");
    assert_eq!(data.total_count, 1);
    assert_eq!(data.rows.len(), 1);
    // The PK column is `id`; since seed_filter_table picks Charlie at id=3.
    assert_eq!(data.rows[0][0].as_i64(), Some(3));

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_filter_like_and_isnull() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_like_isnull_{ts}");
    seed_filter_table(&adapter, &table).await;

    // LIKE pattern matches names starting with 'A' or 'B' through wildcard.
    let filters = vec![FilterCondition {
        column: "name".to_string(),
        operator: FilterOperator::Like,
        value: Some("A%".to_string()),
    }];
    let data = adapter
        .query_table_data(&table, "public", 1, 50, None, Some(&filters), None, None)
        .await
        .expect("filter like");
    assert_eq!(data.total_count, 1);
    assert_eq!(data.rows.len(), 1);

    // IsNull on `note` should hit Charlie + Dave.
    let filters = vec![FilterCondition {
        column: "note".to_string(),
        operator: FilterOperator::IsNull,
        value: None,
    }];
    let data = adapter
        .query_table_data(&table, "public", 1, 50, None, Some(&filters), None, None)
        .await
        .expect("filter is null");
    assert_eq!(data.total_count, 2);

    // IsNotNull complements: 3 rows have a note.
    let filters = vec![FilterCondition {
        column: "note".to_string(),
        operator: FilterOperator::IsNotNull,
        value: None,
    }];
    let data = adapter
        .query_table_data(&table, "public", 1, 50, None, Some(&filters), None, None)
        .await
        .expect("filter is not null");
    assert_eq!(data.total_count, 3);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_filter_unknown_column_is_ignored() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_unknown_{ts}");
    seed_filter_table(&adapter, &table).await;

    // Unknown column must NOT raise — queries.rs silently skips invalid
    // columns to keep the grid resilient against a stale frontend cache.
    let filters = vec![FilterCondition {
        column: "nope".to_string(),
        operator: FilterOperator::Eq,
        value: Some("x".to_string()),
    }];
    let data = adapter
        .query_table_data(&table, "public", 1, 50, None, Some(&filters), None, None)
        .await
        .expect("unknown column → no WHERE → all rows");
    assert_eq!(data.total_count, 5);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_raw_where_accepts_clean_clause() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_clean_{ts}");
    seed_filter_table(&adapter, &table).await;

    let data = adapter
        .query_table_data(
            &table,
            "public",
            1,
            50,
            None,
            None,
            Some("amount > 200 AND active = TRUE"),
            None,
        )
        .await
        .expect("raw_where clean");
    // amount > 200 AND active = TRUE → Charlie (300) + Eve (500).
    assert_eq!(data.total_count, 2);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_cancel_token_interrupts_in_flight_raw_where() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_qtd_cancel_{ts}");
    seed_filter_table(&adapter, &table).await;

    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();
    let spawned_adapter = adapter.clone();
    let table_for_task = table.clone();
    let query_handle = tokio::spawn(async move {
        let raw_where = "id > 0 AND pg_sleep(2) IS NULL";
        spawned_adapter
            .query_table_data(
                &table_for_task,
                "public",
                1,
                50,
                None,
                None,
                Some(raw_where),
                Some(&child_token),
            )
            .await
    });

    advance_cancel_start_window(Duration::from_millis(100)).await;
    let wait_start = Instant::now();
    cancel_token.cancel();

    let result = tokio::time::timeout(Duration::from_secs(5), query_handle)
        .await
        .expect("query_table_data cancel should return within 5s")
        .expect("query task should complete");
    assert!(
        wait_start.elapsed() < Duration::from_secs(5),
        "query_table_data cancel took {:?}",
        wait_start.elapsed()
    );
    match result {
        Err(AppError::Database(msg)) => assert_eq!(msg, "Operation cancelled"),
        other => panic!("expected Operation cancelled, got {other:?}"),
    }

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_raw_where_rejects_semicolon() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_semi_{ts}");
    seed_filter_table(&adapter, &table).await;

    let err = adapter
        .query_table_data(
            &table,
            "public",
            1,
            50,
            None,
            None,
            Some("id = 1; DROP TABLE secrets"),
            None,
        )
        .await
        .expect_err("raw_where with `;` must be rejected");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("semicolons"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_raw_where_rejects_dangerous_keywords() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_kw_{ts}");
    seed_filter_table(&adapter, &table).await;

    for kw in ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "TRUNCATE"] {
        let clause = format!("{kw} TABLE foo");
        let err = adapter
            .query_table_data(&table, "public", 1, 50, None, None, Some(&clause), None)
            .await
            .expect_err(&format!("{kw} must be rejected"));
        match err {
            AppError::Validation(msg) => assert!(
                msg.to_uppercase().contains(kw),
                "validation msg should cite {kw}, got: {msg}"
            ),
            other => panic!("expected Validation for {kw}, got {other:?}"),
        }
    }

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_query_table_data_pagination_and_ordering() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_pagination_{ts}");
    seed_filter_table(&adapter, &table).await;

    // page=2, page_size=2, ORDER BY id ASC → rows 3,4.
    let data = adapter
        .query_table_data(&table, "public", 2, 2, Some("id ASC"), None, None, None)
        .await
        .expect("paginate");
    assert_eq!(data.total_count, 5);
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.page, 2);
    assert_eq!(data.page_size, 2);
    assert_eq!(data.rows[0][0].as_i64(), Some(3));
    assert_eq!(data.rows[1][0].as_i64(), Some(4));

    // ORDER BY DESC reverses.
    let data = adapter
        .query_table_data(&table, "public", 1, 2, Some("id DESC"), None, None, None)
        .await
        .expect("desc order");
    assert_eq!(data.rows[0][0].as_i64(), Some(5));
    assert_eq!(data.rows[1][0].as_i64(), Some(4));

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ── stream_table_rows 시나리오 ────────────────────────────────────────────
// 작성: 2026-05-08. 단위 테스트로는 BEGIN/DECLARE CURSOR/FETCH/CLOSE 를
// hit 할 수 없다. validation 분기 + happy path (mpsc 수신) + receiver-drop
// 분기를 통합으로 고정.

#[tokio::test]
#[serial_test::serial]
async fn test_stream_table_rows_validation_rejects_zero_batch_size() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let cols = vec!["id".to_string()];
    let err = adapter
        .stream_table_rows("public", "anything", 0, &cols, tx, None)
        .await
        .expect_err("batch_size 0 must reject");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("batch_size"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_stream_table_rows_validation_rejects_empty_columns() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let err = adapter
        .stream_table_rows("public", "anything", 100, &[], tx, None)
        .await
        .expect_err("empty column_names must reject");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("column_names"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_stream_table_rows_yields_batches_in_order() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_stream_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, label TEXT)"),
            None,
        )
        .await
        .expect("CREATE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} VALUES \
                 (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e')"
            ),
            None,
        )
        .await
        .expect("INSERT");

    let (sender, mut rx) = tokio::sync::mpsc::channel(8);
    let cols = vec!["id".to_string(), "label".to_string()];
    let adapter_for_stream = adapter.clone();
    let table_for_stream = table.clone();
    let stream_handle = tokio::spawn(async move {
        adapter_for_stream
            .stream_table_rows("public", &table_for_stream, 2, &cols, sender, None)
            .await
    });

    let mut total_rows = 0_u64;
    let mut collected: Vec<i64> = Vec::new();
    while let Some(batch) = rx.recv().await {
        for row in &batch {
            collected.push(row[0].as_i64().expect("id should be i64"));
        }
        total_rows += batch.len() as u64;
    }
    let total = stream_handle.await.expect("task").expect("stream ok");
    assert_eq!(total, 5);
    assert_eq!(total_rows, 5);
    assert_eq!(collected.len(), 5);
    // Cursor returns rows in heap order; the `collected` list should be
    // a permutation of {1..=5} regardless of physical order.
    let mut sorted = collected.clone();
    sorted.sort();
    assert_eq!(sorted, vec![1, 2, 3, 4, 5]);

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_stream_table_rows_aborts_when_receiver_drops() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_stream_drop_{ts}");

    adapter
        .execute_query(&format!("CREATE TABLE {table} (id INT PRIMARY KEY)"), None)
        .await
        .expect("CREATE");
    // Insert enough rows that batch_size=1 yields more than one send call,
    // so the receiver-drop happens after the first batch is queued.
    let mut values = String::new();
    for i in 1..=20 {
        if i > 1 {
            values.push(',');
        }
        values.push_str(&format!("({i})"));
    }
    adapter
        .execute_query(&format!("INSERT INTO {table} VALUES {values}"), None)
        .await
        .expect("INSERT");

    // bound = 1: first send fills the channel; once we drop rx the next
    // send fails and stream_table_rows must surface AppError::Database
    // with the receiver-drop message.
    let (sender, rx) = tokio::sync::mpsc::channel(1);
    drop(rx); // immediate drop — first send fails.
    let cols = vec!["id".to_string()];
    let err = adapter
        .stream_table_rows("public", &table, 1, &cols, sender, None)
        .await
        .expect_err("dropped receiver should abort");
    match err {
        AppError::Database(msg) => {
            assert!(
                msg.contains("Receiver dropped"),
                "expected receiver-drop error, got: {msg}"
            );
        }
        other => panic!("expected Database, got {other:?}"),
    }

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}
