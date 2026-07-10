use std::future::Future;

use oracle_rs::{ColumnInfo as OracleColumnInfo, OracleType, QueryResult as OracleQueryResult};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{ColumnCategory, QueryColumn, QueryResult, QueryType};

use super::{connection_timeout_secs, OracleAdapter};

enum BatchMode {
    Commit,
    Rollback,
}

impl OracleAdapter {
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        // Issue #1231 — fetch-stage row cap (see SQLite adapter).
        row_cap: usize,
    ) -> Result<QueryResult, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(query_cancelled());
        }

        let query = strip_trailing_terminator(query);
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }

        let query_type = oracle_query_type(query);
        if matches!(query_type, QueryType::Ddl) {
            return Err(AppError::Unsupported(
                "Oracle raw DDL/admin execution is outside issue #905; supported runtime is limited to SELECT and DML batch".into(),
            ));
        }

        let config = self.connected_config().await?;
        let timeout_secs = connection_timeout_secs(&config);
        let start = std::time::Instant::now();

        let work = async {
            let connection = OracleAdapter::open_connection(&config, timeout_secs).await?;
            let result = match query_type {
                QueryType::Select => {
                    let result = connection
                        .query(query, &[])
                        .await
                        .map_err(|err| oracle_query_error("Oracle SELECT failed", err))?;
                    let (result, truncated) =
                        fetch_remaining_select_rows(&connection, result, row_cap).await?;
                    normalize_select_result(result, start.elapsed().as_millis() as u64, truncated)
                }
                QueryType::Dml { .. } => {
                    let result = connection
                        .execute(query, &[])
                        .await
                        .map_err(|err| oracle_query_error("Oracle DML failed", err));
                    match result {
                        Ok(result) => {
                            commit(&connection, "Oracle DML commit failed").await?;
                            Ok(normalize_dml_result(
                                result.rows_affected,
                                start.elapsed().as_millis() as u64,
                            ))
                        }
                        Err(error) => {
                            let _ = connection.rollback().await;
                            Err(error)
                        }
                    }
                }
                QueryType::Ddl => {
                    // Defensive: DDL is already rejected up-front (see the
                    // `matches!(query_type, QueryType::Ddl)` guard before the
                    // connection is opened). Return the same Unsupported error
                    // instead of panicking so a future refactor that reorders
                    // the guard degrades to an error rather than a crash.
                    Err(AppError::Unsupported(
                        "Oracle raw DDL/admin execution is outside issue #905; supported runtime is limited to SELECT and DML batch".into(),
                    ))
                }
            };

            let close_result = connection
                .close()
                .await
                .map_err(|err| oracle_query_error("Oracle query connection close failed", err));
            match (result, close_result) {
                (Ok(result), Ok(())) => Ok(result),
                (Ok(_), Err(error)) => Err(error),
                (Err(error), _) => Err(error),
            }
        };

        cancellable(work, cancel_token).await
    }

    pub async fn execute_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        self.execute_transactional_batch(statements, cancel_token, BatchMode::Commit)
            .await
    }

    pub async fn dry_run_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        self.execute_transactional_batch(statements, cancel_token, BatchMode::Rollback)
            .await
    }

    async fn execute_transactional_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
        mode: BatchMode,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(query_cancelled());
        }

        let normalized = normalize_dml_batch_statements(statements)?;
        let config = self.connected_config().await?;
        let timeout_secs = connection_timeout_secs(&config);
        let total = normalized.len();

        let work = async {
            let connection = OracleAdapter::open_connection(&config, timeout_secs).await?;
            let mut results = Vec::with_capacity(total);

            for (idx, statement) in normalized.iter().enumerate() {
                let start = std::time::Instant::now();
                match connection.execute(statement, &[]).await {
                    Ok(result) => {
                        // Issue #1432 — enforce the #1079 single-row commit guard
                        // Oracle previously skipped. A committed statement that
                        // affects != 1 rows (target row vanished -> 0, or a
                        // PK-less all-column WHERE matching duplicates -> N) rolls
                        // the whole transaction back instead of a phantom success
                        // or partial commit. Oracle's SQL%ROWCOUNT reports matched
                        // rows, so a 0 is a genuine no-match. Dry-run reports
                        // N-row impact as a preview, matching SQLite.
                        if matches!(mode, BatchMode::Commit) {
                            if let Err(err) = crate::db::enforce_single_row_effect(
                                idx,
                                total,
                                result.rows_affected,
                            ) {
                                let _ = connection.rollback().await;
                                let _ = connection.close().await;
                                return Err(err);
                            }
                        }
                        results.push(normalize_dml_result(
                            result.rows_affected,
                            start.elapsed().as_millis() as u64,
                        ));
                    }
                    Err(error) => {
                        let _ = connection.rollback().await;
                        let _ = connection.close().await;
                        return Err(AppError::Database(format!(
                            "statement {} of {} failed: {}",
                            idx + 1,
                            total,
                            error
                        )));
                    }
                }
            }

            match mode {
                BatchMode::Commit => commit(&connection, "Oracle DML batch commit failed").await?,
                BatchMode::Rollback => {
                    rollback(&connection, "Oracle DML dry-run rollback failed").await?
                }
            }

            connection
                .close()
                .await
                .map_err(|err| oracle_query_error("Oracle batch connection close failed", err))?;
            Ok(results)
        };

        cancellable(work, cancel_token).await
    }
}

async fn cancellable<T>(
    work: impl Future<Output = Result<T, AppError>>,
    cancel_token: Option<&CancellationToken>,
) -> Result<T, AppError> {
    match cancel_token {
        Some(token) => {
            tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(query_cancelled()),
            }
        }
        None => work.await,
    }
}

async fn commit(connection: &oracle_rs::Connection, context: &'static str) -> Result<(), AppError> {
    connection
        .commit()
        .await
        .map_err(|err| oracle_query_error(context, err))
}

async fn rollback(
    connection: &oracle_rs::Connection,
    context: &'static str,
) -> Result<(), AppError> {
    connection
        .rollback()
        .await
        .map_err(|err| oracle_query_error(context, err))
}

fn normalize_select_result(
    result: OracleQueryResult,
    execution_time_ms: u64,
    truncated: bool,
) -> Result<QueryResult, AppError> {
    // When we deliberately stopped at the cap the cursor still reports more
    // rows — that is expected, not an error, so skip the fully-fetched guard.
    if !truncated {
        ensure_select_fully_fetched(&result)?;
    }

    let columns: Vec<QueryColumn> = result.columns.iter().map(oracle_query_column).collect();
    let rows = result
        .rows
        .iter()
        .map(|row| row.values().iter().map(oracle_value_to_json).collect())
        .collect::<Vec<Vec<serde_json::Value>>>();

    Ok(QueryResult {
        truncated,
        total_count: rows.len() as i64,
        columns,
        rows,
        execution_time_ms,
        query_type: QueryType::Select,
    })
}

/// Issue #1231 — pull batches until the cursor is exhausted OR we hold more
/// than `row_cap` rows, then trim to exactly `row_cap`. Returns the (possibly
/// trimmed) result and whether it was truncated.
async fn fetch_remaining_select_rows(
    connection: &oracle_rs::Connection,
    mut result: OracleQueryResult,
    row_cap: usize,
) -> Result<(OracleQueryResult, bool), AppError> {
    let columns = result.columns.clone();

    while result.has_more_rows && result.rows.len() <= row_cap {
        if result.cursor_id == 0 {
            return Err(AppError::Unsupported(
                "Oracle SELECT returned a partial cursor without a cursor id".into(),
            ));
        }

        let mut next = connection
            .fetch_more(result.cursor_id, &columns, 100)
            .await
            .map_err(|err| oracle_query_error("Oracle SELECT fetch failed", err))?;
        result.rows.append(&mut next.rows);
        result.has_more_rows = next.has_more_rows;
        result.cursor_id = next.cursor_id;
    }

    let truncated = apply_oracle_row_cap(&mut result.rows, result.has_more_rows, row_cap);
    Ok((result, truncated))
}

/// Issue #1231 — decide truncation and trim the last (transient over-cap)
/// batch to exactly `row_cap`. Pure so the off-by-one at the cap boundary is
/// unit-tested without a live Oracle. Truncated iff we hold more than the cap
/// OR the cursor is still open (a stopped-early scan).
fn apply_oracle_row_cap(
    rows: &mut Vec<oracle_rs::Row>,
    has_more_rows: bool,
    row_cap: usize,
) -> bool {
    let truncated = rows.len() > row_cap || has_more_rows;
    if rows.len() > row_cap {
        rows.truncate(row_cap);
    }
    truncated
}

fn ensure_select_fully_fetched(result: &OracleQueryResult) -> Result<(), AppError> {
    if result.has_more_rows {
        return Err(AppError::Unsupported(
            "Oracle SELECT still has unfetched rows after cursor fetch".into(),
        ));
    }
    Ok(())
}

fn normalize_dml_result(rows_affected: u64, execution_time_ms: u64) -> QueryResult {
    QueryResult {
        truncated: false,
        columns: Vec::new(),
        rows: Vec::new(),
        total_count: rows_affected as i64,
        execution_time_ms,
        query_type: QueryType::Dml { rows_affected },
    }
}

fn normalize_dml_batch_statements(statements: &[String]) -> Result<Vec<&str>, AppError> {
    let mut normalized = Vec::with_capacity(statements.len());
    for (idx, raw) in statements.iter().enumerate() {
        let statement = strip_trailing_terminator(raw);
        if statement.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "Statement {} of {} is empty",
                idx + 1,
                statements.len()
            )));
        }
        if !matches!(oracle_query_type(statement), QueryType::Dml { .. }) {
            return Err(AppError::Unsupported(format!(
                "Oracle DML batch statement {} of {} must be INSERT, UPDATE, DELETE, or MERGE",
                idx + 1,
                statements.len()
            )));
        }
        normalized.push(statement);
    }
    Ok(normalized)
}

fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            if let Some(idx) = s.find('\n') {
                s = s[idx + 1..].trim_start();
            } else {
                return "";
            }
        } else if s.starts_with("/*") {
            if let Some(idx) = s.find("*/") {
                s = s[idx + 2..].trim_start();
            } else {
                return "";
            }
        } else {
            break;
        }
    }
    s
}

fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

fn oracle_query_type(query: &str) -> QueryType {
    let trimmed = strip_leading_comments(query).to_uppercase();
    if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
        QueryType::Select
    } else if trimmed.starts_with("INSERT")
        || trimmed.starts_with("UPDATE")
        || trimmed.starts_with("DELETE")
        || trimmed.starts_with("MERGE")
    {
        QueryType::Dml { rows_affected: 0 }
    } else {
        QueryType::Ddl
    }
}

fn oracle_query_column(column: &OracleColumnInfo) -> QueryColumn {
    QueryColumn {
        name: column.name.clone(),
        data_type: oracle_type_name(column),
        category: oracle_column_category(column),
    }
}

pub(super) fn oracle_type_name(column: &OracleColumnInfo) -> String {
    let base = match column.oracle_type {
        OracleType::Varchar => "varchar2",
        OracleType::Number => "number",
        OracleType::BinaryInteger => "binary_integer",
        OracleType::Long => "long",
        OracleType::Rowid => "rowid",
        OracleType::Date => "date",
        OracleType::Raw => "raw",
        OracleType::LongRaw => "long raw",
        OracleType::Char => "char",
        OracleType::BinaryFloat => "binary_float",
        OracleType::BinaryDouble => "binary_double",
        OracleType::Cursor => "ref cursor",
        OracleType::Object => "object",
        OracleType::Clob => "clob",
        OracleType::Blob => "blob",
        OracleType::Bfile => "bfile",
        OracleType::Json => "json",
        OracleType::Vector => "vector",
        OracleType::Timestamp => "timestamp",
        OracleType::TimestampTz => "timestamp with time zone",
        OracleType::IntervalYm => "interval year to month",
        OracleType::IntervalDs => "interval day to second",
        OracleType::Urowid => "urowid",
        OracleType::TimestampLtz => "timestamp with local time zone",
        OracleType::Boolean => "boolean",
    };

    if column.oracle_type == OracleType::Number && column.precision > 0 {
        format!("{base}({},{})", column.precision, column.scale)
    } else {
        base.to_string()
    }
}

pub(super) fn oracle_column_category(column: &OracleColumnInfo) -> ColumnCategory {
    match column.oracle_type {
        OracleType::Number | OracleType::BinaryInteger => {
            if column.scale == 0 {
                ColumnCategory::Int
            } else {
                ColumnCategory::Float
            }
        }
        OracleType::BinaryFloat | OracleType::BinaryDouble => ColumnCategory::Float,
        OracleType::Varchar
        | OracleType::Char
        | OracleType::Long
        | OracleType::Clob
        | OracleType::Rowid
        | OracleType::Urowid
        | OracleType::IntervalYm
        | OracleType::IntervalDs => ColumnCategory::Text,
        OracleType::Date
        | OracleType::Timestamp
        | OracleType::TimestampTz
        | OracleType::TimestampLtz => ColumnCategory::Datetime,
        OracleType::Raw | OracleType::LongRaw | OracleType::Blob | OracleType::Bfile => {
            ColumnCategory::Binary
        }
        OracleType::Boolean => ColumnCategory::Bool,
        OracleType::Json | OracleType::Vector | OracleType::Cursor | OracleType::Object => {
            ColumnCategory::Object
        }
    }
}

pub(super) fn oracle_value_to_json(value: &oracle_rs::Value) -> serde_json::Value {
    match value {
        oracle_rs::Value::Null => serde_json::Value::Null,
        oracle_rs::Value::String(value) => serde_json::Value::String(value.clone()),
        oracle_rs::Value::Bytes(value) => {
            serde_json::Value::String(format!("0x{}", hex_encode(value)))
        }
        oracle_rs::Value::Integer(value) => serde_json::Value::Number((*value).into()),
        oracle_rs::Value::Float(value) => json_number(*value),
        oracle_rs::Value::Number(value) => oracle_number_to_json(value),
        oracle_rs::Value::Date(value) => serde_json::Value::String(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            value.year, value.month, value.day, value.hour, value.minute, value.second
        )),
        oracle_rs::Value::Timestamp(value) => {
            let mut formatted = format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
                value.year,
                value.month,
                value.day,
                value.hour,
                value.minute,
                value.second,
                value.microsecond
            );
            if value.has_timezone() {
                formatted.push_str(&format!(
                    " {:+03}:{:02}",
                    value.tz_hour_offset, value.tz_minute_offset
                ));
            }
            serde_json::Value::String(formatted)
        }
        oracle_rs::Value::RowId(value) => value
            .to_string()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
        oracle_rs::Value::Boolean(value) => serde_json::Value::Bool(*value),
        oracle_rs::Value::Json(value) => value.clone(),
        oracle_rs::Value::Lob(_)
        | oracle_rs::Value::Vector(_)
        | oracle_rs::Value::Cursor(_)
        | oracle_rs::Value::Collection(_) => serde_json::Value::String(value.to_string()),
    }
}

fn oracle_number_to_json(value: &oracle_rs::types::OracleNumber) -> serde_json::Value {
    if value.is_integer {
        value
            .to_i64()
            .ok()
            .map(|number| serde_json::Value::Number(number.into()))
            .unwrap_or_else(|| serde_json::Value::String(value.as_str().to_string()))
    } else {
        value
            .to_f64()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value.as_str().to_string()))
    }
}

fn json_number(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn query_cancelled() -> AppError {
    AppError::Database("Query cancelled".into())
}

fn oracle_query_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}

#[cfg(test)]
mod coverage_tests;

#[cfg(test)]
mod tests {
    use std::future::pending;
    use std::time::Duration;

    use oracle_rs::{ColumnInfo as OracleColumnInfo, OracleType, Row, Value};

    use super::*;

    #[test]
    fn oracle_query_type_classifies_select_dml_and_unsupported_statements() {
        assert!(matches!(
            oracle_query_type("-- x\nSELECT 1 FROM DUAL;"),
            QueryType::Select
        ));
        assert!(matches!(
            oracle_query_type("/* x */ WITH q AS (SELECT 1 AS id FROM DUAL) SELECT id FROM q"),
            QueryType::Select
        ));
        assert!(matches!(
            oracle_query_type("UPDATE users SET name = 'Ada'"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            oracle_query_type("MERGE INTO users u USING incoming i ON (u.id = i.id) WHEN MATCHED THEN UPDATE SET u.name = i.name"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            oracle_query_type("BEGIN NULL; END;"),
            QueryType::Ddl
        ));
        assert!(matches!(
            oracle_query_type("GRANT DBA TO app_user"),
            QueryType::Ddl
        ));
        assert!(matches!(
            oracle_query_type("ALTER SESSION SET CURRENT_SCHEMA = HR"),
            QueryType::Ddl
        ));
    }

    #[test]
    fn dml_batch_validator_accepts_only_dml_statements() {
        let valid = vec![
            "INSERT INTO users(id) VALUES (1);".to_string(),
            " UPDATE users SET name = 'Ada' WHERE id = 1 ".to_string(),
            "DELETE FROM users WHERE id = 2".to_string(),
            "MERGE INTO users u USING incoming i ON (u.id = i.id) WHEN NOT MATCHED THEN INSERT (id) VALUES (i.id)".to_string(),
        ];
        let normalized = normalize_dml_batch_statements(&valid).unwrap();
        assert_eq!(normalized[0], "INSERT INTO users(id) VALUES (1)");
        assert_eq!(normalized.len(), 4);

        let invalid = vec!["SELECT 1 FROM DUAL".to_string()];
        assert!(matches!(
            normalize_dml_batch_statements(&invalid),
            Err(AppError::Unsupported(message)) if message.contains("DML batch statement 1 of 1")
        ));
    }

    #[tokio::test]
    async fn execute_query_returns_cancelled_before_connection_lookup() {
        let adapter = OracleAdapter::new();
        let token = CancellationToken::new();
        token.cancel();

        let err = adapter
            .execute_query(
                "SELECT 1 FROM DUAL",
                Some(&token),
                crate::db::row_cap::DEFAULT_ROW_CAP,
            )
            .await
            .expect_err("cancelled query should fail before requiring a connection");

        assert!(matches!(err, AppError::Database(message) if message == "Query cancelled"));
    }

    #[tokio::test]
    async fn execute_query_batch_returns_empty_without_connection() {
        let adapter = OracleAdapter::new();

        let results = adapter
            .execute_query_batch(&[], None)
            .await
            .expect("empty batch should not require a connection");

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dry_run_query_batch_returns_empty_without_connection() {
        let adapter = OracleAdapter::new();

        let results = adapter
            .dry_run_query_batch(&[], None)
            .await
            .expect("empty dry-run batch should not require a connection");

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn execute_query_batch_returns_cancelled_before_connection_lookup() {
        let adapter = OracleAdapter::new();
        let token = CancellationToken::new();
        token.cancel();

        let err = adapter
            .execute_query_batch(&["UPDATE users SET name = 'Ada'".to_string()], Some(&token))
            .await
            .expect_err("cancelled batch should fail before requiring a connection");

        assert!(matches!(err, AppError::Database(message) if message == "Query cancelled"));
    }

    #[test]
    fn select_result_normalization_preserves_tabular_envelope() {
        let mut id = OracleColumnInfo::new("ID", OracleType::Number);
        id.precision = 10;
        id.scale = 0;
        let name = OracleColumnInfo::new("NAME", OracleType::Varchar);
        let active = OracleColumnInfo::new("ACTIVE", OracleType::Boolean);
        let created = OracleColumnInfo::new("CREATED_AT", OracleType::Timestamp);
        let result = OracleQueryResult {
            columns: vec![id, name, active, created],
            rows: vec![Row::new(vec![
                Value::Number(oracle_rs::types::OracleNumber::new("42")),
                Value::String("Ada".into()),
                Value::Boolean(true),
                Value::Timestamp(oracle_rs::types::OracleTimestamp::new(
                    2026, 6, 7, 1, 2, 3, 456,
                )),
            ])],
            rows_affected: 0,
            has_more_rows: false,
            cursor_id: 0,
        };

        let normalized = normalize_select_result(result, 7, false).unwrap();
        assert_eq!(normalized.total_count, 1);
        assert_eq!(normalized.execution_time_ms, 7);
        assert!(matches!(normalized.query_type, QueryType::Select));
        assert_eq!(normalized.columns[0].name, "ID");
        assert_eq!(normalized.columns[0].data_type, "number(10,0)");
        assert_eq!(normalized.columns[0].category, ColumnCategory::Int);
        assert_eq!(normalized.columns[1].category, ColumnCategory::Text);
        assert_eq!(normalized.columns[2].category, ColumnCategory::Bool);
        assert_eq!(normalized.columns[3].category, ColumnCategory::Datetime);
        assert_eq!(
            normalized.rows,
            vec![vec![
                serde_json::json!(42),
                serde_json::json!("Ada"),
                serde_json::json!(true),
                serde_json::json!("2026-06-07 01:02:03.000456"),
            ]]
        );
    }

    #[test]
    fn select_result_normalization_rejects_more_rows_cursor() {
        let result = OracleQueryResult {
            columns: vec![OracleColumnInfo::new("ID", OracleType::Number)],
            rows: vec![Row::new(vec![Value::Integer(1)])],
            rows_affected: 0,
            has_more_rows: true,
            cursor_id: 7,
        };

        assert!(matches!(
            normalize_select_result(result, 7, false),
            Err(AppError::Unsupported(message))
                if message.contains("unfetched rows")
        ));
    }

    // Issue #1231 — when the fetch stopped at the cap the cursor still reports
    // `has_more_rows`, and that must NOT trip the fully-fetched guard. The
    // sibling test above locks the guard-ACTIVE path (truncated=false + more
    // rows → Err); this locks the guard-SKIP path.
    #[test]
    fn select_result_normalization_skips_guard_when_truncated_1231() {
        let result = OracleQueryResult {
            columns: vec![OracleColumnInfo::new("ID", OracleType::Number)],
            rows: vec![Row::new(vec![Value::Integer(1)])],
            rows_affected: 0,
            has_more_rows: true,
            cursor_id: 7,
        };

        let normalized = normalize_select_result(result, 7, true)
            .expect("truncated result must skip the fully-fetched guard");
        assert!(normalized.truncated, "truncated flag must propagate");
        assert_eq!(normalized.total_count, 1);
    }

    // Issue #1231 — cap boundary / off-by-one on the transient over-cap batch.
    #[test]
    fn apply_oracle_row_cap_trims_and_flags_boundaries_1231() {
        let row = || Row::new(vec![Value::Integer(1)]);

        // Over cap, cursor closed → trim to cap, truncated.
        let mut rows: Vec<Row> = (0..5).map(|_| row()).collect();
        assert!(apply_oracle_row_cap(&mut rows, false, 2));
        assert_eq!(rows.len(), 2, "must trim to exactly the cap");

        // Exactly cap, cursor closed → no trim, not truncated.
        let mut rows: Vec<Row> = (0..2).map(|_| row()).collect();
        assert!(!apply_oracle_row_cap(&mut rows, false, 2));
        assert_eq!(rows.len(), 2);

        // At cap but cursor still open → truncated (a stopped-early scan).
        let mut rows: Vec<Row> = (0..2).map(|_| row()).collect();
        assert!(apply_oracle_row_cap(&mut rows, true, 2));
        assert_eq!(rows.len(), 2);

        // Under cap, cursor closed → untouched, not truncated.
        let mut rows: Vec<Row> = (0..3).map(|_| row()).collect();
        assert!(!apply_oracle_row_cap(&mut rows, false, 10));
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn select_result_normalization_allows_complete_cursor_id() {
        let result = OracleQueryResult {
            columns: vec![OracleColumnInfo::new("ID", OracleType::Number)],
            rows: vec![Row::new(vec![Value::Integer(1)])],
            rows_affected: 0,
            has_more_rows: false,
            cursor_id: 7,
        };

        let normalized = normalize_select_result(result, 7, false).unwrap();

        assert_eq!(normalized.total_count, 1);
        assert_eq!(normalized.rows, vec![vec![serde_json::json!(1)]]);
    }

    #[test]
    fn dml_result_normalization_uses_rows_affected_envelope() {
        let normalized = normalize_dml_result(3, 11);

        assert!(normalized.columns.is_empty());
        assert!(normalized.rows.is_empty());
        assert_eq!(normalized.total_count, 3);
        assert_eq!(normalized.execution_time_ms, 11);
        assert!(matches!(
            normalized.query_type,
            QueryType::Dml { rows_affected: 3 }
        ));
    }

    #[tokio::test]
    async fn cancellation_returns_database_cancelled_error() {
        let token = CancellationToken::new();
        let child = token.clone();
        let handle = tokio::spawn(async move {
            cancellable(pending::<Result<(), AppError>>(), Some(&child)).await
        });

        tokio::time::sleep(Duration::from_millis(10)).await;
        token.cancel();

        let error = tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("cancellation should return promptly")
            .expect("task should not panic")
            .expect_err("work should be cancelled");
        assert!(matches!(error, AppError::Database(message) if message == "Query cancelled"));
    }

    #[test]
    fn oracle_query_errors_keep_context() {
        let error = oracle_query_error(
            "Oracle SELECT failed",
            oracle_rs::Error::oracle(942, "table or view does not exist"),
        );

        assert!(matches!(
            error,
            AppError::Database(message)
                if message.contains("Oracle SELECT failed")
                    && message.contains("ORA-00942")
        ));
    }
}
