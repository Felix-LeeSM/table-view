//! PostgreSQL schema introspection — schemas, tables, views, functions,
//! columns, indexes, constraints, databases.
//!
//! Sprint 202 split from `db/postgres.rs`. `format_fk_reference`
//! co-located here since it is the canonical wire format consumed by
//! the schema-aware FK rendering path (DataGridTable.tsx
//! `parseFkReference`).

use sqlx::PgPool;

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, PostgresTypeInfo, SchemaInfo, TableInfo,
    ViewInfo,
};

use super::category::map_pg_data_type;
use super::connection::is_pg_database_permission_denied;
use super::PostgresAdapter;

/// Sprint 230 — canonical SQL emitted by `PostgresAdapter::list_types`.
///
/// Captured as a `pub(crate) const &str` so the runtime executes the
/// same byte-string the unit test (`list_types_sql_matches_canonical_fixture`)
/// asserts against. Any future tweak to the filter set must update both
/// the const and the assertion together — drift is caught by `cargo
/// test list_types`.
///
/// Filter set:
/// - `typtype IN ('b','d','e','r','c')` — base / domain / enum / range
///   / composite. Pseudo (`'p'`, e.g. `any`) and multirange (`'m'`)
///   are intentionally excluded.
/// - `typname NOT LIKE '\_%' ESCAPE '\'` — array element types
///   (`_int4`, `_text`, etc.) are excluded; only the bare element
///   name (`int4`, `text`) is surfaced via the base row.
/// - `nspname NOT IN ('pg_toast')` — TOAST internal types are not
///   user-selectable column types.
/// - `NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)`
///   — auto row types backing every CREATE TABLE are excluded; only
///   user-defined `CREATE TYPE … AS (…)` composites survive on the
///   `'c'` arm.
/// - `pg_catalog` namespace is kept in scope so built-ins (`varchar`,
///   `int4`, `uuid`) appear; the frontend hook strips the
///   `pg_catalog.` prefix when building the display label.
pub(crate) const LIST_TYPES_SQL: &str = "SELECT n.nspname AS schema, t.typname AS name,
       CASE t.typtype
            WHEN 'b' THEN 'base'
            WHEN 'd' THEN 'domain'
            WHEN 'e' THEN 'enum'
            WHEN 'r' THEN 'range'
            WHEN 'c' THEN 'composite'
       END AS type_kind
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
 WHERE t.typtype IN ('b', 'd', 'e', 'r', 'c')
   AND t.typname NOT LIKE '\\_%' ESCAPE '\\'
   AND n.nspname NOT IN ('pg_toast')
   AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.reltype = t.oid
   )
 ORDER BY n.nspname, t.typname";

/// Serialize a foreign-key reference into the canonical
/// `<schema>.<table>(<column>)` string consumed by the frontend
/// (`parseFkReference` in `DataGridTable.tsx`).
///
/// Sprint-89 (#FK-1): the previous implementation built this string in SQL
/// (`ccu.table_name || '.' || ccu.column_name`) which (a) silently dropped
/// the schema and (b) made the format un-testable. This pure helper is the
/// single source of truth for the wire format and is exercised by both unit
/// tests in this file and by the `tests/fixtures/fk_reference_samples.json`
/// shared fixture.
///
/// **Input assumptions**: callers must pass identifiers that do **not**
/// contain `.`, `(`, or `)` characters. The fixture intentionally exercises
/// hyphens, underscores, and spaces (which round-trip cleanly through the
/// regex on the TS side) but the format does not currently quote or escape
/// reserved characters — adding that is tracked separately and is not in
/// sprint-89's scope.
pub(crate) fn format_fk_reference(schema: &str, table: &str, column: &str) -> String {
    format!("{schema}.{table}({column})")
}

impl PostgresAdapter {
    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
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

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, Option<i64>)> = sqlx::query_as(
            "SELECT t.table_name, s.n_live_tup \
             FROM information_schema.tables t \
             LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema \
             WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' \
             ORDER BY t.table_name",
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
    /// Inner helper that takes a pool reference directly (avoids double-lock).
    pub(super) async fn get_table_columns_inner(
        &self,
        pool: &PgPool,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let pk_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT kcu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let pk_columns: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(col,)| col).collect();

        // Sprint-89 (#FK-1): select schema/table/column as 3 separate columns
        // so we can format the FK reference in Rust via `format_fk_reference`,
        // matching the `<schema>.<table>(<column>)` contract that the
        // frontend's `parseFkReference` expects.
        let fk_rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
             WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'",
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

        // Get column comments via col_description()
        let comment_rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname AS column_name, col_description(c.oid, a.attnum) AS comment \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comment_map: std::collections::HashMap<String, Option<String>> =
            comment_rows.into_iter().collect();

        // CHECK constraint expressions per column. `pg_get_constraintdef`
        // returns the canonical `CHECK ((<expr>))` form. A constraint
        // referencing N columns (via `conkey`) is duplicated across all
        // N rows so each column accumulates the same expression.
        // `array_agg` would also work but the per-column flatten via
        // `unnest` keeps the join symmetric with the FK / PK queries.
        let check_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT a.attname, pg_catalog.pg_get_constraintdef(c.oid, true) \
             FROM pg_catalog.pg_constraint c \
             JOIN pg_catalog.pg_class t ON t.oid = c.conrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_catalog.pg_attribute a \
               ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey) \
             WHERE c.contype = 'c' AND n.nspname = $1 AND t.relname = $2 \
             ORDER BY c.conname, a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut check_map: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for (col_name, def) in check_rows {
            check_map.entry(col_name).or_default().push(def);
        }

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let is_pk = pk_columns.contains(&name);
                let (is_fk, fk_reference) = match fk_map.get(&name) {
                    Some(ref_str) => (true, Some(ref_str.clone())),
                    None => (false, None),
                };
                let comment = comment_map.get(&name).and_then(Option::clone);
                let check_clauses = check_map.remove(&name).unwrap_or_default();
                let category = map_pg_data_type(&data_type);
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable == "YES",
                    default_value,
                    is_primary_key: is_pk,
                    is_foreign_key: is_fk,
                    fk_reference,
                    comment,
                    check_clauses,
                    category,
                }
            })
            .collect())
    }
    /// Fetches columns for every table in `schema` in one round-trip.
    /// Returns a map of table_name → Vec<ColumnInfo>.
    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError> {
        let pool = self.active_pool().await?;

        // Basic column info for all tables in the schema
        let col_rows: Vec<(String, String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT table_name, column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 \
             ORDER BY table_name, ordinal_position",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Primary keys for all tables in the schema
        let pk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT kcu.table_name, kcu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Foreign keys for all tables in the schema.
        // Sprint-89 (#FK-1): same restructuring as `get_table_columns` —
        // separate schema/table/column columns + Rust-side formatting.
        let fk_rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT kcu.table_name, kcu.column_name, \
                    ccu.table_schema, ccu.table_name, ccu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name \
              AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON tc.constraint_name = ccu.constraint_name \
              AND tc.table_schema = ccu.table_schema \
             WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Column comments for all tables in the schema
        let comment_rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT c.relname, a.attname, col_description(c.oid, a.attnum) \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_attribute a ON a.attrelid = c.oid \
              AND a.attnum > 0 AND NOT a.attisdropped \
             WHERE n.nspname = $1 AND c.relkind = 'r'",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build lookup sets/maps keyed by (table, column)
        let pk_set: std::collections::HashSet<(String, String)> = pk_rows.into_iter().collect();

        let fk_map: std::collections::HashMap<(String, String), String> = fk_rows
            .into_iter()
            .map(|(t, c, ref_schema, ref_table, ref_column)| {
                (
                    (t, c),
                    format_fk_reference(&ref_schema, &ref_table, &ref_column),
                )
            })
            .collect();

        let comment_map: std::collections::HashMap<(String, String), Option<String>> = comment_rows
            .into_iter()
            .map(|(t, c, cmt)| ((t, c), cmt))
            .collect();

        // CHECK constraints across the schema. Same shape as the per-
        // table version in `get_table_columns_inner` but keyed by
        // (table, column) so a single round-trip covers every table.
        let check_rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT t.relname, a.attname, pg_catalog.pg_get_constraintdef(c.oid, true) \
             FROM pg_catalog.pg_constraint c \
             JOIN pg_catalog.pg_class t ON t.oid = c.conrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_catalog.pg_attribute a \
               ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey) \
             WHERE c.contype = 'c' AND n.nspname = $1 \
             ORDER BY t.relname, c.conname, a.attnum",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut check_map: std::collections::HashMap<(String, String), Vec<String>> =
            std::collections::HashMap::new();
        for (t, c, def) in check_rows {
            check_map.entry((t, c)).or_default().push(def);
        }

        // Group columns by table
        let mut result: std::collections::HashMap<String, Vec<ColumnInfo>> =
            std::collections::HashMap::new();

        for (table_name, col_name, data_type, is_nullable, default_value) in col_rows {
            let is_pk = pk_set.contains(&(table_name.clone(), col_name.clone()));
            let (is_fk, fk_reference) = match fk_map.get(&(table_name.clone(), col_name.clone())) {
                Some(r) => (true, Some(r.clone())),
                None => (false, None),
            };
            let comment = comment_map
                .get(&(table_name.clone(), col_name.clone()))
                .and_then(Option::clone);
            let check_clauses = check_map
                .remove(&(table_name.clone(), col_name.clone()))
                .unwrap_or_default();

            let category = map_pg_data_type(&data_type);
            result.entry(table_name).or_default().push(ColumnInfo {
                name: col_name,
                data_type,
                nullable: is_nullable == "YES",
                default_value,
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

    #[allow(clippy::type_complexity)]
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, String, bool, bool, String)> = sqlx::query_as(
            "SELECT i.relname AS index_name,
                    a.attname AS column_name,
                    idx.indisunique AS is_unique,
                    idx.indisprimary AS is_primary,
                    am.amname AS index_method
             FROM pg_index idx
             JOIN pg_class t ON t.oid = idx.indrelid
             JOIN pg_class i ON i.oid = idx.indexrelid
             JOIN pg_am am ON am.oid = i.relam
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(idx.indkey)
             WHERE n.nspname = $1 AND t.relname = $2
             ORDER BY i.relname, a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut index_map: std::collections::BTreeMap<String, (bool, bool, String, Vec<String>)> =
            std::collections::BTreeMap::new();

        for (index_name, column_name, is_unique, is_primary, index_method) in rows {
            let entry = index_map.entry(index_name).or_insert((
                is_unique,
                is_primary,
                index_method,
                Vec::new(),
            ));
            entry.3.push(column_name);
        }

        Ok(index_map
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
    #[allow(clippy::type_complexity)]
    pub async fn get_table_constraints(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT tc.constraint_name,
                    tc.constraint_type,
                    kcu.column_name,
                    ccu_ref.table_name AS ref_table,
                    ccu_ref.column_name AS ref_column
             FROM information_schema.table_constraints tc
             LEFT JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
             LEFT JOIN information_schema.constraint_column_usage ccu_ref
               ON tc.constraint_name = ccu_ref.constraint_name
               AND tc.table_schema = ccu_ref.table_schema
               AND tc.constraint_type = 'FOREIGN KEY'
             WHERE tc.table_schema = $1
               AND tc.table_name = $2
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
             ORDER BY tc.constraint_name, kcu.ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut constraint_map: std::collections::BTreeMap<
            String,
            (String, Vec<String>, Option<String>, Vec<String>),
        > = std::collections::BTreeMap::new();

        for (name, ctype, column, ref_table, ref_column) in rows {
            let entry =
                constraint_map
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

        Ok(constraint_map
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

    /// List all views in the given schema.
    pub async fn list_views(&self, schema: &str) -> Result<Vec<ViewInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT table_name, view_definition \
             FROM information_schema.views \
             WHERE table_schema = $1 \
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

    /// Sprint 230 — list every Postgres type visible to the active
    /// connection (built-ins from `pg_catalog`, extension types from
    /// any other schema, user-defined enums / domains / ranges /
    /// composites). The SQL string is captured in the module-level
    /// [`LIST_TYPES_SQL`] const so the unit test
    /// `list_types_sql_matches_canonical_fixture` asserts byte-for-byte
    /// against the same string the runtime executes.
    ///
    /// Read-only — no cancel-token (the call is small, < 100 ms in
    /// practice). Pattern matches `list_views` / `list_functions` (no
    /// `query_id` argument).
    pub async fn list_types(&self) -> Result<Vec<PostgresTypeInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(LIST_TYPES_SQL)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(schema, name, type_kind)| PostgresTypeInfo {
                schema,
                name,
                // Defensive — the SQL whitelist already restricts
                // typtype to b/d/e/r/c so the CASE expression always
                // returns Some(_); fall back to "base" if PG ever
                // surprises us.
                type_kind: type_kind.unwrap_or_else(|| "base".to_string()),
            })
            .collect())
    }

    /// List all functions and procedures in the given schema.
    #[allow(clippy::type_complexity)]
    pub async fn list_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            i8,
        )> = sqlx::query_as(
            "SELECT p.proname, \
                        pg_get_function_arguments(p.oid) as args, \
                        pg_get_function_result(p.oid) as result, \
                        l.lanname, \
                        p.prosrc, \
                        p.prokind \
                 FROM pg_proc p \
                 JOIN pg_namespace n ON p.pronamespace = n.oid \
                 JOIN pg_language l ON p.prolang = l.oid \
                 WHERE n.nspname = $1 \
                   AND p.prokind IN ('f', 'p', 'a', 'w') \
                 ORDER BY p.proname",
        )
        .bind(schema)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(
                |(name, arguments, return_type, language, source, prokind)| {
                    let kind = match prokind {
                        112 => "procedure", // 'p'
                        97 => "aggregate",  // 'a'
                        119 => "window",    // 'w'
                        _ => "function",    // 'f' (102) or default
                    };
                    FunctionInfo {
                        name,
                        schema: schema.to_string(),
                        arguments,
                        return_type,
                        language: Some(language),
                        source,
                        kind: kind.to_string(),
                    }
                },
            )
            .collect())
    }

    /// Get the column metadata for a view.
    ///
    /// Views inherit column information from `information_schema.columns`,
    /// but they have no primary or foreign keys of their own — those fields
    /// are always returned as `false` / `None`.
    pub async fn get_view_columns(
        &self,
        schema: &str,
        view_name: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT column_name, data_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = $1 AND table_name = $2 \
             ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comment_rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname, col_description(a.attrelid, a.attnum) \
             FROM pg_attribute a \
             JOIN pg_class c ON a.attrelid = c.oid \
             JOIN pg_namespace n ON c.relnamespace = n.oid \
             WHERE n.nspname = $1 \
               AND c.relname = $2 \
               AND c.relkind IN ('v', 'm') \
               AND a.attnum > 0 \
               AND NOT a.attisdropped",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let comments: std::collections::HashMap<String, Option<String>> =
            comment_rows.into_iter().collect();

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let comment = comments.get(&name).cloned().flatten();
                let category = map_pg_data_type(&data_type);
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable.eq_ignore_ascii_case("yes"),
                    default_value,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                    comment,
                    check_clauses: Vec::new(),
                    category,
                }
            })
            .collect())
    }

    /// Get the definition SQL of a view.
    pub async fn get_view_definition(
        &self,
        schema: &str,
        view_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;

        let row: Option<(String,)> = sqlx::query_as(
            "SELECT view_definition \
             FROM information_schema.views \
             WHERE table_schema = $1 AND table_name = $2",
        )
        .bind(schema)
        .bind(view_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        match row {
            Some((def,)) => Ok(def),
            None => Err(AppError::Connection(format!(
                "View {schema}.{view_name} not found"
            ))),
        }
    }

    /// Get the source definition of a function or procedure.
    pub async fn get_function_source(
        &self,
        schema: &str,
        function_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;

        let row: Option<(String,)> = sqlx::query_as(
            "SELECT pg_get_functiondef(p.oid) \
             FROM pg_proc p \
             JOIN pg_namespace n ON p.pronamespace = n.oid \
             WHERE n.nspname = $1 AND p.proname = $2",
        )
        .bind(schema)
        .bind(function_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        match row {
            Some((source,)) => Ok(source),
            None => Err(AppError::Connection(format!(
                "Function {schema}.{function_name} not found"
            ))),
        }
    }

    /// List every non-template database visible to the connected role.
    ///
    /// Sprint 128 — counterpart to `DocumentAdapter::list_databases`. The
    /// canonical query is `SELECT datname FROM pg_database WHERE
    /// datistemplate = false ORDER BY datname`. Hosted PG (RDS, Cloud SQL,
    /// Supabase, Neon free tier) frequently revokes `SELECT` on
    /// `pg_database` for application roles — when that happens the driver
    /// reports `SQLSTATE 42501` ("insufficient_privilege"). We surface a
    /// graceful single-DB fallback in that case (`current_database()`) so
    /// the workspace toolbar can still render *something* useful instead of
    /// a hard error. Any other failure (network, server gone) still
    /// propagates as `AppError::Database`.
    ///
    /// Matching strategy:
    ///   1. SQLSTATE `42501` — exact match against `sqlx::Error::Database`.
    ///   2. Message substring `permission denied for table pg_database` —
    ///      case-insensitive fallback for drivers/locales that fail to expose
    ///      a SQLSTATE (rare, but observed in older sqlx releases).
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.active_pool().await?;

        let primary: Result<Vec<(String,)>, sqlx::Error> = sqlx::query_as::<_, (String,)>(
            "SELECT datname FROM pg_database \
             WHERE datistemplate = false \
             ORDER BY datname",
        )
        .fetch_all(&pool)
        .await;

        match primary {
            Ok(rows) => Ok(rows
                .into_iter()
                .map(|(name,)| SchemaInfo { name })
                .collect()),
            Err(err) if is_pg_database_permission_denied(&err) => {
                // Permission-denied fallback — surface the user's current DB
                // as a single entry so the switcher always has at least one
                // option to render.
                let current: (String,) = sqlx::query_as("SELECT current_database()")
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Ok(vec![SchemaInfo { name: current.0 }])
            }
            Err(err) => Err(AppError::Database(err.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::postgres::PostgresAdapter;

    #[tokio::test]
    async fn list_schemas_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_schemas().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }
    // ── list_views / list_functions / get_view_definition / get_function_source tests ─

    #[tokio::test]
    async fn list_views_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_views("public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn list_functions_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_functions("public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_view_columns_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_view_columns("public", "my_view").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_view_definition_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_view_definition("public", "my_view").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn get_function_source_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.get_function_source("public", "my_func").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }
    // ── Sprint-89 (#FK-1) — `format_fk_reference` unit + fixture tests ──

    #[test]
    fn format_fk_reference_happy_path() {
        assert_eq!(
            format_fk_reference("public", "users", "id"),
            "public.users(id)"
        );
    }

    #[test]
    fn format_fk_reference_underscored_identifiers() {
        assert_eq!(
            format_fk_reference("sales_v2", "orders", "user_id"),
            "sales_v2.orders(user_id)"
        );
    }

    #[test]
    fn format_fk_reference_special_chars_in_identifiers() {
        // Hyphens and spaces survive the round-trip because the TS regex
        // (`/^(.+)\.(.+)\((.+)\)$/`) is greedy on each segment.
        assert_eq!(
            format_fk_reference("audit-log", "events", "event id"),
            "audit-log.events(event id)"
        );
    }
    #[tokio::test]
    async fn list_databases_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = PostgresAdapter::list_databases(&adapter).await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }
    // ── Sprint 230 — list_types SQL builder fixture ────────────────────

    /// Asserts the runtime SQL string matches the canonical filter set
    /// byte-for-byte. Any future tweak (new typtype, additional schema
    /// exclusion, etc.) MUST update both `LIST_TYPES_SQL` and this
    /// fixture together — drift is caught here.
    #[test]
    fn list_types_sql_matches_canonical_fixture() {
        const EXPECTED: &str = "SELECT n.nspname AS schema, t.typname AS name,
       CASE t.typtype
            WHEN 'b' THEN 'base'
            WHEN 'd' THEN 'domain'
            WHEN 'e' THEN 'enum'
            WHEN 'r' THEN 'range'
            WHEN 'c' THEN 'composite'
       END AS type_kind
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
 WHERE t.typtype IN ('b', 'd', 'e', 'r', 'c')
   AND t.typname NOT LIKE '\\_%' ESCAPE '\\'
   AND n.nspname NOT IN ('pg_toast')
   AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.reltype = t.oid
   )
 ORDER BY n.nspname, t.typname";
        assert_eq!(LIST_TYPES_SQL, EXPECTED);
        // Spot-check that the canonical filter substrings are present
        // — if a future refactor reformats the const, these grep-style
        // checks still surface a regression.
        assert!(LIST_TYPES_SQL.contains("pg_catalog.pg_type t"));
        assert!(LIST_TYPES_SQL.contains("pg_catalog.pg_namespace n ON n.oid = t.typnamespace"));
        assert!(LIST_TYPES_SQL.contains("t.typtype IN ('b', 'd', 'e', 'r', 'c')"));
        assert!(LIST_TYPES_SQL.contains("t.typname NOT LIKE '\\_%' ESCAPE '\\'"));
        assert!(LIST_TYPES_SQL.contains("n.nspname NOT IN ('pg_toast')"));
        assert!(LIST_TYPES_SQL.contains("NOT EXISTS"));
        assert!(LIST_TYPES_SQL.contains("c.reltype = t.oid"));
        assert!(LIST_TYPES_SQL.contains("ORDER BY n.nspname, t.typname"));
    }

    #[tokio::test]
    async fn list_types_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_types().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[test]
    fn format_fk_reference_matches_sprint_88_fixture() {
        // Round-trip every sample from the shared fixture so any future
        // drift between the Rust serializer and the JSON contract is caught
        // by `cargo test`. The TS side does the inverse direction.
        const FIXTURE_RAW: &str =
            include_str!("../../../../tests/fixtures/fk_reference_samples.json");

        #[derive(serde::Deserialize)]
        struct Sample {
            schema: String,
            table: String,
            column: String,
            expected: String,
        }

        #[derive(serde::Deserialize)]
        struct Fixture {
            samples: Vec<Sample>,
        }

        let fixture: Fixture =
            serde_json::from_str(FIXTURE_RAW).expect("fixture must be valid JSON");
        assert!(
            fixture.samples.len() >= 3,
            "fixture must define at least 3 samples"
        );
        for sample in &fixture.samples {
            assert_eq!(
                format_fk_reference(&sample.schema, &sample.table, &sample.column),
                sample.expected,
                "format_fk_reference must round-trip sample {:?}",
                sample.expected
            );
        }
    }
}
