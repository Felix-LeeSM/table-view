use std::fmt::Display;

use serde_json::Value;

use crate::error::AppError;
use crate::models::ColumnCategory;

pub(super) fn map_mssql_data_type(data_type: &str) -> ColumnCategory {
    let lower = data_type.trim().to_ascii_lowercase();
    let base = lower.split(['(', ' ']).next().unwrap_or("");
    match base {
        "bit" => ColumnCategory::Bool,
        "tinyint" | "smallint" | "int" | "bigint" | "int1" | "int2" | "int4" | "int8" | "intn" => {
            ColumnCategory::Int
        }
        "decimal" | "numeric" | "money" | "smallmoney" | "float" | "real" | "decimaln"
        | "numericn" | "floatn" => ColumnCategory::Float,
        "date" | "datetime" | "datetime2" | "smalldatetime" | "datetimeoffset" | "time"
        | "daten" | "timen" | "datetimen" => ColumnCategory::Datetime,
        "uniqueidentifier" | "guid" => ColumnCategory::Uuid,
        "binary" | "varbinary" | "image" | "bigvarbin" | "bigbinary" => ColumnCategory::Binary,
        "xml" | "json" | "udt" => ColumnCategory::Object,
        "char" | "varchar" | "nchar" | "nvarchar" | "text" | "ntext" | "bigvarchar" | "bigchar" => {
            ColumnCategory::Text
        }
        _ => ColumnCategory::Unknown,
    }
}

pub(super) fn format_mssql_data_type(
    base_type: &str,
    max_length: Option<i64>,
    precision: Option<i64>,
    scale: Option<i64>,
) -> String {
    match base_type.to_ascii_lowercase().as_str() {
        "varchar" | "char" | "binary" | "varbinary" => match max_length {
            Some(-1) => format!("{base_type}(max)"),
            Some(len) if len > 0 => format!("{base_type}({len})"),
            _ => base_type.to_string(),
        },
        "nvarchar" | "nchar" => match max_length {
            Some(-1) => format!("{base_type}(max)"),
            Some(len) if len > 0 => format!("{base_type}({})", len / 2),
            _ => base_type.to_string(),
        },
        "decimal" | "numeric" => match (precision, scale) {
            (Some(p), Some(s)) if p > 0 => format!("{base_type}({p},{s})"),
            _ => base_type.to_string(),
        },
        _ => base_type.to_string(),
    }
}

pub(super) fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} must not be empty")));
    }
    if trimmed.len() > 128 {
        return Err(AppError::Validation(format!(
            "{label} must not exceed 128 bytes"
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(AppError::Validation(format!("{label} must not be empty")));
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(AppError::Validation(format!(
            "{label} must start with a letter or underscore"
        )));
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(AppError::Validation(format!(
                "{label} must contain only alphanumeric characters and underscores"
            )));
        }
    }
    Ok(())
}

pub(super) fn quote_ident(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

pub(super) fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

pub(super) fn sql_string(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

pub(super) fn json_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        _ => None,
    }
}

pub(super) fn json_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

pub(super) fn json_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::Number(n)) => n.as_i64().map(|v| v != 0),
        Some(Value::String(s)) => match s.as_str() {
            "true" | "TRUE" | "1" => Some(true),
            "false" | "FALSE" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn mssql_error(context: &'static str, err: impl Display) -> AppError {
    AppError::Connection(format!("{context}: {err}"))
}

pub(super) fn mssql_db_error(context: &'static str, err: impl Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}
