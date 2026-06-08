use oracle_rs::{Connection as OracleConnection, Row, Value};

use crate::error::AppError;
use crate::models::ColumnCategory;

pub(super) async fn query_rows(
    connection: &OracleConnection,
    context: &'static str,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Row>, AppError> {
    let mut result = connection
        .query(sql, params)
        .await
        .map_err(|err| oracle_catalog_error(context, err))?;
    let columns = result.columns.clone();
    let mut rows = result.rows;

    while result.has_more_rows {
        if result.cursor_id == 0 {
            return Err(AppError::Database(format!(
                "{context}: Oracle returned a partial catalog cursor without a cursor id"
            )));
        }
        result = connection
            .fetch_more(result.cursor_id, &columns, 100)
            .await
            .map_err(|err| oracle_catalog_error(context, err))?;
        rows.extend(result.rows);
    }

    Ok(rows)
}

pub(super) async fn query_rows_or_empty_on_metadata_denied(
    connection: &OracleConnection,
    context: &'static str,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Row>, AppError> {
    match query_rows(connection, context, sql, params).await {
        Ok(rows) => Ok(rows),
        Err(AppError::Database(message)) if is_metadata_permission_error(&message) => {
            Ok(Vec::new())
        }
        Err(error) => Err(error),
    }
}

pub(super) fn row_string(row: &Row, idx: usize, label: &'static str) -> Result<String, AppError> {
    Ok(row_optional_string(row, idx, label)?.unwrap_or_default())
}

pub(super) fn row_optional_string(
    row: &Row,
    idx: usize,
    label: &'static str,
) -> Result<Option<String>, AppError> {
    let value = row.values().get(idx).ok_or_else(|| {
        AppError::Database(format!(
            "Oracle {label} decode failed: missing column {idx}"
        ))
    })?;

    Ok(match value {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        Value::Integer(value) => Some(value.to_string()),
        Value::Float(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.as_str().to_string()),
        Value::Date(value) => Some(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            value.year, value.month, value.day, value.hour, value.minute, value.second
        )),
        Value::Timestamp(value) => Some(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
            value.year,
            value.month,
            value.day,
            value.hour,
            value.minute,
            value.second,
            value.microsecond
        )),
        Value::Boolean(value) => Some(if *value { "Y" } else { "N" }.to_string()),
        _ => Some(value.to_string()),
    })
}

pub(super) fn row_i64(row: &Row, idx: usize, label: &'static str) -> Result<Option<i64>, AppError> {
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

pub(super) fn row_bool_yn(row: &Row, idx: usize, label: &'static str) -> Result<bool, AppError> {
    Ok(matches!(
        row_optional_string(row, idx, label)?
            .unwrap_or_default()
            .trim()
            .to_ascii_uppercase()
            .as_str(),
        "Y" | "YES" | "TRUE" | "1"
    ))
}

pub(super) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
}

pub(super) fn map_oracle_data_type(data_type: &str) -> ColumnCategory {
    match data_type.trim().to_ascii_uppercase().as_str() {
        "NUMBER" | "INTEGER" | "INT" | "SMALLINT" | "BINARY_INTEGER" | "PLS_INTEGER" => {
            ColumnCategory::Int
        }
        "BINARY_FLOAT" | "BINARY_DOUBLE" | "FLOAT" | "DECIMAL" | "NUMERIC" => ColumnCategory::Float,
        "DATE" | "TIMESTAMP" | "TIMESTAMP WITH TIME ZONE" | "TIMESTAMP WITH LOCAL TIME ZONE" => {
            ColumnCategory::Datetime
        }
        "RAW" | "LONG RAW" | "BLOB" | "BFILE" => ColumnCategory::Binary,
        "BOOLEAN" => ColumnCategory::Bool,
        "JSON" | "VECTOR" | "XMLTYPE" | "OBJECT" | "SDO_GEOMETRY" => ColumnCategory::Object,
        "CHAR"
        | "NCHAR"
        | "VARCHAR2"
        | "NVARCHAR2"
        | "LONG"
        | "CLOB"
        | "NCLOB"
        | "ROWID"
        | "UROWID"
        | "INTERVAL YEAR TO MONTH"
        | "INTERVAL DAY TO SECOND" => ColumnCategory::Text,
        _ => ColumnCategory::Unknown,
    }
}

pub(super) fn is_metadata_permission_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("ora-00942")
        || lower.contains("ora-01031")
        || lower.contains("ora-04043")
        || lower.contains("ora-31603")
        || lower.contains("ora-31608")
        || lower.contains("insufficient privileges")
        || lower.contains("permission")
        || lower.contains("not authorized")
        || lower.contains("metadata")
        || lower.contains("dictionary")
}

fn oracle_catalog_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_oracle_data_type_classifies_datagrid_categories() {
        assert_eq!(map_oracle_data_type("NUMBER"), ColumnCategory::Int);
        assert_eq!(map_oracle_data_type("binary_double"), ColumnCategory::Float);
        assert_eq!(
            map_oracle_data_type("timestamp with time zone"),
            ColumnCategory::Datetime
        );
        assert_eq!(map_oracle_data_type("raw"), ColumnCategory::Binary);
        assert_eq!(map_oracle_data_type("boolean"), ColumnCategory::Bool);
        assert_eq!(map_oracle_data_type("json"), ColumnCategory::Object);
        assert_eq!(map_oracle_data_type("varchar2"), ColumnCategory::Text);
        assert_eq!(map_oracle_data_type("mystery"), ColumnCategory::Unknown);
    }

    #[test]
    fn format_fk_reference_matches_datagrid_contract() {
        assert_eq!(format_fk_reference("HR", "USERS", "ID"), "HR.USERS(ID)");
    }

    #[test]
    fn permission_errors_are_safe_empty_metadata_candidates() {
        assert!(is_metadata_permission_error(
            "Oracle routine catalog query failed: ORA-01031: insufficient privileges"
        ));
        assert!(is_metadata_permission_error(
            "Oracle view definition query failed: ORA-00942: table or view does not exist"
        ));
        assert!(is_metadata_permission_error(
            "user is not authorized to read metadata dictionary"
        ));
        assert!(!is_metadata_permission_error(
            "Oracle login failed: connection timeout"
        ));
    }

    #[test]
    fn row_decoders_handle_common_oracle_values() {
        let row = Row::new(vec![
            Value::String("APP".into()),
            Value::Integer(42),
            Value::String("Y".into()),
            Value::Null,
        ]);

        assert_eq!(row_string(&row, 0, "owner").unwrap(), "APP");
        assert_eq!(row_i64(&row, 1, "row count").unwrap(), Some(42));
        assert!(row_bool_yn(&row, 2, "nullable").unwrap());
        assert_eq!(row_optional_string(&row, 3, "comment").unwrap(), None);
    }

    #[test]
    fn row_decoders_surface_missing_columns() {
        let row = Row::new(vec![]);

        assert!(matches!(
            row_string(&row, 0, "owner"),
            Err(AppError::Database(message)) if message.contains("missing column 0")
        ));
        assert!(matches!(
            row_i64(&row, 0, "row count"),
            Err(AppError::Database(message)) if message.contains("missing column 0")
        ));
    }
}
