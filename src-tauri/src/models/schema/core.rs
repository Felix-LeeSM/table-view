use serde::{Deserialize, Serialize};

use crate::models::ColumnCategory;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub fk_reference: Option<String>,
    pub comment: Option<String>,
    /// CHECK constraint expressions where this column appears in the
    /// constraint's column list. Multiple constraints can target the
    /// same column; each entry is the full `pg_get_constraintdef()`
    /// output (e.g. `"CHECK ((age >= 0))"`). Empty when no CHECK
    /// constraint references the column. `#[serde(default)]` keeps
    /// payloads from older callers (or non-PG adapters that don't
    /// populate the field) deserializing to an empty vector.
    #[serde(default)]
    pub check_clauses: Vec<String>,
    /// Sprint 238 AC-238-02 — display category for the DataGrid (drives
    /// default width + text-align). Independent of `data_type`, which is
    /// preserved verbatim for structure / records views. `#[serde(default)]`
    /// keeps older payloads (and callers that don't enrich) parsing as
    /// `Unknown`.
    #[serde(default)]
    pub category: ColumnCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_count: i64,
    pub page: i32,
    pub page_size: i32,
    pub executed_query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub reference_table: Option<String>,
    pub reference_columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FilterOperator {
    Eq,
    Neq,
    Gt,
    Lt,
    Gte,
    Lte,
    Like,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    /// SQL binary comparison token for this operator, or `None` for the
    /// null-check operators (`IsNull`/`IsNotNull`) which take no right-hand
    /// operand. #1354 — the single source every RDB adapter maps through, so a
    /// new variant is a compile error in every caller instead of a runtime
    /// `unreachable!()` panic in the postgres/mysql/duckdb filter builders.
    pub fn comparison_sql(&self) -> Option<&'static str> {
        match self {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}

#[cfg(test)]
mod filter_operator_tests {
    use super::FilterOperator;

    #[test]
    fn comparison_sql_maps_binary_operators_and_none_for_null_checks() {
        assert_eq!(FilterOperator::Eq.comparison_sql(), Some("="));
        assert_eq!(FilterOperator::Neq.comparison_sql(), Some("<>"));
        assert_eq!(FilterOperator::Gt.comparison_sql(), Some(">"));
        assert_eq!(FilterOperator::Lt.comparison_sql(), Some("<"));
        assert_eq!(FilterOperator::Gte.comparison_sql(), Some(">="));
        assert_eq!(FilterOperator::Lte.comparison_sql(), Some("<="));
        assert_eq!(FilterOperator::Like.comparison_sql(), Some("LIKE"));
        // #1354 — null checks have no binary token; callers branch on None
        // instead of reaching an `unreachable!()`.
        assert_eq!(FilterOperator::IsNull.comparison_sql(), None);
        assert_eq!(FilterOperator::IsNotNull.comparison_sql(), None);
    }
}
