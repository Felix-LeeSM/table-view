use std::collections::BTreeSet;
use std::fs;

use duckdb::Connection;
use serde_json::Value;

use crate::error::AppError;
use crate::models::FileAnalyticsSourceKind;

use super::super::connection::RegisteredFileAnalyticsSource;
use super::super::sql_text::quote_identifier;
use super::quote_sql_string;

type JsonObjectRow = serde_json::Map<String, Value>;

pub(super) fn create_json_source_table(
    conn: &Connection,
    source: &RegisteredFileAnalyticsSource,
) -> Result<(), AppError> {
    let rows = parse_json_rows(source)?;
    if rows.is_empty() {
        return Err(AppError::Validation(
            "JSON file analytics requires at least one object row".into(),
        ));
    }

    let mut columns = BTreeSet::new();
    for row in &rows {
        columns.extend(row.keys().cloned());
    }
    if columns.is_empty() {
        return Err(AppError::Validation(
            "JSON file analytics requires object rows with at least one field".into(),
        ));
    }
    let columns = columns.into_iter().collect::<Vec<_>>();
    let column_kinds = infer_json_column_kinds(&rows, &columns);

    let table = quote_identifier(&source.public.alias);
    let column_defs = columns
        .iter()
        .zip(column_kinds.iter())
        .map(|(column, kind)| format!("{} {}", quote_identifier(column), kind.sql_type()))
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute(
        &format!("CREATE OR REPLACE TEMP TABLE {table} ({column_defs})"),
        [],
    )
    .map_err(|error| AppError::Database(error.to_string()))?;

    let values_sql = rows
        .iter()
        .map(|row| {
            let cells = columns
                .iter()
                .zip(column_kinds.iter())
                .map(|(column, kind)| json_sql_literal(row.get(column), *kind))
                .collect::<Vec<_>>()
                .join(", ");
            format!("({cells})")
        })
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute(&format!("INSERT INTO {table} VALUES {values_sql}"), [])
        .map_err(|error| AppError::Database(error.to_string()))?;
    Ok(())
}

fn parse_json_rows(source: &RegisteredFileAnalyticsSource) -> Result<Vec<JsonObjectRow>, AppError> {
    let body = fs::read_to_string(&source.path)
        .map_err(|error| AppError::Database(format!("Failed to read local JSON file: {error}")))?;
    match source.public.kind {
        FileAnalyticsSourceKind::Json => parse_json_document_rows(&body),
        FileAnalyticsSourceKind::Ndjson => parse_ndjson_rows(&body),
        _ => unreachable!("JSON parser should only receive JSON source kinds"),
    }
}

fn parse_json_document_rows(body: &str) -> Result<Vec<JsonObjectRow>, AppError> {
    match serde_json::from_str::<Value>(body).map_err(|error| {
        AppError::Validation(format!("JSON file analytics parse failed: {error}"))
    })? {
        Value::Array(values) => values
            .into_iter()
            .map(json_value_to_object_row)
            .collect::<Result<Vec<_>, _>>(),
        Value::Object(object) => Ok(vec![object]),
        _ => Err(AppError::Validation(
            "JSON file analytics expects an object or an array of objects".into(),
        )),
    }
}

fn parse_ndjson_rows(body: &str) -> Result<Vec<JsonObjectRow>, AppError> {
    body.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<Value>(line)
                .map_err(|error| {
                    AppError::Validation(format!("NDJSON file analytics parse failed: {error}"))
                })
                .and_then(json_value_to_object_row)
        })
        .collect()
}

fn json_value_to_object_row(value: Value) -> Result<JsonObjectRow, AppError> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(AppError::Validation(
            "JSON file analytics expects object rows".into(),
        )),
    }
}

#[derive(Clone, Copy)]
enum JsonColumnKind {
    Bool,
    Number,
    Text,
}

impl JsonColumnKind {
    fn sql_type(self) -> &'static str {
        match self {
            JsonColumnKind::Bool => "BOOLEAN",
            JsonColumnKind::Number => "DOUBLE",
            JsonColumnKind::Text => "VARCHAR",
        }
    }
}

fn infer_json_column_kinds(rows: &[JsonObjectRow], columns: &[String]) -> Vec<JsonColumnKind> {
    columns
        .iter()
        .map(|column| {
            let mut saw_bool = false;
            let mut saw_number = false;
            for row in rows {
                match row.get(column) {
                    None | Some(Value::Null) => {}
                    Some(Value::Bool(_)) => saw_bool = true,
                    Some(Value::Number(_)) => saw_number = true,
                    Some(Value::String(_) | Value::Array(_) | Value::Object(_)) => {
                        return JsonColumnKind::Text;
                    }
                }
            }
            match (saw_bool, saw_number) {
                (true, false) => JsonColumnKind::Bool,
                (false, true) => JsonColumnKind::Number,
                _ => JsonColumnKind::Text,
            }
        })
        .collect()
}

fn json_sql_literal(value: Option<&Value>, column_kind: JsonColumnKind) -> String {
    let Some(value) = value else {
        return "NULL".into();
    };

    match (value, column_kind) {
        (Value::Null, _) => "NULL".into(),
        (Value::Bool(value), JsonColumnKind::Bool) => {
            if *value {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        (Value::Number(value), JsonColumnKind::Number) => value.to_string(),
        (Value::String(value), JsonColumnKind::Text) => quote_sql_string(value),
        (Value::Bool(_) | Value::Number(_) | Value::Array(_) | Value::Object(_), _) => {
            quote_sql_string(&value.to_string())
        }
        (Value::String(value), _) => quote_sql_string(value),
    }
}
