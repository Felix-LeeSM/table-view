//! MySQL schema introspection — databases (= schemas), tables, columns.
//! Sprint 281 (Phase 17 Slice A) — read path for sidebar + column meta.
//!
//! PG (`db/postgres/schema.rs`) 의 분류를 답습하되 dialect 차이:
//! - MySQL 은 database 가 곧 namespace ('schema' 와 동의어). `SHOW
//!   DATABASES` / `information_schema.schemata` 둘 다 같은 리스트.
//! - 시스템 schema (`information_schema`, `mysql`, `performance_schema`,
//!   `sys`) 는 사용자 surface 에서 필터.
//! - `information_schema.columns.column_type` 은 PG `format_type` 와 동등
//!   (`varchar(200)`, `int(11)`, `decimal(10,2)` 형식). 별도 정규화 불필요.
//! - CHECK constraint 은 column 별이 아니라 constraint 별 — Slice E
//!   (Sprint 285) 에서 처리. Slice A 는 `check_clauses` 빈 vec.

use sqlx::MySqlPool;

use crate::error::AppError;
use crate::models::{ColumnCategory, ColumnInfo, SchemaInfo, TableInfo};

use super::MysqlAdapter;

/// MySQL data type → DataGrid category 매핑. PG 의 `map_pg_data_type` 와
/// 동일 정책 (Sprint 238 AC-238-02): raw `data_type` (소문자 keyword,
/// length/precision 제거된 형태) 만 보고 분기.
pub(super) fn map_mysql_data_type(data_type: &str) -> ColumnCategory {
    let lower = data_type.trim().to_ascii_lowercase();
    // `int unsigned` 등 modifier 가 붙는 경우 base keyword 만 추출.
    let base = match lower.split_whitespace().next() {
        Some(b) => b,
        None => return ColumnCategory::Unknown,
    };
    match base {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "year" | "bit" => {
            ColumnCategory::Int
        }
        "decimal" | "numeric" | "float" | "double" | "real" => ColumnCategory::Float,
        "bool" | "boolean" => ColumnCategory::Bool,
        "date" | "datetime" | "timestamp" | "time" => ColumnCategory::Datetime,
        "json" => ColumnCategory::Object,
        "binary" | "varbinary" | "tinyblob" | "blob" | "mediumblob" | "longblob" => {
            ColumnCategory::Binary
        }
        "enum" | "set" => ColumnCategory::Enum,
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" => {
            ColumnCategory::Text
        }
        _ => ColumnCategory::Unknown,
    }
}

/// PG schema.rs 의 `format_fk_reference` 와 동일 형식
/// (`<schema>.<table>(<column>)`) — frontend `parseFkReference` 가 PG /
/// MySQL 공통으로 같은 wire format 을 기대.
pub(super) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
}

impl MysqlAdapter {
    /// 시스템 schema 제외한 user-visible database 리스트.
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') \
             ORDER BY schema_name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(name,)| SchemaInfo { name })
            .collect())
    }

    /// `BASE TABLE` 만. `table_rows` 는 InnoDB 의 approximate row estimate —
    /// PG 의 `pg_stat_user_tables.n_live_tup` 와 동등한 위상.
    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<(String, Option<i64>)> = sqlx::query_as(
            "SELECT table_name, CAST(table_rows AS SIGNED) \
             FROM information_schema.tables \
             WHERE table_schema = ? AND table_type = 'BASE TABLE' \
             ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(name, row_count)| TableInfo {
                name,
                schema: schema.to_string(),
                row_count,
            })
            .collect())
    }

    pub async fn get_table_columns(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.active_pool().await?;
        self.get_table_columns_inner(&pool, table, schema).await
    }

    /// PG 의 `get_table_columns_inner` 와 동일 책무. 4 round-trip:
    /// (1) columns, (2) PK, (3) FK, (4) comments — MySQL 은 column comment 가
    /// `information_schema.columns.column_comment` 에 inline 으로 들어
    /// 있어 PG 처럼 별도 `col_description` round-trip 불필요. CHECK 은
    /// Slice E (Sprint 285).
    pub(super) async fn get_table_columns_inner(
        &self,
        pool: &MySqlPool,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        // column_type: `varchar(200)`, `int(11)`, `decimal(10,2)` — PG 의
        // `format_type` 등가. data_type: `varchar` / `int` / `decimal`
        // (length/precision 없이) — category 매핑용.
        let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT column_name, column_type, data_type, is_nullable, column_default, column_comment \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // PK columns — `column_key = 'PRI'` 는 위 query 에서 추출 가능하지만
        // 명시적 round-trip 으로 PG 와 패턴 통일 (constraints API 로 일관).
        let pk_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT kcu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
              AND tc.table_name = kcu.table_name \
             WHERE tc.table_schema = ? AND tc.table_name = ? \
               AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        let pk_columns: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(c,)| c).collect();

        // FK — `referenced_table_name` non-null 인 row 만 추출.
        let fk_rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT column_name, referenced_table_schema, referenced_table_name, referenced_column_name \
             FROM information_schema.key_column_usage \
             WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        let fk_map: std::collections::HashMap<String, String> = fk_rows
            .into_iter()
            .map(|(local_col, ref_schema, ref_table, ref_column)| {
                (
                    local_col,
                    format_fk_reference(&ref_schema, &ref_table, &ref_column),
                )
            })
            .collect();

        Ok(rows
            .into_iter()
            .map(
                |(name, column_type, data_type, is_nullable, default_value, column_comment)| {
                    let is_pk = pk_columns.contains(&name);
                    let (is_fk, fk_reference) = match fk_map.get(&name) {
                        Some(s) => (true, Some(s.clone())),
                        None => (false, None),
                    };
                    let comment = if column_comment.is_empty() {
                        None
                    } else {
                        Some(column_comment)
                    };
                    let category = map_mysql_data_type(&data_type);
                    ColumnInfo {
                        name,
                        data_type: column_type,
                        nullable: is_nullable.eq_ignore_ascii_case("YES"),
                        default_value,
                        is_primary_key: is_pk,
                        is_foreign_key: is_fk,
                        fk_reference,
                        comment,
                        check_clauses: Vec::new(),
                        category,
                    }
                },
            )
            .collect())
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-13, Sprint 281): map_mysql_data_type 의 카테고리
    //! 분기는 사용자에게 보이는 DataGrid 폭/정렬을 좌우. pure fn 이라 실
    //! DB 없이도 회귀 가드 가능 — 타입 추가 시 fall-through 가 silent 하게
    //! Unknown 으로 떨어지는 회귀를 빠르게 잡는다.
    use super::*;

    #[test]
    fn map_mysql_data_type_classifies_common_types() {
        assert_eq!(map_mysql_data_type("int"), ColumnCategory::Int);
        assert_eq!(map_mysql_data_type("bigint"), ColumnCategory::Int);
        assert_eq!(map_mysql_data_type("int unsigned"), ColumnCategory::Int);
        assert_eq!(map_mysql_data_type("decimal"), ColumnCategory::Float);
        assert_eq!(map_mysql_data_type("varchar"), ColumnCategory::Text);
        assert_eq!(map_mysql_data_type("text"), ColumnCategory::Text);
        assert_eq!(map_mysql_data_type("boolean"), ColumnCategory::Bool);
        assert_eq!(map_mysql_data_type("date"), ColumnCategory::Datetime);
        assert_eq!(map_mysql_data_type("datetime"), ColumnCategory::Datetime);
        assert_eq!(map_mysql_data_type("json"), ColumnCategory::Object);
        assert_eq!(map_mysql_data_type("blob"), ColumnCategory::Binary);
        assert_eq!(map_mysql_data_type("enum"), ColumnCategory::Enum);
        assert_eq!(map_mysql_data_type("set"), ColumnCategory::Enum);
        assert_eq!(map_mysql_data_type("unknown_xyz"), ColumnCategory::Unknown);
        assert_eq!(map_mysql_data_type(""), ColumnCategory::Unknown);
    }

    #[test]
    fn format_fk_reference_round_trips_pg_format() {
        // PG / MySQL 공통 wire format — frontend `parseFkReference` 가
        // 한 정규식으로 양쪽 dialect 결과를 파싱한다.
        assert_eq!(
            format_fk_reference("public", "users", "id"),
            "public.users(id)"
        );
        assert_eq!(
            format_fk_reference("app", "orders", "user_id"),
            "app.orders(user_id)"
        );
    }
}
