//! MySQL schema introspection — databases (= schemas), tables, columns,
//! indexes, constraints, and views.
//!
//! Mirrors the PG (`db/postgres/schema.rs`) classification, with dialect
//! differences:
//! - In MySQL, a database is the namespace (a synonym for 'schema'). `SHOW
//!   DATABASES` / `information_schema.schemata` return the same list.
//! - System schemas (`information_schema`, `mysql`, `performance_schema`,
//!   `sys`) are filtered out of the user-facing surface.
//! - `information_schema.columns.column_type` is equivalent to PG
//!   `format_type` (`varchar(200)`, `int(11)`, `decimal(10,2)` form). No
//!   separate normalization needed.
//! - CHECK constraints are read from `information_schema.check_constraints`
//!   only when the server-version gate is open, projected per referenced
//!   column as `check_clauses`.

use sqlx::MySqlPool;
use std::future::Future;

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, SchemaInfo, TableInfo,
    TriggerInfo, ViewInfo,
};

use super::checks::{build_check_map, is_check_metadata_unavailable};
use super::MysqlAdapter;

/// Issue #1077 Stage 2 — read-only users listing from the `mysql.user` grant
/// table. The projection is the account identity (`User`/`Host`), the privilege
/// and lock flags, the authentication plugin and `max_user_connections` — the
/// `authentication_string` / `Password` credential columns are NEVER selected
/// (mirrors the PG `pg_roles` posture; see
/// `users_queries_never_select_a_credential_column`).
///
/// Every text column goes through `CONVERT(... USING utf8mb4)` for the same
/// reason `MysqlAdapter::list_schemas` documents below.
/// `max_user_connections` is `CAST(... AS SIGNED)` for the wire i64.
///
/// **MySQL only — MariaDB takes [`MARIADB_USERS_QUERY`].** `account_locked` was
/// added to `mysql.user` in MySQL 5.7.6; MariaDB's `mysql.user` does not carry
/// it (measured absent on 10.3, 10.4 and 11.3), so this text fails the whole
/// panel there with `1054 (42S22): Unknown column 'account_locked' in 'field
/// list'`.
/// [`MysqlAdapter::users_query`](MysqlAdapter::users_query) picks the arm.
/// The trailing `'N'` fills the `is_role` slot both queries share: MySQL has no
/// such column because `CREATE ROLE` there produces an ordinary account that is
/// already `account_locked = 'Y'`.
pub(crate) const MYSQL_USERS_QUERY: &str = "SELECT CONVERT(User USING utf8mb4), \
     CONVERT(Host USING utf8mb4), CONVERT(Super_priv USING utf8mb4), \
     CONVERT(Create_priv USING utf8mb4), CONVERT(Create_user_priv USING utf8mb4), \
     CONVERT(Repl_slave_priv USING utf8mb4), CONVERT(account_locked USING utf8mb4), \
     CONVERT(plugin USING utf8mb4), \
     CAST(max_user_connections AS SIGNED), 'N' \
     FROM mysql.user ORDER BY User, Host";

/// Issue #1077 Stage 2 — the MariaDB arm of [`MYSQL_USERS_QUERY`]. Same
/// projected shape, so both decode into [`MysqlUserRow`].
///
/// MariaDB 10.4 turned `mysql.user` into a view over `mysql.global_priv`, and
/// the view carries no `account_locked` column (measured on 10.4 and 11.3); the
/// lock flag lives in the `global_priv` `Priv` JSON document. Only the one key
/// is extracted — that same document also holds `authentication_string`, so
/// selecting `Priv` itself would put a credential on the wire (guard test:
/// `users_queries_never_select_a_credential_column`).
///
/// `is_role` is a real column here, and it is what the mapper's role test keys
/// off.
///
/// The `LEFT JOIN` is deliberate. `mysql.user` is a view over `global_priv` so
/// the two are 1:1 today, but an account-audit screen must never drop a
/// principal silently — an unmatched row surfaces as "not locked" instead of
/// disappearing.
///
/// MariaDB before 10.4 has no `mysql.global_priv` and fails loud with `1146
/// Table 'mysql.global_priv' doesn't exist` (measured on 10.3), which is the
/// intended posture — mislabelling a locked account as loginable is worse than
/// refusing the panel.
pub(crate) const MARIADB_USERS_QUERY: &str = "SELECT CONVERT(u.User USING utf8mb4), \
     CONVERT(u.Host USING utf8mb4), CONVERT(u.Super_priv USING utf8mb4), \
     CONVERT(u.Create_priv USING utf8mb4), CONVERT(u.Create_user_priv USING utf8mb4), \
     CONVERT(u.Repl_slave_priv USING utf8mb4), \
     IF(JSON_VALUE(g.Priv, '$.account_locked') IN ('true', '1'), 'Y', 'N'), \
     CONVERT(u.plugin USING utf8mb4), \
     CAST(u.max_user_connections AS SIGNED), CONVERT(u.is_role USING utf8mb4) \
     FROM mysql.user u \
     LEFT JOIN mysql.global_priv g ON g.User = u.User AND g.Host = u.Host \
     ORDER BY u.User, u.Host";

/// One decoded users row: `User`, `Host`, the four `enum('N','Y')` grant flags,
/// the account-locked flag, `plugin`, the raw `max_user_connections`, and the
/// role flag (always `'N'` on MySQL). Both vendor queries project this shape.
pub(super) type MysqlUserRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
);

/// Pure `mysql.user` row → wire `DatabaseUserRow`. Extracted from the IO body
/// so the two mappings that are easy to get silently wrong stay unit-testable
/// without a live server:
///
/// - **`conn_limit`** — the wire contract is PG's `rolconnlimit`
///   (`crate::models::DatabaseUserRow::conn_limit`): `-1` means unlimited and
///   `0` means "no connections allowed". `DatabaseUsersPanel` turns `< 0` into
///   the "Unlimited" label and prints every other value verbatim, so a wrong
///   sentinel reaches the operator as a number. MySQL inverts the sentinel —
///   `max_user_connections = 0` means *unlimited* (defer to the global cap) —
///   and MariaDB uses a negative value for "this account may not connect at
///   all". A raw passthrough would show practically every account as "0
///   connections allowed" and a banned MariaDB account as "Unlimited".
/// - **`can_login`** — `account_locked` alone over-reports. The `mysql_no_login`
///   plugin exists precisely to make an account non-loginable, and a MariaDB
///   10.4+ role lives in the same view (rendered under its bare role name, not
///   `role@`) yet can never log in. The role test is the `is_role` column.
pub(super) fn map_mysql_user_row(row: MysqlUserRow) -> crate::models::DatabaseUserRow {
    let (
        user,
        host,
        super_priv,
        create_priv,
        create_user_priv,
        repl_slave_priv,
        account_locked,
        plugin,
        max_user_connections,
        is_role,
    ) = row;

    crate::models::DatabaseUserRow {
        name: if host.is_empty() {
            user
        } else {
            format!("{user}@{host}")
        },
        can_login: account_locked != "Y" && plugin != "mysql_no_login" && is_role != "Y",
        is_superuser: super_priv == "Y",
        can_create_db: create_priv == "Y",
        can_create_role: create_user_priv == "Y",
        replication: repl_slave_priv == "Y",
        conn_limit: match max_user_connections {
            0 => -1,
            n if n < 0 => 0,
            n => n,
        },
        valid_until: None,
        member_of: Vec::new(),
    }
}

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

/// MySQL data type → DataGrid category mapping. Same policy as PG's
/// `map_pg_data_type` (AC-238-02): branch on the raw `data_type` only —
/// the lowercase keyword with length/precision stripped.
pub(super) fn map_mysql_data_type(data_type: &str) -> ColumnCategory {
    let lower = data_type.trim().to_ascii_lowercase();
    // For `int unsigned` and other modifier-carrying forms, extract only the
    // base keyword.
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

/// Same format as PG schema.rs's `format_fk_reference`
/// (`<schema>.<table>(<column>)`) — the frontend `parseFkReference` expects
/// this same wire format across PG and MySQL.
pub(super) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
}

impl MysqlAdapter {
    /// User-visible database list, excluding system schemas.
    ///
    /// On MySQL 8.0+, `information_schema` exposes some identifier columns as
    /// utf8mb3 `_bin` collation or VARBINARY — when sqlx tries to decode them
    /// as String, `mismatched types … is not compatible with SQL type
    /// VARBINARY` surfaces. Every identifier select is wrapped in
    /// `CONVERT(... USING utf8mb4)` so it comes back as deterministic utf8
    /// text.
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

    /// `BASE TABLE` only. `table_rows` is InnoDB's approximate row estimate —
    /// the counterpart of PG's `pg_stat_user_tables.n_live_tup`.
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

    /// Same responsibility as PG's `get_table_columns_inner`. CHECK metadata
    /// is queried only when the server-version gate is open.
    /// 4 round-trips:
    /// (1) columns, (2) PK, (3) FK, (4) CHECK — in MySQL the column comment
    /// is inline in `information_schema.columns.column_comment`, so no
    /// separate `col_description` round-trip is needed as in PG.
    pub(super) async fn get_table_columns_inner(
        &self,
        pool: &MySqlPool,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        // column_type: `varchar(200)`, `int(11)`, `decimal(10,2)` —
        // equivalent to PG's `format_type`. data_type: `varchar` / `int` /
        // `decimal` (without length/precision) — used for category mapping.
        // Every identifier column is wrapped in `CONVERT(... USING utf8mb4)`
        // to avoid the case where MySQL 8.0's information_schema exposes it
        // as VARBINARY.
        // #1433 — extra: an `auto_increment` column has a NULL column_default,
        // so the default alone cannot identify it. The frontend INSERT
        // generator needs the is_identity flag to omit unfilled
        // auto-increment cells.
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

        // FK — take only the rows whose `referenced_table_name` is non-null.
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

    /// Every database (= schema) on the user-facing surface. The MySQL
    /// counterpart of PG `list_databases`. Equivalent to `SHOW DATABASES`,
    /// but routed through information_schema so the result does not depend
    /// on how the `LIKE` filter handles backslash escaping.
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        // In MySQL schema == database — the same result as `list_schemas`,
        // but the intent branch is kept (aligned with the PG paradigm).
        self.list_schemas().await
    }

    /// Fetches every table column of one schema in a single round-trip.
    /// Equivalent to PG `list_schema_columns` — called by the frontend
    /// Schema overview.
    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
        let pool = self.active_pool().await?;

        // 7-column SELECT — within sqlx query_as's tuple size limit (16 in
        // most cases), but only column_default is Optional, so it is spelled
        // out with the named accessor (`try_get`). Slightly more surface than
        // the PG side's 5-tuple pattern, yet it guarantees one round-trip.
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

        // PKs across the whole schema — a set of (table, column) tuples.
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

        // FKs across the whole schema.
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
                // ponytail: schema-overview path — the INSERT generator
                // consumes only the get_table_columns_inner result. Join
                // extra in if that changes.
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

    /// Index metadata for `(schema, table)`. The MySQL counterpart of PG
    /// `get_table_indexes`. `information_schema.statistics` returns one row
    /// per index column, so the rows are ordered by (index_name,
    /// seq_in_index) to preserve column order.
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let pool = self.active_pool().await?;
        // index_type: BTREE / HASH / FULLTEXT / SPATIAL — sqlx decodes it as String.
        // non_unique: 0 = unique, 1 = non-unique (MySQL's inverted sense).
        // An index_name of 'PRIMARY' means the PK.
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

    /// Table-level constraint metadata. PK / FK / UNIQUE are always queried;
    /// CHECK is included only on MySQL 8.0.16+ / MariaDB 10.2.1+, where the
    /// server-version gate is open.
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

        // (name, type, column, ref_table, ref_column) — an FK's ref columns
        // live in key_column_usage. For CHECK the column is null.
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

    /// The list of views inside a schema.
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

    /// A view's columns. Same path as table column introspection (in MySQL a
    /// view's columns also land in information_schema.columns). Views have no
    /// PK / FK, so both are always false.
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

    /// View definition body. The view_definition column of
    /// `information_schema.views` returns the normalized form of the view
    /// query, depending on sql_mode.
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

    /// The function / procedure list. Branches on the routine_type of
    /// `information_schema.routines` between 'FUNCTION' and 'PROCEDURE'.
    /// MySQL has no user-defined aggregate/window as PG does (built-ins
    /// only), so routine_type is itself the kind.
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

        // arguments — a separate round-trip against the parameters table.
        // Equivalent to PG's `pg_get_function_arguments`.
        // parameter_name is nullable (NULL for the RETURNS row) — Optional.
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

    /// The body of a function/procedure. The counterpart of PG
    /// `get_function_source`. Reads `routine_definition` from
    /// `information_schema.routines`; a user without DEFINER privilege sees
    /// it as NULL, which surfaces as an empty body rather than an error.
    pub async fn get_function_source(
        &self,
        schema: &str,
        function: &str,
    ) -> Result<String, AppError> {
        // Resolve the routine kind first.
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

    /// The user triggers of `(schema, table)`.
    /// `information_schema.triggers` — action_timing / event_manipulation /
    /// action_orientation / action_statement are all exposed, mapping 1:1
    /// onto PG's separated-field form.
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

        // In MySQL one trigger is normally one event. Folding through a
        // BTreeMap keyed by trigger_name means that a server exposing a
        // multi-event trigger accumulates only the events instead of
        // producing duplicate entries.
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
                    // A MySQL trigger has an inline body — no notion of a
                    // separate function. function_schema/function_name are
                    // placeholders: the schema, and an empty name.
                    function_schema: schema.to_string(),
                    function_name: String::new(),
                    arguments: None,
                    when_expression: None,
                    definition: statement,
                },
            )
            .collect())
    }

    /// The action_statement of one trigger.
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
    /// MySQL does not allow CREATE/DROP DATABASE inside an explicit
    /// transaction block, so this goes to the active pool as a single
    /// statement (sqlx auto-commits a lone statement it did not wrap in a
    /// transaction). Same contract as PG `create_database` — the identifier
    /// is validated against an ASCII sub-set and then backtick-quoted to
    /// block injection.
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

    /// Refs #1067 — `DROP DATABASE \`<name>\``. Symmetric with
    /// `create_database`. No session may be attached to the target DB — if
    /// one remains, the server error is surfaced as-is.
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
    /// MySQL returns the plan tree as a single-row / single-column JSON
    /// **string** (column `EXPLAIN`, LONGTEXT) — unlike PG's native `JSON`
    /// type, so it is decoded as String and then parsed with `serde_json`.
    /// `ANALYZE` is not used: the Explain UI is plan inspection, not an
    /// execution profiler (same policy as the PG override). ExplainViewer
    /// falls through to a raw JSON view for non-PG payloads, so it renders
    /// without a per-dialect tree parser.
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

    /// Issue #1077 Stage 2 — read-only users listing from `mysql.user`. The SQL
    /// comes from [`MysqlAdapter::users_query`] (`MYSQL_USERS_QUERY` or
    /// `MARIADB_USERS_QUERY`) and the rows go through the pure
    /// `map_mysql_user_row`. No credential column crosses the IPC boundary. The
    /// PG-shaped `DatabaseUserRow` is reused: `name` is `user@host`, or the bare
    /// name when `Host` is empty (MySQL scopes accounts by host, unlike
    /// PG's flat role name; a MariaDB role has no host), the boolean flags map from the `enum('N','Y')`
    /// grant columns, and `max_user_connections` is normalised onto the PG
    /// `rolconnlimit` sentinel. `valid_until` and `member_of` have no
    /// widely-portable `mysql.user` source — the MySQL role graph
    /// (`mysql.role_edges`, 8.0+) is a later #1077 depth step — so they stay
    /// empty.
    pub async fn list_database_users(
        &self,
    ) -> Result<Vec<crate::models::DatabaseUserRow>, AppError> {
        let pool = self.active_pool().await?;
        let rows: Vec<MysqlUserRow> = sqlx::query_as(self.users_query())
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(format!("mysql.user listing failed: {e}")))?;

        Ok(rows.into_iter().map(map_mysql_user_row).collect())
    }

    /// The vendor arm of the users projection. `mysql.user` is not one schema:
    /// MySQL has `account_locked` and no `is_role`, MariaDB has `is_role` and
    /// keeps the lock flag in `mysql.global_priv`. Routing on the constructed
    /// `kind` rather than on a runtime version probe keeps this unit-testable
    /// (`users_query_routes_on_the_constructed_vendor`) and costs no round trip;
    /// `MysqlAdapter::new_mariadb` is the only way a MariaDB connection is
    /// built (`commands/connection.rs`).
    pub(super) fn users_query(&self) -> &'static str {
        match self.kind {
            crate::models::DatabaseType::Mariadb => MARIADB_USERS_QUERY,
            _ => MYSQL_USERS_QUERY,
        }
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
    //! Reason (2026-05-13): the category branch of map_mysql_data_type
    //! drives the DataGrid width/alignment the user sees. It is a pure fn, so
    //! it can be regression-guarded without a live DB — this catches quickly
    //! the regression where an added type silently falls through to Unknown.
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
        // Wire format shared by PG / MySQL — the frontend `parseFkReference`
        // parses both dialects' results with one regex.
        assert_eq!(
            format_fk_reference("public", "users", "id"),
            "public.users(id)"
        );
        assert_eq!(
            format_fk_reference("app", "orders", "user_id"),
            "app.orders(user_id)"
        );
    }

    // Refs #1067 — DB lifecycle + EXPLAIN parity. 1:1 with the same-named
    // unit cases in PG (`postgres/schema.rs`). The identifier / empty-SQL
    // guards are branches verifiable without a pool, so they are
    // regression-guarded without a live MySQL.
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

    // Issue #1077 Stage 2 (2026-07-25) — the no-connection path of
    // list_database_users. Its SQL choice and its row mapping are unit-covered
    // separately (`users_query_routes_on_the_constructed_vendor`, the
    // `map_mysql_user_row_*` tests); what needs a server is the mysql.user
    // column decode, which the integration suite owns. Mirrors the PG/MySQL
    // admin-op guards.
    #[tokio::test]
    async fn list_database_users_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        match adapter.list_database_users().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25, both vendor arms 2026-08-02) —
    // the users queries must read the account identity + privilege flags from
    // `mysql.user` and must NEVER select a credential column
    // (`authentication_string` / `Password`). MariaDB raises the stake: its
    // lock flag lives in the `mysql.global_priv` `Priv` JSON document, which
    // ALSO holds `authentication_string`, so selecting `Priv` whole — the
    // obvious shortcut — would ship a password hash to the frontend. The
    // projection must name the one JSON key.
    #[test]
    fn users_queries_never_select_a_credential_column() {
        for (vendor, query) in [
            ("MySQL", MYSQL_USERS_QUERY),
            ("MariaDB", MARIADB_USERS_QUERY),
        ] {
            assert!(
                query.contains("mysql.user"),
                "{vendor}: must source the mysql.user grant table"
            );
            let lower = query.to_ascii_lowercase();
            assert!(
                !lower.contains("authentication_string"),
                "{vendor}: authentication_string is the credential column — must not be selected"
            );
            assert!(
                !lower.contains("password"),
                "{vendor}: no password credential column may be selected"
            );
        }
        // "only the one key" has to be counted, not spot-checked: banning a
        // single spelling (`CONVERT(g.Priv`) still lets a bare `g.Priv` into the
        // select list. One occurrence, and it is the keyed extraction.
        assert_eq!(
            MARIADB_USERS_QUERY.matches("g.Priv").count(),
            1,
            "MariaDB must reference the global_priv document exactly once — the \
             surrounding document carries authentication_string"
        );
        assert!(
            MARIADB_USERS_QUERY.contains("JSON_VALUE(g.Priv, '$.account_locked')"),
            "MariaDB must extract only the account_locked key — the surrounding \
             global_priv document carries authentication_string"
        );
    }

    // Issue #1077 Stage 2 (2026-08-02) — `mysql.user` is not one schema across
    // the family: MariaDB 10.4 made it a view over `mysql.global_priv` that
    // carries no `account_locked`, so sending the MySQL text to MariaDB fails
    // the whole panel with `1054 (42S22): Unknown column 'account_locked' in
    // 'field list'` (reproduced through the adapter on mariadb:11.3, and by
    // hand on 11.8 and 10.4). Sharing one constant across the two vendors is
    // exactly the regression this pins, so the assertions are written against
    // each vendor's real column vocabulary rather than against the routing
    // function alone.
    #[test]
    fn users_query_routes_on_the_constructed_vendor() {
        assert_eq!(
            MysqlAdapter::new().users_query(),
            MYSQL_USERS_QUERY,
            "MySQL must keep the account_locked projection"
        );
        assert_eq!(
            MysqlAdapter::new_mariadb().users_query(),
            MARIADB_USERS_QUERY,
            "MariaDB must not be sent the account_locked projection"
        );

        assert!(
            MYSQL_USERS_QUERY.contains("account_locked")
                && !MYSQL_USERS_QUERY.contains("global_priv"),
            "MySQL has the column and no global_priv table"
        );
        assert!(
            !MARIADB_USERS_QUERY.contains("CONVERT(account_locked")
                && !MARIADB_USERS_QUERY.contains("CONVERT(u.account_locked"),
            "MariaDB has no account_locked column — selecting it is error 1054"
        );
        assert!(
            MARIADB_USERS_QUERY.contains("mysql.global_priv")
                && MARIADB_USERS_QUERY.contains("u.is_role"),
            "MariaDB reads the lock flag from global_priv and roles from is_role"
        );
    }

    // Issue #1077 Stage 2 (2026-07-25) — `MysqlAdapter::list_schemas` documents
    // the repo-wide rule; this guard pins it for the eight text columns
    // `MYSQL_USERS_QUERY` selects today. A ninth text column added without
    // `CONVERT` would not fail here — the list is hand-maintained.
    #[test]
    fn mysql_users_query_converts_text_columns_to_utf8mb4() {
        for column in [
            "User",
            "Host",
            "Super_priv",
            "Create_priv",
            "Create_user_priv",
            "Repl_slave_priv",
            "account_locked",
            "plugin",
        ] {
            assert!(
                MYSQL_USERS_QUERY.contains(&format!("CONVERT({column} USING utf8mb4)")),
                "`{column}` must be wrapped in CONVERT(... USING utf8mb4)"
            );
        }
    }

    // Issue #1077 Stage 2 (2026-08-02) — the same binary-decode trap applies to
    // the MariaDB arm; its columns are alias-qualified, and `is_role` joins the
    // list. The lock flag is an `IF(...)` literal, so it is already utf8mb4.
    #[test]
    fn mariadb_users_query_converts_text_columns_to_utf8mb4() {
        for column in [
            "u.User",
            "u.Host",
            "u.Super_priv",
            "u.Create_priv",
            "u.Create_user_priv",
            "u.Repl_slave_priv",
            "u.plugin",
            "u.is_role",
        ] {
            assert!(
                MARIADB_USERS_QUERY.contains(&format!("CONVERT({column} USING utf8mb4)")),
                "`{column}` must be wrapped in CONVERT(... USING utf8mb4)"
            );
        }
    }

    fn user_row(host: &str, account_locked: &str, plugin: &str, conns: i64) -> MysqlUserRow {
        role_row(host, account_locked, plugin, conns, "N")
    }

    fn role_row(
        host: &str,
        account_locked: &str,
        plugin: &str,
        conns: i64,
        is_role: &str,
    ) -> MysqlUserRow {
        (
            "app".into(),
            host.into(),
            "N".into(),
            "N".into(),
            "N".into(),
            "N".into(),
            account_locked.into(),
            plugin.into(),
            conns,
            is_role.into(),
        )
    }

    // Issue #1077 Stage 2 (2026-07-25) — `conn_limit` crosses the wire as PG's
    // `rolconnlimit` and `DatabaseUsersPanel` renders `< 0` as "Unlimited".
    // MySQL inverts the sentinel (`0` = unlimited) and MariaDB uses a negative
    // value for "may not connect at all", so a raw passthrough mislabels
    // practically every account and inverts the MariaDB ban.
    #[test]
    fn map_mysql_user_row_normalises_conn_limit_onto_the_pg_sentinel() {
        assert_eq!(
            map_mysql_user_row(user_row("%", "N", "caching_sha2_password", 0)).conn_limit,
            -1,
            "MySQL 0 = unlimited → PG -1"
        );
        assert_eq!(
            map_mysql_user_row(user_row("%", "N", "caching_sha2_password", -1)).conn_limit,
            0,
            "MariaDB negative = no connections allowed → PG 0"
        );
        assert_eq!(
            map_mysql_user_row(user_row("%", "N", "caching_sha2_password", 5)).conn_limit,
            5,
            "a real cap passes through unchanged"
        );
    }

    // Issue #1077 Stage 2 (2026-07-25) — `account_locked` alone over-reports
    // login capability: `mysql_no_login` exists to make an account
    // non-loginable, and a MariaDB 10.4+ role sits in the same view (rendered
    // under its bare name, not `role@`).
    #[test]
    fn map_mysql_user_row_reports_login_capability_and_identity() {
        let normal = map_mysql_user_row(user_row("%", "N", "caching_sha2_password", 0));
        assert_eq!(normal.name, "app@%");
        assert!(normal.can_login);

        assert!(
            !map_mysql_user_row(user_row("%", "Y", "caching_sha2_password", 0)).can_login,
            "a locked account cannot log in"
        );
        assert!(
            !map_mysql_user_row(user_row("%", "N", "mysql_no_login", 0)).can_login,
            "the mysql_no_login plugin makes the account non-loginable"
        );

        let mariadb_role = map_mysql_user_row(role_row("", "N", "", 0, "Y"));
        assert_eq!(mariadb_role.name, "app", "a role renders bare, not app@");
        assert!(!mariadb_role.can_login, "a MariaDB role cannot log in");
    }

    // Issue #1077 Stage 2 (2026-08-02) — the role test used to be
    // `!host.is_empty()`; MariaDB records roles with the dedicated `is_role`
    // column, and the mapper has no vendor branch.
    #[test]
    fn map_mysql_user_row_uses_is_role_not_an_empty_host_to_deny_login() {
        let empty_host_account =
            map_mysql_user_row(role_row("", "N", "mysql_native_password", 0, "N"));
        assert!(
            empty_host_account.can_login,
            "an empty Host alone must not deny login — is_role decides"
        );

        let role_with_a_host = map_mysql_user_row(role_row("%", "N", "", 0, "Y"));
        assert!(
            !role_with_a_host.can_login,
            "is_role decides, independent of Host"
        );
    }
}
