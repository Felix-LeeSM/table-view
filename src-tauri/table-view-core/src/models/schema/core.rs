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
    /// #1433 — auto-increment/identity flag (PG `attidentity`, MySQL
    /// `auto_increment` EXTRA, MSSQL `sys.columns.is_identity`). Those
    /// catalogs expose no default expression for identity columns, so the
    /// frontend INSERT generator needs this flag to omit untouched identity
    /// cells. `#[serde(default)]` keeps older payloads / non-enriching
    /// adapters parsing as `false`.
    #[serde(default)]
    pub is_identity: bool,
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
    /// AC-238-02 — display category for the DataGrid (drives
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
    /// Case-insensitive `LIKE`. The spelling differs per dialect, so it stays
    /// out of the portable token table in `comparison_sql` below — the
    /// PostgreSQL adapter supplies `ILIKE` through `pg_comparison_sql`
    /// (#2430).
    Ilike,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    /// The SQL binary comparison token that every RDB adapter spells the same
    /// way. It returns `None` in two cases — a null check with no right-hand
    /// operand (`IsNull`/`IsNotNull`), and `Ilike`, whose spelling differs per
    /// dialect. An adapter that receives `None` either supplies its own
    /// dialect spelling or drops the condition. On the PostgreSQL side the
    /// reader is `db::postgres::queries::pg_comparison_sql`.
    ///
    /// #1354 — routing adapters through here makes a new variant fall into the
    /// `None` branch instead of an `unreachable!()` panic. A site that catches
    /// the branch with `_` cannot turn a new variant into a compile error,
    /// though, so adding a dialect spelling means editing that adapter
    /// directly (#2430).
    pub fn comparison_sql(&self) -> Option<&'static str> {
        match self {
            FilterOperator::Eq => Some("="),
            FilterOperator::Neq => Some("<>"),
            FilterOperator::Gt => Some(">"),
            FilterOperator::Lt => Some("<"),
            FilterOperator::Gte => Some(">="),
            FilterOperator::Lte => Some("<="),
            FilterOperator::Like => Some("LIKE"),
            FilterOperator::Ilike | FilterOperator::IsNull | FilterOperator::IsNotNull => None,
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

    // #2430 — `ILIKE` is the PostgreSQL spelling. If the portable token table
    // returned it, the MySQL, MSSQL and Oracle adapters would put a token
    // their own dialect lacks straight into the query. So it is `None` here
    // and the dialect side supplies the spelling (the `pg_comparison_sql`
    // test in `db::postgres::queries` is its counterpart).
    #[test]
    fn comparison_sql_has_no_portable_token_for_ilike() {
        assert_eq!(FilterOperator::Ilike.comparison_sql(), None);
    }
}
