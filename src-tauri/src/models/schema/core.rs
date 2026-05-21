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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}
