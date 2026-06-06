use std::collections::HashSet;
use std::time::Instant;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::TryStreamExt;
use serde_json::Value;
use tiberius::{Client, ColumnType, QueryItem, Row};
use tokio::net::TcpStream;
use tokio_util::compat::Compat;
use tokio_util::sync::CancellationToken;

use crate::db::BoxFuture;
use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConnectionConfig, FilterCondition, FilterOperator, QueryColumn, QueryResult,
    QueryType, TableData,
};

use super::support::{
    json_i64, map_mssql_data_type, mssql_db_error, qualified_table, quote_ident, sql_string,
    validate_identifier,
};
use super::MssqlAdapter;

impl MssqlAdapter {
    pub(super) async fn query_select(
        config: &ConnectionConfig,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let started = Instant::now();
        let mut client = Self::connect_client(config).await?;
        let mut stream = client
            .simple_query(sql)
            .await
            .map_err(|err| mssql_db_error("SQL Server query failed", err))?;

        let mut result_index: Option<usize> = None;
        let mut columns: Vec<QueryColumn> = Vec::new();
        let mut rows: Vec<Vec<Value>> = Vec::new();

        while let Some(item) = stream
            .try_next()
            .await
            .map_err(|err| mssql_db_error("SQL Server result read failed", err))?
        {
            match item {
                QueryItem::Metadata(metadata) => {
                    if result_index.is_some_and(|idx| idx != metadata.result_index()) {
                        break;
                    }
                    result_index = Some(metadata.result_index());
                    if columns.is_empty() {
                        columns = metadata.columns().iter().map(mssql_query_column).collect();
                    }
                }
                QueryItem::Row(row) => {
                    if columns.is_empty() {
                        columns = row.columns().iter().map(mssql_query_column).collect();
                    }
                    rows.push(mssql_row_to_json(&row));
                }
            }
        }

        Ok(QueryResult {
            columns,
            total_count: rows.len() as i64,
            rows,
            execution_time_ms: started.elapsed().as_millis() as u64,
            query_type: QueryType::Select,
        })
    }

    pub(super) async fn execute_statement(
        config: &ConnectionConfig,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let trimmed = strip_trailing_terminator(strip_leading_comments(sql)).trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "SQL statement must not be empty".into(),
            ));
        }
        if is_select_like(trimmed) {
            return Self::query_select(config, sql).await;
        }

        let started = Instant::now();
        let mut client = Self::connect_client(config).await?;
        let rows_affected = client
            .execute(sql, &[])
            .await
            .map_err(|err| mssql_db_error("SQL Server statement failed", err))?
            .total();

        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            total_count: rows_affected as i64,
            execution_time_ms: started.elapsed().as_millis() as u64,
            query_type: classify_mutation(trimmed, rows_affected),
        })
    }

    pub(super) async fn execute_statement_with_client(
        client: &mut Client<Compat<TcpStream>>,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let trimmed = strip_trailing_terminator(strip_leading_comments(sql)).trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "SQL statement must not be empty".into(),
            ));
        }
        if is_select_like(trimmed) {
            let started = Instant::now();
            let mut stream = client
                .simple_query(sql)
                .await
                .map_err(|err| mssql_db_error("SQL Server query failed", err))?;
            let mut columns: Vec<QueryColumn> = Vec::new();
            let mut rows: Vec<Vec<Value>> = Vec::new();
            let mut result_index: Option<usize> = None;
            while let Some(item) = stream
                .try_next()
                .await
                .map_err(|err| mssql_db_error("SQL Server result read failed", err))?
            {
                match item {
                    QueryItem::Metadata(metadata) => {
                        if result_index.is_some_and(|idx| idx != metadata.result_index()) {
                            break;
                        }
                        result_index = Some(metadata.result_index());
                        if columns.is_empty() {
                            columns = metadata.columns().iter().map(mssql_query_column).collect();
                        }
                    }
                    QueryItem::Row(row) => {
                        if columns.is_empty() {
                            columns = row.columns().iter().map(mssql_query_column).collect();
                        }
                        rows.push(mssql_row_to_json(&row));
                    }
                }
            }
            return Ok(QueryResult {
                columns,
                total_count: rows.len() as i64,
                rows,
                execution_time_ms: started.elapsed().as_millis() as u64,
                query_type: QueryType::Select,
            });
        }

        let started = Instant::now();
        let rows_affected = client
            .execute(sql, &[])
            .await
            .map_err(|err| mssql_db_error("SQL Server statement failed", err))?
            .total();
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            total_count: rows_affected as i64,
            execution_time_ms: started.elapsed().as_millis() as u64,
            query_type: classify_mutation(trimmed, rows_affected),
        })
    }

    pub(super) fn execute_sql_box<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let work = Self::execute_statement(&config, sql);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    pub(super) fn execute_sql_batch_box<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move {
            if statements.is_empty() {
                return Ok(Vec::new());
            }
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let mut client = Self::connect_client(&config).await?;
            client
                .simple_query("BEGIN TRANSACTION")
                .await
                .map_err(|err| mssql_db_error("SQL Server BEGIN failed", err))?
                .into_results()
                .await
                .map_err(|err| mssql_db_error("SQL Server BEGIN failed", err))?;

            let mut results = Vec::with_capacity(statements.len());
            for statement in statements {
                if let Some(token) = cancel {
                    if token.is_cancelled() {
                        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
                        return Err(AppError::Database("Operation cancelled".into()));
                    }
                }
                match Self::execute_statement_with_client(&mut client, statement).await {
                    Ok(result) => results.push(result),
                    Err(err) => {
                        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
                        return Err(err);
                    }
                }
            }
            client
                .simple_query("COMMIT TRANSACTION")
                .await
                .map_err(|err| mssql_db_error("SQL Server COMMIT failed", err))?
                .into_results()
                .await
                .map_err(|err| mssql_db_error("SQL Server COMMIT failed", err))?;
            Ok(results)
        })
    }

    pub(super) fn dry_run_sql_batch_box<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move {
            if statements.is_empty() {
                return Ok(Vec::new());
            }
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let mut client = Self::connect_client(&config).await?;
            client
                .simple_query("BEGIN TRANSACTION")
                .await
                .map_err(|err| mssql_db_error("SQL Server BEGIN failed", err))?
                .into_results()
                .await
                .map_err(|err| mssql_db_error("SQL Server BEGIN failed", err))?;

            let mut results = Vec::with_capacity(statements.len());
            for statement in statements {
                if let Some(token) = cancel {
                    if token.is_cancelled() {
                        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
                        return Err(AppError::Database("Operation cancelled".into()));
                    }
                }
                match Self::execute_statement_with_client(&mut client, statement).await {
                    Ok(result) => results.push(result),
                    Err(err) => {
                        let _ = client.simple_query("ROLLBACK TRANSACTION").await;
                        return Err(err);
                    }
                }
            }
            client
                .simple_query("ROLLBACK TRANSACTION")
                .await
                .map_err(|err| mssql_db_error("SQL Server ROLLBACK failed", err))?
                .into_results()
                .await
                .map_err(|err| mssql_db_error("SQL Server ROLLBACK failed", err))?;
            Ok(results)
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn query_table_data_box<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            validate_identifier(namespace, "Schema name")?;
            validate_identifier(table, "Table name")?;
            let config = self.connected_config().await?;
            let columns = Self::table_columns_inner(&config, namespace, table).await?;
            let valid_columns: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
            let where_clause = build_where_clause(&valid_columns, filters, raw_where)?;
            let qualified = qualified_table(namespace, table);
            let count_sql = format!("SELECT COUNT_BIG(*) FROM {qualified}{where_clause}");
            let count_result = Self::query_select(&config, &count_sql).await?;
            let total_count = count_result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|value| json_i64(Some(value)))
                .unwrap_or(0);

            let offset = (page - 1).max(0) * page_size.max(1);
            let order_clause = build_order_clause(order_by, &columns);
            let executed_query = format!(
                "SELECT * FROM {qualified}{where_clause}{order_clause} OFFSET {offset} ROWS FETCH NEXT {} ROWS ONLY",
                page_size.max(1)
            );
            let work = Self::query_select(&config, &executed_query);
            let result = match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }?;
            Ok(TableData {
                columns,
                rows: result.rows,
                total_count,
                page,
                page_size,
                executed_query,
            })
        })
    }
}

fn mssql_query_column(column: &tiberius::Column) -> QueryColumn {
    let data_type = format!("{:?}", column.column_type()).to_ascii_lowercase();
    QueryColumn {
        name: column.name().to_string(),
        category: map_mssql_data_type(&data_type),
        data_type,
    }
}

fn mssql_row_to_json(row: &Row) -> Vec<Value> {
    (0..row.columns().len())
        .map(|idx| mssql_cell_to_json(row, idx))
        .collect()
}

fn mssql_cell_to_json(row: &Row, idx: usize) -> Value {
    macro_rules! try_opt {
        ($t:ty, $map:expr) => {
            if let Ok(Some(value)) = row.try_get::<$t, _>(idx) {
                return ($map)(value);
            }
        };
    }

    match row.columns()[idx].column_type() {
        ColumnType::Bit | ColumnType::Bitn => {
            try_opt!(bool, Value::Bool);
        }
        ColumnType::Int1 => {
            try_opt!(u8, |v: u8| Value::Number(v.into()));
        }
        ColumnType::Int2 => {
            try_opt!(i16, |v: i16| Value::Number(v.into()));
        }
        ColumnType::Int4 | ColumnType::Intn => {
            try_opt!(i32, |v: i32| Value::Number(v.into()));
            try_opt!(i64, |v: i64| Value::Number(v.into()));
        }
        ColumnType::Int8 => {
            try_opt!(i64, |v: i64| Value::Number(v.into()));
        }
        ColumnType::Float4 => {
            try_opt!(f32, |v: f32| serde_json::Number::from_f64(v as f64)
                .map(Value::Number)
                .unwrap_or(Value::Null));
        }
        ColumnType::Float8 | ColumnType::Floatn => {
            try_opt!(f64, |v: f64| serde_json::Number::from_f64(v)
                .map(Value::Number)
                .unwrap_or(Value::Null));
        }
        ColumnType::Decimaln | ColumnType::Numericn | ColumnType::Money | ColumnType::Money4 => {
            try_opt!(
                tiberius::numeric::BigDecimal,
                |v: tiberius::numeric::BigDecimal| { Value::String(v.to_string()) }
            );
        }
        ColumnType::Guid => {
            try_opt!(tiberius::Uuid, |v: tiberius::Uuid| Value::String(
                v.to_string()
            ));
        }
        ColumnType::Daten => {
            try_opt!(
                tiberius::time::chrono::NaiveDate,
                |v: tiberius::time::chrono::NaiveDate| { Value::String(v.to_string()) }
            );
        }
        ColumnType::Timen => {
            try_opt!(
                tiberius::time::chrono::NaiveTime,
                |v: tiberius::time::chrono::NaiveTime| { Value::String(v.to_string()) }
            );
        }
        ColumnType::Datetime
        | ColumnType::Datetime2
        | ColumnType::Datetime4
        | ColumnType::Datetimen => {
            try_opt!(
                tiberius::time::chrono::NaiveDateTime,
                |v: tiberius::time::chrono::NaiveDateTime| Value::String(v.to_string())
            );
        }
        ColumnType::DatetimeOffsetn => {
            try_opt!(
                tiberius::time::chrono::DateTime<tiberius::time::chrono::FixedOffset>,
                |v: tiberius::time::chrono::DateTime<tiberius::time::chrono::FixedOffset>| {
                    Value::String(v.to_rfc3339())
                }
            );
        }
        ColumnType::BigVarBin | ColumnType::BigBinary | ColumnType::Image => {
            try_opt!(&[u8], |v: &[u8]| Value::String(BASE64.encode(v)));
        }
        _ => {}
    }

    try_opt!(&str, |v: &str| Value::String(v.to_string()));
    try_opt!(i64, |v: i64| Value::Number(v.into()));
    try_opt!(i32, |v: i32| Value::Number(v.into()));
    try_opt!(f64, |v: f64| serde_json::Number::from_f64(v)
        .map(Value::Number)
        .unwrap_or(Value::Null));
    Value::Null
}

pub(super) fn strip_leading_comments(sql: &str) -> &str {
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

pub(super) fn is_select_like(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    ["SELECT", "WITH", "EXEC", "DECLARE"].iter().any(|kw| {
        upper.strip_prefix(kw).is_some_and(|rest| {
            rest.chars()
                .next()
                .is_none_or(|ch| !ch.is_ascii_alphanumeric())
        })
    })
}

pub(super) fn classify_mutation(sql: &str, rows_affected: u64) -> QueryType {
    let upper = sql.trim_start().to_ascii_uppercase();
    if ["INSERT", "UPDATE", "DELETE", "MERGE"].iter().any(|kw| {
        upper.strip_prefix(kw).is_some_and(|rest| {
            rest.chars()
                .next()
                .is_none_or(|ch| !ch.is_ascii_alphanumeric())
        })
    }) {
        QueryType::Dml { rows_affected }
    } else {
        QueryType::Ddl
    }
}

pub(super) fn validate_raw_where(raw: &str) -> Result<(), AppError> {
    let trimmed = raw.trim();
    if trimmed.contains(';') || trimmed.contains("--") || trimmed.contains("/*") {
        return Err(AppError::Validation(
            "Raw WHERE clause must not contain semicolons or SQL comments".into(),
        ));
    }
    let upper = trimmed.to_ascii_uppercase();
    for keyword in [
        "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
    ] {
        if upper.starts_with(keyword) {
            return Err(AppError::Validation(format!(
                "Raw WHERE clause must not start with {keyword}"
            )));
        }
    }
    Ok(())
}

pub(super) fn build_where_clause(
    valid_columns: &HashSet<&str>,
    filters: Option<&[FilterCondition]>,
    raw_where: Option<&str>,
) -> Result<String, AppError> {
    if let Some(raw) = raw_where.map(str::trim).filter(|s| !s.is_empty()) {
        validate_raw_where(raw)?;
        return Ok(format!(" WHERE {raw}"));
    }
    let mut conditions = Vec::new();
    if let Some(filters) = filters {
        for filter in filters {
            if !valid_columns.contains(filter.column.as_str()) {
                continue;
            }
            let col = quote_ident(&filter.column);
            match filter.operator {
                FilterOperator::IsNull => conditions.push(format!("{col} IS NULL")),
                FilterOperator::IsNotNull => conditions.push(format!("{col} IS NOT NULL")),
                _ => {
                    let op = match filter.operator {
                        FilterOperator::Eq => "=",
                        FilterOperator::Neq => "<>",
                        FilterOperator::Gt => ">",
                        FilterOperator::Lt => "<",
                        FilterOperator::Gte => ">=",
                        FilterOperator::Lte => "<=",
                        FilterOperator::Like => "LIKE",
                        FilterOperator::IsNull | FilterOperator::IsNotNull => unreachable!(),
                    };
                    if let Some(value) = &filter.value {
                        conditions.push(format!("{col} {op} {}", sql_string(value)));
                    }
                }
            }
        }
    }
    if conditions.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!(" WHERE {}", conditions.join(" AND ")))
    }
}

pub(super) fn build_order_clause(order_by: Option<&str>, columns: &[ColumnInfo]) -> String {
    let valid_columns: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    let mut parts = Vec::new();
    if let Some(order_by) = order_by {
        for part in order_by.split(',') {
            let tokens: Vec<&str> = part.split_whitespace().collect();
            let (column, direction) = match tokens.as_slice() {
                [column] => (*column, "ASC"),
                [column, direction] if direction.eq_ignore_ascii_case("ASC") => (*column, "ASC"),
                [column, direction] if direction.eq_ignore_ascii_case("DESC") => (*column, "DESC"),
                _ => continue,
            };
            if valid_columns.contains(column) {
                parts.push(format!("{} {direction}", quote_ident(column)));
            }
        }
    }
    if parts.is_empty() {
        for column in columns.iter().filter(|c| c.is_primary_key) {
            parts.push(format!("{} ASC", quote_ident(&column.name)));
        }
    }
    if parts.is_empty() {
        " ORDER BY (SELECT NULL)".into()
    } else {
        format!(" ORDER BY {}", parts.join(", "))
    }
}
