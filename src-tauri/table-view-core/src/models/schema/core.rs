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
    /// 대소문자를 무시하는 `LIKE`. 철자가 방언마다 갈려서 아래
    /// `comparison_sql` 의 이식 가능 토큰 표에는 안 들어간다 — PostgreSQL
    /// 어댑터가 `pg_comparison_sql` 로 `ILIKE` 를 얹는다 (#2430).
    Ilike,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    /// 어느 RDB 어댑터에서나 같은 철자로 나가는 SQL 이항 비교 토큰. `None` 을
    /// 내는 경우가 둘이다 — 오른쪽 피연산자가 없는 null 검사
    /// (`IsNull`/`IsNotNull`), 그리고 철자가 방언마다 갈리는 `Ilike`. `None` 을
    /// 받은 어댑터는 자기 방언의 철자를 스스로 얹거나 그 조건을 버린다.
    /// PostgreSQL 쪽 해석기는 `db::postgres::queries::pg_comparison_sql` 이다.
    ///
    /// #1354 — 어댑터가 여기를 거치게 두면 새 variant 가 `unreachable!()` 패닉
    /// 대신 `None` 갈래로 떨어진다. 다만 갈래를 `_` 로 받는 자리는 새 variant 를
    /// 컴파일 에러로 못 잡으므로, 방언 철자를 더할 때는 그 어댑터를 직접 고친다
    /// (#2430).
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

    // #2430 — `ILIKE` 는 PostgreSQL 철자다. 이식 가능 토큰 표가 그것을 내면
    // MySQL·MSSQL·Oracle 어댑터가 자기 방언에 없는 토큰을 그대로 쿼리에 실어
    // 보낸다. 그래서 여기서는 `None` 이고, 철자는 방언 쪽이 얹는다
    // (`db::postgres::queries` 의 `pg_comparison_sql` 테스트가 짝이다).
    #[test]
    fn comparison_sql_has_no_portable_token_for_ilike() {
        assert_eq!(FilterOperator::Ilike.comparison_sql(), None);
    }
}
