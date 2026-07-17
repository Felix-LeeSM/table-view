//! MySQL schema introspection — databases (= schemas), tables, columns,
//! indexes, constraints, and views.
//!
//! PG (`db/postgres/schema.rs`) 의 분류를 답습하되 dialect 차이:
//! - MySQL 은 database 가 곧 namespace ('schema' 와 동의어). `SHOW
//!   DATABASES` / `information_schema.schemata` 둘 다 같은 리스트.
//! - 시스템 schema (`information_schema`, `mysql`, `performance_schema`,
//!   `sys`) 는 사용자 surface 에서 필터.
//! - `information_schema.columns.column_type` 은 PG `format_type` 와 동등
//!   (`varchar(200)`, `int(11)`, `decimal(10,2)` 형식). 별도 정규화 불필요.
//! - CHECK constraint 는 server-version gate 가 열린 경우에만
//!   `information_schema.check_constraints` 에서 읽고 참조 컬럼별
//!   `check_clauses` 로 투영.

use sqlx::MySqlPool;
use std::future::Future;

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, SchemaInfo, TableInfo,
    TriggerInfo, ViewInfo,
};

use super::checks::{build_check_map, is_check_metadata_unavailable};
use super::MysqlAdapter;

async fn mysql_check_rows_or_empty<T>(
    supported: bool,
    result: impl Future<Output = Result<Vec<T>, sqlx::Error>>,
) -> Result<Vec<T>, AppError> {
    if !supported {
        return Ok(Vec::new());
    }

    match result.await {
        Ok(rows) => Ok(rows),
        Err(err) if is_check_metadata_unavailable(&err) => Ok(Vec::new()),
        Err(err) => Err(AppError::Connection(err.to_string())),
    }
}

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
    ///
    /// MySQL 8.0+ 의 `information_schema` 는 일부 식별자 컬럼을 utf8mb3
    /// `_bin` collation 또는 VARBINARY 로 노출 — sqlx 가 String 으로 decode
    /// 시도하면 `mismatched types … is not compatible with SQL type VARBINARY`
    /// 가 surface 된다. 모든 식별자 select 를 `CONVERT(... USING utf8mb4)`
    /// 로 wrap 해 결정성 있는 utf8 text 로 받는다.
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT CONVERT(schema_name USING utf8mb4) \
             FROM information_schema.schemata \
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
            "SELECT CONVERT(table_name USING utf8mb4), CAST(table_rows AS SIGNED) \
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

    /// PG 의 `get_table_columns_inner` 와 동일 책무. CHECK metadata 는
    /// server-version gate 가 열린 경우에만 추가 조회한다.
    /// 4 round-trip:
    /// (1) columns, (2) PK, (3) FK, (4) CHECK — MySQL 은 column comment 가
    /// `information_schema.columns.column_comment` 에 inline 으로 들어
    /// 있어 PG 처럼 별도 `col_description` round-trip 불필요.
    pub(super) async fn get_table_columns_inner(
        &self,
        pool: &MySqlPool,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        // column_type: `varchar(200)`, `int(11)`, `decimal(10,2)` — PG 의
        // `format_type` 등가. data_type: `varchar` / `int` / `decimal`
        // (length/precision 없이) — category 매핑용.
        // 모든 식별자 컬럼을 `CONVERT(... USING utf8mb4)` 로 wrap — MySQL 8.0
        // 의 information_schema 가 VARBINARY 로 노출하는 경우 회피.
        // #1433 — extra: `auto_increment` 컬럼은 column_default 가 NULL 이라
        // default 만으로는 식별 불가. frontend INSERT generator 가 미입력
        // auto-increment 셀을 생략하려면 is_identity flag 가 필요하다.
        #[allow(clippy::type_complexity)]
        let rows: Vec<(
            String,
            String,
            String,
            String,
            Option<String>,
            String,
            String,
        )> = sqlx::query_as(
            "SELECT CONVERT(column_name USING utf8mb4), \
                    CONVERT(column_type USING utf8mb4), \
                    CONVERT(data_type USING utf8mb4), \
                    CONVERT(is_nullable USING utf8mb4), \
                    CONVERT(column_default USING utf8mb4), \
                    CONVERT(column_comment USING utf8mb4), \
                    CONVERT(extra USING utf8mb4) \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // PK columns.
        let pk_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT CONVERT(kcu.column_name USING utf8mb4) \
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
            "SELECT CONVERT(column_name USING utf8mb4), \
                    CONVERT(referenced_table_schema USING utf8mb4), \
                    CONVERT(referenced_table_name USING utf8mb4), \
                    CONVERT(referenced_column_name USING utf8mb4) \
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

        let check_rows: Vec<(String,)> = mysql_check_rows_or_empty(
            self.supports_check_constraint_catalog().await,
            sqlx::query_as(
                "SELECT CONVERT(cc.check_clause USING utf8mb4) \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.check_constraints cc \
               ON cc.constraint_schema = tc.constraint_schema \
              AND cc.constraint_name = tc.constraint_name \
             WHERE tc.table_schema = ? AND tc.table_name = ? \
               AND tc.constraint_type = 'CHECK' \
             ORDER BY tc.constraint_name",
            )
            .bind(schema)
            .bind(table)
            .fetch_all(pool),
        )
        .await?;
        let column_names: Vec<String> = rows.iter().map(|(name, ..)| name.clone()).collect();
        let mut check_map = build_check_map(
            &column_names,
            check_rows.into_iter().map(|(clause,)| clause),
        );

        Ok(rows
            .into_iter()
            .map(
                |(
                    name,
                    column_type,
                    data_type,
                    is_nullable,
                    default_value,
                    column_comment,
                    extra,
                )| {
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
                    let check_clauses = check_map.remove(&name).unwrap_or_default();
                    let category = map_mysql_data_type(&data_type);
                    ColumnInfo {
                        name,
                        data_type: column_type,
                        nullable: is_nullable.eq_ignore_ascii_case("YES"),
                        default_value,
                        is_identity: extra.to_ascii_lowercase().contains("auto_increment"),
                        is_primary_key: is_pk,
                        is_foreign_key: is_fk,
                        fk_reference,
                        comment,
                        check_clauses,
                        category,
                    }
                },
            )
            .collect())
    }

    /// Sprint 287 (Slice G) — 사용자 surface 의 모든 database (= schema)
    /// 리스트. PG `list_databases` 의 MySQL 짝꿍. `SHOW DATABASES` 와 동등
    /// 하지만 information_schema 경로로 통일해 `LIKE` filter 가 backslash
    /// 이스케이프를 어떻게 처리하는지에 영향받지 않게.
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        // MySQL 은 schema == database — `list_schemas` 와 동일 결과지만
        // 의도 분기를 유지 (PG paradigm 과 align).
        self.list_schemas().await
    }

    /// Sprint 287 (Slice G) — 한 schema 의 모든 table 컬럼을 1 round-trip
    /// 으로 fetch. PG `list_schema_columns` 와 동등 — frontend Schema 개요
    /// 가 호출.
    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
        let pool = self.active_pool().await?;

        // 7-column SELECT — sqlx query_as 의 tuple 크기 한계 (대부분 16)
        // 안이지만 column_default 만 Optional 이라 named accessor (`try_get`)
        // 로 풀어 쓴다. PG 측의 5-tuple 패턴보다 surface 가 약간 길지만
        // round-trip 1회 보장.
        let rows = sqlx::query(
            "SELECT CONVERT(table_name USING utf8mb4) AS table_name, \
                    CONVERT(column_name USING utf8mb4) AS column_name, \
                    CONVERT(column_type USING utf8mb4) AS column_type, \
                    CONVERT(data_type USING utf8mb4) AS data_type, \
                    CONVERT(is_nullable USING utf8mb4) AS is_nullable, \
                    CONVERT(column_default USING utf8mb4) AS column_default, \
                    CONVERT(column_comment USING utf8mb4) AS column_comment \
             FROM information_schema.columns \
             WHERE table_schema = ? \
             ORDER BY table_name, ordinal_position",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // PK 전체 schema — (table, column) tuple set.
        let pk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT CONVERT(kcu.table_name USING utf8mb4), CONVERT(kcu.column_name USING utf8mb4) \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
              AND tc.table_name = kcu.table_name \
             WHERE tc.table_schema = ? AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        let pk_set: std::collections::HashSet<(String, String)> = pk_rows.into_iter().collect();

        // FK 전체 schema.
        let fk_rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT CONVERT(table_name USING utf8mb4), \
                    CONVERT(column_name USING utf8mb4), \
                    CONVERT(referenced_table_schema USING utf8mb4), \
                    CONVERT(referenced_table_name USING utf8mb4), \
                    CONVERT(referenced_column_name USING utf8mb4) \
             FROM information_schema.key_column_usage \
             WHERE table_schema = ? AND referenced_table_name IS NOT NULL",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        let fk_map: std::collections::HashMap<(String, String), String> = fk_rows
            .into_iter()
            .map(|(t, c, ref_schema, ref_table, ref_column)| {
                (
                    (t, c),
                    format_fk_reference(&ref_schema, &ref_table, &ref_column),
                )
            })
            .collect();

        let check_rows: Vec<(String, String)> = mysql_check_rows_or_empty(
            self.supports_check_constraint_catalog().await,
            sqlx::query_as(
                "SELECT CONVERT(tc.table_name USING utf8mb4), \
                    CONVERT(cc.check_clause USING utf8mb4) \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.check_constraints cc \
               ON cc.constraint_schema = tc.constraint_schema \
              AND cc.constraint_name = tc.constraint_name \
             WHERE tc.table_schema = ? AND tc.constraint_type = 'CHECK' \
             ORDER BY tc.table_name, tc.constraint_name",
            )
            .bind(schema)
            .fetch_all(&pool),
        )
        .await?;
        let mut columns_by_table: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in &rows {
            use sqlx::Row;
            let table_name: String = row.try_get("table_name").unwrap_or_default();
            let col_name: String = row.try_get("column_name").unwrap_or_default();
            columns_by_table
                .entry(table_name)
                .or_default()
                .push(col_name);
        }
        let mut check_map: std::collections::HashMap<(String, String), Vec<String>> =
            std::collections::HashMap::new();
        for (table_name, raw_clause) in check_rows {
            let Some(column_names) = columns_by_table.get(&table_name) else {
                continue;
            };
            let table_check_map = build_check_map(column_names, [raw_clause]);
            for (column_name, clauses) in table_check_map {
                check_map
                    .entry((table_name.clone(), column_name))
                    .or_default()
                    .extend(clauses);
            }
        }

        let mut result: std::collections::HashMap<String, Vec<ColumnInfo>> =
            std::collections::HashMap::new();

        use sqlx::Row;
        for row in rows {
            let table_name: String = row.try_get("table_name").unwrap_or_default();
            let col_name: String = row.try_get("column_name").unwrap_or_default();
            let column_type: String = row.try_get("column_type").unwrap_or_default();
            let data_type: String = row.try_get("data_type").unwrap_or_default();
            let is_nullable: String = row.try_get("is_nullable").unwrap_or_default();
            let default_value: Option<String> = row.try_get("column_default").ok().flatten();
            let column_comment: String = row.try_get("column_comment").unwrap_or_default();

            let is_pk = pk_set.contains(&(table_name.clone(), col_name.clone()));
            let (is_fk, fk_reference) = match fk_map.get(&(table_name.clone(), col_name.clone())) {
                Some(s) => (true, Some(s.clone())),
                None => (false, None),
            };
            let comment = if column_comment.is_empty() {
                None
            } else {
                Some(column_comment)
            };
            let check_clauses = check_map
                .remove(&(table_name.clone(), col_name.clone()))
                .unwrap_or_default();
            let category = map_mysql_data_type(&data_type);
            result.entry(table_name).or_default().push(ColumnInfo {
                name: col_name,
                data_type: column_type,
                nullable: is_nullable.eq_ignore_ascii_case("YES"),
                default_value,
                // ponytail: schema-overview 경로 — INSERT generator 는
                // get_table_columns_inner 결과만 소비. 필요 시 extra 조인.
                is_identity: false,
                is_primary_key: is_pk,
                is_foreign_key: is_fk,
                fk_reference,
                comment,
                check_clauses,
                category,
            });
        }

        Ok(result)
    }

    /// Sprint 285 (Slice E) — `(schema, table)` 의 인덱스 메타. PG
    /// `get_table_indexes` 의 MySQL 짝꿍. `information_schema.statistics` 는
    /// 인덱스 컬럼별로 한 행을 반환하므로 (index_name, seq_in_index) 로
    /// 정렬 후 column 순서 보존.
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let pool = self.active_pool().await?;
        // index_type: BTREE / HASH / FULLTEXT / SPATIAL — sqlx 가 String 으로 decode.
        // non_unique: 0 = unique, 1 = non-unique (MySQL 의 inverse 의미).
        // index_name 이 'PRIMARY' 면 PK.
        let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
            "SELECT CONVERT(index_name USING utf8mb4), \
                    CONVERT(column_name USING utf8mb4), \
                    non_unique, \
                    CONVERT(index_type USING utf8mb4) \
             FROM information_schema.statistics \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY index_name, seq_in_index",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut map: std::collections::BTreeMap<String, (bool, bool, String, Vec<String>)> =
            std::collections::BTreeMap::new();
        for (index_name, column_name, non_unique, index_type) in rows {
            let is_unique = non_unique == 0;
            let is_primary = index_name == "PRIMARY";
            let entry = map.entry(index_name).or_insert((
                is_unique,
                is_primary,
                index_type.to_lowercase(),
                Vec::new(),
            ));
            entry.3.push(column_name);
        }
        Ok(map
            .into_iter()
            .map(
                |(name, (is_unique, is_primary, index_type, columns))| IndexInfo {
                    name,
                    columns,
                    index_type,
                    is_unique,
                    is_primary,
                },
            )
            .collect())
    }

    /// Table-level constraint metadata. PK / FK / UNIQUE 는 항상 조회하고,
    /// CHECK 은 server-version gate 가 열린 MySQL 8.0.16+ / MariaDB
    /// 10.2.1+ 에서만 포함한다.
    #[allow(clippy::type_complexity)]
    pub async fn get_table_constraints(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let pool = self.active_pool().await?;

        let constraint_query = if self.supports_check_constraint_catalog().await {
            "SELECT CONVERT(tc.constraint_name USING utf8mb4), \
                    CONVERT(tc.constraint_type USING utf8mb4), \
                    CONVERT(kcu.column_name USING utf8mb4), \
                    CONVERT(kcu.referenced_table_name USING utf8mb4), \
                    CONVERT(kcu.referenced_column_name USING utf8mb4) \
             FROM information_schema.table_constraints tc \
             LEFT JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
              AND tc.table_name = kcu.table_name \
             WHERE tc.table_schema = ? AND tc.table_name = ? \
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK') \
             ORDER BY tc.constraint_name, kcu.ordinal_position"
        } else {
            "SELECT CONVERT(tc.constraint_name USING utf8mb4), \
                    CONVERT(tc.constraint_type USING utf8mb4), \
                    CONVERT(kcu.column_name USING utf8mb4), \
                    CONVERT(kcu.referenced_table_name USING utf8mb4), \
                    CONVERT(kcu.referenced_column_name USING utf8mb4) \
             FROM information_schema.table_constraints tc \
             LEFT JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
              AND tc.table_name = kcu.table_name \
             WHERE tc.table_schema = ? AND tc.table_name = ? \
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY') \
             ORDER BY tc.constraint_name, kcu.ordinal_position"
        };

        // (name, type, column, ref_table, ref_column) — FK 의 ref columns 는
        // key_column_usage 에 들어가 있다. CHECK 은 column null.
        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(constraint_query)
            .bind(schema)
            .bind(table)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        type ConstraintAccum = (String, Vec<String>, Option<String>, Vec<String>);
        let mut map: std::collections::BTreeMap<String, ConstraintAccum> =
            std::collections::BTreeMap::new();

        for (name, ctype, column, ref_table, ref_column) in rows {
            let entry = map
                .entry(name)
                .or_insert((ctype, Vec::new(), ref_table, Vec::new()));
            if let Some(col) = column {
                if !entry.1.contains(&col) {
                    entry.1.push(col);
                }
            }
            if let Some(rc) = ref_column {
                if !entry.3.contains(&rc) {
                    entry.3.push(rc);
                }
            }
        }
        Ok(map
            .into_iter()
            .map(
                |(name, (constraint_type, columns, reference_table, ref_cols))| ConstraintInfo {
                    name,
                    constraint_type,
                    columns,
                    reference_table,
                    reference_columns: if ref_cols.is_empty() {
                        None
                    } else {
                        Some(ref_cols)
                    },
                },
            )
            .collect())
    }

    /// Sprint 286 (Slice F) — schema 안의 view 리스트.
    pub async fn list_views(&self, schema: &str) -> Result<Vec<ViewInfo>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT CONVERT(table_name USING utf8mb4), \
                    CONVERT(view_definition USING utf8mb4) \
             FROM information_schema.views \
             WHERE table_schema = ? \
             ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(name, definition)| ViewInfo {
                name,
                schema: schema.to_string(),
                definition,
            })
            .collect())
    }

    /// Sprint 286 (Slice F) — view 의 columns. table 의 컬럼 introspection
    /// 과 동일 path (MySQL 은 view 의 column 도 information_schema.columns
    /// 에 들어간다). PK / FK 는 view 에 없으므로 항상 false.
    pub async fn get_view_columns(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT CONVERT(column_name USING utf8mb4), \
                    CONVERT(column_type USING utf8mb4), \
                    CONVERT(data_type USING utf8mb4), \
                    CONVERT(is_nullable USING utf8mb4), \
                    CONVERT(column_default USING utf8mb4), \
                    CONVERT(column_comment USING utf8mb4) \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(view)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(
                |(name, column_type, data_type, is_nullable, default_value, column_comment)| {
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
                        // View columns can't be auto_increment.
                        is_identity: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        fk_reference: None,
                        comment,
                        check_clauses: Vec::new(),
                        category,
                    }
                },
            )
            .collect())
    }

    /// Sprint 286 (Slice F) — view definition body. `information_schema.views`
    /// 의 view_definition 컬럼은 sql_mode 에 따라 view query 의 normalized
    /// form 을 반환.
    pub async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, AppError> {
        let pool = self.active_pool().await?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT CONVERT(view_definition USING utf8mb4) \
             FROM information_schema.views \
             WHERE table_schema = ? AND table_name = ?",
        )
        .bind(schema)
        .bind(view)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        match row {
            Some((Some(def),)) => Ok(def),
            Some((None,)) => Ok(String::new()),
            None => Err(AppError::Connection(format!(
                "View {schema}.{view} not found"
            ))),
        }
    }

    /// Sprint 286 (Slice F) — function / procedure 목록.
    /// `information_schema.routines` 의 routine_type 으로 'FUNCTION' /
    /// 'PROCEDURE' 분기. MySQL 은 PG 처럼 aggregate/window 가 사용자 정의
    /// 가 없으므로 (built-in 만), routine_type 이 곧 kind.
    #[allow(clippy::type_complexity)]
    pub async fn list_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let pool = self.active_pool().await?;
        // (name, routine_type, dtd_identifier(returns), routine_body)
        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT CONVERT(routine_name USING utf8mb4), \
                        CONVERT(routine_type USING utf8mb4), \
                        CONVERT(dtd_identifier USING utf8mb4), \
                        CONVERT(routine_definition USING utf8mb4), \
                        CONVERT(external_language USING utf8mb4) \
                 FROM information_schema.routines \
                 WHERE routine_schema = ? \
                 ORDER BY routine_name",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // arguments — parameters 테이블로 별도 round-trip. PG 의
        // `pg_get_function_arguments` 와 등가.
        // parameter_name 은 nullable (RETURNS row 의 경우 NULL) — Optional.
        let param_rows: Vec<(String, Option<String>, Option<String>, Option<String>, i64)> =
            sqlx::query_as(
                "SELECT CONVERT(specific_name USING utf8mb4), \
                        CONVERT(parameter_name USING utf8mb4), \
                        CONVERT(parameter_mode USING utf8mb4), \
                        CONVERT(dtd_identifier USING utf8mb4), \
                        ordinal_position \
                 FROM information_schema.parameters \
                 WHERE specific_schema = ? AND ordinal_position > 0 \
                 ORDER BY specific_name, ordinal_position",
            )
            .bind(schema)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut params: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for (sn, pname, mode, dtype, _ord) in param_rows {
            let m = mode.unwrap_or_else(|| "IN".to_string());
            let t = dtype.unwrap_or_default();
            let n = pname.unwrap_or_default();
            params
                .entry(sn)
                .or_default()
                .push(format!("{} {} {}", m, n, t));
        }

        Ok(rows
            .into_iter()
            .map(|(name, routine_type, returns, source, lang)| {
                let arguments = params.remove(&name).map(|parts| parts.join(", "));
                let kind = if routine_type.eq_ignore_ascii_case("PROCEDURE") {
                    "procedure"
                } else {
                    "function"
                };
                FunctionInfo {
                    name,
                    schema: schema.to_string(),
                    arguments,
                    return_type: returns,
                    language: lang,
                    source,
                    kind: kind.to_string(),
                }
            })
            .collect())
    }

    /// Sprint 286 (Slice F) — function/procedure 의 body. PG
    /// `get_function_source` 의 짝꿍. `SHOW CREATE FUNCTION` /
    /// `SHOW CREATE PROCEDURE` 를 우선 시도하고 실패 시 routine_definition
    /// fallback (DEFINER 권한 없는 user 의 경우).
    pub async fn get_function_source(
        &self,
        schema: &str,
        function: &str,
    ) -> Result<String, AppError> {
        // 어떤 종류인지 먼저 확인.
        let pool = self.active_pool().await?;
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT CONVERT(routine_type USING utf8mb4), \
                    CONVERT(routine_definition USING utf8mb4) \
             FROM information_schema.routines \
             WHERE routine_schema = ? AND routine_name = ?",
        )
        .bind(schema)
        .bind(function)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        match row {
            Some((_, Some(body))) if !body.is_empty() => Ok(body),
            Some(_) => Ok(String::new()),
            None => Err(AppError::Connection(format!(
                "Function {schema}.{function} not found"
            ))),
        }
    }

    /// Sprint 286 (Slice F) — `(schema, table)` 의 사용자 trigger.
    /// `information_schema.triggers` — action_timing / event_manipulation /
    /// action_orientation / action_statement 가 모두 노출된다. PG 의 분리
    /// 필드 형식과 1:1 매핑.
    pub async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        let pool = self.active_pool().await?;
        // (trigger_name, action_timing, event_manipulation, action_orientation,
        //  action_statement)
        let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT CONVERT(trigger_name USING utf8mb4), \
                    CONVERT(action_timing USING utf8mb4), \
                    CONVERT(event_manipulation USING utf8mb4), \
                    CONVERT(action_orientation USING utf8mb4), \
                    CONVERT(action_statement USING utf8mb4) \
             FROM information_schema.triggers \
             WHERE event_object_schema = ? AND event_object_table = ? \
             ORDER BY trigger_name, action_order",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // 동일 trigger 가 multi-event 인 경우 MySQL 은 row 를 1개로 합치지
        // 않고 별도 보관하기보다는 보통 한 trigger = 한 event. 그러나 향후
        // server 가 multi-event 합쳐 노출하더라도 같은 trigger_name 이면
        // events 만 누적되도록 BTreeMap 으로 fold.
        let mut map: std::collections::BTreeMap<String, (String, Vec<String>, String, String)> =
            std::collections::BTreeMap::new();
        for (name, timing, event, orientation, statement) in rows {
            let entry = map
                .entry(name)
                .or_insert((timing, Vec::new(), orientation, statement));
            if !entry.1.iter().any(|e| e == &event) {
                entry.1.push(event);
            }
        }

        Ok(map
            .into_iter()
            .map(
                |(name, (timing, events, orientation, statement))| TriggerInfo {
                    name,
                    schema: schema.to_string(),
                    table: table.to_string(),
                    timing,
                    events,
                    orientation,
                    // MySQL trigger 는 inline body — function 분리 개념 없음.
                    // function_schema/function_name 은 schema/table 로 placeholder.
                    function_schema: schema.to_string(),
                    function_name: String::new(),
                    arguments: None,
                    when_expression: None,
                    definition: statement,
                },
            )
            .collect())
    }

    /// Sprint 286 (Slice F) — 한 trigger 의 action_statement.
    pub async fn get_trigger_source(
        &self,
        schema: &str,
        _table: &str,
        trigger_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT CONVERT(action_statement USING utf8mb4) \
             FROM information_schema.triggers \
             WHERE trigger_schema = ? AND trigger_name = ?",
        )
        .bind(schema)
        .bind(trigger_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
        match row {
            Some((stmt,)) => Ok(stmt),
            None => Err(AppError::Connection(format!(
                "Trigger {schema}.{trigger_name} not found"
            ))),
        }
    }

    /// Refs #1067 — `CREATE DATABASE \`<name>\``.
    ///
    /// MySQL 은 CREATE/DROP DATABASE 를 명시적 transaction block 안에서
    /// 허용하지 않으므로 active pool 에 single statement 로 보낸다 (sqlx 가
    /// transaction 으로 감싸지 않은 단문을 auto-commit). PG
    /// `create_database` 와 동일 contract — identifier 를 ASCII sub-set 으로
    /// 검증한 뒤 backtick 으로 quote 해 injection 을 막는다.
    pub async fn create_database(&self, name: &str) -> Result<(), AppError> {
        use super::mutations::{quote_ident, validate_identifier};
        validate_identifier(name, "Database name")?;
        let pool = self.active_pool().await?;
        let sql = format!("CREATE DATABASE {}", quote_ident(name.trim()));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(format!("CREATE DATABASE failed: {e}")))?;
        Ok(())
    }

    /// Refs #1067 — `DROP DATABASE \`<name>\``. `create_database` 와 대칭.
    /// 대상 DB 에 붙어있는 session 이 없어야 한다 — 남아있으면 server 가
    /// 에러를 그대로 surface 한다.
    pub async fn drop_database(&self, name: &str) -> Result<(), AppError> {
        use super::mutations::{quote_ident, validate_identifier};
        validate_identifier(name, "Database name")?;
        let pool = self.active_pool().await?;
        let sql = format!("DROP DATABASE {}", quote_ident(name.trim()));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(format!("DROP DATABASE failed: {e}")))?;
        Ok(())
    }

    /// Refs #1067 — `EXPLAIN FORMAT=JSON <sql>`.
    ///
    /// MySQL 은 plan tree 를 single-row / single-column 의 JSON **문자열**
    /// (column `EXPLAIN`, LONGTEXT) 로 반환한다 — PG 의 native `JSON` 타입과
    /// 달라 String 으로 decode 한 뒤 `serde_json` 으로 파싱한다. `ANALYZE` 는
    /// 쓰지 않는다: Explain UI 는 plan inspection 이지 실행 profiler 가 아니다
    /// (PG override 와 동일 정책). ExplainViewer 는 PG 가 아닌 payload 를 raw
    /// JSON 뷰로 fall-through 하므로 dialect 별 tree 파서 없이도 렌더된다.
    pub async fn explain_query(&self, sql: &str) -> Result<serde_json::Value, AppError> {
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL must not be empty".into()));
        }
        let pool = self.active_pool().await?;
        let wrapped = format!("EXPLAIN FORMAT=JSON {trimmed}");
        let row: (String,) = sqlx::query_as(&wrapped)
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {e}")))?;
        serde_json::from_str(&row.0)
            .map_err(|e| AppError::Database(format!("EXPLAIN JSON parse failed: {e}")))
    }

    /// Issue #1073 (U1 MySQL parity) — list backend sessions from
    /// `information_schema.processlist`. Chosen over `performance_schema.threads`
    /// / `SHOW PROCESSLIST` because `information_schema.processlist` exists on
    /// every supported MySQL (5.1+) and MariaDB (5.1+) build regardless of the
    /// `performance_schema` compile/runtime flag — the widest-compat source, and
    /// the only one that decodes cleanly as a typed result set. `ID` is
    /// `BIGINT UNSIGNED`, so it is `CAST(... AS SIGNED)` to fit the wire's i64
    /// (connection ids never approach the signed ceiling). The adapter's own
    /// session is excluded via `CONNECTION_ID()`, mirroring the PG
    /// `pg_backend_pid()` filter. `wait_event` has no processlist analogue, so it
    /// stays `None`; `started_at` is derived as `now - TIME` seconds (processlist
    /// only exposes elapsed `TIME`, not an absolute start), rendered UTC ISO-8601
    /// server-side to avoid a `chrono` dependency (mirrors the PG override).
    pub async fn list_server_activity(
        &self,
    ) -> Result<Vec<crate::models::ServerActivityRow>, AppError> {
        #[allow(clippy::type_complexity)]
        type Row = (
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let pool = self.active_pool().await?;
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT CAST(ID AS SIGNED) AS id, DB, USER, STATE, INFO, \
                    DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL TIME SECOND, \
                                '%Y-%m-%dT%H:%i:%sZ') AS started_at \
             FROM information_schema.processlist \
             WHERE ID <> CONNECTION_ID() \
             ORDER BY TIME DESC",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(format!("information_schema.processlist failed: {e}")))?;

        Ok(rows
            .into_iter()
            .map(
                |(id, db, user, state, query, started_at)| crate::models::ServerActivityRow {
                    id,
                    db,
                    user,
                    state,
                    query,
                    wait_event: None,
                    started_at,
                },
            )
            .collect())
    }

    /// Issue #1073 (U1 MySQL parity) — terminate a backend session by id.
    /// MySQL/MariaDB `KILL` is not accepted in the prepared-statement protocol,
    /// so the id cannot be a bind parameter; it is interpolated directly. This
    /// is injection-safe because `id: i64` is a typed integer — no string can
    /// reach the SQL. Parity with the PG `pg_terminate_backend` no-op contract:
    /// killing an already-gone session raises `ER_NO_SUCH_THREAD` (1094), which
    /// is swallowed as a successful no-op so the activity panel behaves the same
    /// across engines. Any other driver error surfaces verbatim.
    pub async fn kill_session(&self, id: i64) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        let sql = format!("KILL {id}");
        match sqlx::query(&sql).execute(&pool).await {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("Unknown thread id") || msg.contains("1094") {
                    Ok(())
                } else {
                    Err(AppError::Database(format!("KILL failed: {msg}")))
                }
            }
        }
    }

    /// Issue #1073 (U5 MySQL parity) — top-N slow queries from
    /// `performance_schema.events_statements_summary_by_digest`. The digest table
    /// is only populated when `performance_schema` is enabled, and when it is
    /// **off** the table exists but returns zero rows — a silent empty list that
    /// would masquerade as "no slow queries". To avoid that, the runtime flag is
    /// checked first (`@@performance_schema`) and a disabled instance raises an
    /// explicit, actionable error instead of an empty result. `DIGEST_TEXT` is
    /// the normalised statement (literals already collapsed to `?`), so no raw
    /// user data / secrets leak through the query text. Timer columns are
    /// picoseconds — divided by 1e9 to milliseconds to match the PG `_ms` wire
    /// fields. `limit` is trusted here (the caller clamps it, same as PG).
    pub async fn slow_queries(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
        let pool = self.active_pool().await?;

        let enabled: i64 = sqlx::query_scalar("SELECT @@performance_schema")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("performance_schema probe failed: {e}")))?;
        if enabled == 0 {
            return Err(AppError::CapabilityNotEnabled {
                code: "mysql_performance_schema".into(),
                message: "performance_schema is disabled — slow query digests are \
                          unavailable. Set `performance_schema = ON` in the server config \
                          and restart to enable statement digest collection."
                    .into(),
            });
        }

        #[allow(clippy::type_complexity)]
        type Row = (Option<String>, i64, Option<f64>, Option<f64>, i64);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT DIGEST_TEXT, \
                    CAST(COUNT_STAR AS SIGNED), \
                    SUM_TIMER_WAIT / 1e9, \
                    AVG_TIMER_WAIT / 1e9, \
                    CAST(SUM_ROWS_SENT AS SIGNED) \
             FROM performance_schema.events_statements_summary_by_digest \
             WHERE DIGEST_TEXT IS NOT NULL \
             ORDER BY AVG_TIMER_WAIT DESC \
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            match classify_performance_schema_error(&msg) {
                Some(code) => AppError::CapabilityNotEnabled {
                    code: code.into(),
                    message: "performance_schema statement digests are unavailable on \
                              this connection. Enable `performance_schema` (server config) \
                              and grant SELECT on it to view slow query digests."
                        .into(),
                },
                None => {
                    AppError::Database(format!("events_statements_summary_by_digest failed: {msg}"))
                }
            }
        })?;

        Ok(rows
            .into_iter()
            .map(
                |(query, calls, total, mean, rows)| crate::models::SlowQueryRow {
                    query: query.unwrap_or_default(),
                    calls,
                    total_exec_time_ms: total.unwrap_or(0.0),
                    mean_exec_time_ms: mean.unwrap_or(0.0),
                    rows,
                    extras: std::collections::HashMap::new(),
                },
            )
            .collect())
    }

    /// Issue #1073 (U4 MySQL parity) — server identity (`VERSION()` +
    /// `@@hostname`) plus uptime / active connections from `SHOW GLOBAL STATUS`
    /// and a whitelist of tuning knobs from `SHOW GLOBAL VARIABLES`. `SHOW`
    /// commands are used over `performance_schema.global_status` so the panel
    /// works even when `performance_schema` is disabled. `extras` mirrors the PG
    /// `{ name: { setting } }` shape so the UI's raw subsection renders both
    /// engines with one code path.
    pub async fn server_info(&self) -> Result<crate::models::ServerInfoRow, AppError> {
        let pool = self.active_pool().await?;

        let (version, host): (String, Option<String>) =
            sqlx::query_as("SELECT VERSION(), @@hostname")
                .fetch_one(&pool)
                .await
                .map_err(|e| AppError::Database(format!("VERSION()/@@hostname failed: {e}")))?;

        // Value column is a string for both status and variables; parse numerics
        // in Rust rather than casting server-side (SHOW has no typed projection).
        let status: Vec<(String, String)> = sqlx::query_as(
            "SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime', 'Threads_connected')",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(format!("SHOW GLOBAL STATUS failed: {e}")))?;
        let mut uptime_sec = None;
        let mut connections_active = None;
        for (name, value) in status {
            match name.as_str() {
                "Uptime" => uptime_sec = value.parse::<i64>().ok(),
                "Threads_connected" => connections_active = value.parse::<i64>().ok(),
                _ => {}
            }
        }

        let variables: Vec<(String, String)> = sqlx::query_as(
            "SHOW GLOBAL VARIABLES WHERE Variable_name IN \
             ('version_comment', 'max_connections', 'innodb_buffer_pool_size', \
              'max_allowed_packet', 'time_zone')",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(format!("SHOW GLOBAL VARIABLES failed: {e}")))?;
        let mut extras: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::new();
        for (name, value) in variables {
            extras.insert(name, serde_json::json!({ "setting": value }));
        }

        Ok(crate::models::ServerInfoRow {
            version,
            host,
            uptime_sec,
            connections_active,
            extras,
        })
    }
}

/// Classify a `performance_schema` digest-query failure:
/// `Some("mysql_performance_schema")` when the digest table is unavailable
/// (missing / disabled / access denied), `None` for any other DB error (kept as
/// `AppError::Database`). Pure so the not-enabled → capability mapping is
/// unit-testable without a live server. Conservative — an ambiguous error that
/// does not name performance_schema stays `Database`.
fn classify_performance_schema_error(msg: &str) -> Option<&'static str> {
    let lower = msg.to_ascii_lowercase();
    if lower.contains("performance_schema")
        && (lower.contains("doesn't exist")
            || lower.contains("does not exist")
            || lower.contains("disabled")
            || lower.contains("access denied"))
    {
        Some("mysql_performance_schema")
    } else {
        None
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

    // Refs #1067 — DB lifecycle + EXPLAIN parity. PG (`postgres/schema.rs`)
    // 의 동명 유닛 케이스와 1:1. identifier / empty-SQL guard 는 pool 없이
    // 검증 가능한 branch 라 실 MySQL 없이 회귀 가드한다.
    #[tokio::test]
    async fn create_database_rejects_empty_name() {
        let adapter = MysqlAdapter::new();
        match adapter.create_database("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_database_rejects_invalid_identifier() {
        let adapter = MysqlAdapter::new();
        match adapter.create_database("1bad-name").await {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_database_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.create_database("analytics").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_database_rejects_empty_name() {
        let adapter = MysqlAdapter::new();
        match adapter.drop_database("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_database_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.drop_database("analytics").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_rejects_empty_sql() {
        let adapter = MysqlAdapter::new();
        match adapter.explain_query("").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("must not be empty"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_rejects_whitespace_sql() {
        let adapter = MysqlAdapter::new();
        match adapter.explain_query("   \n\t").await {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.explain_query("SELECT 1").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Issue #1073 — admin ops. The SQL bodies need a live MySQL (covered by
    // mysql_integration.rs); the pool-acquisition guard is the branch that is
    // reachable without a server, mirroring the PG `*_without_connection_fails`
    // unit cases. kill_session takes a typed i64 (no identifier validation to
    // assert) — its guard here also documents that no string reaches the SQL.
    #[tokio::test]
    async fn list_server_activity_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.list_server_activity().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn kill_session_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.kill_session(42).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn slow_queries_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.slow_queries(10).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Reason: a disabled/inaccessible performance_schema is a server-config gap,
    // not a bug — it must classify as CapabilityNotEnabled (passive UI hint)
    // while unrelated digest-query failures stay Database (2026-07-17, slow-query UX).
    #[test]
    fn classify_performance_schema_maps_unavailable_only() {
        assert_eq!(
            classify_performance_schema_error(
                "Table 'performance_schema.events_statements_summary_by_digest' doesn't exist"
            ),
            Some("mysql_performance_schema")
        );
        assert_eq!(
            classify_performance_schema_error(
                "Access denied for user 'app'@'%' to performance_schema"
            ),
            Some("mysql_performance_schema")
        );
        assert_eq!(
            classify_performance_schema_error("Lost connection to MySQL server"),
            None
        );
    }

    #[tokio::test]
    async fn server_info_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.server_info().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }
}
