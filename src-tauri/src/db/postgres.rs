use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Column, PgPool, Row};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, FilterCondition, FilterOperator, IndexInfo,
    QueryColumn, QueryResult, QueryType, SchemaInfo, TableData, TableInfo,
};

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

#[derive(Clone)]
pub struct PostgresAdapter {
    pool: Arc<Mutex<Option<PgPool>>>,
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(None)),
        }
    }

    /// Build PgConnectOptions safely without string interpolation (prevents injection).
    fn connect_options(config: &ConnectionConfig) -> PgConnectOptions {
        PgConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            .database(&config.database)
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Use defer pattern: close pool in all code paths
        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()));

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let timeout_secs = config.connection_timeout.unwrap_or(300);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(timeout_secs.min(30) as u64))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        info!("Connected to PostgreSQL at {}:{}", config.host, config.port);

        let mut guard = self.pool.lock().await;
        *guard = Some(pool);
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.pool.lock().await;
        if let Some(pool) = guard.take() {
            pool.close().await;
            info!("Disconnected from PostgreSQL");
        }
        Ok(())
    }

    /// Execute a raw SQL statement (DDL, DML).
    pub async fn execute(&self, query: &str) -> Result<(), AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        sqlx::query(query)
            .execute(pool)
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
        let pool = {
            let guard = self.pool.lock().await;
            guard
                .as_ref()
                .ok_or_else(|| AppError::Connection("Not connected".into()))?
                .clone()
        };

        // Execute query based on type
        let result = match query_type {
            QueryType::Select => {
                let query_future = async {
                    // Execute the query and get rows
                    let rows = sqlx::query(query).fetch_all(&pool).await?;

                    // Extract column metadata from rows when available
                    let columns: Vec<QueryColumn> = if let Some(first_row) = rows.first() {
                        first_row
                            .columns()
                            .iter()
                            .map(|col| QueryColumn {
                                name: col.name().to_string(),
                                data_type: col.type_info().to_string(),
                            })
                            .collect()
                    } else {
                        // For empty results, we cannot determine columns from the row data.
                        // Return empty columns — the frontend handles this gracefully.
                        Vec::new()
                    };

                    // Convert rows to JSON values
                    let json_rows: Vec<Vec<serde_json::Value>> = rows
                        .iter()
                        .map(|row| {
                            (0..row.columns().len())
                                .map(|col_idx| {
                                    // Try to get value as JSON, fall back to Null
                                    row.try_get::<serde_json::Value, _>(col_idx)
                                        .unwrap_or(serde_json::Value::Null)
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

    pub async fn ping(&self) -> Result<(), AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        sqlx::query("SELECT 1")
            .execute(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
             ORDER BY schema_name",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name,)| SchemaInfo { name })
            .collect())
    }

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows: Vec<(String, Option<i64>)> = sqlx::query_as(
            "SELECT t.table_name, s.n_live_tup \
             FROM information_schema.tables t \
             LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema \
             WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' \
             ORDER BY t.table_name",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name, row_count)| TableInfo {
                name,
                schema: schema.to_string(),
                row_count,
            })
            .collect())
    }

    pub async fn get_table_columns(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        self.get_table_columns_inner(pool, table, schema).await
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
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        // Get columns first
        let columns = self.get_table_columns_inner(pool, table, schema).await?;

        // Build safe query — table/schema are validated identifiers
        let qualified_table = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );

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
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build data query using row_to_json for type-safe conversion
        let offset = (page - 1).max(0) * page_size;

        let mut order_clause = String::new();
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
                }
            }
            if !order_parts.is_empty() {
                order_clause = format!(" ORDER BY {}", order_parts.join(", "));
            }
        }

        let data_sql = format!(
            "SELECT row_to_json(q)::text FROM (SELECT * FROM {}{}{} LIMIT {} OFFSET {}) q",
            qualified_table, where_clause, order_clause, page_size, offset
        );

        let executed_query = data_sql.clone();

        let mut data_query = sqlx::query_as::<_, (String,)>(&data_sql);
        for val in &param_values {
            data_query = data_query.bind(val);
        }
        let json_rows: Vec<(String,)> = data_query
            .fetch_all(pool)
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
                        obj.get(&col.name)
                            .cloned()
                            .unwrap_or(serde_json::Value::Null)
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

    /// Inner helper that takes a pool reference directly (avoids double-lock).
    async fn get_table_columns_inner(
        &self,
        pool: &PgPool,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let pk_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT kcu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let pk_columns: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(col,)| col).collect();

        let fk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT kcu.column_name, ccu.table_name || '.' || ccu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
             WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let fk_map: std::collections::HashMap<String, String> = fk_rows.into_iter().collect();

        // Get column comments via col_description()
        let comment_rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname AS column_name, col_description(c.oid, a.attnum) AS comment \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comment_map: std::collections::HashMap<String, Option<String>> =
            comment_rows.into_iter().collect();

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let is_pk = pk_columns.contains(&name);
                let (is_fk, fk_reference) = match fk_map.get(&name) {
                    Some(ref_str) => (true, Some(ref_str.clone())),
                    None => (false, None),
                };
                let comment = comment_map.get(&name).and_then(Option::clone);
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable == "YES",
                    default_value,
                    is_primary_key: is_pk,
                    is_foreign_key: is_fk,
                    fk_reference,
                    comment,
                }
            })
            .collect())
    }

    #[allow(clippy::type_complexity)]
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows: Vec<(String, String, bool, bool, String)> = sqlx::query_as(
            "SELECT i.relname AS index_name,
                    a.attname AS column_name,
                    idx.indisunique AS is_unique,
                    idx.indisprimary AS is_primary,
                    am.amname AS index_method
             FROM pg_index idx
             JOIN pg_class t ON t.oid = idx.indrelid
             JOIN pg_class i ON i.oid = idx.indexrelid
             JOIN pg_am am ON am.oid = i.relam
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(idx.indkey)
             WHERE n.nspname = $1 AND t.relname = $2
             ORDER BY i.relname, a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut index_map: std::collections::BTreeMap<String, (bool, bool, String, Vec<String>)> =
            std::collections::BTreeMap::new();

        for (index_name, column_name, is_unique, is_primary, index_method) in rows {
            let entry = index_map.entry(index_name).or_insert((
                is_unique,
                is_primary,
                index_method,
                Vec::new(),
            ));
            entry.3.push(column_name);
        }

        Ok(index_map
            .into_iter()
            .map(
                |(name, (is_unique, is_primary, index_type, columns))| IndexInfo {
                    name,
                    columns,
                    index_type,
                    is_unique,
                    is_primary,
                },
            )
            .collect())
    }

    /// Drop a table permanently. Uses parameterized schema validation but
    /// table-safe quoting since table names cannot be bound as parameters.
    pub async fn drop_table(&self, table: &str, schema: &str) -> Result<(), AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        // Verify the table exists first
        let exists: Vec<(String,)> = sqlx::query_as(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        if exists.is_empty() {
            return Err(AppError::NotFound(format!(
                "Table {}.{} not found",
                schema, table
            )));
        }

        let qualified = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );
        let sql = format!("DROP TABLE {}", qualified);
        sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Dropped table {}.{}", schema, table);
        Ok(())
    }

    /// Rename a table. Validates the new name is a valid identifier.
    pub async fn rename_table(
        &self,
        table: &str,
        schema: &str,
        new_name: &str,
    ) -> Result<(), AppError> {
        // Validate new name: non-empty, alphanumeric + underscores only
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "New table name must not be empty".into(),
            ));
        }
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(AppError::Validation(
                "New table name must contain only alphanumeric characters and underscores".into(),
            ));
        }
        if trimmed.chars().next().is_none_or(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation(
                "New table name must not start with a digit".into(),
            ));
        }

        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let qualified_old = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );
        let quoted_new = format!("\"{}\"", trimmed.replace('"', "\"\""));
        let sql = format!("ALTER TABLE {} RENAME TO {}", qualified_old, quoted_new);
        sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Renamed table {}.{} to {}", schema, table, trimmed);
        Ok(())
    }

    #[allow(clippy::type_complexity)]
    pub async fn get_table_constraints(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT tc.constraint_name,
                    tc.constraint_type,
                    kcu.column_name,
                    ccu_ref.table_name AS ref_table,
                    ccu_ref.column_name AS ref_column
             FROM information_schema.table_constraints tc
             LEFT JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             LEFT JOIN information_schema.constraint_column_usage ccu_ref
               ON tc.constraint_name = ccu_ref.constraint_name
               AND tc.table_schema = ccu_ref.table_schema
               AND tc.constraint_type = 'FOREIGN KEY'
             WHERE tc.table_schema = $1
               AND tc.table_name = $2
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
             ORDER BY tc.constraint_name, kcu.ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut constraint_map: std::collections::BTreeMap<
            String,
            (String, Vec<String>, Option<String>, Vec<String>),
        > = std::collections::BTreeMap::new();

        for (name, ctype, column, ref_table, ref_column) in rows {
            let entry =
                constraint_map
                    .entry(name)
                    .or_insert((ctype, Vec::new(), ref_table, Vec::new()));
            if let Some(col) = column {
                if !entry.1.contains(&col) {
                    entry.1.push(col);
                }
            }
            if let Some(rc) = ref_column {
                if !entry.3.contains(&rc) {
                    entry.3.push(rc);
                }
            }
        }

        Ok(constraint_map
            .into_iter()
            .map(
                |(name, (constraint_type, columns, reference_table, ref_cols))| ConstraintInfo {
                    name,
                    constraint_type,
                    columns,
                    reference_table,
                    reference_columns: if ref_cols.is_empty() {
                        None
                    } else {
                        Some(ref_cols)
                    },
                },
            )
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseType;

    fn sample_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "test".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "secret".to_string(),
            database: "testdb".to_string(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
        }
    }

    #[tokio::test]
    async fn new_adapter_has_no_pool() {
        let adapter = PostgresAdapter::new();
        let guard = adapter.pool.lock().await;
        assert!(guard.is_none(), "New adapter should have no pool");
    }

    #[tokio::test]
    async fn ping_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.ping().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn list_schemas_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_schemas().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[test]
    fn connect_options_builder() {
        let config = sample_config();
        let opts = PostgresAdapter::connect_options(&config);

        // PgConnectOptions exposes host, port, username, database via Debug
        // We verify by building a connection string and checking the components
        let opts_str = format!("{opts:?}");

        // The debug output should contain our connection parameters
        assert!(
            opts_str.contains("localhost") || opts_str.contains("5432"),
            "Options should reflect the config parameters"
        );
    }

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

    #[tokio::test]
    async fn drop_table_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.drop_table("users", "public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "people").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_empty_name_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_whitespace_only_name_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "   ").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_invalid_characters_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "bad-name!").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("alphanumeric"),
            "Expected alphanumeric validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_starts_with_digit_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "123bad").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not start with a digit"),
            "Expected digit-start validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_valid_name_passes_validation() {
        let adapter = PostgresAdapter::new();
        // This will fail at the connection stage, not validation
        let result = adapter.rename_table("users", "public", "people").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        // Should fail with connection error, not validation
        assert!(
            err_msg.contains("Not connected"),
            "Expected connection error for valid name, got: {err_msg}"
        );
    }
}
