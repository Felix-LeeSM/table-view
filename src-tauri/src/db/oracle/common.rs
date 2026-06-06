use std::collections::HashSet;
use std::fmt::Display;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use oracle_rs::{OracleType, Value as OracleValue};
use serde_json::Value;

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnDefinition, ColumnInfo, ConstraintDefinition, FilterCondition,
    FilterOperator, QueryType,
};

pub(super) const SYSTEM_SCHEMAS: &[&str] = &[
    "SYS",
    "SYSTEM",
    "XDB",
    "CTXSYS",
    "MDSYS",
    "ORDSYS",
    "OUTLN",
    "DBSNMP",
    "GSMADMIN_INTERNAL",
    "AUDSYS",
    "WMSYS",
];
pub(super) const REFERENTIAL_ACTIONS: &[&str] = &["NO ACTION", "CASCADE", "SET NULL"];
pub(super) const ORACLE_INDEX_TYPES: &[&str] = &["btree", "bitmap"];

pub(super) fn oracle_value_to_json(value: &OracleValue) -> Value {
    match value {
        OracleValue::Null => Value::Null,
        OracleValue::String(s) => Value::String(s.clone()),
        OracleValue::Bytes(bytes) => Value::String(BASE64.encode(bytes)),
        OracleValue::Integer(i) => Value::Number((*i).into()),
        OracleValue::Float(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        OracleValue::Number(n) => Value::String(n.as_str().to_string()),
        OracleValue::Date(_)
        | OracleValue::Timestamp(_)
        | OracleValue::RowId(_)
        | OracleValue::Lob(_)
        | OracleValue::Vector(_)
        | OracleValue::Cursor(_)
        | OracleValue::Collection(_) => Value::String(value.to_string()),
        OracleValue::Boolean(b) => Value::Bool(*b),
        OracleValue::Json(json) => json.clone(),
    }
}

pub(super) fn oracle_type_name(oracle_type: OracleType, precision: i16, scale: i16) -> String {
    match oracle_type {
        OracleType::Varchar => "varchar2".into(),
        OracleType::Number if precision > 0 => format!("number({precision},{scale})"),
        OracleType::Number => "number".into(),
        OracleType::BinaryInteger => "binary_integer".into(),
        OracleType::Long => "long".into(),
        OracleType::Rowid => "rowid".into(),
        OracleType::Date => "date".into(),
        OracleType::Raw => "raw".into(),
        OracleType::LongRaw => "long raw".into(),
        OracleType::Char => "char".into(),
        OracleType::BinaryFloat => "binary_float".into(),
        OracleType::BinaryDouble => "binary_double".into(),
        OracleType::Cursor => "ref cursor".into(),
        OracleType::Object => "object".into(),
        OracleType::Clob => "clob".into(),
        OracleType::Blob => "blob".into(),
        OracleType::Bfile => "bfile".into(),
        OracleType::Json => "json".into(),
        OracleType::Vector => "vector".into(),
        OracleType::Timestamp => "timestamp".into(),
        OracleType::TimestampTz => "timestamp with time zone".into(),
        OracleType::IntervalYm => "interval year to month".into(),
        OracleType::IntervalDs => "interval day to second".into(),
        OracleType::Urowid => "urowid".into(),
        OracleType::TimestampLtz => "timestamp with local time zone".into(),
        OracleType::Boolean => "boolean".into(),
    }
}

pub(super) fn map_oracle_data_type(data_type: &str) -> ColumnCategory {
    let lower = data_type.trim().to_ascii_lowercase();
    let base = lower.split(['(', ' ']).next().unwrap_or("");
    match base {
        "number" | "binary_integer" => ColumnCategory::Float,
        "binary_float" | "binary_double" | "float" => ColumnCategory::Float,
        "date" | "timestamp" | "interval" => ColumnCategory::Datetime,
        "char" | "nchar" | "varchar2" | "nvarchar2" | "clob" | "nclob" | "long" => {
            ColumnCategory::Text
        }
        "raw" | "blob" | "bfile" => ColumnCategory::Binary,
        "json" | "object" | "vector" | "cursor" => ColumnCategory::Object,
        "boolean" => ColumnCategory::Bool,
        _ => ColumnCategory::Unknown,
    }
}

pub(super) fn format_oracle_dictionary_type(
    base_type: &str,
    data_length: Option<i64>,
    precision: Option<i64>,
    scale: Option<i64>,
) -> String {
    match base_type.to_ascii_uppercase().as_str() {
        "VARCHAR2" | "CHAR" | "NVARCHAR2" | "NCHAR" | "RAW" => match data_length {
            Some(length) if length > 0 => format!("{base_type}({length})"),
            _ => base_type.to_string(),
        },
        "NUMBER" => match (precision, scale) {
            (Some(p), Some(s)) if p > 0 => format!("{base_type}({p},{s})"),
            (Some(p), _) if p > 0 => format!("{base_type}({p})"),
            _ => base_type.to_string(),
        },
        _ => base_type.to_string(),
    }
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

pub(super) fn starts_with_keyword(input: &str, keyword: &str) -> bool {
    input.strip_prefix(keyword).is_some_and(|rest| {
        rest.chars()
            .next()
            .is_none_or(|ch| !ch.is_ascii_alphanumeric())
    })
}

pub(super) fn is_select_like(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    ["SELECT", "WITH"]
        .iter()
        .any(|kw| starts_with_keyword(&upper, kw))
}

pub(super) fn is_oracle_ddl(sql: &str) -> bool {
    let upper = strip_leading_comments(sql)
        .trim_start()
        .to_ascii_uppercase();
    ["CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME"]
        .iter()
        .any(|kw| starts_with_keyword(&upper, kw))
}

pub(super) fn classify_mutation(sql: &str, rows_affected: u64) -> QueryType {
    let upper = sql.trim_start().to_ascii_uppercase();
    if ["INSERT", "UPDATE", "DELETE", "MERGE"]
        .iter()
        .any(|kw| starts_with_keyword(&upper, kw))
    {
        QueryType::Dml { rows_affected }
    } else {
        QueryType::Ddl
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

pub(super) fn oracle_canonical_name(name: &str) -> String {
    name.trim().to_ascii_uppercase()
}

pub(super) fn quote_ident(name: &str) -> String {
    format!("\"{}\"", oracle_canonical_name(name).replace('"', "\"\""))
}

pub(super) fn qualified_table(schema: &str, table: &str) -> String {
    qualified_object(schema, table)
}

pub(super) fn qualified_object(schema: &str, object: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(object))
}

pub(super) fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn oracle_name_literal(value: &str) -> String {
    sql_string(&oracle_canonical_name(value))
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
        if starts_with_keyword(&upper, keyword) {
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
            let canonical = oracle_canonical_name(&filter.column);
            if !valid_columns.contains(canonical.as_str()) {
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
    let valid_columns: HashSet<String> = columns
        .iter()
        .map(|c| oracle_canonical_name(&c.name))
        .collect();
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
            if valid_columns.contains(&oracle_canonical_name(column)) {
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
        " ORDER BY 1".into()
    } else {
        format!(" ORDER BY {}", parts.join(", "))
    }
}

pub(super) fn oracle_column_definition(column: &ColumnDefinition) -> Result<String, AppError> {
    validate_identifier(&column.name, "Column name")?;
    if column.data_type.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            column.name
        )));
    }
    let mut def = format!("{} {}", quote_ident(&column.name), column.data_type.trim());
    if column.is_identity {
        def.push_str(" GENERATED BY DEFAULT AS IDENTITY");
    } else if let Some(default) = &column.default_value {
        if !default.trim().is_empty() {
            def.push_str(&format!(" DEFAULT {}", default.trim()));
        }
    }
    if !column.nullable || column.is_identity {
        def.push_str(" NOT NULL");
    }
    Ok(def)
}

pub(super) fn oracle_constraint_definition(
    definition: &ConstraintDefinition,
) -> Result<String, AppError> {
    match definition {
        ConstraintDefinition::PrimaryKey { columns } => {
            if columns.is_empty() {
                return Err(AppError::Validation(
                    "Primary key requires at least one column".into(),
                ));
            }
            for col in columns {
                validate_identifier(col, "Primary key column name")?;
            }
            Ok(format!(
                "PRIMARY KEY ({})",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
        ConstraintDefinition::ForeignKey {
            columns,
            reference_table,
            reference_columns,
            on_delete,
            on_update,
        } => {
            if on_update.is_some() {
                return Err(AppError::Unsupported(
                    "Oracle foreign keys do not support ON UPDATE actions".into(),
                ));
            }
            if columns.is_empty() || reference_columns.is_empty() {
                return Err(AppError::Validation(
                    "Foreign key requires local and reference columns".into(),
                ));
            }
            for col in columns {
                validate_identifier(col, "Foreign key column name")?;
            }
            validate_identifier(reference_table, "Foreign key reference table name")?;
            for col in reference_columns {
                validate_identifier(col, "Foreign key reference column name")?;
            }
            Ok(format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}){}",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote_ident(reference_table),
                reference_columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", "),
                referential_action(on_delete.as_deref(), "ON DELETE")?
            ))
        }
        ConstraintDefinition::Unique { columns } => {
            if columns.is_empty() {
                return Err(AppError::Validation(
                    "Unique constraint requires at least one column".into(),
                ));
            }
            for col in columns {
                validate_identifier(col, "Unique constraint column name")?;
            }
            Ok(format!(
                "UNIQUE ({})",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
        ConstraintDefinition::Check { expression } => {
            if expression.trim().is_empty() {
                return Err(AppError::Validation(
                    "Check constraint expression must not be empty".into(),
                ));
            }
            Ok(format!("CHECK ({})", expression.trim()))
        }
    }
}

pub(super) fn referential_action(action: Option<&str>, clause: &str) -> Result<String, AppError> {
    match action {
        None => Ok(String::new()),
        Some(action) if REFERENTIAL_ACTIONS.contains(&action) => Ok(format!(" {clause} {action}")),
        Some(action) => Err(AppError::Validation(format!(
            "Invalid referential action: {} (expected one of {})",
            action,
            REFERENTIAL_ACTIONS.join(", ")
        ))),
    }
}

pub(super) fn oracle_constraint_type(value: Option<&str>) -> String {
    match value {
        Some("P") => "PRIMARY KEY".into(),
        Some("U") => "UNIQUE".into(),
        Some("R") => "FOREIGN KEY".into(),
        Some("C") => "CHECK".into(),
        Some(other) => other.into(),
        None => String::new(),
    }
}

pub(super) fn oracle_error(context: &'static str, err: impl Display) -> AppError {
    AppError::Connection(format!("{context}: {err}"))
}

pub(super) fn oracle_db_error(context: &'static str, err: impl Display) -> AppError {
    AppError::Database(format!("{context}: {err}"))
}
