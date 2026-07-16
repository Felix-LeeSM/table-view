//! SQLite free-form query execution and table preview.

use futures_util::TryStreamExt;
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Column, Row, TypeInfo};
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::db::raw_where::{validate_raw_where_clause, RawWhereDialect};
use crate::db::traits::finalize_cancelled;
use crate::error::AppError;
use crate::models::{
    FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::connection::{
    quote_identifier, sqlite_column_category, validate_namespace, SqliteAdapter,
};
use super::sql_text::{
    sqlite_invokes_load_extension, sqlite_query_type, strip_trailing_terminator,
};

fn validate_raw_where(rw: &str) -> Result<(), AppError> {
    validate_raw_where_clause(RawWhereDialect::Sqlite, rw)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(*b >> 4) as usize] as char);
        out.push(HEX[(*b & 0x0f) as usize] as char);
    }
    out
}

fn cell_to_json(row: &SqliteRow, idx: usize) -> serde_json::Value {
    let type_name = row.column(idx).type_info().name().to_ascii_uppercase();

    macro_rules! try_decode {
        ($t:ty, $f:expr) => {
            if let Ok(Some(v)) = row.try_get::<Option<$t>, _>(idx) {
                return ($f)(v);
            }
        };
    }

    match type_name.as_str() {
        "INTEGER" | "INT" | "BIGINT" | "SMALLINT" | "TINYINT" => {
            // ADR 0026 (issue #1082) — SQLite 는 INTEGER-affinity 컬럼을 선언
            // 타입과 무관하게 i64 로 저장하므로 (sqlx 는 declared type 이 아니라
            // storage class "INTEGER" 를 report 한다), 2^53 을 넘는 값이 raw
            // JSON number 로 wire 되면 프론트의 native JSON.parse 가 f64 로
            // 강등하며 무음 손상시킨다. 정밀도-보존 JSON string token 으로
            // 직렬화하고, 프론트 wrapNumericCells 가 컬럼 data_type (free-form
            // 은 storage class "INTEGER", table preview 는 PRAGMA 선언 타입)
            // 을 보고 BigInt 로 승격한다. 타입 정보가 없는 컬럼/표현식
            // (type_info == "NULL") 은 아래 untyped fallback 으로 내려가 Number
            // 로 남는다 — 프론트에 승격 매핑이 없으므로 string 화하면 오히려
            // grid 에 raw string 이 노출된다.
            try_decode!(i64, |v: i64| serde_json::Value::String(v.to_string()));
        }
        "REAL" | "DOUBLE" | "FLOAT" | "NUMERIC" | "DECIMAL" => {
            try_decode!(f64, |v: f64| serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null));
        }
        "BOOLEAN" | "BOOL" => {
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
                return serde_json::Value::Bool(v);
            }
            try_decode!(i64, |v: i64| serde_json::Value::Bool(v != 0));
        }
        "BLOB" | "BINARY" | "VARBINARY" => {
            try_decode!(Vec<u8>, |v: Vec<u8>| {
                serde_json::Value::String(format!("0x{}", hex_encode(&v)))
            });
        }
        "JSON" => {
            try_decode!(String, |s: String| serde_json::from_str(&s)
                .unwrap_or(serde_json::Value::String(s)));
        }
        _ => {}
    }

    try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
    try_decode!(f64, |v: f64| serde_json::Number::from_f64(v)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null));
    if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
        return serde_json::Value::Bool(v);
    }
    try_decode!(String, serde_json::Value::String);
    try_decode!(Vec<u8>, |v: Vec<u8>| serde_json::Value::String(format!(
        "0x{}",
        hex_encode(&v)
    )));

    serde_json::Value::Null
}

pub(super) fn validate_sqlite_write_guardrails(
    query_type: &QueryType,
    read_only: bool,
) -> Result<(), AppError> {
    match query_type {
        QueryType::Ddl => Err(AppError::Unsupported(
            "Raw SQLite DDL is not supported by the SQLite query adapter; use structured CREATE TABLE for the bounded table-creation slice or a future explicit rebuild workflow.".into(),
        )),
        QueryType::Dml { .. } if read_only => Err(AppError::Unsupported(
            "Cannot execute write statements on a read-only SQLite connection.".into(),
        )),
        QueryType::Dml { .. } | QueryType::Select => Ok(()),
    }
}

pub(super) fn validate_sqlite_execution_guardrails(
    sql: &str,
    query_type: &QueryType,
    read_only: bool,
) -> Result<(), AppError> {
    if sqlite_invokes_load_extension(sql) {
        return Err(AppError::Unsupported(
            "SQLite loadable extensions are not supported by Table View.".into(),
        ));
    }
    validate_sqlite_write_guardrails(query_type, read_only)
}

impl SqliteAdapter {
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        // Issue #1231 — stop fetching after this many rows so the Rust buffer
        // never grows past the cap. `crate::db::row_cap::current()` in the
        // trait impl; tests pass an explicit small cap.
        row_cap: usize,
    ) -> Result<QueryResult, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Query cancelled".into()));
        }

        let start = std::time::Instant::now();
        let query = strip_trailing_terminator(query);
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }

        let (pool, read_only) = self.active_pool_with_mode().await?;
        let query_type = sqlite_query_type(query);
        validate_sqlite_execution_guardrails(query, &query_type, read_only)?;

        // Issue #1068 — pin one connection so a cancel token can install a
        // SQLite progress handler that raises SQLITE_INTERRUPT mid-statement.
        // Unlike dropping the query future (which leaves the worker stepping to
        // completion), the handler actually aborts a running statement and frees
        // the connection. sqlite3_interrupt does not close the connection, so it
        // returns to the pool reusable once the handler is cleared.
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        if let Some(token) = cancel_token {
            install_cancel_interrupt(&mut conn, token).await?;
        }

        let result = run_sqlite_statement(&mut conn, query, &query_type, row_cap, start).await;

        if cancel_token.is_some() {
            // Always clear the handler before the connection returns to the pool
            // so a later query on this connection is not aborted by a stale
            // token. The interrupt test exercises exactly this reuse path.
            clear_cancel_interrupt(&mut conn).await;
        }

        // Converge a raced cancel to the canonical message (mirrors mysql/pg):
        // a SQLITE_INTERRUPT surfaces here as an opaque DB error, so map it back
        // to "Query cancelled" whenever the token fired.
        finalize_cancelled(result, cancel_token)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn query_table_data(
        &self,
        namespace: &str,
        table: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<TableData, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }

        let work = self.query_table_data_uncancelled(
            namespace, table, page, page_size, order_by, filters, raw_where,
        );
        match cancel_token {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => work.await,
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn query_table_data_uncancelled(
        &self,
        namespace: &str,
        table: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
    ) -> Result<TableData, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let columns = self.get_table_columns(namespace, table).await?;
        let table_ident = quote_identifier(table);

        let raw_where_trimmed = raw_where.map(str::trim).filter(|rw| !rw.is_empty());
        if let Some(rw) = &raw_where_trimmed {
            validate_raw_where(rw)?;
        }

        let (where_clause, param_values) = if let Some(rw) = &raw_where_trimmed {
            (format!(" WHERE {}", rw), Vec::<String>::new())
        } else {
            build_filter_clause(filters, &columns)
        };

        let count_sql = format!("SELECT COUNT(*) FROM {table_ident}{where_clause}");
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        for val in &param_values {
            count_query = count_query.bind(val);
        }
        let (total_count,) = count_query
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let order_clause = build_order_clause(order_by, &columns);
        let offset = (page - 1).max(0) * page_size;
        let executed_query =
            format!("SELECT * FROM {table_ident}{where_clause}{order_clause} LIMIT {page_size} OFFSET {offset}");

        let mut data_query = sqlx::query(&executed_query);
        for val in &param_values {
            data_query = data_query.bind(val);
        }
        let rows = data_query
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let col_index = columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.as_str(), i))
            .collect::<std::collections::HashMap<&str, usize>>();
        let result_rows = rows
            .iter()
            .map(|row| {
                let mut out = vec![serde_json::Value::Null; columns.len()];
                for (idx, col) in row.columns().iter().enumerate() {
                    if let Some(&target) = col_index.get(col.name()) {
                        out[target] = cell_to_json(row, idx);
                    }
                }
                out
            })
            .collect();

        Ok(TableData {
            columns,
            rows: result_rows,
            total_count,
            page,
            page_size,
            executed_query,
        })
    }

    /// Issue #1068 — export row streaming, the SQLite counterpart of the
    /// PG/MySQL `stream_table_rows`. The caller passes `column_names` in source
    /// order; each row is emitted as a `Vec<Value>` in that order and batched
    /// (`batch_size`) to `sender`. Returns the total rows streamed.
    ///
    /// The scan runs inside a read transaction so a long export sees one
    /// consistent snapshot (matches the PG/MySQL contract). Between batches it
    /// checks the cancel token and a dropped receiver, rolling back and aborting
    /// on either. Cell serialization reuses the wire `cell_to_json`, so the
    /// dump's value shape is identical to the grid (same as mysql.rs).
    pub async fn stream_table_rows(
        &self,
        namespace: &str,
        table: &str,
        batch_size: u32,
        column_names: &[String],
        sender: tokio::sync::mpsc::Sender<Vec<Vec<serde_json::Value>>>,
        cancel: Option<&CancellationToken>,
    ) -> Result<u64, AppError> {
        if batch_size == 0 {
            return Err(AppError::Validation(
                "stream_table_rows: batch_size must be > 0".into(),
            ));
        }
        if column_names.is_empty() {
            return Err(AppError::Validation(
                "stream_table_rows: column_names must not be empty".into(),
            ));
        }
        validate_namespace(namespace)?;

        let pool = self.active_pool().await?;
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(format!("BEGIN failed: {e}")))?;

        // Columns are selected in `column_names` order — the caller owns source
        // order. SQLite resolves the unqualified table against `main`, the only
        // namespace this adapter exposes.
        let cols_clause: Vec<String> = column_names.iter().map(|c| quote_identifier(c)).collect();
        let select_sql = format!(
            "SELECT {} FROM {}",
            cols_clause.join(", "),
            quote_identifier(table)
        );

        let mut stream = sqlx::query(&select_sql).fetch(&mut *tx);
        let mut total: u64 = 0;
        let mut batch: Vec<Vec<serde_json::Value>> = Vec::with_capacity(batch_size as usize);

        loop {
            if let Some(t) = cancel {
                if t.is_cancelled() {
                    drop(stream);
                    if let Err(e) = tx.rollback().await {
                        warn!("ROLLBACK after cancellation failed: {e}");
                    }
                    return Err(AppError::Database("Operation cancelled".into()));
                }
            }
            let next = stream
                .try_next()
                .await
                .map_err(|e| AppError::Database(format!("FETCH failed: {e}")))?;
            match next {
                Some(row) => {
                    let values: Vec<serde_json::Value> = (0..row.columns().len())
                        .map(|idx| cell_to_json(&row, idx))
                        .collect();
                    batch.push(values);
                    if batch.len() as u32 >= batch_size {
                        let count = batch.len() as u64;
                        let send_batch = std::mem::take(&mut batch);
                        if sender.send(send_batch).await.is_err() {
                            drop(stream);
                            if let Err(e) = tx.rollback().await {
                                warn!("ROLLBACK after receiver drop failed: {e}");
                            }
                            return Err(AppError::Database(
                                "Receiver dropped — export aborted".into(),
                            ));
                        }
                        total += count;
                    }
                }
                None => break,
            }
        }
        // Tail flush — the final sub-batch_size remainder.
        if !batch.is_empty() {
            let count = batch.len() as u64;
            if sender.send(batch).await.is_err() {
                drop(stream);
                if let Err(e) = tx.rollback().await {
                    warn!("ROLLBACK after receiver drop (tail) failed: {e}");
                }
                return Err(AppError::Database(
                    "Receiver dropped — export aborted".into(),
                ));
            }
            total += count;
        }

        drop(stream);
        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("COMMIT failed: {e}")))?;
        Ok(total)
    }
}

/// Run one classified statement on a pinned connection. Split out of
/// `execute_query` so the cancel-interrupt handler can be installed/cleared on
/// the same connection around the run.
async fn run_sqlite_statement(
    conn: &mut SqliteConnection,
    query: &str,
    query_type: &QueryType,
    row_cap: usize,
    start: std::time::Instant,
) -> Result<QueryResult, AppError> {
    match query_type {
        QueryType::Select => {
            // Issue #1231 — stream rows and stop at cap+1 (the extra row only
            // sets `truncated`, it is never buffered) so a no-LIMIT JOIN cannot
            // blow up the heap.
            let mut stream = sqlx::query(query).fetch(&mut *conn);
            let mut columns: Vec<QueryColumn> = Vec::new();
            let mut json_rows: Vec<Vec<serde_json::Value>> = Vec::new();
            let mut truncated = false;
            while let Some(row) = stream
                .try_next()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?
            {
                if columns.is_empty() {
                    columns = sqlite_query_columns(&row);
                }
                if json_rows.len() >= row_cap {
                    truncated = true;
                    break;
                }
                json_rows.push(
                    (0..row.columns().len())
                        .map(|idx| cell_to_json(&row, idx))
                        .collect(),
                );
            }
            let total_count = json_rows.len() as i64;
            Ok(QueryResult {
                truncated,
                columns,
                rows: json_rows,
                total_count,
                execution_time_ms: start.elapsed().as_millis() as u64,
                query_type: QueryType::Select,
            })
        }
        QueryType::Dml { .. } => {
            let result = sqlx::query(query)
                .execute(&mut *conn)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows_affected = result.rows_affected();
            Ok(QueryResult {
                truncated: false,
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: rows_affected as i64,
                execution_time_ms: start.elapsed().as_millis() as u64,
                query_type: QueryType::Dml { rows_affected },
            })
        }
        QueryType::Ddl => {
            sqlx::query(query)
                .execute(&mut *conn)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            Ok(QueryResult {
                truncated: false,
                columns: Vec::new(),
                rows: Vec::new(),
                total_count: 0,
                execution_time_ms: start.elapsed().as_millis() as u64,
                query_type: QueryType::Ddl,
            })
        }
    }
}

/// Bind a SQLite progress handler to `token`: when the callback returns `false`
/// SQLite raises SQLITE_INTERRUPT and the running statement aborts. The
/// handler is checked roughly every 1024 VM opcodes, so cancel latency stays
/// sub-millisecond on a busy statement with no measurable overhead otherwise.
async fn install_cancel_interrupt(
    conn: &mut SqliteConnection,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let token = token.clone();
    conn.lock_handle()
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
        .set_progress_handler(1024, move || !token.is_cancelled());
    Ok(())
}

/// Remove the progress handler so the connection can return to the pool without
/// a stale token aborting the next query on it. Best-effort: a worker that
/// crashed can no longer run queries anyway.
async fn clear_cancel_interrupt(conn: &mut SqliteConnection) {
    if let Ok(mut handle) = conn.lock_handle().await {
        handle.remove_progress_handler();
    }
}

fn sqlite_query_columns(row: &SqliteRow) -> Vec<QueryColumn> {
    row.columns()
        .iter()
        .map(|col| {
            let data_type = col.type_info().name().to_string();
            QueryColumn {
                name: col.name().to_string(),
                category: sqlite_column_category(&data_type),
                data_type,
            }
        })
        .collect()
}

fn build_filter_clause(
    filters: Option<&[FilterCondition]>,
    columns: &[crate::models::ColumnInfo],
) -> (String, Vec<String>) {
    let mut conditions = Vec::new();
    let mut values = Vec::new();
    let Some(filters) = filters else {
        return (String::new(), values);
    };
    if filters.is_empty() {
        return (String::new(), values);
    }

    let valid_columns = columns
        .iter()
        .map(|c| c.name.as_str())
        .collect::<std::collections::HashSet<&str>>();

    for filter in filters {
        if !valid_columns.contains(filter.column.as_str()) {
            continue;
        }
        let column = quote_identifier(&filter.column);
        match &filter.operator {
            FilterOperator::IsNull => conditions.push(format!("{column} IS NULL")),
            FilterOperator::IsNotNull => conditions.push(format!("{column} IS NOT NULL")),
            _ => {
                let op = match &filter.operator {
                    FilterOperator::Eq => "=",
                    FilterOperator::Neq => "<>",
                    FilterOperator::Gt => ">",
                    FilterOperator::Lt => "<",
                    FilterOperator::Gte => ">=",
                    FilterOperator::Lte => "<=",
                    FilterOperator::Like => "LIKE",
                    _ => unreachable!(),
                };
                if let Some(value) = &filter.value {
                    conditions.push(format!("{column} {op} ?"));
                    values.push(value.clone());
                }
            }
        }
    }

    if conditions.is_empty() {
        (String::new(), values)
    } else {
        (format!(" WHERE {}", conditions.join(" AND ")), values)
    }
}

fn build_order_clause(order_by: Option<&str>, columns: &[crate::models::ColumnInfo]) -> String {
    let valid_columns = columns
        .iter()
        .map(|c| c.name.as_str())
        .collect::<std::collections::HashSet<&str>>();
    let mut user_sort_columns = std::collections::HashSet::<String>::new();
    let mut order_parts = Vec::new();

    if let Some(order_by) = order_by {
        for part in order_by.split(',') {
            let parts = part.split_whitespace().collect::<Vec<&str>>();
            let (column, direction) = match parts.as_slice() {
                [column, direction] if *direction == "ASC" || *direction == "DESC" => {
                    (*column, *direction)
                }
                [column] => (*column, "ASC"),
                _ => continue,
            };
            if valid_columns.contains(column) {
                order_parts.push(format!("{} {}", quote_identifier(column), direction));
                user_sort_columns.insert(column.to_string());
            }
        }
    }

    let pk_parts = columns
        .iter()
        .filter(|c| c.is_primary_key && !user_sort_columns.contains(&c.name))
        .map(|c| format!("{} ASC", quote_identifier(&c.name)));
    order_parts.extend(pk_parts);

    if order_parts.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order_parts.join(", "))
    }
}

#[cfg(test)]
#[path = "queries_tests.rs"]
mod tests;
