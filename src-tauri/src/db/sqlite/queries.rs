//! SQLite free-form query execution and table preview.

use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, TypeInfo};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::connection::{
    quote_identifier, sqlite_column_category, validate_namespace, SqliteAdapter,
};

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

pub(super) fn strip_trailing_terminator(sql: &str) -> &str {
    sql.trim_end_matches(|c: char| c == ';' || c.is_whitespace())
}

fn validate_raw_where(rw: &str) -> Result<(), AppError> {
    if rw.contains(';') {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain semicolons".into(),
        ));
    }
    let upper = rw.to_uppercase();
    let dangerous_starts = [
        "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
    ];
    for keyword in &dangerous_starts {
        if upper.starts_with(keyword) {
            return Err(AppError::Validation(format!(
                "Raw WHERE clause must not start with {}",
                keyword
            )));
        }
    }
    Ok(())
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
            try_decode!(i64, |v: i64| serde_json::Value::Number(v.into()));
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

fn sqlite_query_type(sql: &str) -> QueryType {
    let stripped = strip_leading_comments(sql).to_uppercase();
    if stripped.starts_with("SELECT")
        || stripped.starts_with("WITH")
        || stripped.starts_with("PRAGMA")
        || stripped.starts_with("EXPLAIN")
    {
        QueryType::Select
    } else if stripped.starts_with("INSERT")
        || stripped.starts_with("UPDATE")
        || stripped.starts_with("DELETE")
        || stripped.starts_with("REPLACE")
    {
        QueryType::Dml { rows_affected: 0 }
    } else {
        QueryType::Ddl
    }
}

impl SqliteAdapter {
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
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

        let pool = self.active_pool().await?;
        let query_type = sqlite_query_type(query);

        let work = async {
            match query_type {
                QueryType::Select => {
                    let rows = sqlx::query(query)
                        .fetch_all(&pool)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;

                    let columns = rows.first().map(sqlite_query_columns).unwrap_or_default();
                    let json_rows = rows
                        .iter()
                        .map(|row| {
                            (0..row.columns().len())
                                .map(|idx| cell_to_json(row, idx))
                                .collect()
                        })
                        .collect::<Vec<Vec<serde_json::Value>>>();
                    let total_count = json_rows.len() as i64;
                    Ok(QueryResult {
                        columns,
                        rows: json_rows,
                        total_count,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Select,
                    })
                }
                QueryType::Dml { .. } => {
                    let result = sqlx::query(query)
                        .execute(&pool)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    let rows_affected = result.rows_affected();
                    Ok(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: rows_affected as i64,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Dml { rows_affected },
                    })
                }
                QueryType::Ddl => {
                    sqlx::query(query)
                        .execute(&pool)
                        .await
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    Ok(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: 0,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Ddl,
                    })
                }
            }
        };

        match cancel_token {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Query cancelled".into())),
            },
            None => work.await,
        }
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
