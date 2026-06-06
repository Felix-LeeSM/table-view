use futures_util::TryStreamExt;
use tiberius::{
    time::chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime},
    Column, ColumnData, ColumnType, QueryItem, Row,
};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{ColumnCategory, QueryColumn, QueryResult, QueryType};

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

        let config = self.connected_config().await?;
        let query_type = mssql_query_type(query);
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
                QueryType::Ddl => {
                    client
                        .execute(query, &[])
                        .await
                        .map_err(|err| mssql_query_error("SQL Server statement failed", err))?;
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
            if strip_trailing_terminator(raw).trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Statement {} of {} is empty",
                    idx + 1,
                    statements.len()
                )));
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

fn mssql_query_type(query: &str) -> QueryType {
    let trimmed = strip_leading_comments(query).to_uppercase();
    if trimmed.starts_with("SELECT")
        || trimmed.starts_with("WITH")
        || trimmed.starts_with("EXEC")
        || trimmed.starts_with("EXECUTE")
    {
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

fn mssql_query_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mssql_query_type_classifies_tsql_select_and_dml() {
        assert!(matches!(
            mssql_query_type("-- x\nSELECT 1;"),
            QueryType::Select
        ));
        assert!(matches!(
            mssql_query_type("/* x */ WITH cte AS (SELECT 1 AS id) SELECT id FROM cte"),
            QueryType::Select
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
    fn scalar_helpers_cover_json_and_type_edges() {
        assert_eq!(strip_trailing_terminator("SELECT 1;\n\t"), "SELECT 1");
        assert_eq!(strip_leading_comments("-- only a comment"), "");
        assert_eq!(strip_leading_comments("/* unterminated"), "");
        assert_eq!(hex_encode(&[0x00, 0xaf, 0xff]), "00afff");
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
}
