//! MySQL query execution paths — `execute_query` (free-form SQL) +
//! `query_table_data` (paged table reads).
//!
//! Mirrors the PG `db/postgres/queries.rs` pattern, with dialect differences:
//! - placeholder: `?` (PG `$N`)
//! - identifier quote: backtick (PG `"`)
//! - row → JSON conversion: no builtin like PG's `row_to_json(q)::text`, so
//!   fall back to per-cell decode based on column type-info (one server
//!   round-trip; sqlx decodes native types via per-column `try_get`).
//! - Time types: MySQL DATETIME/TIMESTAMP/DATE/TIME decode into the chrono
//!   `NaiveDateTime` / `NaiveDate` / `NaiveTime` types and serialize as ISO
//!   8601 strings.
//! - DECIMAL: while the sqlx-mysql decimal feature is disabled, fallback
//!   decode into `String` works — precision preserved via string round-trip.
//!
//! The `executed_query` column is the SQL the user sees in the grid's
//! 'Query' panel, so keep the inner form (no CAST/JSON_OBJECT wrappers).

use futures_util::TryStreamExt;
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::ValueRef;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::db::raw_where::{validate_raw_where_clause, RawWhereDialect};
use crate::error::AppError;
use crate::models::{
    FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::mutations::{qualified_table, quote_ident, validate_identifier};
use super::schema::map_mysql_data_type;
use super::MysqlAdapter;

/// Same duty as PG queries.rs — match prefixes like SELECT/WITH after
/// stripping leading SQL comments. Byte-for-byte identical implementation
/// (dialect-agnostic helper).
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

/// Same as PG queries.rs. Strips only `;` + whitespace from the trail.
fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

// quote_ident / qualified_table are single-sourced in `super::mutations`.
// The DDL/DML emitters have shared the same helper ever since.

/// Same duty as PG `pg_cast_type` — the `CAST(? AS <type>)` target per
/// column type. MySQL needs less type branching than PG (most string
/// params coerce automatically) — only DATE/DATETIME/DECIMAL/INT get an
/// explicit cast. Note that MySQL `CAST(? AS INT)` uses the INT sub-name,
/// and `SIGNED INTEGER` is canonical in MySQL 8.0, so that is what we emit.
fn mysql_cast_type(data_type: &str) -> Option<&'static str> {
    // `column_type` comes in forms like `int(11)` — extract the base keyword.
    let lower = data_type.trim().to_ascii_lowercase();
    let base = lower
        .split(|c: char| c == '(' || c.is_whitespace())
        .next()
        .unwrap_or("");
    match base {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "year" => {
            Some("SIGNED")
        }
        "decimal" | "numeric" => Some("DECIMAL"),
        "float" | "double" | "real" => None, // MySQL coerces automatically
        "date" => Some("DATE"),
        "datetime" | "timestamp" => Some("DATETIME"),
        "time" => Some("TIME"),
        _ => None,
    }
}

/// Decodes the idx-th cell of a row into `serde_json::Value` based on the
/// column type-info. On failure falls back to try_get_unchecked<String>, and
/// to Null if that fails too. Avoids unsafe raw-bytes access to sqlx
/// MysqlValueRef and uses only the public `try_get` API.
fn cell_to_json(row: &sqlx::mysql::MySqlRow, idx: usize) -> serde_json::Value {
    // Handle NULL first — try_get::<Option<String>> is the broadest path.
    // This pattern matches the null branch of PG queries.rs's row_to_json.
    let type_name = row.column(idx).type_info().name().to_ascii_uppercase();

    macro_rules! try_decode {
        ($t:ty, $f:expr) => {
            if let Ok(Some(v)) = row.try_get::<Option<$t>, _>(idx) {
                return ($f)(v);
            }
        };
    }

    // Branch on the type name. MySQL TypeInfo's name() returns uppercase
    // keywords (`"INT"`, `"VARCHAR"`, `"DATETIME"`, `"JSON"`, `"BLOB"`, etc.).
    match type_name.as_str() {
        "BOOLEAN" => {
            // sqlx-mysql reports ColumnType::Tiny as one of three keywords
            // depending on width (vendored column.rs L175-181): TINYINT(1) →
            // `"BOOLEAN"`, unsigned → `"TINYINT UNSIGNED"`, otherwise →
            // `"TINYINT"`. Width 1 (`"BOOLEAN"`) is MySQL's boolean idiom, so
            // render as bool — matches TablePlus behavior. Falls back to i64
            // when the bool decode fails. A wide `"TINYINT"` falls through to
            // the integer branch below and decodes as Number
            // (issue #1484: bug where non-zero TINYINT integers collapsed to
            // true).
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
                return serde_json::Value::Bool(v);
            }
            try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
        }
        "BIGINT" | "BIGINT UNSIGNED" => {
            // ADR 0026 (issue #1082) — BIGINT (i64) and BIGINT UNSIGNED (u64)
            // can exceed ±(2^53-1), so wiring them as raw JSON numbers makes
            // the frontend's native JSON.parse demote them to f64 and silently
            // corrupt them. As with PG bigint, serialize as a
            // precision-preserving JSON string token; the frontend's
            // wrapNumericCells then promotes to BigInt based on the column
            // data_type. sqlx-mysql 0.8.6's type_info().name() reports
            // unsigned as `"BIGINT UNSIGNED"` (vendored column.rs L180) —
            // matching signed only drops unsigned into the wildcard branch,
            // where String decode fails → Null value loss. Large auto-inc PK
            // columns are a common idiom, so an explicit match is required.
            try_decode!(i64, |v: i64| serde_json::Value::String(v.to_string()));
            try_decode!(u64, |v: u64| serde_json::Value::String(v.to_string()));
        }
        "TINYINT" | "SMALLINT" | "SMALLINT UNSIGNED" | "MEDIUMINT" | "MEDIUMINT UNSIGNED"
        | "INT" | "INT UNSIGNED" | "INTEGER" | "YEAR" | "TINYINT UNSIGNED" => {
            // All of these are ≤32bit (u32 max 4_294_967_295 < 2^53), so they
            // round-trip through f64 losslessly — keep the raw Number. A wide
            // `"TINYINT"` decodes as an integer here: `"TINYINT" | "BOOLEAN"`
            // used to be grouped with bool tried first, and sqlx bool succeeds
            // whenever byte != 0, so non-zero TINYINT (2, 127, -5) all
            // collapsed to true (issue #1484). TINYINT(1) is reported by sqlx
            // as `"BOOLEAN"` and handled by the bool branch above, so only
            // pure integer columns reach `"TINYINT"` here. Unsigned variants
            // are reported by sqlx-mysql as separate keywords (`"INT UNSIGNED"`
            // etc., vendored column.rs L176-179) and must be matched
            // explicitly, so they do not fall into the wildcard branch and
            // lose their values as Null. Signed first (i64) → u64 on failure.
            try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
            try_decode!(u64, |v: u64| serde_json::Value::Number(v.into()));
        }
        "BIT" => {
            // BIT(N) decodes as u64 in sqlx-mysql.
            try_decode!(u64, |v: u64| serde_json::Value::Number(v.into()));
        }
        "FLOAT" => {
            try_decode!(f32, |v: f32| serde_json::Number::from_f64(v as f64)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null));
        }
        "DOUBLE" => {
            try_decode!(f64, |v: f64| serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null));
        }
        "DECIMAL" | "NEWDECIMAL" => {
            // Follow-up — the sqlx-mysql prepared statement binary protocol
            // provides no automatic DECIMAL → String decode (the earlier
            // assumption was wrong; an ignored test exposed it). With the
            // Cargo `bigdecimal` feature enabled, convert via
            // `BigDecimal::to_string()` into a precision-lossless base-10
            // string. Keeps the same wire format (JSON string) as ADR 0026
            // (PG).
            try_decode!(sqlx::types::BigDecimal, |v: sqlx::types::BigDecimal| {
                serde_json::Value::String(v.to_string())
            });
            // Fallback for driver paths that expose it directly as an ASCII
            // string (legacy text protocol).
            try_decode!(String, serde_json::Value::String);
        }
        "DATE" => {
            try_decode!(
                sqlx::types::chrono::NaiveDate,
                |v: sqlx::types::chrono::NaiveDate| { serde_json::Value::String(v.to_string()) }
            );
        }
        "TIME" => {
            try_decode!(
                sqlx::types::chrono::NaiveTime,
                |v: sqlx::types::chrono::NaiveTime| { serde_json::Value::String(v.to_string()) }
            );
        }
        "DATETIME" | "TIMESTAMP" => {
            try_decode!(
                sqlx::types::chrono::NaiveDateTime,
                |v: sqlx::types::chrono::NaiveDateTime| {
                    serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string())
                }
            );
        }
        "JSON" => {
            try_decode!(serde_json::Value, |v| v);
            try_decode!(String, |s: String| serde_json::from_str(&s)
                .unwrap_or(serde_json::Value::String(s)));
        }
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => {
            // Render binary as a hex string (a surface the user's grid can
            // display). Revisit a base64 + raw split surface when the
            // constraint / type-aware editor work lands.
            try_decode!(Vec<u8>, |v: Vec<u8>| serde_json::Value::String(format!(
                "0x{}",
                hex_encode(&v)
            )));
        }
        // VARCHAR / CHAR / TEXT / MEDIUMTEXT / LONGTEXT / TINYTEXT / ENUM / SET /
        // and every other unknown keyword: try String.
        _ => {
            try_decode!(String, serde_json::Value::String);
        }
    }

    // One more String fallback if every path above failed. An actual NULL
    // makes try_get::<Option<String>> return Ok(None), dropping to the raw
    // NULL branch below.
    if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
        return serde_json::Value::String(v);
    }

    // issue #1083 — a cell that reaches this point is either a "true NULL"
    // or "has a value but every decode failed". Both used to be lumped into a
    // silent Null (legacy zero-date `0000-00-00` / GEOMETRY / TIME beyond 24h
    // etc. masqueraded as empty cells → the user mistook them, overwrote, and
    // lost the original). Inspect the raw value's NULL flag directly, emit
    // Null only for true NULLs, and surface decode failures as an explicit
    // marker — visually distinct from an empty cell in the grid, which
    // prevents the mistake.
    match row.try_get_raw(idx) {
        Ok(raw) if raw.is_null() => serde_json::Value::Null,
        _ => decode_error_marker(&type_name),
    }
}

/// issue #1083 — marker for a decode-failed cell. A string distinguishable
/// from a true NULL, preventing data loss where a cell is mistaken for empty
/// and overwritten in the grid. A stable format the frontend can hook into
/// when it adds an edit-block/warning surface.
fn decode_error_marker(type_name: &str) -> serde_json::Value {
    serde_json::Value::String(format!("<decode error: {type_name}>"))
}

/// Minimal hex encoder that avoids a `hex` crate dependency. For BLOB
/// display — enough as long as the user's grid recognizes cell values as
/// `0x...`.
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(*b >> 4) as usize] as char);
        out.push(HEX[(*b & 0x0f) as usize] as char);
    }
    out
}

/// Validates raw WHERE input. The shared AST validator wraps the fragment
/// in a dialect SELECT, allowing only boolean expressions.
fn validate_raw_where(rw: &str) -> Result<(), AppError> {
    validate_raw_where_clause(RawWhereDialect::Mysql, rw)
}

impl MysqlAdapter {
    /// Runs free-form SQL. Same contract as PG `execute_query`:
    /// SELECT/WITH/SHOW/EXPLAIN/DESCRIBE/CALL → `QueryType::Select` +
    /// columns + rows; INSERT/UPDATE/DELETE → `QueryType::Dml { rows_affected }`;
    /// anything else → `QueryType::Ddl`.
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        // Issue #1231 — fetch-stage row cap. See SQLite adapter for the
        // streaming rationale.
        row_cap: usize,
    ) -> Result<QueryResult, AppError> {
        self.execute_query_tracked(query, cancel_token, row_cap, None)
            .await
    }

    /// Issue #1230 — `execute_query` variant that pins ONE pooled connection
    /// and, when `pid_tx` is `Some`, sends its `CONNECTION_ID()` thread id
    /// before the statement runs so `KILL QUERY <id>` can abort a long query.
    /// The statement (streaming row-cap fetch included) runs on that SAME
    /// connection. `None` keeps the pooled fast-path used by batch / schema
    /// callers; the #1231 streaming row-cap semantics are unchanged.
    pub async fn execute_query_tracked(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        row_cap: usize,
        pid_tx: Option<tokio::sync::oneshot::Sender<i64>>,
    ) -> Result<QueryResult, AppError> {
        let start = std::time::Instant::now();

        let query = strip_trailing_terminator(query);
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }

        // Detect query type — DESCRIBE / DESC is MySQL's SELECT-equivalent
        // and returns columns + rows (dialect-specific, absent in PG).
        let stripped = strip_leading_comments(query);
        let trimmed_query = stripped.to_uppercase();
        let query_type = if trimmed_query.starts_with("SELECT")
            || trimmed_query.starts_with("WITH")
            || trimmed_query.starts_with("SHOW")
            || trimmed_query.starts_with("EXPLAIN")
            || trimmed_query.starts_with("DESCRIBE")
            || trimmed_query.starts_with("DESC ")
            || trimmed_query.starts_with("CALL")
        {
            QueryType::Select
        } else if trimmed_query.starts_with("INSERT")
            || trimmed_query.starts_with("UPDATE")
            || trimmed_query.starts_with("DELETE")
            || trimmed_query.starts_with("REPLACE")
        {
            QueryType::Dml { rows_affected: 0 }
        } else {
            QueryType::Ddl
        };

        // Pin ONE connection so the reported thread id is the backend that
        // runs this statement (a separate pool acquire could pick another).
        let pool = self.active_pool().await?;
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        if let Some(pid_tx) = pid_tx {
            // Best-effort: probe failure skips native cancel; the cooperative
            // token still applies (pid_tx drops → Err on rx).
            if let Ok(thread_id) = sqlx::query_scalar::<_, u64>("SELECT CONNECTION_ID()")
                .fetch_one(&mut *conn)
                .await
            {
                let _ = pid_tx.send(thread_id as i64);
            }
        }

        let result = match query_type {
            QueryType::Select => {
                let query_future = async {
                    // Issue #1231 — stream + cap so a no-LIMIT result cannot
                    // buffer the whole table into the Rust Vec.
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
                            columns = row
                                .columns()
                                .iter()
                                .map(|col| {
                                    let data_type = col.type_info().name().to_string();
                                    let category = map_mysql_data_type(&data_type);
                                    QueryColumn {
                                        name: col.name().to_string(),
                                        data_type,
                                        category,
                                    }
                                })
                                .collect();
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
                    let execution_time_ms = start.elapsed().as_millis() as u64;

                    Ok::<QueryResult, AppError>(QueryResult {
                        truncated,
                        columns,
                        rows: json_rows,
                        total_count,
                        execution_time_ms,
                        query_type: QueryType::Select,
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
            QueryType::Dml { .. } => {
                let query_future = async {
                    let result = sqlx::query(query)
                        .execute(&mut *conn)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    let rows_affected = result.rows_affected();
                    let execution_time_ms = start.elapsed().as_millis() as u64;
                    Ok::<QueryResult, AppError>(QueryResult {
                        truncated: false,
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
                    sqlx::query(query)
                        .execute(&mut *conn)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    let execution_time_ms = start.elapsed().as_millis() as u64;
                    Ok::<QueryResult, AppError>(QueryResult {
                        truncated: false,
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

        // Issue #1230 (PR #1241 review) — a native KILL QUERY can end the
        // statement as ER_QUERY_INTERRUPTED (1317) or a spurious SLEEP success
        // before the token branch above wins the select!; converge onto the
        // canonical cancelled error when the token has fired so mysql reaches
        // the same frontend cancelled-state as PG.
        crate::db::traits::finalize_cancelled(result, cancel_token)
    }

    /// Paged table data. Same contract as PG `query_table_data` — identical
    /// semantics and fallback policy for filters / order_by / raw_where too.
    /// Dialect differences: `?` placeholder + backtick quoting + DESC
    /// tiebreaker are also the same.
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
        cancel_token: Option<&CancellationToken>,
    ) -> Result<TableData, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let work = self.query_table_data_uncancelled(
            table, schema, page, page_size, order_by, filters, raw_where, None,
        );
        match cancel_token {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => work.await,
        }
    }

    /// Issue #1269 — `query_table_data` variant that pins ONE connection and
    /// reports its `CONNECTION_ID()` thread id through `pid_tx` so a grid browse
    /// can be natively cancelled (`KILL QUERY`) mid-scan. Otherwise identical to
    /// `query_table_data` (same cooperative-token cooperation). Mirrors PG's
    /// `query_table_data_tracked`.
    #[allow(clippy::too_many_arguments)]
    pub async fn query_table_data_tracked(
        &self,
        table: &str,
        schema: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
        cancel_token: Option<&CancellationToken>,
        pid_tx: tokio::sync::oneshot::Sender<i64>,
    ) -> Result<TableData, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let work = self.query_table_data_uncancelled(
            table,
            schema,
            page,
            page_size,
            order_by,
            filters,
            raw_where,
            Some(pid_tx),
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
        table: &str,
        schema: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
        // Issue #1269 — when `Some`, pin ONE connection and send its
        // `CONNECTION_ID()` thread id before the COUNT + data scan so native
        // cancel (`KILL QUERY`) reaches the backend actually running the browse.
        // `None` keeps the pre-#1269 pooled behaviour.
        pid_tx: Option<tokio::sync::oneshot::Sender<i64>>,
    ) -> Result<TableData, AppError> {
        let pool = self.active_pool().await?;

        // Fast metadata stays on the pool; native cancel only needs to reach the
        // COUNT + data scan below.
        let columns = self.get_table_columns_inner(&pool, table, schema).await?;

        // Issue #1269 — pin ONE connection so the COUNT + data queries (the
        // potentially long ones) run on the same backend whose thread id we
        // report. Acquiring a fresh pool connection per query would let the
        // reported id point at a different session, and `KILL QUERY` would miss.
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        if let Some(pid_tx) = pid_tx {
            // Best-effort: a probe failure simply skips native cancel (pid_tx
            // drops → Err on rx) and the cooperative token still applies.
            if let Ok(thread_id) = sqlx::query_scalar::<_, u64>("SELECT CONNECTION_ID()")
                .fetch_one(&mut *conn)
                .await
            {
                let _ = pid_tx.send(thread_id as i64);
            }
        }

        let qualified = qualified_table(schema, table);

        let raw_where_trimmed = raw_where.map(|rw| rw.trim()).filter(|rw| !rw.is_empty());
        if let Some(rw) = &raw_where_trimmed {
            validate_raw_where(rw)?;
        }

        let (where_clause, param_values) = if let Some(rw) = &raw_where_trimmed {
            (format!(" WHERE {}", rw), Vec::<String>::new())
        } else {
            let mut where_clause = String::new();
            let mut param_values: Vec<String> = Vec::new();
            if let Some(filters) = filters {
                if !filters.is_empty() {
                    let valid_columns: std::collections::HashSet<&str> =
                        columns.iter().map(|c| c.name.as_str()).collect();
                    let col_types: std::collections::HashMap<&str, &str> = columns
                        .iter()
                        .map(|c| (c.name.as_str(), c.data_type.as_str()))
                        .collect();
                    let mut conditions: Vec<String> = Vec::new();
                    for f in filters {
                        if !valid_columns.contains(f.column.as_str()) {
                            continue;
                        }
                        let quoted_col = quote_ident(&f.column);
                        match &f.operator {
                            FilterOperator::IsNull => {
                                conditions.push(format!("{} IS NULL", quoted_col));
                            }
                            FilterOperator::IsNotNull => {
                                conditions.push(format!("{} IS NOT NULL", quoted_col));
                            }
                            _ => {
                                let Some(op) = f.operator.comparison_sql() else {
                                    continue;
                                };
                                if let Some(val) = &f.value {
                                    // MySQL's placeholder is `?` — no index
                                    // needed. Instead of PG's `::type` cast,
                                    // wrap with `CAST(? AS <type>)`.
                                    let placeholder = match col_types
                                        .get(f.column.as_str())
                                        .and_then(|dt| mysql_cast_type(dt))
                                    {
                                        Some(t) => format!("CAST(? AS {})", t),
                                        None => "?".to_string(),
                                    };
                                    conditions
                                        .push(format!("{} {} {}", quoted_col, op, placeholder));
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

        // total count
        let count_sql = format!("SELECT COUNT(*) FROM {}{}", qualified, where_clause);
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        for val in &param_values {
            count_query = count_query.bind(val);
        }
        let (total,) = count_query
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let page_size = crate::db::clamp_page_size(page_size);
        let offset = (page - 1).max(0) * page_size;

        // ORDER BY — same parsing policy as PG queries.rs, same PK tiebreaker.
        let mut order_clause = String::new();
        let mut user_sort_columns: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        if let Some(order_by) = &order_by {
            let valid_columns: std::collections::HashSet<&str> =
                columns.iter().map(|c| c.name.as_str()).collect();
            let mut order_parts: Vec<String> = Vec::new();
            for part in order_by.split(',') {
                let part_trimmed = part.trim();
                let parts: Vec<&str> = part_trimmed.split_whitespace().collect();
                let (col_name, direction) = match parts.as_slice() {
                    [col, dir] => match crate::db::parse_order_direction(dir) {
                        Some(d) => (*col, d),
                        None => continue,
                    },
                    [col] => (*col, "ASC"),
                    _ => continue,
                };
                if valid_columns.contains(col_name) {
                    order_parts.push(format!("{} {}", quote_ident(col_name), direction));
                    user_sort_columns.insert(col_name.to_string());
                }
            }
            if !order_parts.is_empty() {
                let pk_tiebreaker_parts: Vec<String> = columns
                    .iter()
                    .filter(|c| c.is_primary_key && !user_sort_columns.contains(&c.name))
                    .map(|c| format!("{} ASC", quote_ident(&c.name)))
                    .collect();
                let mut all_parts = order_parts;
                all_parts.extend(pk_tiebreaker_parts);
                order_clause = format!(" ORDER BY {}", all_parts.join(", "));
            }
        }

        if order_clause.is_empty() {
            // Same as PG `build_default_order_clause` — PK column ASC.
            let pk_parts: Vec<String> = columns
                .iter()
                .filter(|c| c.is_primary_key)
                .map(|c| format!("{} ASC", quote_ident(&c.name)))
                .collect();
            if !pk_parts.is_empty() {
                order_clause = format!(" ORDER BY {}", pk_parts.join(", "));
            }
        }

        let executed_query = format!(
            "SELECT * FROM {}{}{} LIMIT {} OFFSET {}",
            qualified, where_clause, order_clause, page_size, offset
        );

        let mut data_query = sqlx::query(&executed_query);
        for val in &param_values {
            data_query = data_query.bind(val);
        }
        let rows = data_query
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Column name → ColumnInfo index map. The row's column order can
        // differ from the schema order (`SELECT *` usually matches, but map
        // explicitly to stay conservative).
        let col_index: std::collections::HashMap<&str, usize> = columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.as_str(), i))
            .collect();

        let result_rows: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| {
                let mut out: Vec<serde_json::Value> = vec![serde_json::Value::Null; columns.len()];
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
            total_count: total,
            page,
            page_size,
            executed_query,
        })
    }

    /// Row streaming — the MySQL counterpart of PG `stream_table_rows`.
    /// Outside stored procedures MySQL has no server-side cursor, so PG's
    /// `DECLARE NO SCROLL CURSOR FOR …; FETCH FORWARD` pattern cannot be used
    /// as-is — the equivalent is built on the async row stream of
    /// `sqlx::query.fetch()` (internally sqlx-mysql receives rows in chunks
    /// per prepared statement). Every batch checks `cancel.is_cancelled()` and
    /// a failed `sender.send` so it can abort cooperatively.
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
        validate_identifier(schema, "Schema name")?;
        validate_identifier(table, "Table name")?;

        let pool = self.active_pool().await?;

        // Transaction-wrap for a consistent snapshot (InnoDB REPEATABLE READ).
        // Same intent as PG — a long export must not be shaken by other
        // commits.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(format!("BEGIN failed: {e}")))?;

        let qualified = qualified_table(schema, table);
        // Column selection follows the `column_names` order — the caller
        // decides the source order.
        let cols_clause: Vec<String> = column_names.iter().map(|c| quote_ident(c)).collect();
        let select_sql = format!("SELECT {} FROM {}", cols_clause.join(", "), qualified);

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
        // tail flush — the remainder smaller than batch_size.
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

    /// `SELECT COUNT(*) FROM qualified WHERE col IS NULL`. Same contract as
    /// PG `count_null_rows`.
    pub async fn count_null_rows(
        &self,
        schema: &str,
        table: &str,
        column: &str,
    ) -> Result<i64, AppError> {
        validate_identifier(schema, "Schema name")?;
        validate_identifier(table, "Table name")?;
        validate_identifier(column, "Column name")?;

        let qualified = qualified_table(schema, table);
        let quoted_col = quote_ident(column);
        let sql = format!(
            "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
            qualified, quoted_col
        );

        let pool = self.active_pool().await?;
        let (count,): (i64,) = sqlx::query_as(&sql)
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(count)
    }

    /// The MySQL counterpart of PG `execute_query_batch`. Runs every statement
    /// sequentially inside a single transaction (BEGIN/COMMIT), ROLLBACK on
    /// failure.
    ///
    /// MySQL limitation: a DDL statement (CREATE/ALTER/DROP/RENAME) commits
    /// implicitly, so a later statement failing does not roll it back. This
    /// batch path is mainly for the commit pipeline (DML), and the user-facing
    /// copy says that mixing DDL/DML can leave a partial apply.
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
                        // Issue #1079 — a one-row grid edit that touches != 1
                        // rows (PK-less all-column WHERE hitting duplicates)
                        // rolls the whole transaction back.
                        if let Err(err) =
                            crate::db::enforce_single_row_effect(idx, total, rows_affected)
                        {
                            let _ = tx.rollback().await;
                            return Err(err);
                        }
                        results.push(QueryResult {
                            truncated: false,
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

    /// The MySQL counterpart of PG `dry_run_query_batch`. BEGIN → run →
    /// unconditional ROLLBACK. Like PG, it reports only the `rows_affected`
    /// statistics of the DML and leaves no actual row change behind.
    ///
    /// MySQL limitation: DDL commits implicitly, so a dry run cannot stop a
    /// real schema change — the destructive-confirm dialog (ADR 0022) is a
    /// DML-only use case, so this path is safe enough. DDL preview takes a
    /// separate route that only emits SQL via the `preview_only` flag.
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
                            truncated: false,
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
}

#[cfg(test)]
mod tests {
    //! Reason (2026-05-13): the pure helpers in this file
    //! (strip_leading_comments / strip_trailing_terminator / quote_ident /
    //! qualified / mysql_cast_type / validate_raw_where / hex_encode) can be
    //! regression-guarded without a real DB. The real-DB integration of
    //! execute_query / query_table_data lives in the opt-in
    //! `mysql_test_config` tests.
    use super::*;

    #[test]
    fn strip_leading_comments_handles_line_block_and_mixed() {
        assert_eq!(strip_leading_comments("-- hi\nSELECT 1"), "SELECT 1");
        assert_eq!(strip_leading_comments("/* x */SELECT 1"), "SELECT 1");
        assert_eq!(strip_leading_comments("/* a */ -- b\nSELECT 1"), "SELECT 1");
        assert_eq!(strip_leading_comments("   SELECT 1"), "SELECT 1");
        assert_eq!(strip_leading_comments(""), "");
    }

    #[test]
    fn strip_trailing_terminator_removes_semicolons_and_whitespace() {
        assert_eq!(strip_trailing_terminator("SELECT 1;"), "SELECT 1");
        assert_eq!(strip_trailing_terminator("SELECT 1;  ;\n"), "SELECT 1");
        assert_eq!(strip_trailing_terminator("SELECT 1"), "SELECT 1");
        assert_eq!(strip_trailing_terminator(";;;"), "");
    }

    // The regression guard for quote_ident / qualified_table is single-sourced
    // in the unit tests of mutations.rs — this file covers only the
    // dialect-cast, the raw_where validator, and the SELECT/DML branch
    // helpers.

    #[test]
    fn mysql_cast_type_routes_common_types() {
        assert_eq!(mysql_cast_type("int"), Some("SIGNED"));
        assert_eq!(mysql_cast_type("BIGINT"), Some("SIGNED"));
        assert_eq!(mysql_cast_type("decimal(10,2)"), Some("DECIMAL"));
        assert_eq!(mysql_cast_type("datetime"), Some("DATETIME"));
        assert_eq!(mysql_cast_type("date"), Some("DATE"));
        assert_eq!(mysql_cast_type("varchar(255)"), None);
        assert_eq!(mysql_cast_type("text"), None);
    }

    #[test]
    fn validate_raw_where_blocks_semicolon() {
        assert!(validate_raw_where("a=1; DROP TABLE u").is_err());
    }

    #[test]
    fn validate_raw_where_blocks_ddl_dml_prefix() {
        for kw in [
            "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
        ] {
            let rw = format!("{} something", kw);
            assert!(validate_raw_where(&rw).is_err(), "{} should be blocked", kw);
        }
    }

    #[test]
    fn validate_raw_where_accepts_plain_filter() {
        assert!(validate_raw_where("status = 'active' AND age > 18").is_ok());
    }

    #[tokio::test]
    async fn query_table_data_pre_cancel_short_circuits_before_pool_lookup() {
        let adapter = MysqlAdapter::new();
        let token = CancellationToken::new();
        token.cancel();

        let result = adapter
            .query_table_data("users", "app", 1, 10, None, None, None, Some(&token))
            .await;

        match result {
            Err(AppError::Database(msg)) => assert_eq!(msg, "Operation cancelled"),
            other => panic!("expected Operation cancelled, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn query_table_data_tracked_pre_cancel_short_circuits_and_drops_pid() {
        // Issue #1269 — the pid-tracked browse variant (grid native cancel via
        // `KILL QUERY`) must short-circuit a pre-cancelled token before the pool
        // lookup, like the untracked path, and drop `pid_tx` so no stale thread
        // id is recorded (rx resolves to Err → the frontend keeps cooperative
        // cancel).
        let adapter = MysqlAdapter::new();
        let token = CancellationToken::new();
        token.cancel();
        let (pid_tx, pid_rx) = tokio::sync::oneshot::channel::<i64>();

        let result = adapter
            .query_table_data_tracked(
                "users",
                "app",
                1,
                10,
                None,
                None,
                None,
                Some(&token),
                pid_tx,
            )
            .await;

        match result {
            Err(AppError::Database(msg)) => assert_eq!(msg, "Operation cancelled"),
            other => panic!("expected Operation cancelled, got {other:?}"),
        }
        assert!(
            pid_rx.await.is_err(),
            "pre-cancel must drop pid_tx without sending a thread id"
        );
    }

    #[test]
    fn hex_encode_lower_two_chars_per_byte() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab]), "00ffab");
        assert_eq!(hex_encode(&[]), "");
    }

    /// issue #1083 — a decode failure must never disguise itself as a silent
    /// NULL. The marker has to be a string distinguishable from a real NULL,
    /// and it carries the column type that failed.
    #[test]
    fn decode_error_marker_is_not_null_and_names_type() {
        let v = decode_error_marker("GEOMETRY");
        assert_eq!(
            v,
            serde_json::Value::String("<decode error: GEOMETRY>".to_string())
        );
        assert!(!v.is_null(), "decode failure must never masquerade as NULL");
    }
}
