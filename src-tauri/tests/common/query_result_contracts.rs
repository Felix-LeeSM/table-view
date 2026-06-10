#![allow(dead_code)]

use serde_json::Value;
use table_view_lib::db::RdbAdapter;
use table_view_lib::error::AppError;
use table_view_lib::models::{QueryResult, QueryType};

pub async fn assert_rdb_select_envelope<A>(
    adapter: &A,
    sql: &str,
    expected_columns: &[&str],
    expected_rows: Vec<Vec<Value>>,
) where
    A: RdbAdapter + ?Sized,
{
    let result = adapter
        .execute_sql(sql, None)
        .await
        .expect("SELECT query should succeed");

    assert_select_envelope(&result, expected_columns, expected_rows);
}

pub async fn assert_rdb_dml_envelope<A>(adapter: &A, sql: &str, expected_rows_affected: u64)
where
    A: RdbAdapter + ?Sized,
{
    let result = adapter
        .execute_sql(sql, None)
        .await
        .expect("DML query should succeed");

    assert!(result.columns.is_empty(), "DML must not return columns");
    assert!(result.rows.is_empty(), "DML must not return rows");
    assert_eq!(result.total_count, expected_rows_affected as i64);
    match &result.query_type {
        QueryType::Dml { rows_affected } => {
            assert_eq!(*rows_affected, expected_rows_affected);
        }
        other => panic!("expected DML query type, got {other:?}"),
    }

    let json = assert_common_wire_keys(&result);
    assert_eq!(
        json["queryType"]["dml"]["rows_affected"],
        expected_rows_affected
    );
}

pub async fn assert_rdb_ddl_envelope<A>(adapter: &A, sql: &str)
where
    A: RdbAdapter + ?Sized,
{
    let result = adapter
        .execute_sql(sql, None)
        .await
        .expect("DDL query should succeed");

    assert!(result.columns.is_empty(), "DDL must not return columns");
    assert!(result.rows.is_empty(), "DDL must not return rows");
    assert_eq!(result.total_count, 0);
    assert!(matches!(result.query_type, QueryType::Ddl));

    let json = assert_common_wire_keys(&result);
    assert_eq!(json["queryType"], "ddl");
}

pub async fn assert_rdb_runtime_database_error<A>(adapter: &A, sql: &str, expected_fragment: &str)
where
    A: RdbAdapter + ?Sized,
{
    let result = adapter.execute_sql(sql, None).await;
    assert_database_error(result, expected_fragment);
}

pub async fn assert_rdb_unsupported_query<A>(adapter: &A, sql: &str, expected_fragment: &str)
where
    A: RdbAdapter + ?Sized,
{
    let result = adapter.execute_sql(sql, None).await;
    assert_unsupported_error(result, expected_fragment);
}

fn assert_select_envelope(
    result: &QueryResult,
    expected_columns: &[&str],
    expected_rows: Vec<Vec<Value>>,
) {
    assert!(matches!(result.query_type, QueryType::Select));
    assert_eq!(
        result
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        expected_columns
    );
    assert_eq!(result.rows, expected_rows);
    assert_eq!(result.total_count, result.rows.len() as i64);

    for (row_index, row) in result.rows.iter().enumerate() {
        assert_eq!(
            row.len(),
            result.columns.len(),
            "row {row_index} width must match query columns"
        );
    }

    let json = assert_common_wire_keys(result);
    assert_eq!(json["queryType"], "select");
}

pub fn assert_database_error<T: std::fmt::Debug>(
    result: Result<T, AppError>,
    expected_fragment: &str,
) {
    match result {
        Err(AppError::Database(message)) => {
            assert!(
                message.contains(expected_fragment),
                "expected database error to mention {expected_fragment:?}, got {message:?}"
            );
        }
        other => panic!("expected database error, got {other:?}"),
    }
}

pub fn assert_unsupported_error<T: std::fmt::Debug>(
    result: Result<T, AppError>,
    expected_fragment: &str,
) {
    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(
                message.contains(expected_fragment),
                "expected unsupported error to mention {expected_fragment:?}, got {message:?}"
            );
        }
        other => panic!("expected unsupported error, got {other:?}"),
    }
}

fn assert_common_wire_keys(result: &QueryResult) -> Value {
    let json = serde_json::to_value(result).expect("query result should serialize");
    assert!(json.get("columns").is_some());
    assert!(json.get("rows").is_some());
    assert!(json.get("totalCount").is_some());
    assert!(json.get("executionTimeMs").is_some());
    assert!(json.get("queryType").is_some());

    assert!(json.get("total_count").is_none());
    assert!(json.get("execution_time_ms").is_none());
    assert!(json.get("query_type").is_none());
    json
}
