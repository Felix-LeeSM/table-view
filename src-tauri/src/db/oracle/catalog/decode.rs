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
    use oracle_rs::types::{OracleDate, OracleNumber, OracleTimestamp};

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
    fn map_oracle_data_type_covers_catalog_aliases() {
        let cases = [
            ("INTEGER", ColumnCategory::Int),
            ("PLS_INTEGER", ColumnCategory::Int),
            ("FLOAT", ColumnCategory::Float),
            ("DECIMAL", ColumnCategory::Float),
            ("TIMESTAMP WITH LOCAL TIME ZONE", ColumnCategory::Datetime),
            ("LONG RAW", ColumnCategory::Binary),
            ("BFILE", ColumnCategory::Binary),
            ("XMLTYPE", ColumnCategory::Object),
            ("SDO_GEOMETRY", ColumnCategory::Object),
            ("NCHAR", ColumnCategory::Text),
            ("NVARCHAR2", ColumnCategory::Text),
            ("NCLOB", ColumnCategory::Text),
            ("ROWID", ColumnCategory::Text),
            ("UROWID", ColumnCategory::Text),
            ("INTERVAL YEAR TO MONTH", ColumnCategory::Text),
            ("INTERVAL DAY TO SECOND", ColumnCategory::Text),
        ];

        for (data_type, expected) in cases {
            assert_eq!(map_oracle_data_type(data_type), expected, "{data_type}");
        }
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
    fn oracle_catalog_error_keeps_context_and_oracle_code() {
        let error = oracle_catalog_error(
            "Oracle synonym catalog query failed",
            oracle_rs::Error::oracle(942, "table or view does not exist"),
        );

        assert!(matches!(
            error,
            AppError::Database(message)
                if message.contains("Oracle synonym catalog query failed")
                    && message.contains("ORA-00942")
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
    fn row_decoders_convert_oracle_scalar_variants() {
        let row = Row::new(vec![
            Value::Number(OracleNumber::new("42")),
            Value::Float(12.5),
            Value::Date(OracleDate::new(2026, 6, 8, 9, 10, 11)),
            Value::Timestamp(OracleTimestamp::new(2026, 6, 8, 9, 10, 11, 1200)),
            Value::Boolean(false),
            Value::Bytes(vec![1, 2]),
        ]);

        assert_eq!(
            row_optional_string(&row, 0, "number").unwrap().as_deref(),
            Some("42")
        );
        assert_eq!(
            row_optional_string(&row, 1, "float").unwrap().as_deref(),
            Some("12.5")
        );
        assert_eq!(
            row_optional_string(&row, 2, "date").unwrap().as_deref(),
            Some("2026-06-08 09:10:11")
        );
        assert_eq!(
            row_optional_string(&row, 3, "timestamp")
                .unwrap()
                .as_deref(),
            Some("2026-06-08 09:10:11.001200")
        );
        assert_eq!(
            row_optional_string(&row, 4, "flag").unwrap().as_deref(),
            Some("N")
        );
        assert_eq!(
            row_optional_string(&row, 5, "raw").unwrap().as_deref(),
            Some("<2 bytes>")
        );
    }

    #[test]
    fn row_i64_decodes_numeric_shapes_and_reports_bad_values() {
        let row = Row::new(vec![
            Value::Number(OracleNumber::new("7")),
            Value::Float(8.9),
            Value::String("9".into()),
            Value::String("bad".into()),
            Value::Boolean(true),
        ]);

        assert_eq!(row_i64(&row, 0, "number").unwrap(), Some(7));
        assert_eq!(row_i64(&row, 1, "float").unwrap(), Some(8));
        assert_eq!(row_i64(&row, 2, "string").unwrap(), Some(9));
        assert!(matches!(
            row_i64(&row, 3, "string"),
            Err(AppError::Database(message)) if message.contains("decode failed")
        ));
        assert!(matches!(
            row_i64(&row, 4, "boolean"),
            Err(AppError::Database(message)) if message.contains("expected numeric value")
        ));
    }

    #[test]
    fn row_bool_yn_accepts_truthy_catalog_spellings_only() {
        for truthy in ["Y", "YES", "TRUE", "1", " y "] {
            let row = Row::new(vec![Value::String(truthy.into())]);
            assert!(row_bool_yn(&row, 0, "flag").unwrap(), "{truthy}");
        }

        for falsy in ["N", "FALSE", "0", ""] {
            let row = Row::new(vec![Value::String(falsy.into())]);
            assert!(!row_bool_yn(&row, 0, "flag").unwrap(), "{falsy}");
        }
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
