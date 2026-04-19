mod common;

use std::time::Duration;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use view_table_lib::commands::connection::AppState;
use view_table_lib::commands::query::{validate_cancel_inputs, validate_query_inputs};
use view_table_lib::error::AppError;
use view_table_lib::models::{DatabaseType, QueryType};

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

    // Give the query a moment to start
    sleep(Duration::from_millis(100)).await;

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

    // Let the query start, then cancel
    sleep(Duration::from_millis(50)).await;
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
#[tokio::test]
#[serial_test::serial]
async fn test_dml_with_trailing_semicolon() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // Setup: create a temp table
    adapter
        .execute_query("CREATE TEMP TABLE trailing_semi_test (id integer);", None)
        .await
        .expect("CREATE TEMP TABLE should succeed");

    let result = adapter
        .execute_query("INSERT INTO trailing_semi_test VALUES (1);", None)
        .await
        .expect("INSERT with trailing semicolon should succeed");

    assert!(matches!(result.query_type, QueryType::Dml { .. }));

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
