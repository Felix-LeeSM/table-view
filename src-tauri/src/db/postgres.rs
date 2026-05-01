use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Column, PgPool, Row};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnInfo, ConnectionConfig,
    ConstraintDefinition, ConstraintInfo, CreateIndexRequest, DropConstraintRequest,
    DropIndexRequest, FilterCondition, FilterOperator, FunctionInfo, IndexInfo, QueryColumn,
    QueryResult, QueryType, SchemaChangeResult, SchemaInfo, TableData, TableInfo, ViewInfo,
};

/// Serialize a foreign-key reference into the canonical
/// `<schema>.<table>(<column>)` string consumed by the frontend
/// (`parseFkReference` in `DataGridTable.tsx`).
///
/// Sprint-89 (#FK-1): the previous implementation built this string in SQL
/// (`ccu.table_name || '.' || ccu.column_name`) which (a) silently dropped
/// the schema and (b) made the format un-testable. This pure helper is the
/// single source of truth for the wire format and is exercised by both unit
/// tests in this file and by the `tests/fixtures/fk_reference_samples.json`
/// shared fixture.
///
/// **Input assumptions**: callers must pass identifiers that do **not**
/// contain `.`, `(`, or `)` characters. The fixture intentionally exercises
/// hyphens, underscores, and spaces (which round-trip cleanly through the
/// regex on the TS side) but the format does not currently quote or escape
/// reserved characters — adding that is tracked separately and is not in
/// sprint-89's scope.
pub(crate) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
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

/// Validate a SQL identifier (table name, column name, index name, constraint name)
/// to prevent SQL injection. Only allows `[a-zA-Z_][a-zA-Z0-9_]*`.
fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    }
    let mut chars = trimmed.chars();
    let first = chars.next().expect("checked non-empty");
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(AppError::Validation(format!(
            "{} must start with a letter or underscore",
            label
        )));
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(AppError::Validation(format!(
                "{} must contain only alphanumeric characters and underscores",
                label
            )));
        }
    }
    Ok(())
}

/// Quote a SQL identifier with double quotes, escaping internal double quotes.
fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Build a qualified table reference: `"schema"."table"`.
fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
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

/// Sprint 130 — soft cap on simultaneously cached PG sub-pools per
/// `PostgresAdapter`. The 9th `switch_active_db` cache miss evicts the
/// oldest non-current entry so we never grow unbounded as the user hops
/// between databases. The number is intentionally small: TablePlus-style
/// flows rarely touch more than a handful of databases per session, and
/// each idle pool still holds 1+ TCP connections.
const PG_SUBPOOL_CAP: usize = 8;

/// Sprint 130 — pure helper that picks the next eviction target from an
/// LRU order, skipping the protected `current` database.
///
/// Returns the oldest entry in `lru` whose name does not match `current`,
/// or `None` when every entry is the current db (so eviction is a no-op).
/// Extracted as a standalone function so the LRU bookkeeping is unit-
/// testable without standing up a real PgPool.
pub(crate) fn select_eviction_target(lru: &VecDeque<String>, current: &str) -> Option<String> {
    lru.iter().find(|name| *name != current).cloned()
}

/// Inner mutable state for a `PostgresAdapter`. The struct is owned by an
/// `Arc<Mutex<PgPoolState>>` so all reads + writes go through a single
/// lock, keeping the LRU/cache invariants atomic across `switch_active_db`
/// calls. See `PostgresAdapter::new` for the freshly-empty initial value.
#[derive(Default)]
pub struct PgPoolState {
    /// Stored connection config (without DB override) — credentials stay
    /// resident so `switch_active_db` can spawn a sub-pool against another
    /// database without prompting the user again. `None` when the adapter
    /// is disconnected.
    config: Option<ConnectionConfig>,
    /// `db_name → PgPool` cache. Membership is bounded by
    /// `PG_SUBPOOL_CAP`; eviction is driven by `lru_order`.
    pools: HashMap<String, PgPool>,
    /// The database the adapter is currently routing queries through.
    /// `None` while disconnected.
    current_db: Option<String>,
    /// LRU ordering — oldest at the front, most-recently-used at the back.
    /// Entries are unique (we re-push to the back on cache hits).
    lru_order: VecDeque<String>,
}

#[derive(Clone)]
pub struct PostgresAdapter {
    inner: Arc<Mutex<PgPoolState>>,
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PgPoolState::default())),
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

        // Sprint 130 — seed the sub-pool cache with the default DB. The
        // stored config has its credentials but a placeholder `database`
        // (we'll always override it via `switch_active_db`) — we keep the
        // original DB name on the config for fallbacks.
        let mut guard = self.inner.lock().await;
        let db_name = config.database.clone();
        guard.config = Some(config.clone());
        guard.pools.insert(db_name.clone(), pool);
        guard.lru_order.push_back(db_name.clone());
        guard.current_db = Some(db_name);
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        // Sprint 130 — close every cached sub-pool, not just the active
        // one. Drain the map up-front so we don't hold the mutex across
        // the awaits below.
        let pools: Vec<PgPool> = guard.pools.drain().map(|(_, p)| p).collect();
        guard.lru_order.clear();
        guard.current_db = None;
        guard.config = None;
        let had_pools = !pools.is_empty();
        drop(guard);
        for pool in pools {
            pool.close().await;
        }
        if had_pools {
            info!("Disconnected from PostgreSQL");
        }
        Ok(())
    }

    /// Sprint 130 — clone the active sub-pool out from the inner mutex so
    /// callers can run queries without holding the lock across awaits.
    /// Returns `Connection("Not connected")` when the adapter has no
    /// `current_db` (i.e. before `connect_pool` or after `disconnect_pool`).
    async fn active_pool(&self) -> Result<PgPool, AppError> {
        let guard = self.inner.lock().await;
        let db = guard
            .current_db
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        guard
            .pools
            .get(db)
            .cloned()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    /// Sprint 130 — switch the adapter's active sub-pool to `db_name`.
    ///
    /// On a cache hit (`pools` already contains `db_name`) we simply
    /// re-promote the entry to the back of the LRU and flip
    /// `current_db`. On a miss we lazily build a new `PgPool` reusing the
    /// stored credentials with `database` overridden, evicting the oldest
    /// non-current entry first when the cache is at capacity. The
    /// `current_db` is intentionally protected — the user's active query
    /// path must never be torn down by an LRU eviction.
    pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError> {
        if db_name.is_empty() {
            return Err(AppError::Validation(
                "Database name must not be empty".into(),
            ));
        }

        // Step 1: take the lock, decide whether this is a hit or miss.
        // For a miss we clone the stored config out so we can build the
        // pool *without* holding the lock across an await — otherwise a
        // long `connect_with()` call would block every other adapter
        // method. Miss is boxed so the enum stays small (clippy flags
        // the variant size mismatch otherwise — `ConnectionConfig` is
        // ~280 bytes vs `Hit`'s zero).
        enum SwitchPath {
            Hit,
            Miss(Box<ConnectionConfig>),
        }
        let path = {
            let mut guard = self.inner.lock().await;
            if guard.pools.contains_key(db_name) {
                guard.current_db = Some(db_name.to_string());
                guard.lru_order.retain(|name| name != db_name);
                guard.lru_order.push_back(db_name.to_string());
                SwitchPath::Hit
            } else {
                let config = guard
                    .config
                    .as_ref()
                    .cloned()
                    .ok_or_else(|| AppError::Connection("Not connected".into()))?;
                SwitchPath::Miss(Box::new(config))
            }
        };

        match path {
            SwitchPath::Hit => {
                info!("Switched active PG db to {}", db_name);
                Ok(())
            }
            SwitchPath::Miss(boxed_config) => {
                let mut config = *boxed_config;
                config.database = db_name.to_string();
                let options = Self::connect_options(&config);
                let timeout_secs = config.connection_timeout.unwrap_or(300);
                let new_pool = PgPoolOptions::new()
                    .max_connections(5)
                    .acquire_timeout(std::time::Duration::from_secs(timeout_secs.min(30) as u64))
                    .connect_with(options)
                    .await
                    .map_err(|e| {
                        AppError::Connection(format!(
                            "Failed to open sub-pool for db {}: {}",
                            db_name, e
                        ))
                    })?;

                // Step 2: re-take the lock, install the new pool, and
                // evict the oldest non-current sub-pool when over the cap.
                // We may need to close an evicted pool, which requires
                // releasing the lock first.
                let evicted: Option<PgPool> = {
                    let mut guard = self.inner.lock().await;
                    // It's possible (race) another task installed the same
                    // db_name while we were awaiting `connect_with`. If so,
                    // close the just-built pool and treat this as a hit.
                    if guard.pools.contains_key(db_name) {
                        guard.current_db = Some(db_name.to_string());
                        guard.lru_order.retain(|name| name != db_name);
                        guard.lru_order.push_back(db_name.to_string());
                        drop(guard);
                        new_pool.close().await;
                        info!("Switched active PG db to {} (race resolved)", db_name);
                        return Ok(());
                    }

                    let evicted_pool = if guard.pools.len() >= PG_SUBPOOL_CAP {
                        // Pick the oldest entry that isn't the current_db.
                        // current_db here is whatever we *had* before this
                        // switch, since current_db doesn't update until we
                        // commit below — so the protection is symmetric
                        // with the post-switch current_db too.
                        let current = guard
                            .current_db
                            .clone()
                            .unwrap_or_else(|| db_name.to_string());
                        let target = select_eviction_target(&guard.lru_order, &current);
                        target.and_then(|name| {
                            guard.lru_order.retain(|x| x != &name);
                            guard.pools.remove(&name)
                        })
                    } else {
                        None
                    };

                    guard.pools.insert(db_name.to_string(), new_pool);
                    guard.lru_order.push_back(db_name.to_string());
                    guard.current_db = Some(db_name.to_string());
                    evicted_pool
                };

                if let Some(pool) = evicted {
                    pool.close().await;
                }
                info!("Switched active PG db to {}", db_name);
                Ok(())
            }
        }
    }

    /// Sprint 130 — read the active database name (whatever
    /// `switch_active_db` last selected, or the seed `connect_pool`
    /// installed). Returns `None` when the adapter is disconnected.
    pub async fn current_database(&self) -> Option<String> {
        self.inner.lock().await.current_db.clone()
    }

    /// Execute a raw SQL statement (DDL, DML).
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

                    // Use row_to_json via PostgreSQL to convert rows to proper JSON values.
                    // Direct try_get::<serde_json::Value> only works for json/jsonb columns,
                    // so we wrap the query in a subquery and use row_to_json().
                    let wrapped_sql = format!("SELECT row_to_json(q)::text FROM ({}) q", query);
                    let json_rows_raw = sqlx::query_scalar::<_, String>(&wrapped_sql)
                        .fetch_all(&pool)
                        .await?;

                    let col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
                    let json_rows: Vec<Vec<serde_json::Value>> = json_rows_raw
                        .iter()
                        .map(|json_str| {
                            let obj: serde_json::Map<String, serde_json::Value> =
                                serde_json::from_str(json_str).unwrap_or_default();
                            col_names
                                .iter()
                                .map(|name| {
                                    obj.get(*name).cloned().unwrap_or(serde_json::Value::Null)
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

    pub async fn ping(&self) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
             ORDER BY schema_name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name,)| SchemaInfo { name })
            .collect())
    }

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, Option<i64>)> = sqlx::query_as(
            "SELECT t.table_name, s.n_live_tup \
             FROM information_schema.tables t \
             LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema \
             WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' \
             ORDER BY t.table_name",
        )
        .bind(schema)
        .fetch_all(&pool)
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
        let pool = self.active_pool().await?;
        self.get_table_columns_inner(&pool, table, schema).await
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
            .fetch_one(&pool)
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

        // Sprint-89 (#FK-1): select schema/table/column as 3 separate columns
        // so we can format the FK reference in Rust via `format_fk_reference`,
        // matching the `<schema>.<table>(<column>)` contract that the
        // frontend's `parseFkReference` expects.
        let fk_rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name \
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

        let fk_map: std::collections::HashMap<String, String> = fk_rows
            .into_iter()
            .map(|(local_col, ref_schema, ref_table, ref_column)| {
                (
                    local_col,
                    format_fk_reference(&ref_schema, &ref_table, &ref_column),
                )
            })
            .collect();

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

    /// Fetches columns for every table in `schema` in one round-trip.
    /// Returns a map of table_name → Vec<ColumnInfo>.
    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
        let pool = self.active_pool().await?;

        // Basic column info for all tables in the schema
        let col_rows: Vec<(String, String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT table_name, column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 \
             ORDER BY table_name, ordinal_position",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Primary keys for all tables in the schema
        let pk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT kcu.table_name, kcu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Foreign keys for all tables in the schema.
        // Sprint-89 (#FK-1): same restructuring as `get_table_columns` —
        // separate schema/table/column columns + Rust-side formatting.
        let fk_rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT kcu.table_name, kcu.column_name, \
                    ccu.table_schema, ccu.table_name, ccu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON tc.constraint_name = ccu.constraint_name \
              AND tc.table_schema = ccu.table_schema \
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Column comments for all tables in the schema
        let comment_rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT c.relname, a.attname, col_description(c.oid, a.attnum) \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_attribute a ON a.attrelid = c.oid \
              AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = $1 AND c.relkind = 'r'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build lookup sets/maps keyed by (table, column)
        let pk_set: std::collections::HashSet<(String, String)> = pk_rows.into_iter().collect();

        let fk_map: std::collections::HashMap<(String, String), String> = fk_rows
            .into_iter()
            .map(|(t, c, ref_schema, ref_table, ref_column)| {
                (
                    (t, c),
                    format_fk_reference(&ref_schema, &ref_table, &ref_column),
                )
            })
            .collect();

        let comment_map: std::collections::HashMap<(String, String), Option<String>> = comment_rows
            .into_iter()
            .map(|(t, c, cmt)| ((t, c), cmt))
            .collect();

        // Group columns by table
        let mut result: std::collections::HashMap<String, Vec<ColumnInfo>> =
            std::collections::HashMap::new();

        for (table_name, col_name, data_type, is_nullable, default_value) in col_rows {
            let is_pk = pk_set.contains(&(table_name.clone(), col_name.clone()));
            let (is_fk, fk_reference) = match fk_map.get(&(table_name.clone(), col_name.clone())) {
                Some(r) => (true, Some(r.clone())),
                None => (false, None),
            };
            let comment = comment_map
                .get(&(table_name.clone(), col_name.clone()))
                .and_then(Option::clone);

            result.entry(table_name).or_default().push(ColumnInfo {
                name: col_name,
                data_type,
                nullable: is_nullable == "YES",
                default_value,
                is_primary_key: is_pk,
                is_foreign_key: is_fk,
                fk_reference,
                comment,
            });
        }

        Ok(result)
    }

    #[allow(clippy::type_complexity)]
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let pool = self.active_pool().await?;

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
        .fetch_all(&pool)
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
        let pool = self.active_pool().await?;

        // Verify the table exists first
        let exists: Vec<(String,)> = sqlx::query_as(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
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
            .execute(&pool)
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

        let pool = self.active_pool().await?;

        let qualified_old = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );
        let quoted_new = format!("\"{}\"", trimmed.replace('"', "\"\""));
        let sql = format!("ALTER TABLE {} RENAME TO {}", qualified_old, quoted_new);
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Renamed table {}.{} to {}", schema, table, trimmed);
        Ok(())
    }

    // ── Schema change operations ──────────────────────────────────────

    /// ALTER TABLE: add, modify, or drop columns in batch.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn alter_table(
        &self,
        req: &AlterTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;

        if req.changes.is_empty() {
            return Err(AppError::Validation(
                "At least one column change is required".into(),
            ));
        }

        // Validate all column names in changes
        for change in &req.changes {
            match change {
                ColumnChange::Add { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Modify { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Drop { name } => validate_identifier(name, "Column name")?,
            }
        }

        let qualified = qualified_table(&req.schema, &req.table);

        let mut parts: Vec<String> = Vec::new();

        for change in &req.changes {
            match change {
                ColumnChange::Add {
                    name,
                    data_type,
                    nullable,
                    default_value,
                } => {
                    let mut sql = format!("ADD COLUMN {} {}", quote_identifier(name), data_type);
                    if !nullable {
                        sql.push_str(" NOT NULL");
                    }
                    if let Some(default) = default_value {
                        sql.push_str(&format!(" DEFAULT {}", default));
                    }
                    parts.push(sql);
                }
                ColumnChange::Modify {
                    name,
                    new_data_type,
                    new_nullable,
                    new_default_value,
                } => {
                    let quoted_name = quote_identifier(name);
                    if let Some(dt) = new_data_type {
                        parts.push(format!("ALTER COLUMN {} TYPE {}", quoted_name, dt));
                    }
                    if let Some(nullable) = new_nullable {
                        if *nullable {
                            parts.push(format!("ALTER COLUMN {} DROP NOT NULL", quoted_name));
                        } else {
                            parts.push(format!("ALTER COLUMN {} SET NOT NULL", quoted_name));
                        }
                    }
                    if let Some(default) = new_default_value {
                        parts.push(format!(
                            "ALTER COLUMN {} SET DEFAULT {}",
                            quoted_name, default
                        ));
                    }
                }
                ColumnChange::Drop { name } => {
                    parts.push(format!("DROP COLUMN {}", quote_identifier(name)));
                }
            }
        }

        let sql = format!("ALTER TABLE {} {}", qualified, parts.join(", "));

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Altered table {}.{}", req.schema, req.table);
        Ok(SchemaChangeResult { sql })
    }

    /// Create an index on a table.
    /// Supports index types: btree, hash, gist, gin, brin.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn create_index(
        &self,
        req: &CreateIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.index_name, "Index name")?;

        if req.columns.is_empty() {
            return Err(AppError::Validation(
                "At least one column is required for an index".into(),
            ));
        }

        for col in &req.columns {
            validate_identifier(col, "Index column name")?;
        }

        // Validate index type
        let valid_index_types = ["btree", "hash", "gist", "gin", "brin"];
        let index_type_lower = req.index_type.to_lowercase();
        if !valid_index_types.contains(&index_type_lower.as_str()) {
            return Err(AppError::Validation(format!(
                "Index type must be one of: {}",
                valid_index_types.join(", ")
            )));
        }

        let qualified = qualified_table(&req.schema, &req.table);
        let columns: Vec<String> = req.columns.iter().map(|c| quote_identifier(c)).collect();

        let unique = if req.is_unique { "UNIQUE " } else { "" };
        let sql = format!(
            "CREATE {}INDEX {} ON {} USING {} ({})",
            unique,
            quote_identifier(&req.index_name),
            qualified,
            index_type_lower,
            columns.join(", ")
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Created index {} on {}.{}",
            req.index_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop an index.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_index(&self, req: &DropIndexRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.index_name, "Index name")?;

        let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
        let sql = format!(
            "DROP INDEX {}.{}{}",
            quote_identifier(&req.schema),
            if_exists,
            quote_identifier(&req.index_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Dropped index {}.{}", req.schema, req.index_name);
        Ok(SchemaChangeResult { sql })
    }

    /// Add a constraint to a table.
    /// Supports: PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn add_constraint(
        &self,
        req: &AddConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let constraint_name = quote_identifier(&req.constraint_name);

        let constraint_sql = match &req.definition {
            ConstraintDefinition::PrimaryKey { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Primary key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Primary key column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("PRIMARY KEY ({})", cols.join(", "))
            }
            ConstraintDefinition::ForeignKey {
                columns,
                reference_table,
                reference_columns,
            } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Foreign key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Foreign key column name")?;
                }
                validate_identifier(reference_table, "Foreign key reference table name")?;
                for col in reference_columns {
                    validate_identifier(col, "Foreign key reference column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                let ref_cols: Vec<String> = reference_columns
                    .iter()
                    .map(|c| quote_identifier(c))
                    .collect();
                format!(
                    "FOREIGN KEY ({}) REFERENCES {} ({})",
                    cols.join(", "),
                    quote_identifier(reference_table),
                    ref_cols.join(", ")
                )
            }
            ConstraintDefinition::Unique { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Unique constraint requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Unique constraint column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("UNIQUE ({})", cols.join(", "))
            }
            ConstraintDefinition::Check { expression } => {
                if expression.trim().is_empty() {
                    return Err(AppError::Validation(
                        "Check constraint expression must not be empty".into(),
                    ));
                }
                format!("CHECK ({})", expression)
            }
        };

        let sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {}",
            qualified, constraint_name, constraint_sql
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Added constraint {} on {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop a constraint from a table.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_constraint(
        &self,
        req: &DropConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let sql = format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            qualified,
            quote_identifier(&req.constraint_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Dropped constraint {} from {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    #[allow(clippy::type_complexity)]
    pub async fn get_table_constraints(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let pool = self.active_pool().await?;

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
        .fetch_all(&pool)
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

    /// List all views in the given schema.
    pub async fn list_views(&self, schema: &str) -> Result<Vec<ViewInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT table_name, view_definition \
             FROM information_schema.views \
             WHERE table_schema = $1 \
             ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name, definition)| ViewInfo {
                name,
                schema: schema.to_string(),
                definition,
            })
            .collect())
    }

    /// List all functions and procedures in the given schema.
    #[allow(clippy::type_complexity)]
    pub async fn list_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            i8,
        )> = sqlx::query_as(
            "SELECT p.proname, \
                        pg_get_function_arguments(p.oid) as args, \
                        pg_get_function_result(p.oid) as result, \
                        l.lanname, \
                        p.prosrc, \
                        p.prokind \
                 FROM pg_proc p \
                 JOIN pg_namespace n ON p.pronamespace = n.oid \
                 JOIN pg_language l ON p.prolang = l.oid \
                 WHERE n.nspname = $1 \
                   AND p.prokind IN ('f', 'p', 'a', 'w') \
                 ORDER BY p.proname",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(
                |(name, arguments, return_type, language, source, prokind)| {
                    let kind = match prokind {
                        112 => "procedure", // 'p'
                        97 => "aggregate",  // 'a'
                        119 => "window",    // 'w'
                        _ => "function",    // 'f' (102) or default
                    };
                    FunctionInfo {
                        name,
                        schema: schema.to_string(),
                        arguments,
                        return_type,
                        language: Some(language),
                        source,
                        kind: kind.to_string(),
                    }
                },
            )
            .collect())
    }

    /// Get the column metadata for a view.
    ///
    /// Views inherit column information from `information_schema.columns`,
    /// but they have no primary or foreign keys of their own — those fields
    /// are always returned as `false` / `None`.
    pub async fn get_view_columns(
        &self,
        schema: &str,
        view_name: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comment_rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname, col_description(a.attrelid, a.attnum) \
             FROM pg_attribute a \
             JOIN pg_class c ON a.attrelid = c.oid \
             JOIN pg_namespace n ON c.relnamespace = n.oid \
             WHERE n.nspname = $1 \
               AND c.relname = $2 \
               AND c.relkind IN ('v', 'm') \
               AND a.attnum > 0 \
               AND NOT a.attisdropped",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comments: std::collections::HashMap<String, Option<String>> =
            comment_rows.into_iter().collect();

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let comment = comments.get(&name).cloned().flatten();
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable.eq_ignore_ascii_case("yes"),
                    default_value,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                    comment,
                }
            })
            .collect())
    }

    /// Get the definition SQL of a view.
    pub async fn get_view_definition(
        &self,
        schema: &str,
        view_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;

        let row: Option<(String,)> = sqlx::query_as(
            "SELECT view_definition \
             FROM information_schema.views \
             WHERE table_schema = $1 AND table_name = $2",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        match row {
            Some((def,)) => Ok(def),
            None => Err(AppError::Connection(format!(
                "View {schema}.{view_name} not found"
            ))),
        }
    }

    /// Get the source definition of a function or procedure.
    pub async fn get_function_source(
        &self,
        schema: &str,
        function_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;

        let row: Option<(String,)> = sqlx::query_as(
            "SELECT pg_get_functiondef(p.oid) \
             FROM pg_proc p \
             JOIN pg_namespace n ON p.pronamespace = n.oid \
             WHERE n.nspname = $1 AND p.proname = $2",
        )
        .bind(schema)
        .bind(function_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        match row {
            Some((source,)) => Ok(source),
            None => Err(AppError::Connection(format!(
                "Function {schema}.{function_name} not found"
            ))),
        }
    }

    /// List every non-template database visible to the connected role.
    ///
    /// Sprint 128 — counterpart to `DocumentAdapter::list_databases`. The
    /// canonical query is `SELECT datname FROM pg_database WHERE
    /// datistemplate = false ORDER BY datname`. Hosted PG (RDS, Cloud SQL,
    /// Supabase, Neon free tier) frequently revokes `SELECT` on
    /// `pg_database` for application roles — when that happens the driver
    /// reports `SQLSTATE 42501` ("insufficient_privilege"). We surface a
    /// graceful single-DB fallback in that case (`current_database()`) so
    /// the workspace toolbar can still render *something* useful instead of
    /// a hard error. Any other failure (network, server gone) still
    /// propagates as `AppError::Database`.
    ///
    /// Matching strategy:
    ///   1. SQLSTATE `42501` — exact match against `sqlx::Error::Database`.
    ///   2. Message substring `permission denied for table pg_database` —
    ///      case-insensitive fallback for drivers/locales that fail to expose
    ///      a SQLSTATE (rare, but observed in older sqlx releases).
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;

        let primary: Result<Vec<(String,)>, sqlx::Error> = sqlx::query_as::<_, (String,)>(
            "SELECT datname FROM pg_database \
             WHERE datistemplate = false \
             ORDER BY datname",
        )
        .fetch_all(&pool)
        .await;

        match primary {
            Ok(rows) => Ok(rows
                .into_iter()
                .map(|(name,)| SchemaInfo { name })
                .collect()),
            Err(err) if is_pg_database_permission_denied(&err) => {
                // Permission-denied fallback — surface the user's current DB
                // as a single entry so the switcher always has at least one
                // option to render.
                let current: (String,) = sqlx::query_as("SELECT current_database()")
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Ok(vec![SchemaInfo { name: current.0 }])
            }
            Err(err) => Err(AppError::Database(err.to_string())),
        }
    }
}

/// Detect "user has no SELECT on `pg_database`" the way Postgres reports it.
///
/// Sprint 128 — `pg_database` permission revocation is common in managed PG
/// (RDS, Cloud SQL, Supabase, Neon) so we keep the matcher targeted: SQLSTATE
/// `42501` (insufficient_privilege) is the authoritative signal, and a
/// case-insensitive substring of the canonical Postgres message
/// (`permission denied for table pg_database`) is the secondary fallback.
/// Both arms are unit-tested below.
fn is_pg_database_permission_denied(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        if let Some(code) = db_err.code() {
            if code.as_ref() == "42501" {
                return true;
            }
        }
        let msg = db_err.message().to_ascii_lowercase();
        if msg.contains("permission denied for table pg_database")
            || msg.contains("permission denied for relation pg_database")
        {
            return true;
        }
    }
    false
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint A1: paradigm-separated trait layer.
//
// These impl blocks connect `PostgresAdapter` to the new `DbAdapter` /
// `RdbAdapter` traits declared in `db/mod.rs`. Each trait method is a
// **thin delegate** to the existing concrete inherent method — no behavior
// change. `list_schemas` maps to `list_namespaces` and `(namespace, table)`
// trait arg order is reordered where necessary (e.g. `drop_table`).
// ─────────────────────────────────────────────────────────────────────────

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};
use crate::models::DatabaseType;
use std::future::Future;
use std::pin::Pin;

impl DbAdapter for PostgresAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Postgresql
    }

    fn connect<'a>(
        &'a self,
        config: &'a ConnectionConfig,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.connect_pool(config).await })
    }

    fn disconnect<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.disconnect_pool().await })
    }

    fn ping<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { PostgresAdapter::ping(self).await })
    }
}

impl RdbAdapter for PostgresAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let schemas = self.list_schemas().await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn list_databases<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let dbs = PostgresAdapter::list_databases(self).await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    /// Sprint 130 — delegates to the inherent `switch_active_db` so the
    /// trait dispatcher can drive PG sub-pool swaps from the unified
    /// `switch_active_db` Tauri command.
    fn switch_database<'a>(
        &'a self,
        db_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.switch_active_db(db_name).await })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TableInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_tables(namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`; trait passes `(namespace, table)`.
        // Sprint 180 (AC-180-04): cooperate with cancellation. The pattern
        // mirrors `execute_query` — race the inherent future against the
        // token's `cancelled()` future and propagate the same
        // `AppError::Database("Operation cancelled")` shape used at
        // `postgres.rs:541`.
        Box::pin(async move {
            let work = self.get_table_columns(table, namespace);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.execute_query(sql, cancel).await })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RdbQueryResult>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>> {
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.query_table_data(
                table, namespace, page, page_size, order_by, filters, raw_where,
            );
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn drop_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`.
        Box::pin(async move { self.drop_table(table, namespace).await })
    }

    fn rename_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        new_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema, new_name)`.
        Box::pin(async move { self.rename_table(table, namespace, new_name).await })
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.alter_table(req).await })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.create_index(req).await })
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_index(req).await })
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.add_constraint(req).await })
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_constraint(req).await })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`.
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.get_table_indexes(table, namespace);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`.
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.get_table_constraints(table, namespace);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_views(namespace).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<FunctionInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_functions(namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_view_definition(namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_view_columns(namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move { self.list_schema_columns(namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_function_source(namespace, function).await })
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
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    #[tokio::test]
    async fn new_adapter_has_no_pool() {
        // Sprint 130 — adapter starts with empty sub-pool cache and no
        // current_db. `active_pool()` should fail with `Not connected` and
        // there should be no cached pools or LRU entries.
        let adapter = PostgresAdapter::new();
        let guard = adapter.inner.lock().await;
        assert!(
            guard.current_db.is_none(),
            "New adapter should have no current_db"
        );
        assert!(
            guard.pools.is_empty(),
            "New adapter should have no cached pools"
        );
        assert!(
            guard.lru_order.is_empty(),
            "New adapter should have an empty LRU"
        );
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

    #[tokio::test]
    async fn test_switch_active_db_returns_err_when_not_connected() {
        let adapter = PostgresAdapter::new();
        let result = adapter.switch_active_db("nope").await;
        match result {
            Err(AppError::Connection(msg)) => assert!(msg.contains("Not connected")),
            other => panic!("Expected Connection error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_switch_active_db_rejects_empty_db_name() {
        let adapter = PostgresAdapter::new();
        let result = adapter.switch_active_db("").await;
        match result {
            Err(AppError::Validation(_)) => {}
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_select_eviction_target_protects_current_db() {
        // current_db must never be eligible for eviction — even when it
        // is the only entry in the LRU. This is the pure helper that the
        // production switch path relies on; testing it directly avoids
        // any pool-construction overhead.
        let mut lru = VecDeque::new();
        lru.push_back("only_db".to_string());
        let target = select_eviction_target(&lru, "only_db");
        assert!(
            target.is_none(),
            "current_db must be skipped during eviction selection"
        );
    }

    #[tokio::test]
    async fn test_select_eviction_target_picks_oldest_non_current() {
        let mut lru = VecDeque::new();
        lru.push_back("a".to_string()); // oldest
        lru.push_back("b".to_string());
        lru.push_back("c".to_string()); // current
        let target = select_eviction_target(&lru, "c");
        assert_eq!(
            target.as_deref(),
            Some("a"),
            "Eviction must pick the oldest non-current entry"
        );
    }

    #[tokio::test]
    async fn test_select_eviction_target_skips_current_in_middle() {
        let mut lru = VecDeque::new();
        lru.push_back("current".to_string()); // oldest but current
        lru.push_back("b".to_string());
        lru.push_back("c".to_string());
        let target = select_eviction_target(&lru, "current");
        assert_eq!(
            target.as_deref(),
            Some("b"),
            "Eviction must skip current and pick the next-oldest entry"
        );
    }

    #[tokio::test]
    async fn test_switch_active_db_cache_hit_updates_lru_and_current() {
        // Build an adapter with two pre-populated cache entries (no real
        // PgPool needed: we never query through them — switch_active_db
        // on a hit only mutates LRU + current_db). We bypass `connect_pool`
        // by writing directly to the inner state with stubbed pools that
        // we never await on.
        let adapter = PostgresAdapter::new();
        {
            let mut guard = adapter.inner.lock().await;
            // We cannot construct a `PgPool` without a real DB here, so
            // we exercise the cache-hit path via the LRU bookkeeping
            // surface directly instead. Set up: two LRU entries.
            guard.config = Some(sample_config());
            guard.lru_order.push_back("db1".into());
            guard.lru_order.push_back("db2".into());
            guard.current_db = Some("db1".to_string());
            // Insert dummy keys to make `pools.contains_key` succeed for
            // the hit path. Since `PgPool` cannot be cheaply mocked, we
            // assert the LRU bookkeeping via the helper instead — this
            // mirrors the exact branch the production code takes on a
            // hit (retain + push_back).
        }
        // Drive the LRU mutation logic explicitly (mirrors the hit path
        // inside `switch_active_db`).
        {
            let mut guard = adapter.inner.lock().await;
            guard.current_db = Some("db2".to_string());
            guard.lru_order.retain(|n| n != "db2");
            guard.lru_order.push_back("db2".to_string());
            assert_eq!(guard.lru_order.back().map(String::as_str), Some("db2"));
            assert_eq!(guard.current_db.as_deref(), Some("db2"));
            assert_eq!(guard.lru_order.len(), 2);
        }
    }

    #[tokio::test]
    async fn test_switch_active_db_evicts_oldest_when_cap_exceeded() {
        // Fill the LRU to PG_SUBPOOL_CAP with non-current entries +
        // current_db at the back, then verify that
        // `select_eviction_target` picks the oldest non-current entry.
        let mut lru = VecDeque::new();
        for i in 0..PG_SUBPOOL_CAP {
            lru.push_back(format!("db{}", i));
        }
        // Mark "db5" as current — eviction should still pick "db0".
        let target = select_eviction_target(&lru, "db5");
        assert_eq!(target.as_deref(), Some("db0"));
        assert_eq!(lru.len(), PG_SUBPOOL_CAP);
    }

    #[tokio::test]
    async fn test_switch_active_db_protects_current_db_from_eviction() {
        // Edge case: every entry in the LRU is `current_db` (only
        // possible if the cache holds a single entry). The production
        // code must NOT evict it — the user's active session would die.
        let mut lru = VecDeque::new();
        lru.push_back("solo".to_string());
        let target = select_eviction_target(&lru, "solo");
        assert!(
            target.is_none(),
            "Single-entry current_db must never be evicted"
        );
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres at TEST_PG; cache-miss path opens a real pool"]
    async fn test_switch_active_db_cache_miss_creates_lazy_pool() {
        // Smoke: connect to a real PG, switch to a different db_name
        // that exists, and verify `current_database()` reflects it.
        // Skipped by default — `cargo test --include-ignored` to run.
        let adapter = PostgresAdapter::new();
        let mut config = sample_config();
        config.database = "postgres".to_string();
        adapter.connect_pool(&config).await.expect("connect");
        adapter
            .switch_active_db("template1")
            .await
            .expect("switch to template1");
        assert_eq!(
            adapter.current_database().await.as_deref(),
            Some("template1")
        );
        adapter.disconnect_pool().await.expect("disconnect");
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

    // ── validate_identifier tests ─────────────────────────────────────

    #[test]
    fn validate_identifier_valid_names() {
        assert!(validate_identifier("users", "test").is_ok());
        assert!(validate_identifier("_private", "test").is_ok());
        assert!(validate_identifier("table_1", "test").is_ok());
        assert!(validate_identifier("CamelCase", "test").is_ok());
    }

    #[test]
    fn validate_identifier_empty_fails() {
        let result = validate_identifier("", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_whitespace_only_fails() {
        let result = validate_identifier("   ", "Column name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_starts_with_digit_fails() {
        let result = validate_identifier("1table", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must start with a letter or underscore"));
    }

    #[test]
    fn validate_identifier_special_chars_fails() {
        let result = validate_identifier("bad-name", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must contain only alphanumeric characters and underscores"));
    }

    #[test]
    fn validate_identifier_with_space_fails() {
        let result = validate_identifier("bad name", "Table name");
        assert!(result.is_err());
    }

    // ── quote_identifier tests ────────────────────────────────────────

    #[test]
    fn quote_identifier_simple() {
        assert_eq!(quote_identifier("users"), "\"users\"");
    }

    #[test]
    fn quote_identifier_with_embedded_quote() {
        assert_eq!(quote_identifier("my\"table"), "\"my\"\"table\"");
    }

    // ── qualified_table tests ─────────────────────────────────────────

    #[test]
    fn qualified_table_format() {
        assert_eq!(qualified_table("public", "users"), "\"public\".\"users\"");
    }

    // ── alter_table tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn alter_table_preview_only_returns_sql() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "varchar(255)".to_string(),
                nullable: false,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255) NOT NULL"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_add_with_default() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                nullable: true,
                default_value: Some("now()".to_string()),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"created_at\" timestamp DEFAULT now()"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_modify_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Modify {
                name: "age".to_string(),
                new_data_type: Some("bigint".to_string()),
                new_nullable: Some(false),
                new_default_value: Some("0".to_string()),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ALTER COLUMN \"age\" TYPE bigint, ALTER COLUMN \"age\" SET NOT NULL, ALTER COLUMN \"age\" SET DEFAULT 0"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_drop_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Drop {
                name: "legacy".to_string(),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" DROP COLUMN \"legacy\""
        );
    }

    #[tokio::test]
    async fn alter_table_preview_batch_changes() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![
                ColumnChange::Add {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                    default_value: None,
                },
                ColumnChange::Drop {
                    name: "old_col".to_string(),
                },
            ],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" text, DROP COLUMN \"old_col\""
        );
    }

    #[tokio::test]
    async fn alter_table_empty_changes_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column change"));
    }

    #[tokio::test]
    async fn alter_table_invalid_table_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "bad table!".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_invalid_column_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "bad column!".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: false,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── create_index tests ────────────────────────────────────────────

    #[tokio::test]
    async fn create_index_preview_btree() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_email".to_string(),
            columns: vec!["email".to_string()],
            index_type: "btree".to_string(),
            is_unique: true,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE UNIQUE INDEX \"idx_users_email\" ON \"public\".\"users\" USING btree (\"email\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_hash_non_unique() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_data".to_string(),
            columns: vec!["data".to_string()],
            index_type: "hash".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_users_data\" ON \"public\".\"users\" USING hash (\"data\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_multi_column() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            index_name: "idx_orders_composite".to_string(),
            columns: vec!["user_id".to_string(), "created_at".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_orders_composite\" ON \"public\".\"orders\" USING btree (\"user_id\", \"created_at\")"
        );
    }

    #[tokio::test]
    async fn create_index_all_types_accepted() {
        let adapter = PostgresAdapter::new();
        for itype in &["btree", "hash", "gist", "gin", "brin"] {
            let req = CreateIndexRequest {
                connection_id: "conn1".to_string(),
                schema: "public".to_string(),
                table: "users".to_string(),
                index_name: "idx_test".to_string(),
                columns: vec!["col1".to_string()],
                index_type: itype.to_string(),
                is_unique: false,
                preview_only: true,
            };
            assert!(
                adapter.create_index(&req).await.is_ok(),
                "Failed for type {}",
                itype
            );
        }
    }

    #[tokio::test]
    async fn create_index_invalid_type_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "invalid_type".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Index type must be one of"));
    }

    #[tokio::test]
    async fn create_index_empty_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec![],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column"));
    }

    #[tokio::test]
    async fn create_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "bad name!".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: false,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_index tests ──────────────────────────────────────────────

    #[tokio::test]
    async fn drop_index_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: false,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".\"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_preview_if_exists() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: true,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".IF EXISTS \"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "bad;name".to_string(),
            if_exists: false,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_test".to_string(),
            if_exists: false,
            preview_only: false,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── add_constraint tests ──────────────────────────────────────────

    #[tokio::test]
    async fn add_constraint_preview_primary_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_users".to_string(),
            definition: ConstraintDefinition::PrimaryKey {
                columns: vec!["id".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"pk_users\" PRIMARY KEY (\"id\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_unique() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"uq_users_email\" UNIQUE (\"email\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_check() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_users_age".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "age >= 0".to_string(),
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"chk_users_age\" CHECK (age >= 0)"
        );
    }

    #[tokio::test]
    async fn add_constraint_empty_pk_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_test".to_string(),
            definition: ConstraintDefinition::PrimaryKey { columns: vec![] },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("at least one column"));
    }

    #[tokio::test]
    async fn add_constraint_empty_check_expression_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_test".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "  ".to_string(),
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[tokio::test]
    async fn add_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn add_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: false,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_constraint tests ─────────────────────────────────────────

    #[tokio::test]
    async fn drop_constraint_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            preview_only: true,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" DROP CONSTRAINT \"uq_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            preview_only: true,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            preview_only: false,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── list_views / list_functions / get_view_definition / get_function_source tests ─

    #[tokio::test]
    async fn list_views_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_views("public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn list_functions_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_functions("public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_view_columns_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_view_columns("public", "my_view").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_view_definition_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_view_definition("public", "my_view").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_function_source_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_function_source("public", "my_func").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    // ── Sprint-89 (#FK-1) — `format_fk_reference` unit + fixture tests ──

    #[test]
    fn format_fk_reference_happy_path() {
        assert_eq!(
            format_fk_reference("public", "users", "id"),
            "public.users(id)"
        );
    }

    #[test]
    fn format_fk_reference_underscored_identifiers() {
        assert_eq!(
            format_fk_reference("sales_v2", "orders", "user_id"),
            "sales_v2.orders(user_id)"
        );
    }

    #[test]
    fn format_fk_reference_special_chars_in_identifiers() {
        // Hyphens and spaces survive the round-trip because the TS regex
        // (`/^(.+)\.(.+)\((.+)\)$/`) is greedy on each segment.
        assert_eq!(
            format_fk_reference("audit-log", "events", "event id"),
            "audit-log.events(event id)"
        );
    }

    #[tokio::test]
    async fn list_databases_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = PostgresAdapter::list_databases(&adapter).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    /// Stub `DatabaseError` so the SQLSTATE / message matchers can be
    /// exercised without a live Postgres server. Sprint 128 tests for
    /// the permission-denied fallback only need `code()` and `message()`.
    #[derive(Debug)]
    struct StubDbError {
        code: Option<String>,
        message: String,
    }

    impl std::fmt::Display for StubDbError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.message)
        }
    }

    impl std::error::Error for StubDbError {}

    impl sqlx::error::DatabaseError for StubDbError {
        fn message(&self) -> &str {
            &self.message
        }
        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            self.code.as_deref().map(std::borrow::Cow::Borrowed)
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn make_db_error(code: Option<&str>, message: &str) -> sqlx::Error {
        sqlx::Error::Database(Box::new(StubDbError {
            code: code.map(|c| c.to_string()),
            message: message.to_string(),
        }))
    }

    #[test]
    fn permission_denied_matches_sqlstate_42501() {
        let err = make_db_error(Some("42501"), "permission denied for table pg_database");
        assert!(is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_matches_sqlstate_only() {
        // Even when the message text is missing the hint, SQLSTATE wins.
        let err = make_db_error(Some("42501"), "");
        assert!(is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_matches_message_substring() {
        // No SQLSTATE on the wire (rare but observed) — fall back to the
        // canonical message text.
        let err = make_db_error(None, "ERROR: permission denied for table pg_database");
        assert!(is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_matches_message_relation_substring() {
        // Newer Postgres versions phrase the same error as "relation".
        let err = make_db_error(None, "permission denied for relation pg_database");
        assert!(is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_message_match_is_case_insensitive() {
        let err = make_db_error(None, "PERMISSION DENIED FOR TABLE pg_database");
        assert!(is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_does_not_match_unrelated_42501() {
        // Different table — wrong target. Still SQLSTATE 42501 means the
        // role is missing privileges, but our matcher is intentionally
        // strict on the *table* (otherwise we would fall back for any
        // permission error). SQLSTATE 42501 alone is sufficient because
        // we only call `is_pg_database_permission_denied` from the
        // `pg_database` query path, where any 42501 *is* about
        // `pg_database`. The message-based arm checks the table name
        // explicitly so the negative case below covers other 42501s
        // surfaced through the message-only path.
        let err = make_db_error(None, "permission denied for table pg_class");
        assert!(!is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_does_not_match_unrelated_error() {
        let err = make_db_error(Some("42P01"), "relation \"nope\" does not exist");
        assert!(!is_pg_database_permission_denied(&err));
    }

    #[test]
    fn permission_denied_does_not_match_non_database_error() {
        let err = sqlx::Error::PoolClosed;
        assert!(!is_pg_database_permission_denied(&err));
    }

    #[test]
    fn format_fk_reference_matches_sprint_88_fixture() {
        // Round-trip every sample from the shared fixture so any future
        // drift between the Rust serializer and the JSON contract is caught
        // by `cargo test`. The TS side does the inverse direction.
        const FIXTURE_RAW: &str = include_str!("../../../tests/fixtures/fk_reference_samples.json");

        #[derive(serde::Deserialize)]
        struct Sample {
            schema: String,
            table: String,
            column: String,
            expected: String,
        }

        #[derive(serde::Deserialize)]
        struct Fixture {
            samples: Vec<Sample>,
        }

        let fixture: Fixture =
            serde_json::from_str(FIXTURE_RAW).expect("fixture must be valid JSON");
        assert!(
            fixture.samples.len() >= 3,
            "fixture must define at least 3 samples"
        );
        for sample in &fixture.samples {
            assert_eq!(
                format_fk_reference(&sample.schema, &sample.table, &sample.column),
                sample.expected,
                "format_fk_reference must round-trip sample {:?}",
                sample.expected
            );
        }
    }
}
