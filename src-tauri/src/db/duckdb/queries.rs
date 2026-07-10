//! DuckDB free-form query execution and table preview.

use duckdb::{params_from_iter, Connection};
use tokio_util::sync::CancellationToken;

use crate::db::raw_where::{validate_raw_where_clause, RawWhereDialect};
use crate::error::AppError;
use crate::models::{
    FilterCondition, FilterOperator, QueryColumn, QueryResult, QueryType, TableData,
};

use super::connection::{
    duckdb_column_category, normalize_namespace, quote_qualified_identifier, DuckdbAdapter,
};
use super::sql_text::{
    duckdb_query_type, quote_identifier, strip_trailing_terminator, validate_supported_sql,
};
use super::value::value_ref_to_json;

fn validate_raw_where(raw_where: &str) -> Result<(), AppError> {
    validate_raw_where_clause(RawWhereDialect::Postgres, raw_where)
}

impl DuckdbAdapter {
    pub async fn execute_query(
        &self,
        query: &str,
        cancel_token: Option<&CancellationToken>,
        // Issue #1231 — fetch-stage row cap (see SQLite adapter).
        row_cap: usize,
    ) -> Result<QueryResult, AppError> {
        if cancel_token.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Query cancelled".into()));
        }

        let start = std::time::Instant::now();
        let query = strip_trailing_terminator(query).to_string();
        if query.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL query is empty after removing trailing terminators".into(),
            ));
        }
        validate_supported_sql(&query)?;
        let query_type = duckdb_query_type(&query);
        if let Some(result) = self
            .execute_file_analytics_global_query(&query, start)
            .await?
        {
            return Ok(result);
        }

        self.with_connection(move |conn| {
            execute_query_uncancelled(conn, &query, query_type, start, row_cap)
        })
        .await
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

        let namespace = normalize_namespace(namespace).to_string();
        let table = table.to_string();
        let order_by = order_by.map(str::to_string);
        let filters = filters.map(|filters| filters.to_vec());
        let raw_where = raw_where.map(str::to_string);

        self.with_connection(move |conn| {
            query_table_data_uncancelled(
                conn,
                &namespace,
                &table,
                page,
                page_size,
                order_by.as_deref(),
                filters.as_deref(),
                raw_where.as_deref(),
            )
        })
        .await
    }
}

fn execute_query_uncancelled(
    conn: &Connection,
    query: &str,
    query_type: QueryType,
    start: std::time::Instant,
    row_cap: usize,
) -> Result<QueryResult, AppError> {
    match query_type {
        QueryType::Select => {
            let mut stmt = conn
                .prepare(query)
                .map_err(|e| AppError::Database(e.to_string()))?;
            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::Database(e.to_string()))?;
            let statement = rows.as_ref();
            let column_count = statement.map(|stmt| stmt.column_count()).unwrap_or(0);
            let columns = statement
                .map(|stmt| duckdb_query_columns(stmt, column_count))
                .unwrap_or_default();

            // Issue #1231 — stop pulling from the cursor at cap+1 (the extra
            // row only flags `truncated`).
            let mut json_rows = Vec::new();
            let mut truncated = false;
            while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
                if json_rows.len() >= row_cap {
                    truncated = true;
                    break;
                }
                let mut out = Vec::with_capacity(column_count);
                for idx in 0..column_count {
                    let value = row
                        .get_ref(idx)
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    out.push(value_ref_to_json(value));
                }
                json_rows.push(out);
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
            let rows_affected =
                conn.execute(query, [])
                    .map_err(|e| AppError::Database(e.to_string()))? as u64;
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
            conn.execute(query, [])
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

#[allow(clippy::too_many_arguments)]
fn query_table_data_uncancelled(
    conn: &Connection,
    namespace: &str,
    table: &str,
    page: i32,
    page_size: i32,
    order_by: Option<&str>,
    filters: Option<&[FilterCondition]>,
    raw_where: Option<&str>,
) -> Result<TableData, AppError> {
    let columns = get_table_columns_for_query(conn, namespace, table)?;
    let table_ident = quote_qualified_identifier(namespace, table);

    let raw_where_trimmed = raw_where.map(str::trim).filter(|rw| !rw.is_empty());
    if let Some(raw_where) = &raw_where_trimmed {
        validate_raw_where(raw_where)?;
    }

    let (where_clause, param_values) = if let Some(raw_where) = &raw_where_trimmed {
        (format!(" WHERE {raw_where}"), Vec::<String>::new())
    } else {
        build_filter_clause(filters, &columns)
    };

    let count_sql = format!("SELECT COUNT(*) FROM {table_ident}{where_clause}");
    let total_count: i64 = conn
        .query_row(&count_sql, params_from_iter(param_values.iter()), |row| {
            row.get(0)
        })
        .map_err(|e| AppError::Database(e.to_string()))?;

    let order_clause = build_order_clause(order_by, &columns);
    let page_size = crate::db::clamp_page_size(page_size);
    let offset = (page - 1).max(0) * page_size;
    let executed_query = format!(
        "SELECT * FROM {table_ident}{where_clause}{order_clause} LIMIT {page_size} OFFSET {offset}"
    );

    let mut stmt = conn
        .prepare(&executed_query)
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut rows = stmt
        .query(params_from_iter(param_values.iter()))
        .map_err(|e| AppError::Database(e.to_string()))?;
    let column_count = rows.as_ref().map(|stmt| stmt.column_count()).unwrap_or(0);

    let result_rows = collect_rows(&mut rows, column_count)?;

    Ok(TableData {
        columns,
        rows: result_rows,
        total_count,
        page,
        page_size,
        executed_query,
    })
}

fn get_table_columns_for_query(
    conn: &Connection,
    namespace: &str,
    table: &str,
) -> Result<Vec<crate::models::ColumnInfo>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map(duckdb::params![namespace, table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    super::connection::collect_duckdb_rows(rows).map(|rows| {
        rows.into_iter()
            .map(
                |(name, data_type, is_nullable, default_value)| crate::models::ColumnInfo {
                    name,
                    data_type: data_type.clone(),
                    nullable: is_nullable.eq_ignore_ascii_case("YES"),
                    default_value,
                    // DuckDB sequences arrive as `default_value` (omitted by
                    // the INSERT generator); no dedicated identity flag.
                    is_identity: false,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                    comment: None,
                    check_clauses: Vec::new(),
                    category: duckdb_column_category(&data_type),
                },
            )
            .collect()
    })
}

pub(super) fn duckdb_query_columns(
    stmt: &duckdb::Statement<'_>,
    column_count: usize,
) -> Vec<QueryColumn> {
    (0..column_count)
        .map(|idx| {
            let name = stmt
                .column_name(idx)
                .map(|name| name.to_string())
                .unwrap_or_else(|_| format!("column_{idx}"));
            let data_type = format!("{:?}", stmt.column_type(idx));
            QueryColumn {
                name,
                category: duckdb_column_category(&data_type),
                data_type,
            }
        })
        .collect()
}

pub(super) fn collect_rows(
    rows: &mut duckdb::Rows<'_>,
    column_count: usize,
) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
        let mut out = Vec::with_capacity(column_count);
        for idx in 0..column_count {
            let value = row
                .get_ref(idx)
                .map_err(|e| AppError::Database(e.to_string()))?;
            out.push(value_ref_to_json(value));
        }
        result.push(out);
    }
    Ok(result)
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
                let Some(op) = filter.operator.comparison_sql() else {
                    continue;
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
    let mut order_parts = Vec::new();

    if let Some(order_by) = order_by {
        for part in order_by.split(',') {
            let parts = part.split_whitespace().collect::<Vec<&str>>();
            let (column, direction) = match parts.as_slice() {
                [column, direction] => match crate::db::parse_order_direction(direction) {
                    Some(d) => (*column, d),
                    None => continue,
                },
                [column] => (*column, "ASC"),
                _ => continue,
            };
            if valid_columns.contains(column) {
                order_parts.push(format!("{} {}", quote_identifier(column), direction));
            }
        }
    }

    if order_parts.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order_parts.join(", "))
    }
}

#[cfg(test)]
mod order_clause_tests {
    use super::build_order_clause;
    use crate::models::{ColumnCategory, ColumnInfo};

    fn col(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.into(),
            data_type: "VARCHAR".into(),
            nullable: true,
            default_value: None,
            is_identity: false,
            is_primary_key: false,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: ColumnCategory::Unknown,
        }
    }

    #[test]
    fn lowercase_direction_is_honored_not_dropped() {
        let columns = vec![col("id"), col("name")];
        // #1354 regression — duckdb previously matched only exact-case
        // `"ASC"`/`"DESC"` and silently dropped `asc`/`desc`, producing an
        // empty ORDER BY. Now folded to the canonical uppercase.
        assert_eq!(
            build_order_clause(Some("id asc, name desc"), &columns),
            r#" ORDER BY "id" ASC, "name" DESC"#
        );
    }

    #[test]
    fn invalid_direction_token_skips_the_part() {
        let columns = vec![col("id")];
        assert_eq!(build_order_clause(Some("id sideways"), &columns), "");
    }
}
