use std::collections::HashSet;

use futures_util::TryStreamExt;
use tiberius::{
    time::chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime},
    Column, ColumnData, ColumnType, QueryItem, Row, ToSql,
};
use tokio_util::sync::CancellationToken;

use crate::db::raw_where::{validate_raw_where_clause, RawWhereDialect};
use crate::error::AppError;
use crate::models::{
    ColumnCategory, FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::MssqlAdapter;

enum BatchMode {
    Commit,
    Rollback,
}

impl MssqlAdapter {
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
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
        if has_internal_statement_separator(query) || has_mssql_batch_separator(query) {
            return Err(mssql_runtime_statement_unsupported());
        }

        let query_type = mssql_query_type(query);
        if matches!(&query_type, QueryType::Ddl) {
            return Err(mssql_runtime_statement_unsupported());
        }

        let config = self.connected_config().await?;
        let start = std::time::Instant::now();

        let work = async {
            let mut client = Self::connect_client(&config).await?;
            match query_type {
                QueryType::Select => {
                    let mut stream = client
                        .simple_query(query)
                        .await
                        .map_err(|err| mssql_query_error("SQL Server SELECT failed", err))?;
                    let mut columns = Vec::new();
                    let mut rows = Vec::new();
                    let mut result_index = None;

                    while let Some(item) = stream
                        .try_next()
                        .await
                        .map_err(|err| mssql_query_error("SQL Server SELECT failed", err))?
                    {
                        match item {
                            QueryItem::Metadata(metadata) => {
                                let idx = metadata.result_index();
                                if result_index.is_some_and(|current| current != idx) {
                                    break;
                                }
                                result_index = Some(idx);
                                columns =
                                    metadata.columns().iter().map(mssql_query_column).collect();
                            }
                            QueryItem::Row(row) => {
                                let idx = row.result_index();
                                if result_index.is_some_and(|current| current != idx) {
                                    break;
                                }
                                result_index.get_or_insert(idx);
                                if columns.is_empty() {
                                    columns =
                                        row.columns().iter().map(mssql_query_column).collect();
                                }
                                rows.push(mssql_row_to_json(&row));
                            }
                        }
                    }

                    Ok(QueryResult {
                        total_count: rows.len() as i64,
                        columns,
                        rows,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Select,
                    })
                }
                QueryType::Dml { .. } => {
                    let rows_affected = client
                        .execute(query, &[])
                        .await
                        .map_err(|err| mssql_query_error("SQL Server DML failed", err))?
                        .total();
                    Ok(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: rows_affected as i64,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Dml { rows_affected },
                    })
                }
                QueryType::Ddl => Err(mssql_runtime_statement_unsupported()),
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

    #[allow(clippy::too_many_arguments)]
    pub async fn query_table_data(
        &self,
        schema: &str,
        table: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
        cancel_token: Option<&CancellationToken>,
    ) -> Result<TableData, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(table_query_cancelled());
        }

        let work = self.query_table_data_uncancelled(
            schema, table, page, page_size, order_by, filters, raw_where,
        );
        match cancel_token {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(table_query_cancelled()),
            },
            None => work.await,
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn query_table_data_uncancelled(
        &self,
        schema: &str,
        table: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
    ) -> Result<TableData, AppError> {
        let config = self.connected_config().await?;
        let columns = self.get_table_columns(schema, table).await?;
        let qualified = qualified_mssql_table(schema, table);
        let page_size = page_size.max(1);
        let offset = (page - 1).max(0) * page_size;

        if columns.is_empty() {
            return Ok(TableData {
                columns,
                rows: Vec::new(),
                total_count: 0,
                page,
                page_size,
                executed_query: format!(
                    "SELECT * FROM {qualified} ORDER BY (SELECT NULL) OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
                ),
            });
        }

        let raw_where_trimmed = raw_where.map(str::trim).filter(|rw| !rw.is_empty());
        if let Some(raw_where) = raw_where_trimmed {
            validate_raw_where_clause(RawWhereDialect::Mssql, raw_where)?;
        }

        let (where_clause, param_values) = if let Some(raw_where) = raw_where_trimmed {
            (format!(" WHERE {raw_where}"), Vec::<String>::new())
        } else {
            build_mssql_where_clause(&columns, filters)
        };
        let params: Vec<&dyn ToSql> = param_values
            .iter()
            .map(|value| value as &dyn ToSql)
            .collect();

        let count_sql = format!("SELECT COUNT_BIG(*) FROM {qualified}{where_clause}");
        let mut client = Self::connect_client(&config).await?;
        let count_rows = query_first_result(
            &mut client,
            "SQL Server table count failed",
            &count_sql,
            &params,
        )
        .await?;
        let total_count = count_rows
            .first()
            .map(|row| {
                row.try_get::<i64, _>(0).map_err(|err| {
                    AppError::Database(format!("SQL Server table count decode failed: {err}"))
                })
            })
            .transpose()?
            .flatten()
            .unwrap_or(0);

        let select_list = columns
            .iter()
            .map(|column| quote_mssql_identifier(&column.name))
            .collect::<Vec<_>>()
            .join(", ");
        let order_clause = build_mssql_order_clause(&columns, order_by);
        let executed_query = format!(
            "SELECT {select_list} FROM {qualified}{where_clause}{order_clause} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
        );
        let data_rows = query_first_result(
            &mut client,
            "SQL Server table data query failed",
            &executed_query,
            &params,
        )
        .await?;
        let rows = data_rows
            .into_iter()
            .map(|row| mssql_row_to_json(&row))
            .collect();

        Ok(TableData {
            columns,
            rows,
            total_count,
            page,
            page_size,
            executed_query,
        })
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
        for (idx, raw) in statements.iter().enumerate() {
            let statement = strip_trailing_terminator(raw);
            if statement.trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
            }
            if has_internal_statement_separator(statement)
                || has_mssql_batch_separator(statement)
                || !matches!(mssql_query_type(statement), QueryType::Dml { .. })
            {
                return Err(mssql_batch_statement_unsupported(idx + 1, statements.len()));
            }
        }

        let config = self.connected_config().await?;
        let total = statements.len();
        let work = async {
            let mut client = Self::connect_client(&config).await?;
            run_statement(&mut client, "BEGIN TRANSACTION").await?;

            let mut results = Vec::with_capacity(total);
            for (idx, raw) in statements.iter().enumerate() {
                let statement = strip_trailing_terminator(raw);
                let start = std::time::Instant::now();
                match client.execute(statement, &[]).await {
                    Ok(result) => {
                        let rows_affected = result.total();
                        results.push(QueryResult {
                            columns: Vec::new(),
                            rows: Vec::new(),
                            total_count: rows_affected as i64,
                            execution_time_ms: start.elapsed().as_millis() as u64,
                            query_type: QueryType::Dml { rows_affected },
                        });
                    }
                    Err(error) => {
                        let _ = run_statement(&mut client, "ROLLBACK TRANSACTION").await;
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
                BatchMode::Commit => run_statement(&mut client, "COMMIT TRANSACTION").await?,
                BatchMode::Rollback => run_statement(&mut client, "ROLLBACK TRANSACTION").await?,
            }

            Ok(results)
        };

        cancellable(work, cancel_token).await
    }
}

fn build_mssql_where_clause(
    columns: &[crate::models::ColumnInfo],
    filters: Option<&[FilterCondition]>,
) -> (String, Vec<String>) {
    let Some(filters) = filters else {
        return (String::new(), Vec::new());
    };
    if filters.is_empty() {
        return (String::new(), Vec::new());
    }

    let valid_columns: HashSet<&str> = columns.iter().map(|column| column.name.as_str()).collect();
    let mut param_values = Vec::new();
    let mut conditions = Vec::new();

    for filter in filters {
        if !valid_columns.contains(filter.column.as_str()) {
            continue;
        }

        let column = quote_mssql_identifier(&filter.column);
        match filter.operator {
            FilterOperator::IsNull => conditions.push(format!("{column} IS NULL")),
            FilterOperator::IsNotNull => conditions.push(format!("{column} IS NOT NULL")),
            _ => {
                let Some(value) = &filter.value else {
                    continue;
                };
                let Some(operator) = mssql_filter_operator(&filter.operator) else {
                    continue;
                };
                let placeholder = format!("@P{}", param_values.len() + 1);
                conditions.push(format!("{column} {operator} {placeholder}"));
                param_values.push(value.clone());
            }
        }
    }

    if conditions.is_empty() {
        (String::new(), param_values)
    } else {
        (format!(" WHERE {}", conditions.join(" AND ")), param_values)
    }
}

fn mssql_filter_operator(operator: &FilterOperator) -> Option<&'static str> {
    match operator {
        FilterOperator::Eq => Some("="),
        FilterOperator::Neq => Some("<>"),
        FilterOperator::Gt => Some(">"),
        FilterOperator::Lt => Some("<"),
        FilterOperator::Gte => Some(">="),
        FilterOperator::Lte => Some("<="),
        FilterOperator::Like => Some("LIKE"),
        FilterOperator::IsNull | FilterOperator::IsNotNull => None,
    }
}

fn build_mssql_order_clause(
    columns: &[crate::models::ColumnInfo],
    order_by: Option<&str>,
) -> String {
    let valid_columns: HashSet<&str> = columns.iter().map(|column| column.name.as_str()).collect();
    let mut user_sort_columns = HashSet::new();
    let mut order_parts = Vec::new();

    if let Some(order_by) = order_by {
        for part in order_by.split(',') {
            let parts: Vec<&str> = part.split_whitespace().collect();
            let (column, direction) = match parts.as_slice() {
                [column, direction]
                    if direction.eq_ignore_ascii_case("ASC")
                        || direction.eq_ignore_ascii_case("DESC") =>
                {
                    (*column, direction.to_ascii_uppercase())
                }
                [column] => (*column, "ASC".to_string()),
                _ => continue,
            };
            if valid_columns.contains(column) {
                order_parts.push(format!("{} {}", quote_mssql_identifier(column), direction));
                user_sort_columns.insert(column.to_string());
            }
        }
    }

    let pk_tiebreakers = columns
        .iter()
        .filter(|column| column.is_primary_key && !user_sort_columns.contains(&column.name))
        .map(|column| format!("{} ASC", quote_mssql_identifier(&column.name)));
    order_parts.extend(pk_tiebreakers);

    if order_parts.is_empty() {
        " ORDER BY (SELECT NULL)".to_string()
    } else {
        format!(" ORDER BY {}", order_parts.join(", "))
    }
}

fn qualified_mssql_table(schema: &str, table: &str) -> String {
    if schema.trim().is_empty() {
        quote_mssql_identifier(table)
    } else {
        format!(
            "{}.{}",
            quote_mssql_identifier(schema),
            quote_mssql_identifier(table)
        )
    }
}

fn quote_mssql_identifier(value: &str) -> String {
    format!("[{}]", value.replace(']', "]]"))
}

async fn query_first_result(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    context: &'static str,
    sql: &str,
    params: &[&dyn ToSql],
) -> Result<Vec<Row>, AppError> {
    client
        .query(sql, params)
        .await
        .map_err(|err| mssql_query_error(context, err))?
        .into_first_result()
        .await
        .map_err(|err| mssql_query_error(context, err))
}

async fn cancellable<T>(
    work: impl std::future::Future<Output = Result<T, AppError>>,
    cancel_token: Option<&CancellationToken>,
) -> Result<T, AppError> {
    match cancel_token {
        Some(token) => tokio::select! {
            result = work => result,
            _ = token.cancelled() => Err(query_cancelled()),
        },
        None => work.await,
    }
}

async fn run_statement(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    sql: &str,
) -> Result<(), AppError> {
    client
        .simple_query(sql)
        .await
        .map_err(|err| mssql_query_error("SQL Server transaction control failed", err))?
        .into_results()
        .await
        .map_err(|err| mssql_query_error("SQL Server transaction control failed", err))?;
    Ok(())
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

fn has_internal_statement_separator(sql: &str) -> bool {
    strip_trailing_terminator(sql).contains(';')
}

fn has_mssql_batch_separator(sql: &str) -> bool {
    strip_leading_comments(sql).lines().any(|line| {
        let line = line
            .split("--")
            .next()
            .unwrap_or(line)
            .split("/*")
            .next()
            .unwrap_or(line);
        let parts = line
            .trim()
            .trim_end_matches(';')
            .split_whitespace()
            .collect::<Vec<_>>();
        match parts.as_slice() {
            [head] => head.eq_ignore_ascii_case("GO"),
            [head, count] => head.eq_ignore_ascii_case("GO") && count.parse::<u32>().is_ok(),
            _ => false,
        }
    })
}

fn mssql_query_type(query: &str) -> QueryType {
    let trimmed = strip_leading_comments(query).to_uppercase();
    if trimmed.starts_with("SELECT") || is_mssql_select_with_query(&trimmed) {
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

fn is_mssql_select_with_query(trimmed_upper: &str) -> bool {
    if !trimmed_upper.starts_with("WITH") {
        return false;
    }
    top_level_keyword_after_ctes(trimmed_upper).is_some_and(|keyword| keyword == "SELECT")
}

fn top_level_keyword_after_ctes(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    let mut i = "WITH".len();
    loop {
        skip_ascii_ws(bytes, &mut i);
        skip_identifier_like(bytes, &mut i)?;
        skip_ascii_ws(bytes, &mut i);
        if bytes.get(i) == Some(&b'(') {
            i = skip_balanced_parens(input, i)?;
            skip_ascii_ws(bytes, &mut i);
        }
        let rest = input.get(i..)?;
        if !rest.starts_with("AS") {
            return None;
        }
        i += "AS".len();
        skip_ascii_ws(bytes, &mut i);
        if bytes.get(i) != Some(&b'(') {
            return None;
        }
        i = skip_balanced_parens(input, i)?;
        skip_ascii_ws(bytes, &mut i);
        if bytes.get(i) == Some(&b',') {
            i += 1;
            continue;
        }
        skip_ascii_ws(bytes, &mut i);
        return first_ascii_word(input.get(i..)?);
    }
}

fn skip_ascii_ws(bytes: &[u8], i: &mut usize) {
    while matches!(bytes.get(*i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        *i += 1;
    }
}

fn skip_identifier_like(bytes: &[u8], i: &mut usize) -> Option<()> {
    match bytes.get(*i) {
        Some(b'[') => {
            *i += 1;
            while let Some(byte) = bytes.get(*i) {
                *i += 1;
                if *byte == b']' {
                    if bytes.get(*i) == Some(&b']') {
                        *i += 1;
                        continue;
                    }
                    return Some(());
                }
            }
            None
        }
        Some(byte) if byte.is_ascii_alphabetic() || *byte == b'_' => {
            *i += 1;
            while matches!(bytes.get(*i), Some(byte) if byte.is_ascii_alphanumeric() || *byte == b'_')
            {
                *i += 1;
            }
            Some(())
        }
        _ => None,
    }
}

fn skip_balanced_parens(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    if bytes.get(start) != Some(&b'(') {
        return None;
    }
    let mut depth = 0usize;
    let mut i = start;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\'' {
                        i += 1;
                        if bytes.get(i) == Some(&b'\'') {
                            i += 1;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.checked_sub(1)?;
                i += 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => i += 1,
        }
    }
    None
}

fn first_ascii_word(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    let mut end = 0usize;
    while matches!(bytes.get(end), Some(byte) if byte.is_ascii_alphabetic()) {
        end += 1;
    }
    if end == 0 {
        None
    } else {
        input.get(..end)
    }
}

fn mssql_runtime_statement_unsupported() -> AppError {
    AppError::Unsupported(
        "SQL Server statement is outside issue #903 runtime slice; only SELECT/WITH query and INSERT/UPDATE/DELETE/MERGE DML are supported".into(),
    )
}

fn mssql_batch_statement_unsupported(position: usize, total: usize) -> AppError {
    AppError::Unsupported(format!(
        "Statement {position} of {total} is outside issue #903 runtime slice; batch supports INSERT/UPDATE/DELETE/MERGE DML only"
    ))
}

fn mssql_query_column(column: &Column) -> QueryColumn {
    let data_type = mssql_column_type_name(column.column_type()).to_string();
    QueryColumn {
        name: column.name().to_string(),
        category: mssql_column_category(column.column_type()),
        data_type,
    }
}

fn mssql_row_to_json(row: &Row) -> Vec<serde_json::Value> {
    (0..row.len())
        .map(|idx| mssql_cell_to_json(row, idx))
        .collect()
}

fn mssql_cell_to_json(row: &Row, idx: usize) -> serde_json::Value {
    let Some((_, cell)) = row.cells().nth(idx) else {
        return serde_json::Value::Null;
    };

    match cell {
        ColumnData::DateTime(Some(_)) | ColumnData::SmallDateTime(Some(_)) => row
            .try_get::<NaiveDateTime, _>(idx)
            .ok()
            .flatten()
            .map(|value| serde_json::Value::String(value.to_string()))
            .unwrap_or_else(|| serde_json::Value::String(format!("{cell:?}"))),
        ColumnData::Time(Some(_)) => row
            .try_get::<NaiveTime, _>(idx)
            .ok()
            .flatten()
            .map(|value| serde_json::Value::String(value.to_string()))
            .unwrap_or_else(|| serde_json::Value::String(format!("{cell:?}"))),
        ColumnData::Date(Some(_)) => row
            .try_get::<NaiveDate, _>(idx)
            .ok()
            .flatten()
            .map(|value| serde_json::Value::String(value.to_string()))
            .unwrap_or_else(|| serde_json::Value::String(format!("{cell:?}"))),
        ColumnData::DateTime2(Some(_)) => row
            .try_get::<NaiveDateTime, _>(idx)
            .ok()
            .flatten()
            .map(|value| serde_json::Value::String(value.to_string()))
            .unwrap_or_else(|| serde_json::Value::String(format!("{cell:?}"))),
        ColumnData::DateTimeOffset(Some(_)) => row
            .try_get::<DateTime<FixedOffset>, _>(idx)
            .ok()
            .flatten()
            .map(|value| serde_json::Value::String(value.to_rfc3339()))
            .unwrap_or_else(|| serde_json::Value::String(format!("{cell:?}"))),
        _ => mssql_scalar_cell_to_json(cell),
    }
}

fn mssql_scalar_cell_to_json(cell: &ColumnData<'_>) -> serde_json::Value {
    match cell {
        ColumnData::U8(Some(value)) => serde_json::Value::Number((*value).into()),
        ColumnData::I16(Some(value)) => serde_json::Value::Number((*value).into()),
        ColumnData::I32(Some(value)) => serde_json::Value::Number((*value).into()),
        ColumnData::I64(Some(value)) => serde_json::Value::Number((*value).into()),
        ColumnData::F32(Some(value)) => json_number(*value as f64),
        ColumnData::F64(Some(value)) => json_number(*value),
        ColumnData::Bit(Some(value)) => serde_json::Value::Bool(*value),
        ColumnData::String(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Guid(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Binary(Some(value)) => {
            serde_json::Value::String(format!("0x{}", hex_encode(value.as_ref())))
        }
        ColumnData::Numeric(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Xml(Some(value)) => serde_json::Value::String(value.as_ref().to_string()),
        _ => serde_json::Value::Null,
    }
}

fn json_number(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

fn mssql_column_type_name(column_type: ColumnType) -> &'static str {
    match column_type {
        ColumnType::Null => "null",
        ColumnType::Bit | ColumnType::Bitn => "bit",
        ColumnType::Int1 => "tinyint",
        ColumnType::Int2 => "smallint",
        ColumnType::Int4 => "int",
        ColumnType::Int8 => "bigint",
        ColumnType::Intn => "int",
        ColumnType::Float4 => "real",
        ColumnType::Float8 | ColumnType::Floatn => "float",
        ColumnType::Money | ColumnType::Money4 => "money",
        ColumnType::Datetime4 | ColumnType::Datetime | ColumnType::Datetimen => "datetime",
        ColumnType::Daten => "date",
        ColumnType::Timen => "time",
        ColumnType::Datetime2 => "datetime2",
        ColumnType::DatetimeOffsetn => "datetimeoffset",
        ColumnType::Guid => "uniqueidentifier",
        ColumnType::Decimaln => "decimal",
        ColumnType::Numericn => "numeric",
        ColumnType::BigVarBin | ColumnType::BigBinary => "varbinary",
        ColumnType::BigVarChar | ColumnType::BigChar => "varchar",
        ColumnType::NVarchar | ColumnType::NChar => "nvarchar",
        ColumnType::Xml => "xml",
        ColumnType::Text => "text",
        ColumnType::Image => "image",
        ColumnType::NText => "ntext",
        ColumnType::Udt => "udt",
        ColumnType::SSVariant => "sql_variant",
    }
}

fn mssql_column_category(column_type: ColumnType) -> ColumnCategory {
    match column_type {
        ColumnType::Bit | ColumnType::Bitn => ColumnCategory::Bool,
        ColumnType::Int1
        | ColumnType::Int2
        | ColumnType::Int4
        | ColumnType::Int8
        | ColumnType::Intn => ColumnCategory::Int,
        ColumnType::Float4
        | ColumnType::Float8
        | ColumnType::Floatn
        | ColumnType::Money
        | ColumnType::Money4
        | ColumnType::Decimaln
        | ColumnType::Numericn => ColumnCategory::Float,
        ColumnType::Datetime4
        | ColumnType::Datetime
        | ColumnType::Datetimen
        | ColumnType::Daten
        | ColumnType::Timen
        | ColumnType::Datetime2
        | ColumnType::DatetimeOffsetn => ColumnCategory::Datetime,
        ColumnType::Guid => ColumnCategory::Uuid,
        ColumnType::BigVarBin | ColumnType::BigBinary | ColumnType::Image => ColumnCategory::Binary,
        ColumnType::Xml | ColumnType::Udt | ColumnType::SSVariant => ColumnCategory::Object,
        ColumnType::BigVarChar
        | ColumnType::BigChar
        | ColumnType::NVarchar
        | ColumnType::NChar
        | ColumnType::Text
        | ColumnType::NText => ColumnCategory::Text,
        ColumnType::Null => ColumnCategory::Unknown,
    }
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

fn table_query_cancelled() -> AppError {
    AppError::Database("Operation cancelled".into())
}

fn mssql_query_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionConfig, DatabaseType};
    use std::borrow::Cow;
    use tiberius::{numeric::Numeric, xml::XmlData, Uuid};

    fn loopback_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "conn".into(),
            name: "mssql".into(),
            db_type: DatabaseType::Mssql,
            host: "127.0.0.1".into(),
            port: 1,
            user: "sa".into(),
            password: "secret".into(),
            database: "master".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: Some(1),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: Some(false),
            trust_server_certificate: None,
        }
    }

    async fn connected_loopback_adapter() -> MssqlAdapter {
        let adapter = MssqlAdapter::new();
        *adapter.connected_config.lock().await = Some(loopback_config());
        adapter
    }

    #[test]
    fn mssql_query_type_classifies_bounded_tsql_runtime_shapes() {
        assert!(matches!(
            mssql_query_type("-- x\nSELECT 1;"),
            QueryType::Select
        ));
        assert!(matches!(
            mssql_query_type("/* x */ WITH cte AS (SELECT 1 AS id) SELECT id FROM cte"),
            QueryType::Select
        ));
        assert!(matches!(
            mssql_query_type("WITH cte AS (SELECT 1 AS id) UPDATE dbo.users SET name = 'Ada'"),
            QueryType::Ddl
        ));
        assert!(matches!(
            mssql_query_type("UPDATE dbo.users SET name = 'Ada'"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            mssql_query_type("MERGE dbo.users AS target USING dbo.incoming AS source ON 1 = 0 WHEN NOT MATCHED THEN INSERT DEFAULT VALUES"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            mssql_query_type("CREATE TABLE dbo.t (id int)"),
            QueryType::Ddl
        ));
        assert!(matches!(
            mssql_query_type("-- a\n/* b */ EXECUTE dbo.touch_user @id = 1"),
            QueryType::Ddl
        ));
        assert!(matches!(
            mssql_query_type("INSERT INTO dbo.users DEFAULT VALUES"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            mssql_query_type("DELETE FROM dbo.users WHERE id = 1"),
            QueryType::Dml { .. }
        ));
        assert!(matches!(
            mssql_query_type("\n\t/* a */\n-- b\nexec dbo.touch_user"),
            QueryType::Ddl
        ));
        assert!(matches!(
            mssql_query_type("-- comment only"),
            QueryType::Ddl
        ));
        assert!(matches!(
            mssql_query_type("/* unterminated"),
            QueryType::Ddl
        ));
    }

    #[tokio::test]
    async fn unsupported_runtime_sql_short_circuits_before_connection_lookup() {
        let adapter = MssqlAdapter::new();

        for query in [
            "CREATE TABLE dbo.t (id int)",
            "DROP TABLE dbo.users",
            "EXEC dbo.touch_user @id = 1",
            "EXECUTE dbo.touch_user @id = 1",
            "UPDATE dbo.users SET name = 'Ada'; DROP TABLE dbo.users",
            "SELECT 1\nGO\nSELECT 2",
            "SELECT 1\nGO 2\nSELECT 2",
            "SELECT 1\nGO -- repeat\nSELECT 2",
            "SELECT 1\nGO /* repeat */\nSELECT 2",
            "WITH cte AS (SELECT 1 AS id) UPDATE dbo.users SET name = 'Ada'",
        ] {
            let err = adapter.execute_query(query, None).await.unwrap_err();
            assert!(
                matches!(err, AppError::Unsupported(ref msg) if msg.contains("outside issue #903")),
                "expected issue #903 unsupported boundary for {query}, got {err:?}"
            );
        }

        let err = adapter
            .execute_query_batch(
                &["UPDATE dbo.users SET name = 'Ada'; DROP TABLE dbo.users".to_string()],
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(msg) if msg.contains("Statement 1 of 1")));

        let err = adapter
            .execute_query_batch(
                &[
                    "UPDATE dbo.users SET name = 'Ada'\nGO\nUPDATE dbo.users SET name = 'Bob'"
                        .to_string(),
                ],
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(msg) if msg.contains("Statement 1 of 1")));

        let err = adapter
            .dry_run_query_batch(&["SELECT 1".to_string()], None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Unsupported(msg) if msg.contains("batch supports INSERT/UPDATE/DELETE/MERGE"))
        );
    }

    #[tokio::test]
    async fn empty_batches_return_without_open_connection() {
        let adapter = MssqlAdapter::new();
        let statements: Vec<String> = Vec::new();

        assert!(adapter
            .execute_query_batch(&statements, None)
            .await
            .unwrap()
            .is_empty());
        assert!(adapter
            .dry_run_query_batch(&statements, None)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn validation_and_cancel_paths_short_circuit_before_connection_lookup() {
        let adapter = MssqlAdapter::new();

        let err = adapter.execute_query("  ;\n", None).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg.contains("SQL query is empty")));

        let err = adapter
            .execute_query_batch(&[" ; ".to_string()], None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg == "Statement 1 of 1 is empty"));

        let cancel = CancellationToken::new();
        cancel.cancel();
        let err = adapter
            .execute_query_batch(&["SELECT 1".to_string()], Some(&cancel))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));

        let err = adapter
            .execute_query("SELECT 1", Some(&cancel))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));

        let err = adapter
            .dry_run_query_batch(&[" ; ".to_string()], None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg == "Statement 1 of 1 is empty"));

        let err = adapter
            .dry_run_query_batch(
                &["UPDATE dbo.users SET name = 'Ada'".to_string()],
                Some(&cancel),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));
    }

    #[tokio::test]
    async fn connected_runtime_paths_reach_network_boundary() {
        let adapter = connected_loopback_adapter().await;

        for query in ["SELECT 1", "UPDATE dbo.users SET name = 'Ada'"] {
            let err = adapter.execute_query(query, None).await.unwrap_err();
            assert!(matches!(err, AppError::Connection(msg) if msg.contains("network connection")));
        }

        let cancel = CancellationToken::new();
        let err = adapter
            .execute_query("SELECT 1", Some(&cancel))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Connection(msg) if msg.contains("network connection")));

        let batch = vec!["UPDATE dbo.users SET name = 'Ada'".to_string()];
        let err = adapter.execute_query_batch(&batch, None).await.unwrap_err();
        assert!(matches!(err, AppError::Connection(msg) if msg.contains("network connection")));
        let err = adapter.dry_run_query_batch(&batch, None).await.unwrap_err();
        assert!(matches!(err, AppError::Connection(msg) if msg.contains("network connection")));
    }

    #[tokio::test]
    async fn batch_validation_reports_actual_statement_position() {
        let adapter = MssqlAdapter::new();
        let err = adapter
            .execute_query_batch(
                &[
                    "UPDATE dbo.users SET name = 'Ada'".to_string(),
                    " ; ".to_string(),
                ],
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(msg) if msg == "Statement 2 of 2 is empty"));
    }

    #[tokio::test]
    async fn valid_runtime_modes_fail_at_connection_boundary_without_network() {
        let adapter = MssqlAdapter::new();

        for query in ["SELECT 1", "UPDATE dbo.users SET name = 'Ada'"] {
            let err = adapter.execute_query(query, None).await.unwrap_err();
            assert!(matches!(err, AppError::Connection(msg) if msg.contains("not open")));
        }

        let batch = vec!["UPDATE dbo.users SET name = 'Ada'".to_string()];
        let err = adapter.execute_query_batch(&batch, None).await.unwrap_err();
        assert!(matches!(err, AppError::Connection(msg) if msg.contains("not open")));
        let err = adapter.dry_run_query_batch(&batch, None).await.unwrap_err();
        assert!(matches!(err, AppError::Connection(msg) if msg.contains("not open")));
    }

    #[tokio::test]
    async fn cancellable_helper_covers_ready_and_cancelled_paths() {
        let value = cancellable(async { Ok::<_, AppError>(42) }, None)
            .await
            .unwrap();
        assert_eq!(value, 42);

        let cancel = CancellationToken::new();
        let value = cancellable(async { Ok::<_, AppError>(7) }, Some(&cancel))
            .await
            .unwrap();
        assert_eq!(value, 7);

        let err = cancellable(
            async { Err::<(), _>(AppError::Database("driver failed".into())) },
            Some(&cancel),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Database(msg) if msg == "driver failed"));

        let cancel = CancellationToken::new();
        cancel.cancel();
        let err = cancellable(
            async {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                Ok::<_, AppError>(())
            },
            Some(&cancel),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));
    }

    #[test]
    fn mssql_column_metadata_maps_to_tabular_envelope_hints() {
        let int_column = Column::new("id".into(), ColumnType::Int4);
        let text_column = Column::new("name".into(), ColumnType::NVarchar);
        let uuid_column = Column::new("uid".into(), ColumnType::Guid);

        assert_eq!(mssql_query_column(&int_column).data_type, "int");
        assert_eq!(
            mssql_query_column(&int_column).category,
            ColumnCategory::Int
        );
        assert_eq!(mssql_query_column(&text_column).data_type, "nvarchar");
        assert_eq!(
            mssql_query_column(&text_column).category,
            ColumnCategory::Text
        );
        assert_eq!(
            mssql_query_column(&uuid_column).data_type,
            "uniqueidentifier"
        );
        assert_eq!(
            mssql_query_column(&uuid_column).category,
            ColumnCategory::Uuid
        );
    }

    #[test]
    fn table_data_sql_helpers_quote_filters_order_and_identifiers() {
        let columns = vec![
            column_info("id", true),
            column_info("name", false),
            column_info("deleted_at", false),
            column_info("tenant_id", true),
        ];
        let filters = vec![
            FilterCondition {
                column: "name".into(),
                operator: FilterOperator::Like,
                value: Some("A%".into()),
            },
            FilterCondition {
                column: "missing".into(),
                operator: FilterOperator::Eq,
                value: Some("ignored".into()),
            },
            FilterCondition {
                column: "deleted_at".into(),
                operator: FilterOperator::IsNull,
                value: None,
            },
            FilterCondition {
                column: "tenant_id".into(),
                operator: FilterOperator::Eq,
                value: None,
            },
        ];

        let (where_clause, params) = build_mssql_where_clause(&columns, Some(&filters));

        assert_eq!(
            where_clause,
            " WHERE [name] LIKE @P1 AND [deleted_at] IS NULL"
        );
        assert_eq!(params, vec!["A%".to_string()]);
        assert_eq!(
            build_mssql_order_clause(&columns, Some("name DESC, missing ASC, id BAD, tenant_id")),
            " ORDER BY [name] DESC, [tenant_id] ASC, [id] ASC"
        );
        assert_eq!(qualified_mssql_table("", "odd]table"), "[odd]]table]");
        assert_eq!(qualified_mssql_table("dbo", "users"), "[dbo].[users]");
    }

    #[test]
    fn mssql_raw_where_validator_preserves_filter_only_boundary() {
        validate_raw_where_clause(RawWhereDialect::Mssql, "[name] LIKE N'A%' AND [id] >= 1")
            .expect("bounded MSSQL raw WHERE should parse");

        for clause in [
            "[id] = 1; DROP TABLE [dbo].[users]",
            "[id] = 1 UNION SELECT [password] FROM [dbo].[users]",
            "DROP TABLE [dbo].[users]",
        ] {
            assert!(
                validate_raw_where_clause(RawWhereDialect::Mssql, clause).is_err(),
                "{clause:?} should stay outside raw WHERE support"
            );
        }
    }

    #[test]
    fn scalar_helpers_cover_json_and_type_edges() {
        assert_eq!(strip_trailing_terminator("SELECT 1;\n\t"), "SELECT 1");
        assert_eq!(strip_trailing_terminator("SELECT 1;;;"), "SELECT 1");
        assert_eq!(strip_trailing_terminator("   ;;; \n"), "");
        assert_eq!(
            strip_leading_comments("  -- a\n /* b */\nSELECT 1"),
            "SELECT 1"
        );
        assert_eq!(strip_leading_comments("-- only a comment"), "");
        assert_eq!(strip_leading_comments("/* unterminated"), "");
        assert_eq!(strip_leading_comments("/* closed */"), "");
        assert_eq!(hex_encode(&[0x00, 0xaf, 0xff]), "00afff");
        assert_eq!(hex_encode(&[]), "");
        assert_eq!(json_number(4.5), serde_json::json!(4.5));
        assert_eq!(json_number(f64::NAN), serde_json::Value::Null);

        assert_eq!(mssql_column_type_name(ColumnType::Null), "null");
        assert_eq!(mssql_column_type_name(ColumnType::Money4), "money");
        assert_eq!(mssql_column_type_name(ColumnType::Text), "text");
        assert_eq!(
            mssql_column_category(ColumnType::BigVarBin),
            ColumnCategory::Binary
        );
        assert_eq!(
            mssql_column_category(ColumnType::SSVariant),
            ColumnCategory::Object
        );
        assert_eq!(
            mssql_column_category(ColumnType::Null),
            ColumnCategory::Unknown
        );
    }

    #[test]
    fn mssql_scalar_cells_convert_to_datagrid_json_values() {
        let guid = Uuid::from_u128(0x12345678123456781234567812345678);

        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::U8(Some(7))),
            serde_json::json!(7)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::I16(Some(-2))),
            serde_json::json!(-2)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::I32(Some(42))),
            serde_json::json!(42)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::I64(Some(9_000_000_000))),
            serde_json::json!(9_000_000_000_i64)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::F32(Some(3.5))),
            serde_json::json!(3.5)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::F64(Some(8.25))),
            serde_json::json!(8.25)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::Bit(Some(true))),
            serde_json::Value::Bool(true)
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::String(Some(Cow::Borrowed("Ada")))),
            serde_json::json!("Ada")
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::Guid(Some(guid))),
            serde_json::json!(guid.to_string())
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::Binary(Some(Cow::Owned(vec![0x0a, 0xff])))),
            serde_json::json!("0x0aff")
        );

        let numeric = Numeric::new_with_scale(12_345, 2);
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::Numeric(Some(numeric))),
            serde_json::json!(numeric.to_string())
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::Xml(Some(Cow::Owned(XmlData::new("<x />"))))),
            serde_json::json!("<x />")
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::F64(Some(f64::NAN))),
            serde_json::Value::Null
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::String(None)),
            serde_json::Value::Null
        );
        assert_eq!(
            mssql_scalar_cell_to_json(&ColumnData::DateTime(None)),
            serde_json::Value::Null
        );
    }

    #[test]
    fn mssql_column_metadata_covers_driver_type_families() {
        for (column_type, data_type, category) in [
            (ColumnType::Bit, "bit", ColumnCategory::Bool),
            (ColumnType::Bitn, "bit", ColumnCategory::Bool),
            (ColumnType::Int1, "tinyint", ColumnCategory::Int),
            (ColumnType::Int2, "smallint", ColumnCategory::Int),
            (ColumnType::Int4, "int", ColumnCategory::Int),
            (ColumnType::Int8, "bigint", ColumnCategory::Int),
            (ColumnType::Intn, "int", ColumnCategory::Int),
            (ColumnType::Float4, "real", ColumnCategory::Float),
            (ColumnType::Float8, "float", ColumnCategory::Float),
            (ColumnType::Floatn, "float", ColumnCategory::Float),
            (ColumnType::Money, "money", ColumnCategory::Float),
            (ColumnType::Money4, "money", ColumnCategory::Float),
            (ColumnType::Decimaln, "decimal", ColumnCategory::Float),
            (ColumnType::Numericn, "numeric", ColumnCategory::Float),
            (ColumnType::Datetime4, "datetime", ColumnCategory::Datetime),
            (ColumnType::Datetime, "datetime", ColumnCategory::Datetime),
            (ColumnType::Datetimen, "datetime", ColumnCategory::Datetime),
            (ColumnType::Daten, "date", ColumnCategory::Datetime),
            (ColumnType::Timen, "time", ColumnCategory::Datetime),
            (ColumnType::Datetime2, "datetime2", ColumnCategory::Datetime),
            (
                ColumnType::DatetimeOffsetn,
                "datetimeoffset",
                ColumnCategory::Datetime,
            ),
            (ColumnType::BigVarBin, "varbinary", ColumnCategory::Binary),
            (ColumnType::BigBinary, "varbinary", ColumnCategory::Binary),
            (ColumnType::Image, "image", ColumnCategory::Binary),
            (ColumnType::Xml, "xml", ColumnCategory::Object),
            (ColumnType::Udt, "udt", ColumnCategory::Object),
            (ColumnType::SSVariant, "sql_variant", ColumnCategory::Object),
            (ColumnType::BigVarChar, "varchar", ColumnCategory::Text),
            (ColumnType::BigChar, "varchar", ColumnCategory::Text),
            (ColumnType::NVarchar, "nvarchar", ColumnCategory::Text),
            (ColumnType::NChar, "nvarchar", ColumnCategory::Text),
            (ColumnType::Text, "text", ColumnCategory::Text),
            (ColumnType::NText, "ntext", ColumnCategory::Text),
            (ColumnType::Null, "null", ColumnCategory::Unknown),
        ] {
            assert_eq!(mssql_column_type_name(column_type), data_type);
            assert_eq!(mssql_column_category(column_type), category);
        }
    }

    fn column_info(name: &str, is_primary_key: bool) -> crate::models::ColumnInfo {
        crate::models::ColumnInfo {
            name: name.into(),
            data_type: "nvarchar".into(),
            nullable: true,
            default_value: None,
            is_primary_key,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: ColumnCategory::Text,
        }
    }
}
