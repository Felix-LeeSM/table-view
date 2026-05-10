use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents the type of SQL query that was executed
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryType {
    /// SELECT queries and other read-only statements (WITH, SHOW, etc.)
    Select,
    /// Data Manipulation Language (INSERT, UPDATE, DELETE)
    Dml { rows_affected: u64 },
    /// Data Definition Language (CREATE, ALTER, DROP, etc.)
    Ddl,
}

/// Display category for a column — drives DataGrid layout (default width
/// and text-align). Independent of the raw `data_type`, which is preserved
/// verbatim for structure / records views (Sprint 238 AC-238-02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ColumnCategory {
    Int,
    Float,
    Text,
    Bool,
    Datetime,
    Object,
    Binary,
    Enum,
    #[default]
    Unknown,
}

/// Column metadata for a query result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryColumn {
    /// Column name
    pub name: String,
    /// Column data type (database-specific type name)
    pub data_type: String,
    /// Display category — UI policy hint (width + alignment).
    pub category: ColumnCategory,
}

/// Result of an arbitrary SQL query execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    /// Column metadata (names and types)
    pub columns: Vec<QueryColumn>,
    /// Row data as JSON values (organized by column)
    pub rows: Vec<Vec<Value>>,
    /// Total number of rows returned/affected
    pub total_count: i64,
    /// Query execution time in milliseconds
    pub execution_time_ms: u64,
    /// Type of query that was executed
    pub query_type: QueryType,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn column_category_int_serializes_lowercase() {
        // Sprint 238 AC-238-02 — category enum 은 frontend 의 ColumnCategory
        // string-literal 과 일치해야 한다 (snake_case → "int").
        let category = ColumnCategory::Int;
        let json = serde_json::to_string(&category).unwrap();
        assert_eq!(json, "\"int\"");
    }

    #[test]
    fn all_column_categories_serialize_lowercase() {
        // 8 종 + unknown = 9. Frontend ColumnCategory union 과 일치 검증.
        let pairs: &[(ColumnCategory, &str)] = &[
            (ColumnCategory::Int, "int"),
            (ColumnCategory::Float, "float"),
            (ColumnCategory::Text, "text"),
            (ColumnCategory::Bool, "bool"),
            (ColumnCategory::Datetime, "datetime"),
            (ColumnCategory::Object, "object"),
            (ColumnCategory::Binary, "binary"),
            (ColumnCategory::Enum, "enum"),
            (ColumnCategory::Unknown, "unknown"),
        ];
        for (variant, expected) in pairs {
            let json = serde_json::to_string(variant).unwrap();
            assert_eq!(json, format!("\"{expected}\""));
        }
    }

    #[test]
    fn query_type_select_serializes_correctly() {
        let qt = QueryType::Select;
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "\"select\"");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, QueryType::Select));
    }

    #[test]
    fn query_type_dml_serializes_correctly() {
        let qt = QueryType::Dml { rows_affected: 42 };
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "{\"dml\":{\"rows_affected\":42}}");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        match deserialized {
            QueryType::Dml { rows_affected } => {
                assert_eq!(rows_affected, 42);
            }
            _ => panic!("Expected Dml variant"),
        }
    }

    #[test]
    fn query_type_ddl_serializes_correctly() {
        let qt = QueryType::Ddl;
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "\"ddl\"");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, QueryType::Ddl));
    }

    #[test]
    fn query_column_serializes_correctly() {
        let col = QueryColumn {
            name: "user_id".to_string(),
            data_type: "integer".to_string(),
            category: ColumnCategory::Unknown,
        };
        let json = serde_json::to_string(&col).unwrap();
        let deserialized: QueryColumn = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "user_id");
        assert_eq!(deserialized.data_type, "integer");
    }

    #[test]
    fn query_result_select_serializes_correctly() {
        let result = QueryResult {
            columns: vec![
                QueryColumn {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    category: ColumnCategory::Unknown,
                },
                QueryColumn {
                    name: "name".to_string(),
                    data_type: "text".to_string(),
                    category: ColumnCategory::Unknown,
                },
            ],
            rows: vec![
                vec![Value::Number(1.into()), Value::String("Alice".to_string())],
                vec![Value::Number(2.into()), Value::String("Bob".to_string())],
            ],
            total_count: 2,
            execution_time_ms: 15,
            query_type: QueryType::Select,
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.columns.len(), 2);
        assert_eq!(deserialized.rows.len(), 2);
        assert_eq!(deserialized.total_count, 2);
        assert_eq!(deserialized.execution_time_ms, 15);
        assert!(matches!(deserialized.query_type, QueryType::Select));
    }

    #[test]
    fn query_result_dml_serializes_correctly() {
        let result = QueryResult {
            columns: vec![],
            rows: vec![],
            total_count: 5,
            execution_time_ms: 8,
            query_type: QueryType::Dml { rows_affected: 5 },
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total_count, 5);
        assert_eq!(deserialized.execution_time_ms, 8);
        match deserialized.query_type {
            QueryType::Dml { rows_affected } => {
                assert_eq!(rows_affected, 5);
            }
            _ => panic!("Expected Dml variant"),
        }
    }

    #[test]
    fn query_result_ddl_serializes_correctly() {
        let result = QueryResult {
            columns: vec![],
            rows: vec![],
            total_count: 0,
            execution_time_ms: 120,
            query_type: QueryType::Ddl,
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total_count, 0);
        assert_eq!(deserialized.execution_time_ms, 120);
        assert!(matches!(deserialized.query_type, QueryType::Ddl));
    }
}
