use std::collections::HashSet;
use std::time::Instant;

use oracle_rs::Connection as OracleConnection;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    ConnectionConfig, FilterCondition, QueryColumn, QueryResult, QueryType, SchemaChangeResult,
    TableData,
};

use super::common::{
    build_order_clause, build_where_clause, classify_mutation, is_oracle_ddl, is_select_like,
    json_i64, map_oracle_data_type, oracle_db_error, oracle_error, oracle_type_name,
    oracle_value_to_json, qualified_table, strip_leading_comments, strip_trailing_terminator,
    validate_identifier,
};
use super::OracleAdapter;

impl OracleAdapter {
    pub(super) async fn query_select(
        config: &ConnectionConfig,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let started = Instant::now();
        let connection = Self::connect_driver(config).await?;
        let result = connection
            .query(sql, &[])
            .await
            .map_err(|err| oracle_db_error("Oracle query failed", err))?;

        let columns: Vec<QueryColumn> = result
            .columns
            .iter()
            .map(|column| {
                let data_type =
                    oracle_type_name(column.oracle_type, column.precision, column.scale);
                QueryColumn {
                    name: column.name.clone(),
                    category: map_oracle_data_type(&data_type),
                    data_type,
                }
            })
            .collect();
        let rows: Vec<Vec<Value>> = result
            .rows
            .iter()
            .map(|row| row.values().iter().map(oracle_value_to_json).collect())
            .collect();

        connection
            .close()
            .await
            .map_err(|err| oracle_error("Oracle close failed", err))?;

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
        let connection = Self::connect_driver(config).await?;
        let result = connection
            .execute(sql, &[])
            .await
            .map_err(|err| oracle_db_error("Oracle statement failed", err))?;
        connection
            .commit()
            .await
            .map_err(|err| oracle_db_error("Oracle commit failed", err))?;
        connection
            .close()
            .await
            .map_err(|err| oracle_error("Oracle close failed", err))?;

        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            total_count: result.rows_affected as i64,
            execution_time_ms: started.elapsed().as_millis() as u64,
            query_type: classify_mutation(trimmed, result.rows_affected),
        })
    }

    pub(super) async fn execute_statement_on_connection(
        connection: &OracleConnection,
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
            let result = connection
                .query(sql, &[])
                .await
                .map_err(|err| oracle_db_error("Oracle query failed", err))?;
            let columns = result
                .columns
                .iter()
                .map(|column| {
                    let data_type =
                        oracle_type_name(column.oracle_type, column.precision, column.scale);
                    QueryColumn {
                        name: column.name.clone(),
                        category: map_oracle_data_type(&data_type),
                        data_type,
                    }
                })
                .collect();
            let rows: Vec<Vec<Value>> = result
                .rows
                .iter()
                .map(|row| row.values().iter().map(oracle_value_to_json).collect())
                .collect();
            return Ok(QueryResult {
                columns,
                total_count: rows.len() as i64,
                rows,
                execution_time_ms: started.elapsed().as_millis() as u64,
                query_type: QueryType::Select,
            });
        }

        let started = Instant::now();
        let result = connection
            .execute(sql, &[])
            .await
            .map_err(|err| oracle_db_error("Oracle statement failed", err))?;
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            total_count: result.rows_affected as i64,
            execution_time_ms: started.elapsed().as_millis() as u64,
            query_type: classify_mutation(trimmed, result.rows_affected),
        })
    }

    pub(super) async fn run_schema_sql(
        &self,
        sql: &str,
        preview_only: bool,
    ) -> Result<SchemaChangeResult, AppError> {
        if !preview_only {
            let config = self.connected_config().await?;
            Self::execute_statement(&config, sql).await?;
        }
        Ok(SchemaChangeResult {
            sql: sql.to_string(),
        })
    }
    pub(super) async fn execute_sql_impl(
        &self,
        sql: &str,
        cancel: Option<&CancellationToken>,
    ) -> Result<QueryResult, AppError> {
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
    }

    pub(super) async fn execute_sql_batch_impl(
        &self,
        statements: &[String],
        cancel: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let config = self.connected_config().await?;
        let connection = Self::connect_driver(&config).await?;
        connection
            .execute("SAVEPOINT table_view_batch", &[])
            .await
            .map_err(|err| oracle_db_error("Oracle savepoint failed", err))?;
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            if let Some(token) = cancel {
                if token.is_cancelled() {
                    let _ = connection.rollback_to_savepoint("table_view_batch").await;
                    return Err(AppError::Database("Operation cancelled".into()));
                }
            }
            match Self::execute_statement_on_connection(&connection, statement).await {
                Ok(result) => results.push(result),
                Err(err) => {
                    let _ = connection.rollback_to_savepoint("table_view_batch").await;
                    return Err(err);
                }
            }
        }
        connection
            .commit()
            .await
            .map_err(|err| oracle_db_error("Oracle commit failed", err))?;
        connection
            .close()
            .await
            .map_err(|err| oracle_error("Oracle close failed", err))?;
        Ok(results)
    }

    pub(super) async fn dry_run_sql_batch_impl(
        &self,
        statements: &[String],
        cancel: Option<&CancellationToken>,
    ) -> Result<Vec<QueryResult>, AppError> {
        if statements.iter().any(|sql| is_oracle_ddl(sql)) {
            return Err(AppError::Unsupported(
                "Oracle DDL auto-commits; dry-run is supported for DML/query batches only".into(),
            ));
        }
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let config = self.connected_config().await?;
        let connection = Self::connect_driver(&config).await?;
        connection
            .execute("SAVEPOINT table_view_dry_run", &[])
            .await
            .map_err(|err| oracle_db_error("Oracle savepoint failed", err))?;
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            if let Some(token) = cancel {
                if token.is_cancelled() {
                    let _ = connection.rollback_to_savepoint("table_view_dry_run").await;
                    return Err(AppError::Database("Operation cancelled".into()));
                }
            }
            match Self::execute_statement_on_connection(&connection, statement).await {
                Ok(result) => results.push(result),
                Err(err) => {
                    let _ = connection.rollback_to_savepoint("table_view_dry_run").await;
                    return Err(err);
                }
            }
        }
        connection
            .rollback_to_savepoint("table_view_dry_run")
            .await
            .map_err(|err| oracle_db_error("Oracle rollback failed", err))?;
        connection
            .rollback()
            .await
            .map_err(|err| oracle_db_error("Oracle rollback failed", err))?;
        connection
            .close()
            .await
            .map_err(|err| oracle_error("Oracle close failed", err))?;
        Ok(results)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn query_table_data_impl(
        &self,
        namespace: &str,
        table: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
        raw_where: Option<&str>,
        cancel: Option<&CancellationToken>,
    ) -> Result<TableData, AppError> {
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
        let count_result = Self::query_select(
            &config,
            &format!("SELECT COUNT(*) FROM {qualified}{where_clause}"),
        )
        .await?;
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
    }
}
