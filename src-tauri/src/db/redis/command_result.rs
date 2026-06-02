use serde_json::{json, Value};

use crate::db::KvKeyType;
use crate::models::{ColumnCategory, QueryColumn, QueryResult, QueryType};

pub(super) fn rows_result(columns: &[QueryColumn], rows: Vec<Vec<Value>>) -> QueryResult {
    QueryResult {
        columns: columns.to_vec(),
        total_count: rows.len() as i64,
        rows,
        execution_time_ms: 0,
        query_type: QueryType::Select,
    }
}

pub(super) fn single_row(columns: &[QueryColumn], row: Vec<Value>) -> QueryResult {
    rows_result(columns, vec![row])
}

pub(super) fn mutation_result(key: &str, command: &str, changed: u64) -> QueryResult {
    QueryResult {
        columns: vec![text_col("key"), text_col("command"), int_col("changed")],
        rows: vec![vec![json!(key), json!(command), json!(changed)]],
        total_count: changed as i64,
        execution_time_ms: 0,
        query_type: QueryType::Dml {
            rows_affected: changed,
        },
    }
}

pub(super) fn string_cell(text: Option<String>, hex: Option<String>) -> Value {
    match (text, hex) {
        (Some(text), _) => json!(text),
        (None, Some(hex)) => json!(hex),
        (None, None) => Value::Null,
    }
}

pub(super) fn key_type_label(key_type: KvKeyType) -> &'static str {
    match key_type {
        KvKeyType::String => "string",
        KvKeyType::List => "list",
        KvKeyType::Set => "set",
        KvKeyType::ZSet => "zset",
        KvKeyType::Hash => "hash",
        KvKeyType::Stream => "stream",
        KvKeyType::Json => "json",
        KvKeyType::Unknown => "unknown",
    }
}

pub(super) fn ttl_state_label<T: std::fmt::Debug>(state: T) -> String {
    format!("{state:?}").to_ascii_lowercase()
}

pub(super) fn text_col(name: &str) -> QueryColumn {
    QueryColumn {
        name: name.into(),
        data_type: "text".into(),
        category: ColumnCategory::Text,
    }
}

pub(super) fn int_col(name: &str) -> QueryColumn {
    QueryColumn {
        name: name.into(),
        data_type: "integer".into(),
        category: ColumnCategory::Int,
    }
}

pub(super) fn float_col(name: &str) -> QueryColumn {
    QueryColumn {
        name: name.into(),
        data_type: "float".into(),
        category: ColumnCategory::Float,
    }
}

pub(super) fn object_col(name: &str) -> QueryColumn {
    QueryColumn {
        name: name.into(),
        data_type: "json".into(),
        category: ColumnCategory::Object,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_projection_uses_grid_friendly_columns() {
        let result = mutation_result("session:1", "set", 1);
        assert_eq!(result.columns[0].name, "key");
        assert_eq!(result.columns[2].category, ColumnCategory::Int);
        assert!(matches!(
            result.query_type,
            QueryType::Dml { rows_affected: 1 }
        ));
    }
}
