//! PostgreSQL query execution paths — `execute` / `execute_query` /
//! `execute_query_batch` (free-form SQL) + `query_table_data` /
//! `stream_table_rows` (table-row paging / streaming).
//!
//! Sprint 202 split from `db/postgres.rs`. SQL-string normalization
//! helpers (`strip_leading_comments`, `strip_trailing_terminator`,
//! `pg_cast_type`) co-located here since query-path is the sole consumer.

use sqlx::Column;
use sqlx::Row;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use super::category::map_pg_data_type;
use crate::error::AppError;
use crate::models::{
    ColumnInfo, FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::mutations::qualified_table;
use super::PostgresAdapter;

/// Sprint 232 — build a deterministic fallback `ORDER BY` clause from
/// the table's primary-key columns when the caller supplies no explicit
/// ordering. Returns `" ORDER BY \"<pk1>\" ASC[, \"<pk2>\" ASC …]"` when
/// at least one column has `is_primary_key == true`, or an empty string
/// otherwise (preserves the pre-Sprint-232 behavior for views and
/// PK-less tables).
///
/// PK columns are emitted in the order they appear in `columns`, which
/// the schema fetcher already sorts by `pg_attribute.attnum` (= declared
/// order). Identifier double quotes are doubled per PG quoting rules,
/// matching the convention in the user-supplied ORDER BY parser above.
///
/// Why a free function: the helper is unit-testable without a `PgPool`,
/// and isolating the fallback shape here keeps `query_table_data`'s
/// 200-line body legible. User-supplied `order_by` still takes
/// precedence — the caller only invokes this helper when its own
/// parsing yields zero valid parts.
pub(super) fn build_default_order_clause(columns: &[ColumnInfo]) -> String {
    let parts: Vec<String> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| format!("\"{}\" ASC", c.name.replace('"', "\"\"")))
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", parts.join(", "))
    }
}

/// Best-effort `CLOSE <cursor_name>` for the streaming export path. Logs a
/// warning on failure but does not propagate — at the call sites the rows
/// have already streamed (commit path) or the caller is about to ROLLBACK
/// the transaction anyway (abort path), so a CLOSE failure isn't actionable.
async fn close_cursor_warn(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cursor_name: &str,
    context: &str,
) {
    if let Err(e) = sqlx::query(&format!("CLOSE {cursor_name}"))
        .execute(&mut **tx)
        .await
    {
        warn!("CLOSE {cursor_name} ({context}) failed: {e}");
    }
}

/// Strip leading SQL comments and whitespace so that query type detection
/// works on `-- comment\nSELECT ...` and `/* block */ SELECT ...` inputs.
fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            // Line comment: skip to end of line
            if let Some(idx) = s.find('\n') {
                s = s[idx + 1..].trim_start();
            } else {
                // Entire rest is a comment
                return "";
            }
        } else if s.starts_with("/*") {
            // Block comment: find closing */
            if let Some(idx) = s.find("*/") {
                s = s[idx + 2..].trim_start();
            } else {
                // Unclosed block comment
                return "";
            }
        } else {
            break;
        }
    }
    s
}

/// Strip trailing semicolons and whitespace from a SQL statement.
///
/// Raw queries are wrapped in subqueries (e.g. `SELECT row_to_json(q) FROM (…) q`)
/// when projecting JSON, so a trailing `;` from the user input becomes a syntax
/// error inside the parens. This helper normalises the input by removing any
/// trailing `;` and whitespace before the wrapping happens.
fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

/// Sprint 261 (ADR 0026) — convert a `Value::Number` cell to
/// `Value::String(n.to_string())` when its column `data_type` belongs to a
/// precision-sensitive family (PG `bigint`/`int8`/`bigserial`,
/// `numeric`/`decimal`). All other cells (and other variants) pass through
/// unchanged.
///
/// Why: `row_to_json(q)::text` represents PG `bigint` (i64) and `numeric`
/// (arbitrary-precision base-10) as raw JSON number tokens. The native
/// `JSON.parse` on the JS side coerces them to IEEE 754 f64, losing
/// precision above ±(2^53-1) for `bigint` and the entire base-10 mantissa
/// for `numeric`. Emitting them as JSON string tokens preserves the digits
/// byte-for-byte; the frontend wrapper (`wrapNumericCells`) inspects the
/// same `data_type` and wraps the resulting JS string as `BigInt(...)` or
/// `new Decimal(...)`. `int2`/`int4`/`real`/`double precision` are NOT
/// stringified — they round-trip losslessly through f64 and match JS's
/// `Number` representation directly.
pub(super) fn stringify_numeric_if_precision_sensitive(
    cell: serde_json::Value,
    data_type: &str,
) -> serde_json::Value {
    if !matches!(cell, serde_json::Value::Number(_)) {
        return cell;
    }
    let lower = data_type.to_ascii_lowercase();
    let is_precision_sensitive = lower == "bigint"
        || lower == "int8"
        || lower == "bigserial"
        || lower.contains("numeric")
        || lower.contains("decimal");
    if !is_precision_sensitive {
        return cell;
    }
    if let serde_json::Value::Number(n) = &cell {
        return serde_json::Value::String(n.to_string());
    }
    cell
}

/// Maps PostgreSQL `data_type` strings (from `information_schema.columns`) to
/// the corresponding cast target type name. Returns `None` for text-like types
/// where no cast is needed (binding as `text` is fine).
fn pg_cast_type(data_type: &str) -> Option<&'static str> {
    match data_type {
        // Integer types
        "bigint" => Some("bigint"),
        "integer" => Some("integer"),
        "smallint" => Some("smallint"),
        // Numeric / decimal
        "numeric" | "decimal" => Some("numeric"),
        // Floating-point
        "real" => Some("real"),
        "double precision" => Some("double precision"),
        // Boolean
        "boolean" => Some("boolean"),
        // UUID
        "uuid" => Some("uuid"),
        // Date / time
        "date" => Some("date"),
        "timestamp without time zone" => Some("timestamp"),
        "timestamp with time zone" => Some("timestamptz"),
        "time without time zone" => Some("time"),
        "time with time zone" => Some("timetz"),
        // Text-like: no cast needed
        "text" | "varchar" | "character varying" | "char" | "character" | "name" => None,
        // Unknown types: no cast
        _ => None,
    }
}

impl PostgresAdapter {
    pub async fn execute(&self, query: &str) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query(query)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// Execute an arbitrary SQL query and return the result.
    /// Supports cancellation via CancellationToken.
    ///
    /// # Arguments
    /// * `query` - The SQL query to execute
    /// * `cancel_token` - Optional token to cancel the query execution
    ///
    /// # Returns
    /// * `QueryResult` - Columns, rows, execution time, and query type
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<QueryResult, AppError> {
        let start = std::time::Instant::now();

        // Strip a trailing `;` so it does not break the row_to_json wrapping
        // for SELECT queries — PostgreSQL itself accepts a single trailing
        // semicolon on top-level statements, but it is invalid inside parens.
        let query = strip_trailing_terminator(query);
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }

        // Detect query type from the SQL statement (strip comments first)
        let stripped = strip_leading_comments(query);
        let trimmed_query = stripped.to_uppercase();
        let query_type = if trimmed_query.starts_with("SELECT")
            || trimmed_query.starts_with("WITH")
            || trimmed_query.starts_with("SHOW")
            || trimmed_query.starts_with("EXPLAIN")
        {
            QueryType::Select
        } else if trimmed_query.starts_with("INSERT")
            || trimmed_query.starts_with("UPDATE")
            || trimmed_query.starts_with("DELETE")
        {
            QueryType::Dml { rows_affected: 0 }
        } else {
            QueryType::Ddl
        };

        // Clone pool reference and release lock immediately
        let pool = self.active_pool().await?;

        // Execute query based on type
        let result = match query_type {
            QueryType::Select => {
                let query_future = async {
                    // First, get column metadata from a dry-run (LIMIT 0) or the actual query
                    let rows = sqlx::query(query).fetch_all(&pool).await?;

                    // Extract column metadata from rows when available
                    let columns: Vec<QueryColumn> = if let Some(first_row) = rows.first() {
                        first_row
                            .columns()
                            .iter()
                            .map(|col| {
                                let data_type = col.type_info().to_string();
                                let category = map_pg_data_type(&data_type);
                                QueryColumn {
                                    name: col.name().to_string(),
                                    data_type,
                                    category,
                                }
                            })
                            .collect()
                    } else {
                        // For empty results, we cannot determine columns from the row data.
                        // Return empty columns — the frontend handles this gracefully.
                        Vec::new()
                    };

                    // Use row_to_json via PostgreSQL to convert rows to proper JSON values.
                    // Direct try_get::<serde_json::Value> only works for json/jsonb columns,
                    // so we wrap the query in a subquery and use row_to_json().
                    let wrapped_sql = format!("SELECT row_to_json(q)::text FROM ({}) q", query);
                    let json_rows_raw = sqlx::query_scalar::<_, String>(&wrapped_sql)
                        .fetch_all(&pool)
                        .await?;

                    let json_rows: Vec<Vec<serde_json::Value>> = json_rows_raw
                        .iter()
                        .map(|json_str| {
                            let obj: serde_json::Map<String, serde_json::Value> =
                                serde_json::from_str(json_str).unwrap_or_default();
                            columns
                                .iter()
                                .map(|col| {
                                    let raw = obj
                                        .get(&col.name)
                                        .cloned()
                                        .unwrap_or(serde_json::Value::Null);
                                    // Sprint 261 (ADR 0026) — bigint /
                                    // numeric cells are pre-stringified so
                                    // native JSON.parse on the JS side
                                    // preserves digit-for-digit precision.
                                    stringify_numeric_if_precision_sensitive(raw, &col.data_type)
                                })
                                .collect()
                        })
                        .collect();

                    let total_count = json_rows.len() as i64;
                    let execution_time_ms = start.elapsed().as_millis() as u64;

                    Ok::<QueryResult, AppError>(QueryResult {
                        columns,
                        rows: json_rows,
                        total_count,
                        execution_time_ms,
                        query_type: QueryType::Select,
                    })
                };

                // Apply cancellation if token provided
                if let Some(token) = cancel_token {
                    tokio::select! {
                        result = query_future => result,
                        _ = token.cancelled() => {
                            return Err(AppError::Database("Query cancelled".into()));
                        }
                    }
                } else {
                    query_future.await
                }
            }
            QueryType::Dml { .. } => {
                let query_future = async {
                    let result = sqlx::query(query).execute(&pool).await?;
                    let rows_affected = result.rows_affected();
                    let execution_time_ms = start.elapsed().as_millis() as u64;

                    Ok::<QueryResult, AppError>(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: rows_affected as i64,
                        execution_time_ms,
                        query_type: QueryType::Dml { rows_affected },
                    })
                };

                if let Some(token) = cancel_token {
                    tokio::select! {
                        result = query_future => result,
                        _ = token.cancelled() => {
                            return Err(AppError::Database("Query cancelled".into()));
                        }
                    }
                } else {
                    query_future.await
                }
            }
            QueryType::Ddl => {
                let query_future = async {
                    sqlx::query(query).execute(&pool).await?;
                    let execution_time_ms = start.elapsed().as_millis() as u64;

                    Ok::<QueryResult, AppError>(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: 0,
                        execution_time_ms,
                        query_type: QueryType::Ddl,
                    })
                };

                if let Some(token) = cancel_token {
                    tokio::select! {
                        result = query_future => result,
                        _ = token.cancelled() => {
                            return Err(AppError::Database("Query cancelled".into()));
                        }
                    }
                } else {
                    query_future.await
                }
            }
        };

        result
    }

    /// Sprint 183 — execute a list of statements inside a single
    /// transaction. All-or-nothing: a failure on statement K rolls back
    /// statements 1..K-1 and surfaces the original sqlx error wrapped in
    /// `AppError::Database("statement K of N failed: <msg>")`. Empty input
    /// short-circuits with `Ok(vec![])` (no BEGIN/COMMIT round-trip).
    /// Each non-empty statement is run via `sqlx::query::execute` on the
    /// `Transaction<Postgres>`. We do not classify SELECT vs DML here —
    /// commit-pipeline statements (UPDATE/DELETE/INSERT) only need
    /// `rows_affected`, and the existing `execute_query` path is preserved
    /// for the rare SELECT-inside-batch case (still rare enough that the
    /// caller would issue a single `executeQuery`).
    pub async fn execute_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        for (idx, raw) in statements.iter().enumerate() {
            if strip_trailing_terminator(raw).trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
            }
        }

        let pool = self.active_pool().await?;
        let total = statements.len();

        let work = async {
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut results: Vec<QueryResult> = Vec::with_capacity(total);
            for (idx, raw) in statements.iter().enumerate() {
                let stmt = strip_trailing_terminator(raw);
                let start = std::time::Instant::now();
                let exec_result = sqlx::query(stmt).execute(&mut *tx).await;
                match exec_result {
                    Ok(res) => {
                        let rows_affected = res.rows_affected();
                        results.push(QueryResult {
                            columns: Vec::new(),
                            rows: Vec::new(),
                            total_count: rows_affected as i64,
                            execution_time_ms: start.elapsed().as_millis() as u64,
                            query_type: QueryType::Dml { rows_affected },
                        });
                    }
                    Err(e) => {
                        // Best-effort rollback. `tx.rollback()` consumes
                        // the transaction; any error during rollback is
                        // discarded so the original failure stays the
                        // user-facing message (matches PG's protocol-level
                        // rollback on first error anyway).
                        let _ = tx.rollback().await;
                        return Err(AppError::Database(format!(
                            "statement {} of {} failed: {}",
                            idx + 1,
                            total,
                            e
                        )));
                    }
                }
            }

            tx.commit()
                .await
                .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;
            Ok::<Vec<QueryResult>, AppError>(results)
        };

        if let Some(token) = cancel_token {
            tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Query cancelled".into())),
            }
        } else {
            work.await
        }
    }

    /// Sprint 247 (ADR 0022 Phase 3) — dry-run a list of statements inside
    /// a single transaction WITHOUT committing. Same shape as
    /// `execute_query_batch`, but the transaction is unconditionally
    /// rolled back at the end so the database is left untouched.
    ///
    /// Empty input short-circuits with `Ok(vec![])` (no BEGIN/ROLLBACK
    /// round-trip — matches `execute_query_batch`'s no-op contract).
    /// Failure on statement K returns the same `"statement K of N failed:
    /// <msg>"` error message as the commit path so the preview pane and
    /// the eventual commit produce identical error copy.
    pub async fn dry_run_query_batch(
        &self,
        statements: &[String],
        cancel_token: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        for (idx, raw) in statements.iter().enumerate() {
            if strip_trailing_terminator(raw).trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
            }
        }

        let pool = self.active_pool().await?;
        let total = statements.len();

        let work = async {
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut results: Vec<QueryResult> = Vec::with_capacity(total);
            for (idx, raw) in statements.iter().enumerate() {
                let stmt = strip_trailing_terminator(raw);
                let start = std::time::Instant::now();
                let exec_result = sqlx::query(stmt).execute(&mut *tx).await;
                match exec_result {
                    Ok(res) => {
                        let rows_affected = res.rows_affected();
                        results.push(QueryResult {
                            columns: Vec::new(),
                            rows: Vec::new(),
                            total_count: rows_affected as i64,
                            execution_time_ms: start.elapsed().as_millis() as u64,
                            query_type: QueryType::Dml { rows_affected },
                        });
                    }
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(AppError::Database(format!(
                            "statement {} of {} failed: {}",
                            idx + 1,
                            total,
                            e
                        )));
                    }
                }
            }

            // Unconditional rollback — the entire point of dry-run is to
            // observe statistics without persisting changes. A failed
            // rollback at this stage is unactionable (the connection is
            // returned to the pool which resets state), so we surface
            // the rollback error verbatim only if `commit_ok == false`.
            tx.rollback()
                .await
                .map_err(|e| AppError::Database(format!("rollback failed: {}", e)))?;
            Ok::<Vec<QueryResult>, AppError>(results)
        };

        if let Some(token) = cancel_token {
            tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Query cancelled".into())),
            }
        } else {
            work.await
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn query_table_data(
        &self,
        table: &str,
        schema: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
    ) -> Result<TableData, AppError> {
        let pool = self.active_pool().await?;

        // Get columns first
        let columns = self.get_table_columns_inner(&pool, table, schema).await?;

        // Build safe query — table/schema are validated identifiers
        let qualified_table = qualified_table(schema, table);

        // Validate raw_where if provided
        let raw_where_trimmed = raw_where.map(|rw| rw.trim()).filter(|rw| !rw.is_empty());

        if let Some(rw) = &raw_where_trimmed {
            // Reject semicolons to prevent multi-statement injection
            if rw.contains(';') {
                return Err(AppError::Validation(
                    "Raw WHERE clause must not contain semicolons".into(),
                ));
            }
            // Reject dangerous statements at the start of the clause
            let upper = rw.to_uppercase();
            let dangerous_starts = [
                "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "GRANT",
                "REVOKE",
            ];
            for keyword in &dangerous_starts {
                if upper.starts_with(keyword) {
                    return Err(AppError::Validation(format!(
                        "Raw WHERE clause must not start with {}",
                        keyword
                    )));
                }
            }
        }

        // Build WHERE clause: raw_where takes precedence over structured filters
        let (where_clause, param_values) = if let Some(rw) = &raw_where_trimmed {
            (format!(" WHERE {}", rw), Vec::<String>::new())
        } else {
            // Build WHERE clause from filters with parameterized values
            let mut where_clause = String::new();
            let mut param_values: Vec<String> = Vec::new();
            if let Some(filters) = filters {
                if !filters.is_empty() {
                    let valid_columns: std::collections::HashSet<&str> =
                        columns.iter().map(|c| c.name.as_str()).collect();
                    // Build column-name -> data_type lookup for O(1) type casts
                    let col_types: std::collections::HashMap<&str, &str> = columns
                        .iter()
                        .map(|c| (c.name.as_str(), c.data_type.as_str()))
                        .collect();
                    let mut conditions: Vec<String> = Vec::new();
                    for f in filters {
                        if !valid_columns.contains(f.column.as_str()) {
                            continue;
                        }
                        let quoted_col = format!("\"{}\"", f.column.replace('"', "\"\""));
                        match &f.operator {
                            FilterOperator::IsNull => {
                                conditions.push(format!("{} IS NULL", quoted_col));
                            }
                            FilterOperator::IsNotNull => {
                                conditions.push(format!("{} IS NOT NULL", quoted_col));
                            }
                            _ => {
                                let op = match f.operator {
                                    FilterOperator::Eq => "=",
                                    FilterOperator::Neq => "<>",
                                    FilterOperator::Gt => ">",
                                    FilterOperator::Lt => "<",
                                    FilterOperator::Gte => ">=",
                                    FilterOperator::Lte => "<=",
                                    FilterOperator::Like => "LIKE",
                                    _ => unreachable!(),
                                };
                                if let Some(val) = &f.value {
                                    let param_idx = param_values.len() + 1;
                                    let cast_suffix = col_types
                                        .get(f.column.as_str())
                                        .and_then(|dt| pg_cast_type(dt))
                                        .map(|t| format!("::{}", t))
                                        .unwrap_or_default();
                                    conditions.push(format!(
                                        "{} {} ${}{}",
                                        quoted_col, op, param_idx, cast_suffix
                                    ));
                                    param_values.push(val.clone());
                                }
                            }
                        }
                    }
                    if !conditions.is_empty() {
                        where_clause = format!(" WHERE {}", conditions.join(" AND "));
                    }
                }
            }
            (where_clause, param_values)
        };

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM {}{}", qualified_table, where_clause);
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        for val in &param_values {
            count_query = count_query.bind(val);
        }
        let (total,) = count_query
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build data query using row_to_json for type-safe conversion
        let offset = (page - 1).max(0) * page_size;

        let mut order_clause = String::new();
        let mut user_sort_columns: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        if let Some(order_by) = &order_by {
            // Parse comma-separated "column_name ASC, column_name DESC" format
            let valid_columns: std::collections::HashSet<&str> =
                columns.iter().map(|c| c.name.as_str()).collect();
            let mut order_parts: Vec<String> = Vec::new();
            for part in order_by.split(',') {
                let part_trimmed = part.trim();
                let parts: Vec<&str> = part_trimmed.split_whitespace().collect();
                let (col_name, direction) = match parts.as_slice() {
                    [col, dir] if *dir == "ASC" || *dir == "DESC" => (*col, *dir),
                    [col] => (*col, "ASC"),
                    _ => continue, // Skip invalid format
                };
                // Validate column name
                if valid_columns.contains(col_name) {
                    order_parts.push(format!(
                        "\"{}\" {}",
                        col_name.replace('"', "\"\""),
                        direction
                    ));
                    user_sort_columns.insert(col_name.to_string());
                }
            }
            if !order_parts.is_empty() {
                // Sprint 243 — append PK columns (ASC) as a tiebreaker
                // when the user's sort doesn't already cover them. PG
                // freely reorders rows with equal sort keys based on
                // physical heap layout; an UPDATE moves the tuple to
                // the heap tail, so without a stable secondary sort
                // the edited row appears at the bottom of its same-
                // value group on the next refetch. The PK tiebreaker
                // pins the order deterministically. Skipped when the
                // user already sorted by every PK column (no point
                // appending a redundant clause). Same rationale as
                // Sprint 232's no-sort fallback, extended to the
                // user-supplied path.
                let pk_tiebreaker_parts: Vec<String> = columns
                    .iter()
                    .filter(|c| c.is_primary_key && !user_sort_columns.contains(&c.name))
                    .map(|c| format!("\"{}\" ASC", c.name.replace('"', "\"\"")))
                    .collect();
                let mut all_parts = order_parts;
                all_parts.extend(pk_tiebreaker_parts);
                order_clause = format!(" ORDER BY {}", all_parts.join(", "));
            }
        }

        // Sprint 232 — when the user supplies no `order_by` (or the
        // supplied string yields zero valid parts above), fall back to
        // the table's PK columns in `ASC` order. This makes DataGrid
        // refetches deterministic and keeps an UPDATEd row in its
        // id-ordered slot instead of jumping to the heap tail.
        if order_clause.is_empty() {
            order_clause = build_default_order_clause(&columns);
        }

        // `executed_query` is what the user sees in the grid's "Query" panel,
        // so it must be the user-facing SQL — not the `row_to_json(q)` wrapper
        // we use internally to coerce arbitrary PG types into a JSON string
        // (see `execute_query` for the same pattern and rationale).
        let inner_sql = format!(
            "SELECT * FROM {}{}{} LIMIT {} OFFSET {}",
            qualified_table, where_clause, order_clause, page_size, offset
        );
        let data_sql = format!("SELECT row_to_json(q)::text FROM ({}) q", inner_sql);
        let executed_query = inner_sql;

        let mut data_query = sqlx::query_as::<_, (String,)>(&data_sql);
        for val in &param_values {
            data_query = data_query.bind(val);
        }
        let json_rows: Vec<(String,)> = data_query
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Parse JSON strings into Vec<Vec<serde_json::Value>> in column order
        let result_rows: Vec<Vec<serde_json::Value>> = json_rows
            .into_iter()
            .map(|(json_str,)| {
                let obj: serde_json::Map<String, serde_json::Value> =
                    serde_json::from_str(&json_str).unwrap_or_default();
                columns
                    .iter()
                    .map(|col| {
                        let raw = obj
                            .get(&col.name)
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        // Sprint 261 (ADR 0026) — bigint / numeric cells
                        // are pre-stringified so native JSON.parse on the
                        // JS side preserves digit-for-digit precision.
                        stringify_numeric_if_precision_sensitive(raw, &col.data_type)
                    })
                    .collect()
            })
            .collect();

        Ok(TableData {
            columns,
            rows: result_rows,
            total_count: total,
            page,
            page_size,
            executed_query,
        })
    }
    /// Sprint 192 — server-side cursor 기반 row streaming.
    ///
    /// `BEGIN; DECLARE NO SCROLL CURSOR FOR SELECT row_to_json(t)::text FROM
    /// "schema"."table" t; FETCH FORWARD batch_size; …; CLOSE; COMMIT`.
    /// row_to_json 으로 모든 PG 타입을 JSON 으로 직렬화 — bytea (`\x...`),
    /// timestamp (ISO 8601), array / JSON / record 모두 자동 처리.
    ///
    /// 호출자가 넘긴 `column_names` 를 source order 로 신뢰하고, JSON
    /// object 에서 그 순서대로 lookup 해 `Vec<Value>` 를 만든다.
    /// `serde_json::Map` 은 `preserve_order` feature 가 비활성이라
    /// alphabetical sorted 일 수 있는데, lookup-by-name 으로 우회.
    ///
    /// Cancellation: 매 batch loop 의 시작에서 `cancel.is_cancelled()` 를
    /// 체크. token fired / receiver drop 모두 `CLOSE cursor; ROLLBACK` 한
    /// 뒤 `AppError::Database("Operation cancelled")` 또는 `"Receiver
    /// dropped — export aborted"` 를 반환한다.
    pub async fn stream_table_rows(
        &self,
        schema: &str,
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

        let pool = self.active_pool().await?;
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(format!("BEGIN failed: {e}")))?;

        let qualified = qualified_table(schema, table);
        let cursor_name = "_vt_export_cur";
        let declare = format!(
            "DECLARE {cursor_name} NO SCROLL CURSOR FOR \
             SELECT row_to_json(t)::text FROM {qualified} AS t",
        );
        sqlx::query(&declare)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Database(format!("DECLARE CURSOR failed: {e}")))?;

        let mut total: u64 = 0;
        let fetch_sql = format!("FETCH FORWARD {batch_size} FROM {cursor_name}");
        loop {
            if let Some(t) = cancel {
                if t.is_cancelled() {
                    close_cursor_warn(&mut tx, cursor_name, "cancellation").await;
                    if let Err(e) = tx.rollback().await {
                        warn!("ROLLBACK after cancellation failed: {e}");
                    }
                    return Err(AppError::Database("Operation cancelled".into()));
                }
            }
            let strings: Vec<String> = sqlx::query_scalar(&fetch_sql)
                .fetch_all(&mut *tx)
                .await
                .map_err(|e| AppError::Database(format!("FETCH failed: {e}")))?;
            if strings.is_empty() {
                break;
            }
            let mut batch: Vec<Vec<serde_json::Value>> = Vec::with_capacity(strings.len());
            for s in strings {
                let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&s)
                    .map_err(|e| AppError::Database(format!("row_to_json parse failed: {e}")))?;
                let row: Vec<serde_json::Value> = column_names
                    .iter()
                    .map(|name| obj.get(name).cloned().unwrap_or(serde_json::Value::Null))
                    .collect();
                batch.push(row);
            }
            let count = batch.len() as u64;
            if sender.send(batch).await.is_err() {
                close_cursor_warn(&mut tx, cursor_name, "receiver dropped").await;
                if let Err(e) = tx.rollback().await {
                    warn!("ROLLBACK after receiver drop failed: {e}");
                }
                return Err(AppError::Database(
                    "Receiver dropped — export aborted".into(),
                ));
            }
            total += count;
        }

        close_cursor_warn(&mut tx, cursor_name, "commit").await;
        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("COMMIT failed: {e}")))?;
        Ok(total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::postgres::PostgresAdapter;
    use crate::models::ColumnCategory;

    // [AC-183-07a] — empty input must short-circuit without acquiring a
    // pool or starting a transaction; matches the contract's "no-op
    // commit" expectation. Date 2026-05-01.
    #[tokio::test]
    async fn test_execute_sql_batch_empty_returns_empty_vec() {
        let adapter = PostgresAdapter::new();
        let result = adapter.execute_query_batch(&[], None).await;
        match result {
            Ok(v) => assert!(v.is_empty(), "Expected empty Vec, got {} items", v.len()),
            Err(e) => panic!("Empty input should succeed, got error: {:?}", e),
        }
    }

    // [AC-183-07b] — validation must reject a batch where any statement
    // is empty (or whitespace-only) before BEGIN is issued, so a misformed
    // batch never opens a transaction it cannot close. Date 2026-05-01.
    #[tokio::test]
    async fn test_execute_sql_batch_validation_rejects_empty_statement() {
        let adapter = PostgresAdapter::new();
        let stmts = vec!["UPDATE t SET x = 1".to_string(), "   ".to_string()];
        let result = adapter.execute_query_batch(&stmts, None).await;
        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("Statement 2 of 2 is empty"),
                    "Expected validation error citing index, got: {msg}"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    // -------------------------------------------------------------------
    // Sprint 130 — sub-pool LRU + switch_active_db unit tests
    // -------------------------------------------------------------------
    //
    // The cache-hit / eviction / current_db-protection tests drive the
    // adapter's internal state directly via the `inner` mutex so we can
    // verify LRU bookkeeping without standing up a real Postgres pool.
    // The cache-miss path requires a live `PgPool` (it calls
    // `connect_with`), so that test is gated behind `#[ignore]` and only
    // runs when a developer has TEST_PG configured.

    #[test]
    fn strip_leading_comments_line_comment() {
        assert_eq!(
            strip_leading_comments("-- this is a comment\nSELECT 1"),
            "SELECT 1"
        );
    }

    #[test]
    fn strip_leading_comments_block_comment() {
        assert_eq!(strip_leading_comments("/* block */ SELECT 1"), "SELECT 1");
    }

    #[test]
    fn strip_leading_comments_multiple_line_comments() {
        assert_eq!(
            strip_leading_comments("-- line 1\n-- line 2\nSELECT 1"),
            "SELECT 1"
        );
    }

    #[test]
    fn strip_leading_comments_mixed_comments() {
        assert_eq!(
            strip_leading_comments("/* block */ -- line\nINSERT INTO t VALUES (1)"),
            "INSERT INTO t VALUES (1)"
        );
    }

    #[test]
    fn strip_leading_comments_no_comment() {
        assert_eq!(strip_leading_comments("SELECT 1"), "SELECT 1");
    }

    #[test]
    fn strip_leading_comments_only_comment() {
        assert_eq!(strip_leading_comments("-- just a comment"), "");
    }

    #[test]
    fn strip_leading_comments_unclosed_block() {
        assert_eq!(strip_leading_comments("/* never closed"), "");
    }

    #[test]
    fn strip_leading_comments_whitespace_only() {
        assert_eq!(strip_leading_comments("   "), "");
    }

    #[test]
    fn strip_trailing_terminator_removes_single_semicolon() {
        assert_eq!(strip_trailing_terminator("SELECT 1;"), "SELECT 1");
    }

    #[test]
    fn strip_trailing_terminator_removes_semicolon_with_whitespace() {
        assert_eq!(strip_trailing_terminator("SELECT 1;  \n  "), "SELECT 1");
    }

    #[test]
    fn strip_trailing_terminator_removes_multiple_semicolons() {
        assert_eq!(strip_trailing_terminator("SELECT 1;;"), "SELECT 1");
    }

    #[test]
    fn strip_trailing_terminator_no_change_when_absent() {
        assert_eq!(strip_trailing_terminator("SELECT 1"), "SELECT 1");
    }

    #[test]
    fn strip_trailing_terminator_preserves_internal_semicolon() {
        // Internal semicolons (e.g., inside string literals or between statements)
        // are not the helper's responsibility — only true trailing ones go.
        assert_eq!(
            strip_trailing_terminator("SELECT ';' as v;"),
            "SELECT ';' as v"
        );
    }

    #[test]
    fn strip_trailing_terminator_only_semicolons_returns_empty() {
        assert_eq!(strip_trailing_terminator(";  ;  "), "");
    }

    // -------------------------------------------------------------------
    // Sprint 232 — default ORDER BY by primary key.
    // -------------------------------------------------------------------
    //
    // User report (2026-05-07): "기본적으로 id 기반으로 sorting 하게
    // 해주고, update 했을 때 update 한 row 가 가장 밑으로 내려가는
    // 버그 수정해줘". Root cause: `query_table_data` emitted no
    // ORDER BY when the caller passed `order_by = None`, so PG returned
    // rows in heap order — and an UPDATE moves a row to the heap tail
    // (dead tuple + new tuple-at-tail). Fallback to PK-ordered ASC
    // closes both complaints with a single SQL-builder change.
    //
    // The fixtures below pin `build_default_order_clause` invariants:
    // empty → no clause, single PK → quoted ASC, composite PK →
    // declared-order ASC chain, embedded `"` → PG identifier double-up.
    // We test the helper directly (free function, no pool needed) so a
    // future regression surfaces here before reaching the IPC surface.

    fn col_pk(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: "integer".to_string(),
            nullable: false,
            default_value: None,
            is_primary_key: true,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: ColumnCategory::Int,
        }
    }

    fn col_plain(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: "text".to_string(),
            nullable: true,
            default_value: None,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: ColumnCategory::Text,
        }
    }

    // [AC-232-01] — Single-PK fallback emits the canonical `id ASC`
    // clause that the user expects. Date 2026-05-07.
    #[test]
    fn build_default_order_clause_single_pk() {
        let cols = vec![col_pk("id"), col_plain("name"), col_plain("email")];
        assert_eq!(build_default_order_clause(&cols), " ORDER BY \"id\" ASC");
    }

    // [AC-232-01] — Composite PK preserves declared order so a junction
    // table (e.g. `tenant_user`) sorts by `tenant_id ASC, user_id ASC`.
    // Date 2026-05-07.
    #[test]
    fn build_default_order_clause_composite_pk() {
        let cols = vec![
            col_pk("tenant_id"),
            col_pk("user_id"),
            col_plain("joined_at"),
        ];
        assert_eq!(
            build_default_order_clause(&cols),
            " ORDER BY \"tenant_id\" ASC, \"user_id\" ASC"
        );
    }

    // [AC-232-03] — A table without a PK falls back to the empty string,
    // which preserves the pre-Sprint-232 behavior (no ORDER BY emitted).
    // Views and unlogged tables hit this path. Date 2026-05-07.
    #[test]
    fn build_default_order_clause_no_pk_returns_empty() {
        let cols = vec![col_plain("a"), col_plain("b")];
        assert_eq!(build_default_order_clause(&cols), "");
    }

    // [AC-232-04] — Embedded `"` in a PK identifier must be doubled per
    // PG quoting rules so the generated SQL stays parseable. Mirrors the
    // existing convention `replace('"', "\"\"")` in the user-supplied
    // ORDER BY parsing path. Date 2026-05-07.
    #[test]
    fn build_default_order_clause_quotes_embedded_double_quote() {
        let cols = vec![col_pk("we\"ird")];
        assert_eq!(
            build_default_order_clause(&cols),
            " ORDER BY \"we\"\"ird\" ASC"
        );
    }

    // [AC-232-05 회귀] — User-reported repro shape: a `users` table with
    // a single `id` PK plus a couple of plain columns. Asserts that the
    // helper emits exactly the clause that prevents the UPDATE-tail
    // shift. Date 2026-05-07.
    #[test]
    fn build_default_order_clause_users_table_regression() {
        let cols = vec![
            col_pk("id"),
            col_plain("name"),
            col_plain("active"),
            col_plain("updated_at"),
        ];
        assert_eq!(build_default_order_clause(&cols), " ORDER BY \"id\" ASC");
    }

    // [AC-232-01] — Empty `columns` slice is a degenerate input but must
    // not panic. Returns empty string. Date 2026-05-07.
    #[test]
    fn build_default_order_clause_empty_columns_returns_empty() {
        let cols: Vec<ColumnInfo> = Vec::new();
        assert_eq!(build_default_order_clause(&cols), "");
    }

    // ── strip_leading_comments / strip_trailing_terminator 보강 ──────────
    // 작성: 2026-05-07. 기존 strip_* 테스트가 happy path + 코멘트 분기를
    // 커버하지만 (a) "코멘트 없이 leading whitespace 만" (b) "빈 입력"
    // edge 가 비어있어 P4 (빈/누락 입력 분기 동등 비중) 보강.

    #[test]
    fn strip_leading_comments_trims_leading_whitespace_only_without_comment() {
        // 코멘트 분기를 모두 패스해 break 로 빠지는 경로 — 기존 테스트는
        // 항상 코멘트 시작으로 분기를 들어가서 이 path 가 비어있었다.
        assert_eq!(strip_leading_comments("   \n\t SELECT 1"), "SELECT 1");
    }

    #[test]
    fn strip_leading_comments_empty_input_returns_empty() {
        assert_eq!(strip_leading_comments(""), "");
    }

    #[test]
    fn strip_trailing_terminator_trims_trailing_whitespace_without_semicolon() {
        // trim_end_matches 자체는 자명하지만 ;없이 whitespace 만 trim 되는
        // path 가 기존 테스트에서 누락. 회귀 가드.
        assert_eq!(strip_trailing_terminator("SELECT 1   \n"), "SELECT 1");
    }

    #[test]
    fn strip_trailing_terminator_empty_input_returns_empty() {
        assert_eq!(strip_trailing_terminator(""), "");
    }

    // ── pg_cast_type ──────────────────────────────────────────────────────
    // 작성: 2026-05-07. information_schema.columns.data_type → SQL cast
    // 타깃 매핑. parameterized 쿼리에서 bind 시 캐스트 누락 → 타입 추론
    // 실패 회귀를 차단. happy path + edge (text-like → None, 미지 → None).

    #[test]
    fn pg_cast_type_integer_family() {
        assert_eq!(pg_cast_type("bigint"), Some("bigint"));
        assert_eq!(pg_cast_type("integer"), Some("integer"));
        assert_eq!(pg_cast_type("smallint"), Some("smallint"));
    }

    #[test]
    fn pg_cast_type_numeric_aliases_collapse_to_numeric() {
        // PG 는 `numeric` 과 `decimal` 을 alias 로 취급. 둘 다 같은 cast.
        assert_eq!(pg_cast_type("numeric"), Some("numeric"));
        assert_eq!(pg_cast_type("decimal"), Some("numeric"));
    }

    #[test]
    fn pg_cast_type_floating_point() {
        assert_eq!(pg_cast_type("real"), Some("real"));
        assert_eq!(pg_cast_type("double precision"), Some("double precision"));
    }

    #[test]
    fn pg_cast_type_timestamp_distinguishes_with_timezone() {
        // information_schema 는 "timestamp without time zone" /
        // "timestamp with time zone" 를 풀 표현으로 보고하므로 그 형태가
        // 입력 — 출력은 `timestamp` / `timestamptz` 의 PG canonical 이름.
        assert_eq!(
            pg_cast_type("timestamp without time zone"),
            Some("timestamp")
        );
        assert_eq!(
            pg_cast_type("timestamp with time zone"),
            Some("timestamptz")
        );
    }

    #[test]
    fn pg_cast_type_time_distinguishes_with_timezone() {
        assert_eq!(pg_cast_type("time without time zone"), Some("time"));
        assert_eq!(pg_cast_type("time with time zone"), Some("timetz"));
    }

    #[test]
    fn pg_cast_type_uuid_and_boolean_and_date_simple() {
        assert_eq!(pg_cast_type("uuid"), Some("uuid"));
        assert_eq!(pg_cast_type("boolean"), Some("boolean"));
        assert_eq!(pg_cast_type("date"), Some("date"));
    }

    #[test]
    fn pg_cast_type_text_like_returns_none_no_cast_needed() {
        // text 계열은 bind 시 그냥 text 로 가도 PG 가 추론하므로 cast 불요.
        for t in &[
            "text",
            "varchar",
            "character varying",
            "char",
            "character",
            "name",
        ] {
            assert_eq!(pg_cast_type(t), None, "text-like '{}' should not cast", t);
        }
    }

    #[test]
    fn pg_cast_type_unknown_returns_none() {
        // 새 타입(예: jsonb, money, geometry) 은 None — 호출 측에서 cast
        // 없이 bind. 기존 안전 path 유지.
        assert_eq!(pg_cast_type("jsonb"), None);
        assert_eq!(pg_cast_type("money"), None);
        assert_eq!(pg_cast_type(""), None);
    }

    // ── Sprint 261 (ADR 0026) — numeric stringify helper ─────────────────
    // 작성: 2026-05-11. `row_to_json(q)::text` 가 bigint/numeric 을 raw
    // JSON number 로 직렬화하면 native JSON.parse 단계에서 IEEE 754 f64
    // 변환으로 정밀도가 소실된다. helper 는 `column.data_type` 을 보고
    // 정밀도 위험 컬럼 cell 만 `Value::String(n.to_string())` 으로
    // pre-stringify 해서 wire 위에 string token 으로 올린다. 4 site
    // (execute_query, query_table_data, stream_table_rows) 에서 같은
    // 헬퍼를 재사용하므로 분기 의미를 여기 한 곳에 묶어둔다.

    fn n(i: i64) -> serde_json::Value {
        serde_json::Value::Number(i.into())
    }

    // [AC-261-02-PG-01] — bigint i64 max (>2^53-1) 값이 string 으로 wire 에
    // 올라간다. JS BigInt 로 wrap 되기 전 단계에서 digits 가 보존되는지의
    // 핵심 가드. Date 2026-05-11.
    #[test]
    fn stringify_numeric_bigint_at_i64_max_emits_string() {
        let cell = n(i64::MAX);
        let out = stringify_numeric_if_precision_sensitive(cell, "bigint");
        assert_eq!(
            out,
            serde_json::Value::String("9223372036854775807".to_string())
        );
    }

    // [AC-261-02-PG-01] — int8 alias 도 동일하게 처리. PG 가 보고하는
    // `Pg::type_info()` 가 `INT8` 이라 lower-case 후 매칭. Date 2026-05-11.
    #[test]
    fn stringify_numeric_int8_alias_emits_string() {
        let out = stringify_numeric_if_precision_sensitive(n(42), "INT8");
        assert_eq!(out, serde_json::Value::String("42".to_string()));
    }

    // [AC-261-02-PG-01] — bigserial 도 i64 라 같은 정밀도 위험. PK 의
    // 일반 형태이므로 별도 케이스로 고정. Date 2026-05-11.
    #[test]
    fn stringify_numeric_bigserial_emits_string() {
        let out = stringify_numeric_if_precision_sensitive(n(1), "bigserial");
        assert_eq!(out, serde_json::Value::String("1".to_string()));
    }

    // [AC-261-02-PG-02] — numeric / decimal / numeric(p,s) 모두 base-10
    // 임의 정밀도라 f64 변환 불가. substring 매칭으로 `numeric(20,18)` 같은
    // parameterized 표현도 잡는다. Date 2026-05-11.
    #[test]
    fn stringify_numeric_decimal_family_emits_string() {
        let out = stringify_numeric_if_precision_sensitive(n(123), "numeric");
        assert_eq!(out, serde_json::Value::String("123".to_string()));

        let out = stringify_numeric_if_precision_sensitive(n(123), "decimal");
        assert_eq!(out, serde_json::Value::String("123".to_string()));

        let out = stringify_numeric_if_precision_sensitive(n(456), "numeric(20,18)");
        assert_eq!(out, serde_json::Value::String("456".to_string()));
    }

    // [AC-261-02-PG-03] — int4 / int2 / real / double precision / float8 /
    // float4 는 IEEE 754 f64 안전 범위이거나 정확히 같은 표현. wire 에서
    // 그대로 number 토큰 유지 → JS Number 로 무손실. Date 2026-05-11.
    #[test]
    fn stringify_numeric_safe_number_families_pass_through() {
        for dt in &[
            "int4",
            "integer",
            "int2",
            "smallint",
            "real",
            "double precision",
            "float8",
            "float4",
        ] {
            let out = stringify_numeric_if_precision_sensitive(n(123), dt);
            assert_eq!(out, n(123), "data_type {} should not be stringified", dt);
        }
    }

    // [AC-261-02-PG-04] — number 가 아닌 cell (이미 string / null / object)
    // 은 정밀도 위험 컬럼이어도 그대로 통과. row_to_json 이 null 이나
    // 기존 string 으로 보내는 케이스 (예: 빈 cell, jsonb stringify 결과)
    // 가 잘못 변환되지 않도록 가드. Date 2026-05-11.
    #[test]
    fn stringify_numeric_non_number_cell_passes_through() {
        for cell in &[
            serde_json::Value::String("9223372036854775807".to_string()),
            serde_json::Value::Null,
            serde_json::Value::Bool(true),
            serde_json::json!({"nested": 1}),
        ] {
            let out = stringify_numeric_if_precision_sensitive(cell.clone(), "bigint");
            assert_eq!(
                &out, cell,
                "non-number cell {:?} must pass through unchanged",
                cell
            );
        }
    }

    // [AC-261-02-PG-05] — 알 수 없는 data_type ("jsonb", "money", "") 은
    // 정밀도 위험으로 분류 안 함. PG `money` 는 사용자 비활성, jsonb 는
    // 별도 sprint (nested 정밀도) 로 미룸. Date 2026-05-11.
    #[test]
    fn stringify_numeric_unknown_type_passes_through() {
        let out = stringify_numeric_if_precision_sensitive(n(123), "jsonb");
        assert_eq!(out, n(123));

        let out = stringify_numeric_if_precision_sensitive(n(123), "money");
        assert_eq!(out, n(123));

        let out = stringify_numeric_if_precision_sensitive(n(123), "");
        assert_eq!(out, n(123));
    }
}
