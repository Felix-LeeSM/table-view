//! MySQL query execution paths — `execute_query` (free-form SQL) +
//! `query_table_data` (paged table reads). Sprint 282 (Phase 17 Slice B).
//!
//! PG `db/postgres/queries.rs` 패턴 답습 — 단 dialect 차이:
//! - placeholder: `?` (PG `$N`)
//! - identifier quote: backtick (PG `"`)
//! - row → JSON 변환: PG `row_to_json(q)::text` 같은 빌트인이 없어 column
//!   type-info 기반 per-cell decode 로 우회 (server round-trip 1회, sqlx
//!   가 column 별 `try_get` 으로 native type 디코딩).
//! - 시간 타입: MySQL 의 DATETIME/TIMESTAMP/DATE/TIME 은 chrono crate 의
//!   `NaiveDateTime` / `NaiveDate` / `NaiveTime` 로 decode 후 ISO 8601
//!   string 으로 직렬화.
//! - DECIMAL: sqlx-mysql 의 decimal feature 비활성 상태에선 `String`
//!   으로 fallback decode 가 동작 — string round-trip 으로 정밀도 보존.
//!
//! `executed_query` 컬럼은 사용자가 grid 의 'Query' 패널에서 보는 SQL
//! 이므로 inner 형태 그대로 (CAST/JSON_OBJECT 같은 wrapper 없음).

use futures_util::TryStreamExt;
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
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

/// PG queries.rs 와 동일 책무 — leading SQL comment 제거 후 SELECT/WITH
/// 등 prefix 매칭. byte-for-byte 동일 구현 (dialect-agnostic 헬퍼).
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

/// PG queries.rs 와 동일. `;` + whitespace 만 trail 에서 제거.
fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

// quote_ident / qualified_table 은 `super::mutations` 에 single-source.
// Phase 17 Slice D 이후 DDL/DML emitter 가 동일 helper 를 공유한다.

/// PG `pg_cast_type` 와 동일 책무 — column type 별 `CAST(? AS <type>)`
/// 의 target. MySQL 은 PG 만큼 type 분기가 필요하지 않음 (대부분 string
/// param 이 자동 coerce) — 단 DATE/DATETIME/DECIMAL/INT 만 명시 cast.
/// 단 MySQL `CAST(? AS INT)` 는 INT 의 sub-name, MySQL 8.0 에서
/// `SIGNED INTEGER` 가 canonical 이라 그걸로.
fn mysql_cast_type(data_type: &str) -> Option<&'static str> {
    // `column_type` 은 `int(11)` 같은 form — base keyword 만 추출.
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
        "float" | "double" | "real" => None, // MySQL 자동 coerce
        "date" => Some("DATE"),
        "datetime" | "timestamp" => Some("DATETIME"),
        "time" => Some("TIME"),
        _ => None,
    }
}

/// row 의 idx 번째 cell 을 column type-info 보고 `serde_json::Value` 로
/// decode. 실패 시 try_get_unchecked<String> fallback → 그래도 실패하면
/// Null. sqlx MysqlValueRef 의 raw bytes 접근은 unsafe 라 피하고, public
/// `try_get` API 만 사용.
fn cell_to_json(row: &sqlx::mysql::MySqlRow, idx: usize) -> serde_json::Value {
    // NULL 우선 처리 — try_get::<Option<String>> 으로 가장 광범위한 path.
    // 이 패턴은 PG queries.rs 의 row_to_json 결과의 null 분기와 동일.
    let type_name = row.column(idx).type_info().name().to_ascii_uppercase();

    macro_rules! try_decode {
        ($t:ty, $f:expr) => {
            if let Ok(Some(v)) = row.try_get::<Option<$t>, _>(idx) {
                return ($f)(v);
            }
        };
    }

    // type-name 기반 분기. MySQL TypeInfo 의 name() 은 대문자 keyword
    // (`"INT"`, `"VARCHAR"`, `"DATETIME"`, `"JSON"`, `"BLOB"` 등).
    match type_name.as_str() {
        "TINYINT" | "BOOLEAN" => {
            // TINYINT(1) 는 BOOLEAN 의 fingerprint — bool 로 decode 시도,
            // 실패 시 i64.
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
                return serde_json::Value::Bool(v);
            }
            try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
        }
        "BIGINT" | "BIGINT UNSIGNED" => {
            // ADR 0026 (issue #1082) — BIGINT (i64) 및 BIGINT UNSIGNED (u64) 는
            // ±(2^53-1) 을 넘을 수 있어 raw JSON number 로 wire 하면 프론트의
            // native JSON.parse 가 f64 로 강등하며 무음 손상시킨다. PG bigint 와
            // 동일하게 정밀도-보존 JSON string token 으로 직렬화하고, 프론트
            // wrapNumericCells 가 컬럼 data_type 을 보고 BigInt 로 승격한다.
            // sqlx-mysql 0.8.6 의 type_info().name() 은 unsigned 를
            // `"BIGINT UNSIGNED"` 로 report 한다 (vendored column.rs L180) —
            // signed 만 매치하면 unsigned 는 wildcard 로 떨어져 String decode
            // 실패 → Null 값 소실. 대형 auto-inc PK 관용형이라 명시 매치 필수.
            try_decode!(i64, |v: i64| serde_json::Value::String(v.to_string()));
            try_decode!(u64, |v: u64| serde_json::Value::String(v.to_string()));
        }
        "SMALLINT" | "SMALLINT UNSIGNED" | "MEDIUMINT" | "MEDIUMINT UNSIGNED" | "INT"
        | "INT UNSIGNED" | "INTEGER" | "YEAR" | "TINYINT UNSIGNED" => {
            // 전부 ≤32bit (u32 max 4_294_967_295 < 2^53) 라 f64 로 무손실 round-
            // trip — raw Number 유지. unsigned 변형은 sqlx-mysql 이 별도 keyword
            // (`"INT UNSIGNED"` 등, vendored column.rs L176-179) 로 report 하므로
            // 명시 매치해야 wildcard 로 떨어져 Null 값 소실되는 것을 막는다.
            // signed 우선 (i64) → 실패 시 u64.
            try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
            try_decode!(u64, |v: u64| serde_json::Value::Number(v.into()));
        }
        "BIT" => {
            // BIT(N) 는 sqlx-mysql 에서 u64 로 decode.
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
            // Sprint 296 follow-up — sqlx-mysql 의 prepared statement binary
            // protocol 은 DECIMAL → String 자동 디코드를 제공하지 않는다 (이전
            // 가정 오류 — Sprint 296 ignored test 가 노출). Cargo `bigdecimal`
            // feature 를 enable 한 후 `BigDecimal::to_string()` 으로 정밀도-
            // 손실 없는 base-10 string 으로 변환. ADR 0026 (PG) 와 동일한
            // wire format (JSON string) 유지.
            try_decode!(sqlx::types::BigDecimal, |v: sqlx::types::BigDecimal| {
                serde_json::Value::String(v.to_string())
            });
            // 일부 driver path 가 ASCII string 으로 직접 노출하는 경우 (legacy
            // text protocol) fallback.
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
            // Slice B-1 — binary 는 hex 로 string 화 (사용자 grid 가 표시 가능
            // 한 surface). Slice E (constraint / type-aware editor) 합류 시
            // base64 + raw 분리 surface 검토.
            try_decode!(Vec<u8>, |v: Vec<u8>| serde_json::Value::String(format!(
                "0x{}",
                hex_encode(&v)
            )));
        }
        // VARCHAR / CHAR / TEXT / MEDIUMTEXT / LONGTEXT / TINYTEXT / ENUM / SET /
        // 그 외 모든 알 수 없는 keyword 는 String 으로 시도.
        _ => {
            try_decode!(String, serde_json::Value::String);
        }
    }

    // 위 모든 path 가 실패하면 String fallback 한 번 더.
    if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
        return serde_json::Value::String(v);
    }
    serde_json::Value::Null
}

/// `hex` crate 의존성을 피하기 위한 minimal hex encoder. Slice B-1 의
/// BLOB 표시용 — 사용자 grid 가 cell 값을 `0x...` 로 인식하면 충분.
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(*b >> 4) as usize] as char);
        out.push(HEX[(*b & 0x0f) as usize] as char);
    }
    out
}

/// raw WHERE 입력 검증. 공통 AST validator 가 fragment 를 dialect SELECT 에
/// 감싸서 boolean expression 만 허용한다.
fn validate_raw_where(rw: &str) -> Result<(), AppError> {
    validate_raw_where_clause(RawWhereDialect::Mysql, rw)
}

impl MysqlAdapter {
    /// Free-form SQL 실행. PG `execute_query` 와 동일 contract:
    /// SELECT/WITH/SHOW/EXPLAIN/DESCRIBE/CALL → `QueryType::Select` +
    /// columns + rows; INSERT/UPDATE/DELETE → `QueryType::Dml { rows_affected }`;
    /// 그 외 → `QueryType::Ddl`.
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<QueryResult, AppError> {
        self.execute_query_tracked(query, cancel_token, None).await
    }

    /// Issue #1230 — `execute_query` variant that pins one pooled connection
    /// and, when `pid_tx` is `Some`, sends its `CONNECTION_ID()` thread id
    /// before the statement runs so `KILL QUERY <id>` can abort a long query.
    /// The statement runs on that SAME connection. `None` keeps the pooled
    /// fast-path used by batch / schema callers.
    pub async fn execute_query_tracked(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        pid_tx: Option<tokio::sync::oneshot::Sender<i64>>,
    ) -> Result<QueryResult, AppError> {
        let start = std::time::Instant::now();

        let query = strip_trailing_terminator(query);
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }

        // Detect query type — DESCRIBE / DESC 는 MySQL 의 SELECT-equivalent
        // 라 columns + rows 를 돌려준다 (PG 에는 없는 dialect-specific).
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
                    let rows = sqlx::query(query)
                        .fetch_all(&mut *conn)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;

                    let columns: Vec<QueryColumn> = if let Some(first_row) = rows.first() {
                        first_row
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
                            .collect()
                    } else {
                        Vec::new()
                    };

                    let json_rows: Vec<Vec<serde_json::Value>> = rows
                        .iter()
                        .map(|row| {
                            (0..row.columns().len())
                                .map(|idx| cell_to_json(row, idx))
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

    /// Paged table 데이터. PG `query_table_data` 와 동일 contract — filters /
    /// order_by / raw_where 의 의미와 fallback 정책까지 동일. Dialect 차이:
    /// `?` placeholder + backtick quoting + DESC tiebreaker 도 동일.
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
            table, schema, page, page_size, order_by, filters, raw_where,
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
    ) -> Result<TableData, AppError> {
        let pool = self.active_pool().await?;

        let columns = self.get_table_columns_inner(&pool, table, schema).await?;

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
                                    // MySQL 의 placeholder 는 `?` — index 가
                                    // 필요 없음. PG 의 `::type` cast 대신
                                    // `CAST(? AS <type>)` 로 wrap.
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
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let offset = (page - 1).max(0) * page_size;

        // ORDER BY — PG queries.rs 와 동일 parsing 정책. PK tiebreaker 도 동일.
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
                    [col, dir] if *dir == "ASC" || *dir == "DESC" => (*col, *dir),
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
            // PG `build_default_order_clause` 와 동일 — PK column ASC.
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
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // column 명 → ColumnInfo 인덱스 매핑. row 의 column 순서가 schema
        // 순서와 다를 수 있으므로 (`SELECT *` 는 보통 동일하나 보수적으로
        // 명시 매핑).
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

    /// Sprint 283 (Slice C) — row streaming. PG `stream_table_rows` 의 MySQL
    /// 짝꿍. MySQL 은 stored procedure 외에선 server-side cursor 가 없어 PG
    /// 의 `DECLARE NO SCROLL CURSOR FOR …; FETCH FORWARD` 패턴 그대로는
    /// 불가능 — `sqlx::query.fetch()` 의 async row stream 으로 등가 구현
    /// (sqlx-mysql 은 내부적으로 prepared statement 단위로 row chunk 단위
    /// 수신을 한다). Batch 마다 `cancel.is_cancelled()` 와 `sender.send`
    /// 실패를 체크해 cooperatively abort.
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

        // Transaction-wrap 으로 consistent snapshot (InnoDB REPEATABLE READ).
        // PG 와 동일 의도 — long export 가 다른 commit 에 흔들리지 않게.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(format!("BEGIN failed: {e}")))?;

        let qualified = qualified_table(schema, table);
        // 컬럼 선택은 `column_names` 순서 — 호출자가 source order 를 결정.
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
        // tail flush — 마지막 batch_size 미만의 잔량.
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

    /// Sprint 285 (Slice E) — `SELECT COUNT(*) FROM qualified WHERE col IS NULL`.
    /// PG `count_null_rows` 와 contract 동일.
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

    /// Sprint 288 — PG `execute_query_batch` 의 MySQL 대응. 모든 statement
    /// 를 단일 transaction (BEGIN/COMMIT) 안에서 순차 실행. 실패 시 ROLLBACK.
    ///
    /// MySQL 한계: DDL statement (CREATE/ALTER/DROP/RENAME) 은 implicit
    /// commit 하므로 후속 statement 실패해도 rollback 되지 않음. 본 batch
    /// path 는 commit-pipeline (DML) 용도가 주이며, 호출자가 DDL/DML 혼합
    /// 을 시도하면 부분-적용이 가능함을 user-facing copy 에서 안내한다.
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

    /// Sprint 288 — PG `dry_run_query_batch` 의 MySQL 대응. BEGIN → 실행 →
    /// 무조건 ROLLBACK. PG 와 동일하게 DML 의 rows_affected 통계만 보고
    /// 실제 row 변경은 남기지 않는다.
    ///
    /// MySQL 한계: DDL 은 implicit commit 이라 dry-run 이 실제 schema 변
    /// 경을 막지 못함 — destructive-confirm 다이얼로그 (ADR 0022) 는 DML
    /// 전용 use case 라 본 path 가 충분히 안전. DDL preview 는 `preview_only`
    /// flag 를 통해 SQL emission 만 수행하는 별도 경로를 쓴다.
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
    //! 작성 이유 (2026-05-13, Sprint 282): 본 파일의 pure helper 들
    //! (strip_leading_comments / strip_trailing_terminator / quote_ident /
    //! qualified / mysql_cast_type / validate_raw_where / hex_encode) 은 실
    //! DB 없이도 회귀 가드 가능. execute_query / query_table_data 의 실 DB
    //! integration 은 Sprint 282 후속에서 `mysql_test_config` opt-in 으로.
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

    // quote_ident / qualified_table 회귀 가드는 mutations.rs 의 unit test
    // 에서 single-source — 본 파일은 dialect-cast 와 raw_where validator,
    // 그리고 SELECT/DML 분기 helper 들만 책임.

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

    #[test]
    fn hex_encode_lower_two_chars_per_byte() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab]), "00ffab");
        assert_eq!(hex_encode(&[]), "");
    }
}
