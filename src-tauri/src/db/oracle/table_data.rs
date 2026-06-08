use std::collections::HashSet;

use oracle_rs::{Connection as OracleConnection, Row, Value};
use tokio_util::sync::CancellationToken;

use crate::db::raw_where::{validate_raw_where_clause, RawWhereDialect};
use crate::error::AppError;
use crate::models::{FilterCondition, FilterOperator, TableData};

use super::runtime::oracle_value_to_json;
use super::{connection_timeout_secs, OracleAdapter};

impl OracleAdapter {
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
        let columns = self.get_table_columns(schema, table).await?;
        let plan = build_oracle_table_query_plan(
            &columns, schema, table, page, page_size, order_by, filters, raw_where,
        )?;

        if columns.is_empty() {
            return Ok(TableData {
                columns,
                rows: Vec::new(),
                total_count: 0,
                page,
                page_size: plan.page_size,
                executed_query: plan.executed_query,
            });
        }

        let config = self.connected_config().await?;
        let timeout_secs = connection_timeout_secs(&config);
        let params = oracle_bind_values(&plan.params);

        let connection = OracleAdapter::open_connection(&config, timeout_secs).await?;
        let result = async {
            let count_rows = query_oracle_rows(
                &connection,
                "Oracle table count failed",
                &plan.count_sql,
                &params,
            )
            .await?;
            let total_count = count_rows
                .first()
                .map(|row| oracle_value_to_i64(row, 0, "table count"))
                .transpose()?
                .flatten()
                .unwrap_or(0);

            let data_rows = query_oracle_rows(
                &connection,
                "Oracle table data query failed",
                &plan.executed_query,
                &params,
            )
            .await?;
            let rows = data_rows
                .iter()
                .map(|row| row.values().iter().map(oracle_value_to_json).collect())
                .collect();

            Ok(TableData {
                columns,
                rows,
                total_count,
                page,
                page_size: plan.page_size,
                executed_query: plan.executed_query,
            })
        }
        .await;

        let close_result = connection
            .close()
            .await
            .map_err(|err| oracle_table_error("Oracle table query connection close failed", err));
        match (result, close_result) {
            (Ok(result), Ok(())) => Ok(result),
            (Ok(_), Err(error)) => Err(error),
            (Err(error), _) => Err(error),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct OracleTableQueryPlan {
    count_sql: String,
    executed_query: String,
    params: Vec<String>,
    page_size: i32,
}

#[allow(clippy::too_many_arguments)]
fn build_oracle_table_query_plan(
    columns: &[crate::models::ColumnInfo],
    schema: &str,
    table: &str,
    page: i32,
    page_size: i32,
    order_by: Option<&str>,
    filters: Option<&[FilterCondition]>,
    raw_where: Option<&str>,
) -> Result<OracleTableQueryPlan, AppError> {
    let qualified = qualified_oracle_table(schema, table);
    let page_size = page_size.max(1);
    let offset = (page - 1).max(0) * page_size;
    let raw_where_trimmed = raw_where.map(str::trim).filter(|value| !value.is_empty());

    if let Some(raw_where) = raw_where_trimmed {
        validate_raw_where_clause(RawWhereDialect::Oracle, raw_where)?;
    }

    let (where_clause, params) = if let Some(raw_where) = raw_where_trimmed {
        (format!(" WHERE {raw_where}"), Vec::new())
    } else {
        build_oracle_where_clause(columns, filters)
    };

    let select_list = if columns.is_empty() {
        "*".to_string()
    } else {
        columns
            .iter()
            .map(|column| quote_oracle_identifier(&column.name))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let order_clause = build_oracle_order_clause(columns, order_by);
    let count_sql = format!("SELECT COUNT(*) FROM {qualified}{where_clause}");
    let executed_query = format!(
        "SELECT {select_list} FROM {qualified}{where_clause}{order_clause} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
    );

    Ok(OracleTableQueryPlan {
        count_sql,
        executed_query,
        params,
        page_size,
    })
}

fn build_oracle_where_clause(
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
    let mut params = Vec::new();
    let mut conditions = Vec::new();

    for filter in filters {
        if !valid_columns.contains(filter.column.as_str()) {
            continue;
        }

        let column = quote_oracle_identifier(&filter.column);
        match filter.operator {
            FilterOperator::IsNull => conditions.push(format!("{column} IS NULL")),
            FilterOperator::IsNotNull => conditions.push(format!("{column} IS NOT NULL")),
            _ => {
                let Some(value) = &filter.value else {
                    continue;
                };
                let Some(operator) = oracle_filter_operator(&filter.operator) else {
                    continue;
                };
                let placeholder = format!(":{}", params.len() + 1);
                conditions.push(format!("{column} {operator} {placeholder}"));
                params.push(value.clone());
            }
        }
    }

    if conditions.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {}", conditions.join(" AND ")), params)
    }
}

fn oracle_filter_operator(operator: &FilterOperator) -> Option<&'static str> {
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

fn build_oracle_order_clause(
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
                order_parts.push(format!("{} {}", quote_oracle_identifier(column), direction));
                user_sort_columns.insert(column.to_string());
            }
        }
    }

    let pk_tiebreakers = columns
        .iter()
        .filter(|column| column.is_primary_key && !user_sort_columns.contains(&column.name))
        .map(|column| format!("{} ASC", quote_oracle_identifier(&column.name)));
    order_parts.extend(pk_tiebreakers);

    if order_parts.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order_parts.join(", "))
    }
}

fn qualified_oracle_table(schema: &str, table: &str) -> String {
    if schema.trim().is_empty() {
        quote_oracle_identifier(table)
    } else {
        format!(
            "{}.{}",
            quote_oracle_identifier(schema),
            quote_oracle_identifier(table)
        )
    }
}

fn quote_oracle_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn oracle_bind_values(values: &[String]) -> Vec<Value> {
    values.iter().cloned().map(Value::String).collect()
}

async fn query_oracle_rows(
    connection: &OracleConnection,
    context: &'static str,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Row>, AppError> {
    let mut result = connection
        .query(sql, params)
        .await
        .map_err(|err| oracle_table_error(context, err))?;
    let columns = result.columns.clone();
    let mut rows = result.rows;

    while result.has_more_rows {
        if result.cursor_id == 0 {
            return Err(AppError::Database(format!(
                "{context}: Oracle returned a partial table cursor without a cursor id"
            )));
        }
        result = connection
            .fetch_more(result.cursor_id, &columns, 100)
            .await
            .map_err(|err| oracle_table_error(context, err))?;
        rows.extend(result.rows);
    }

    Ok(rows)
}

fn oracle_value_to_i64(
    row: &Row,
    idx: usize,
    label: &'static str,
) -> Result<Option<i64>, AppError> {
    let value = row.values().get(idx).ok_or_else(|| {
        AppError::Database(format!(
            "Oracle {label} decode failed: missing column {idx}"
        ))
    })?;

    match value {
        Value::Null => Ok(None),
        Value::Integer(value) => Ok(Some(*value)),
        Value::Number(value) => value
            .to_i64()
            .map(Some)
            .map_err(|err| AppError::Database(format!("Oracle {label} decode failed: {err}"))),
        Value::Float(value) => Ok(Some(*value as i64)),
        Value::String(value) => value
            .parse::<i64>()
            .map(Some)
            .map_err(|err| AppError::Database(format!("Oracle {label} decode failed: {err}"))),
        _ => Err(AppError::Database(format!(
            "Oracle {label} decode failed: expected numeric value"
        ))),
    }
}

fn table_query_cancelled() -> AppError {
    AppError::Database("Operation cancelled".into())
}

fn oracle_table_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ColumnCategory, ColumnInfo};

    fn column(name: &str, data_type: &str, primary_key: bool) -> ColumnInfo {
        ColumnInfo {
            name: name.into(),
            data_type: data_type.into(),
            nullable: !primary_key,
            default_value: None,
            is_primary_key: primary_key,
            is_foreign_key: false,
            fk_reference: None,
            comment: None,
            check_clauses: Vec::new(),
            category: ColumnCategory::Unknown,
        }
    }

    #[test]
    fn table_query_plan_quotes_identifiers_filters_and_pk_tiebreakers() {
        let columns = vec![
            column("USER ID", "NUMBER(10,0)", true),
            column("SELECT", "VARCHAR2", false),
        ];
        let filters = vec![FilterCondition {
            column: "SELECT".into(),
            operator: FilterOperator::Like,
            value: Some("A%".into()),
        }];

        let plan = build_oracle_table_query_plan(
            &columns,
            "APP",
            "ORDER DETAIL",
            2,
            25,
            Some("SELECT DESC"),
            Some(&filters),
            None,
        )
        .unwrap();

        assert_eq!(
            plan.count_sql,
            r#"SELECT COUNT(*) FROM "APP"."ORDER DETAIL" WHERE "SELECT" LIKE :1"#
        );
        assert_eq!(
            plan.executed_query,
            r#"SELECT "USER ID", "SELECT" FROM "APP"."ORDER DETAIL" WHERE "SELECT" LIKE :1 ORDER BY "SELECT" DESC, "USER ID" ASC OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY"#
        );
        assert_eq!(plan.params, vec!["A%"]);
        assert_eq!(plan.page_size, 25);
    }

    #[test]
    fn table_query_plan_validates_raw_where_and_uses_no_params() {
        let columns = vec![column("ID", "NUMBER(10,0)", true)];
        let plan = build_oracle_table_query_plan(
            &columns,
            "APP",
            "USERS",
            1,
            100,
            None,
            None,
            Some(r#""ID" IS NOT NULL"#),
        )
        .unwrap();

        assert_eq!(
            plan.executed_query,
            r#"SELECT "ID" FROM "APP"."USERS" WHERE "ID" IS NOT NULL ORDER BY "ID" ASC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY"#
        );
        assert!(plan.params.is_empty());
        assert!(build_oracle_table_query_plan(
            &columns,
            "APP",
            "USERS",
            1,
            100,
            None,
            None,
            Some(r#""ID" = 1; DROP TABLE USERS"#),
        )
        .is_err());
    }

    #[test]
    fn table_query_plan_handles_empty_projection_schema_and_page_defaults() {
        let plan =
            build_oracle_table_query_plan(&[], "", "USERS", 0, 0, None, None, Some("  ")).unwrap();

        assert_eq!(plan.count_sql, r#"SELECT COUNT(*) FROM "USERS""#);
        assert_eq!(
            plan.executed_query,
            r#"SELECT * FROM "USERS" OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY"#
        );
        assert!(plan.params.is_empty());
        assert_eq!(plan.page_size, 1);
    }

    #[test]
    fn oracle_where_clause_covers_filter_operators_and_skips_invalid_filters() {
        let columns = vec![
            column("ID", "NUMBER(10,0)", true),
            column("NAME", "VARCHAR2", false),
            column("AGE", "NUMBER(10,0)", false),
            column("CREATED_AT", "DATE", false),
        ];
        let filters = vec![
            FilterCondition {
                column: "MISSING".into(),
                operator: FilterOperator::Eq,
                value: Some("ignored".into()),
            },
            FilterCondition {
                column: "NAME".into(),
                operator: FilterOperator::IsNull,
                value: None,
            },
            FilterCondition {
                column: "CREATED_AT".into(),
                operator: FilterOperator::IsNotNull,
                value: None,
            },
            FilterCondition {
                column: "ID".into(),
                operator: FilterOperator::Eq,
                value: Some("1".into()),
            },
            FilterCondition {
                column: "ID".into(),
                operator: FilterOperator::Neq,
                value: Some("2".into()),
            },
            FilterCondition {
                column: "AGE".into(),
                operator: FilterOperator::Gt,
                value: Some("18".into()),
            },
            FilterCondition {
                column: "AGE".into(),
                operator: FilterOperator::Lt,
                value: Some("65".into()),
            },
            FilterCondition {
                column: "AGE".into(),
                operator: FilterOperator::Gte,
                value: Some("21".into()),
            },
            FilterCondition {
                column: "AGE".into(),
                operator: FilterOperator::Lte,
                value: Some("64".into()),
            },
            FilterCondition {
                column: "NAME".into(),
                operator: FilterOperator::Like,
                value: None,
            },
        ];

        let (where_clause, params) = build_oracle_where_clause(&columns, Some(&filters));

        assert_eq!(
            where_clause,
            r#" WHERE "NAME" IS NULL AND "CREATED_AT" IS NOT NULL AND "ID" = :1 AND "ID" <> :2 AND "AGE" > :3 AND "AGE" < :4 AND "AGE" >= :5 AND "AGE" <= :6"#
        );
        assert_eq!(params, vec!["1", "2", "18", "65", "21", "64"]);
    }

    #[test]
    fn oracle_where_clause_returns_empty_for_absent_or_unusable_filters() {
        let columns = vec![column("ID", "NUMBER(10,0)", true)];
        assert_eq!(
            build_oracle_where_clause(&columns, None),
            (String::new(), Vec::new())
        );
        assert_eq!(
            build_oracle_where_clause(&columns, Some(&[])),
            (String::new(), Vec::new())
        );

        let unusable = vec![
            FilterCondition {
                column: "MISSING".into(),
                operator: FilterOperator::Eq,
                value: Some("1".into()),
            },
            FilterCondition {
                column: "ID".into(),
                operator: FilterOperator::Eq,
                value: None,
            },
        ];
        assert_eq!(
            build_oracle_where_clause(&columns, Some(&unusable)),
            (String::new(), Vec::new())
        );
    }

    #[test]
    fn oracle_order_clause_sanitizes_user_sort_and_pk_fallbacks() {
        let columns = vec![
            column("ID", "NUMBER(10,0)", true),
            column("NAME", "VARCHAR2", false),
            column("AGE", "NUMBER(10,0)", false),
        ];

        assert_eq!(
            build_oracle_order_clause(
                &columns,
                Some("MISSING DESC, ID, NAME SIDEWAYS, AGE desc, TOO MANY PARTS")
            ),
            r#" ORDER BY "ID" ASC, "AGE" DESC"#
        );
        assert_eq!(
            build_oracle_order_clause(&columns, Some("NAME ASC")),
            r#" ORDER BY "NAME" ASC, "ID" ASC"#
        );
        assert_eq!(
            build_oracle_order_clause(&columns, Some("MISSING DESC")),
            r#" ORDER BY "ID" ASC"#
        );
        assert_eq!(build_oracle_order_clause(&[], None), "");
    }

    #[test]
    fn oracle_helpers_convert_bind_values_counts_and_errors() {
        let params = oracle_bind_values(&["Ada".to_string(), "42".to_string()]);
        match params.as_slice() {
            [Value::String(first), Value::String(second)] => {
                assert_eq!(first, "Ada");
                assert_eq!(second, "42");
            }
            other => panic!("expected Oracle string bind values, got {other:?}"),
        }

        assert_eq!(
            oracle_value_to_i64(&Row::new(vec![Value::Null]), 0, "count").unwrap(),
            None
        );
        assert_eq!(
            oracle_value_to_i64(&Row::new(vec![Value::Integer(7)]), 0, "count").unwrap(),
            Some(7)
        );
        assert_eq!(
            oracle_value_to_i64(
                &Row::new(vec![Value::Number(oracle_rs::types::OracleNumber::new(
                    "42"
                ))]),
                0,
                "count",
            )
            .unwrap(),
            Some(42)
        );
        assert_eq!(
            oracle_value_to_i64(&Row::new(vec![Value::Float(7.9)]), 0, "count").unwrap(),
            Some(7)
        );
        assert_eq!(
            oracle_value_to_i64(&Row::new(vec![Value::String("9".into())]), 0, "count").unwrap(),
            Some(9)
        );
        assert!(matches!(
            oracle_value_to_i64(&Row::new(vec![]), 0, "count"),
            Err(AppError::Database(message)) if message.contains("missing column")
        ));
        assert!(matches!(
            oracle_value_to_i64(&Row::new(vec![Value::String("NaN".into())]), 0, "count"),
            Err(AppError::Database(message)) if message.contains("decode failed")
        ));
        assert!(matches!(
            oracle_value_to_i64(&Row::new(vec![Value::Boolean(true)]), 0, "count"),
            Err(AppError::Database(message)) if message.contains("expected numeric value")
        ));
        assert!(matches!(
            oracle_table_error("context", "failure"),
            AppError::Database(message) if message == "context: failure"
        ));
    }

    #[tokio::test]
    async fn table_query_returns_cancelled_before_connection_lookup() {
        let adapter = OracleAdapter::new();
        let token = CancellationToken::new();
        token.cancel();

        let err = adapter
            .query_table_data("APP", "USERS", 1, 100, None, None, None, Some(&token))
            .await
            .expect_err("cancelled table query should not require a connection");

        assert!(matches!(err, AppError::Database(message) if message == "Operation cancelled"));
    }
}
