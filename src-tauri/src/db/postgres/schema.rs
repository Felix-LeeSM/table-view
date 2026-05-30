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
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, PostgresExtensionInfo, PostgresTypeInfo,
    SchemaInfo, TableInfo, TriggerInfo, ViewInfo,
};

use super::category::{map_pg_data_type, normalize_pg_type, restore_serial};
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

pub(crate) const LIST_EXTENSIONS_SQL: &str = "SELECT e.extname AS name,
       n.nspname AS schema,
       e.extversion AS version,
       obj_description(e.oid, 'pg_extension') AS comment
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
 ORDER BY e.extname";

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

// ── Sprint 272 — `pg_trigger.tgtype` bitmask decoder ───────────────────────

/// Sprint 272 — bit constants for `pg_trigger.tgtype`. Sourced from the
/// PostgreSQL source tree (`src/include/catalog/pg_trigger.h`); reproduced
/// here so the unit tests assert against an explicit byte-vs-meaning map.
pub(crate) const TRIGGER_TYPE_ROW: i16 = 0x01;
pub(crate) const TRIGGER_TYPE_BEFORE: i16 = 0x02;
pub(crate) const TRIGGER_TYPE_INSERT: i16 = 0x04;
pub(crate) const TRIGGER_TYPE_DELETE: i16 = 0x08;
pub(crate) const TRIGGER_TYPE_UPDATE: i16 = 0x10;
pub(crate) const TRIGGER_TYPE_TRUNCATE: i16 = 0x20;
pub(crate) const TRIGGER_TYPE_INSTEAD: i16 = 0x40;

/// Decoded view of one `pg_trigger.tgtype` int2 bitmask. `timing` and
/// `orientation` are static keywords; `events` carries the user-facing
/// subset of `["INSERT", "UPDATE", "DELETE"]` (TRUNCATE intentionally
/// stripped — see `PostgresAdapter::list_triggers` doc).
pub(crate) struct DecodedTgtype {
    pub timing: &'static str,
    pub orientation: &'static str,
    pub events: Vec<&'static str>,
}

/// Decode `pg_trigger.tgtype` into explicit timing / events / orientation
/// fields. INSTEAD OF takes precedence over BEFORE/AFTER (PG semantics:
/// `INSTEAD` triggers can only exist on views and are mutually exclusive
/// with timing flags, but defensively we check `INSTEAD` first regardless
/// of whether `BEFORE` is also set).
///
/// Event ordering is fixed (INSERT, UPDATE, DELETE) so the rendered SQL
/// preview is deterministic regardless of the bitmask's natural order.
pub(crate) fn decode_tgtype(tgtype: i16) -> DecodedTgtype {
    let timing = if (tgtype & TRIGGER_TYPE_INSTEAD) != 0 {
        "INSTEAD OF"
    } else if (tgtype & TRIGGER_TYPE_BEFORE) != 0 {
        "BEFORE"
    } else {
        "AFTER"
    };

    let orientation = if (tgtype & TRIGGER_TYPE_ROW) != 0 {
        "ROW"
    } else {
        "STATEMENT"
    };

    // Sprint 272 — TRUNCATE is dropped from the event list. The list is
    // built in fixed `INSERT, UPDATE, DELETE` order to keep the rendered
    // summary deterministic; the user-visible label `"BEFORE INSERT OR
    // UPDATE"` never depends on which bit happened to be set in PG's
    // internal order.
    let mut events: Vec<&'static str> = Vec::new();
    if (tgtype & TRIGGER_TYPE_INSERT) != 0 {
        events.push("INSERT");
    }
    if (tgtype & TRIGGER_TYPE_UPDATE) != 0 {
        events.push("UPDATE");
    }
    if (tgtype & TRIGGER_TYPE_DELETE) != 0 {
        events.push("DELETE");
    }
    // TRIGGER_TYPE_TRUNCATE (0x20) is intentionally NOT pushed — see
    // `PostgresAdapter::list_triggers` doc. Asserting the bit name here
    // keeps the constant referenced (otherwise dead_code) and documents
    // the deliberate omission.
    let _ = TRIGGER_TYPE_TRUNCATE;

    DecodedTgtype {
        timing,
        orientation,
        events,
    }
}

/// Sprint 272 — render `pg_trigger.tgargs` (PG stores it as a `bytea` of
/// null-delimited C strings, terminated by an empty string) into the
/// display form `'arg1', 'arg2'`. Returns `None` when the trigger function
/// takes no arguments (empty `tgargs` blob).
///
/// PG escapes embedded single quotes in `tgargs` as `''`; this helper
/// surfaces the raw decoded string verbatim so the rendered SQL matches
/// what `pg_get_triggerdef` would emit.
pub(crate) fn decode_tgargs(tgargs: &[u8]) -> Option<String> {
    if tgargs.is_empty() {
        return None;
    }
    // Split on null bytes, drop the trailing empty terminator if present.
    let parts: Vec<&[u8]> = tgargs.split(|b| *b == 0).collect();
    let mut rendered: Vec<String> = Vec::new();
    for part in parts {
        if part.is_empty() {
            continue;
        }
        // Lossy UTF-8: trigger arguments are user text and may carry
        // non-ASCII; lossy decode keeps the helper infallible.
        let s = String::from_utf8_lossy(part);
        rendered.push(format!("'{}'", s));
    }
    if rendered.is_empty() {
        None
    } else {
        Some(rendered.join(", "))
    }
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
        // Sprint 258 — `information_schema.columns.data_type` 는 generic
        // 명 ("character varying") 만 노출. `pg_catalog.format_type` 으로
        // 길이/정밀도/배열 표기 (`varchar(200)`, `numeric(10,2)`,
        // `text[]`) 까지 DDL-level 그대로 가져온다.
        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname, \
                    pg_catalog.format_type(a.atttypid, a.atttypmod), \
                    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
                    pg_get_expr(d.adbin, d.adrelid) \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_catalog.pg_attrdef d \
               ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE n.nspname = $1 AND c.relname = $2 \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
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
                // Sprint 258 — category 매핑은 raw format_type 결과 (parameter
                // 표기 포함) 에서 base 만 추출하므로 정규화 전후 무관. 사용자
                // 표시용 data_type 은 단축형으로 정규화.
                // Sprint 259 — nextval(...) default 패턴 검출 시 정수 → serial.
                let category = map_pg_data_type(&data_type);
                let data_type = normalize_pg_type(&data_type);
                let data_type = restore_serial(data_type, default_value.as_deref());
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

        // Sprint 258 — DDL-level type 노출용 `pg_catalog.format_type`
        // 사용 (information_schema.columns.data_type 는 generic 명만 노출).
        let col_rows: Vec<(String, String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT c.relname, a.attname, \
                    pg_catalog.format_type(a.atttypid, a.atttypmod), \
                    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
                    pg_get_expr(d.adbin, d.adrelid) \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_catalog.pg_attrdef d \
               ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE n.nspname = $1 AND c.relkind = 'r' \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY c.relname, a.attnum",
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
            let data_type = normalize_pg_type(&data_type);
            let data_type = restore_serial(data_type, default_value.as_deref());
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

    pub async fn list_extensions(&self) -> Result<Vec<PostgresExtensionInfo>, AppError> {
        let pool = self.active_pool().await?;

        let rows: Vec<(String, String, String, Option<String>)> =
            sqlx::query_as(LIST_EXTENSIONS_SQL)
                .fetch_all(&pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name, schema, version, comment)| PostgresExtensionInfo {
                name,
                schema,
                version,
                comment,
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

        // Sprint 258 — DDL-level type 노출용 format_type. view 도 동일 패턴.
        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT a.attname, \
                    pg_catalog.format_type(a.atttypid, a.atttypmod), \
                    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
                    pg_get_expr(d.adbin, d.adrelid) \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_catalog.pg_attrdef d \
               ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE n.nspname = $1 AND c.relname = $2 \
               AND c.relkind IN ('v', 'm') \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
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
                let data_type = normalize_pg_type(&data_type);
                let data_type = restore_serial(data_type, default_value.as_deref());
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

    /// Sprint 272 — list triggers attached to `(schema, table)`.
    ///
    /// Filters `tgisinternal = true` (PG-managed FK / RI / replication
    /// triggers) so only user-defined triggers surface. `tgtype` is the
    /// int2 bitmask decoded by [`decode_tgtype`] into the explicit
    /// timing / events / orientation fields on `TriggerInfo`.
    ///
    /// TRUNCATE event handling (master spec § 6, Generator's pick):
    /// - The decoder strips TRUNCATE from the `events` list so the UI
    ///   never offers an "edit a TRUNCATE trigger" affordance.
    /// - If TRUNCATE is the ONLY event (`events.is_empty()` after the
    ///   filter) the entire trigger row is dropped — surfacing a trigger
    ///   with no events would be a lie. Triggers that fire on
    ///   `INSERT OR TRUNCATE` keep the INSERT row and drop the TRUNCATE
    ///   event; the rendered SQL definition still carries the full
    ///   `pg_get_triggerdef` so the user can see the truth in source.
    ///
    /// SQL identifiers are bound as `$1` / `$2` — no string interpolation
    /// of user-supplied schema / table names.
    pub async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        // Row tuple shape returned by the pg_trigger query: (tgname,
        // tgtype, function_schema, function_name, tgargs, when_expression,
        // definition). Aliased to satisfy clippy::type_complexity.
        type TriggerRow = (String, i16, String, String, Vec<u8>, Option<String>, String);

        let pool = self.active_pool().await?;

        // `tgargs` is bytea (PG stores it null-delimited); cast to text
        // via `convert_from(..., 'UTF8')` preserves the bytes. The
        // application-layer decoder splits on `\0` and re-renders as
        // `'a', 'b'` for display.
        let rows: Vec<TriggerRow> = sqlx::query_as(
            "SELECT t.tgname, \
                    t.tgtype, \
                    fn.nspname AS function_schema, \
                    p.proname AS function_name, \
                    t.tgargs, \
                    pg_catalog.pg_get_expr(t.tgqual, t.tgrelid) AS when_expression, \
                    pg_catalog.pg_get_triggerdef(t.oid, true) AS definition \
             FROM pg_catalog.pg_trigger t \
             JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid \
             JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace \
             WHERE n.nspname = $1 \
               AND c.relname = $2 \
               AND NOT t.tgisinternal \
             ORDER BY t.tgname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        let mut out = Vec::with_capacity(rows.len());
        for (name, tgtype, function_schema, function_name, tgargs, when_expression, definition) in
            rows
        {
            let decoded = decode_tgtype(tgtype);
            // TRUNCATE-only filter — see method doc.
            if decoded.events.is_empty() {
                continue;
            }
            out.push(TriggerInfo {
                name,
                schema: schema.to_string(),
                table: table.to_string(),
                timing: decoded.timing.to_string(),
                events: decoded.events.into_iter().map(|s| s.to_string()).collect(),
                orientation: decoded.orientation.to_string(),
                function_schema,
                function_name,
                arguments: decode_tgargs(&tgargs),
                when_expression,
                definition,
            });
        }
        Ok(out)
    }

    /// Sprint 272 — `pg_get_triggerdef(t.oid)` for a single trigger.
    ///
    /// Identifiers bound parametrically. `relkind IN ('r', 'p', 'v', 'm')`
    /// is implicit via the join on the named (schema, table) — `pg_trigger`
    /// only references relations.
    pub async fn get_trigger_source(
        &self,
        schema: &str,
        table: &str,
        trigger_name: &str,
    ) -> Result<String, AppError> {
        let pool = self.active_pool().await?;

        let row: Option<(String,)> = sqlx::query_as(
            "SELECT pg_catalog.pg_get_triggerdef(t.oid, true) \
             FROM pg_catalog.pg_trigger t \
             JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 \
               AND c.relname = $2 \
               AND t.tgname = $3 \
               AND NOT t.tgisinternal",
        )
        .bind(schema)
        .bind(table)
        .bind(trigger_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        match row {
            Some((source,)) => Ok(source),
            None => Err(AppError::NotFound(format!(
                "Trigger {schema}.{table}.{trigger_name} not found"
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

    /// Sprint 335 (Slice M live wire) — `CREATE DATABASE "<name>"`.
    ///
    /// PG forbids CREATE/DROP DATABASE inside an explicit transaction
    /// block, so we send the statement through `sqlx::query` against the
    /// active pool — sqlx auto-commits a single statement that is not
    /// wrapped in a transaction. The active pool's database does not need
    /// to be `postgres`; PG only requires the connection to be outside a
    /// transaction (default for fresh pool connections).
    pub async fn create_database(&self, name: &str) -> Result<(), AppError> {
        use crate::db::postgres::mutations::{quote_identifier, validate_identifier};
        validate_identifier(name, "Database name")?;
        let pool = self.active_pool().await?;
        let sql = format!("CREATE DATABASE {}", quote_identifier(name.trim()));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(format!("CREATE DATABASE failed: {e}")))?;
        Ok(())
    }

    /// Sprint 336 (U1 live wire) — `pg_stat_activity` snapshot. Excludes
    /// the current backend so the user does not see their own session
    /// in the activity grid. `state`, `wait_event`, `query` are nullable
    /// in PG → surfaced as `Option<String>` verbatim. `query_start` is
    /// converted to ISO-8601 text on the server (`to_char`) so we do not
    /// take a direct `chrono` dependency.
    #[allow(clippy::type_complexity)]
    pub async fn list_server_activity(
        &self,
    ) -> Result<Vec<crate::models::ServerActivityRow>, AppError> {
        type Row = (
            Option<i32>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let pool = self.active_pool().await?;
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT pid, datname, usename, state, wait_event, query, \
                    to_char(query_start AT TIME ZONE 'UTC', \
                            'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS query_start_text \
             FROM pg_stat_activity \
             WHERE pid IS DISTINCT FROM pg_backend_pid() \
             ORDER BY query_start DESC NULLS LAST",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(format!("pg_stat_activity failed: {e}")))?;

        Ok(rows
            .into_iter()
            .map(|(pid, db, user, state, wait_event, query, started_at)| {
                crate::models::ServerActivityRow {
                    id: pid.unwrap_or(0) as i64,
                    db,
                    user,
                    state,
                    query,
                    wait_event,
                    started_at,
                }
            })
            .collect())
    }

    /// Sprint 336 (U1 live wire) — `pg_terminate_backend(pid)`. Returns
    /// `Ok(())` unconditionally on driver success — PG returns a boolean
    /// indicating whether the backend was alive, but per the spec
    /// "missing PID" is a successful no-op rather than an error.
    pub async fn kill_session(&self, id: i64) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT pg_terminate_backend($1)")
            .bind(id as i32)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(format!("pg_terminate_backend failed: {e}")))?;
        Ok(())
    }

    /// Sprint 335 (Slice M live wire) — `DROP DATABASE "<name>"`.
    ///
    /// Same auto-commit assumption as `create_database`. PG further
    /// requires no active sessions on the target database; the user is
    /// responsible for evicting connectors first (the error surfaces
    /// verbatim if any session is still attached).
    pub async fn drop_database(&self, name: &str) -> Result<(), AppError> {
        use crate::db::postgres::mutations::{quote_identifier, validate_identifier};
        validate_identifier(name, "Database name")?;
        let pool = self.active_pool().await?;
        let sql = format!("DROP DATABASE {}", quote_identifier(name.trim()));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(format!("DROP DATABASE failed: {e}")))?;
        Ok(())
    }

    /// Sprint 337 (U2 live wire) — `EXPLAIN (FORMAT JSON) <sql>`.
    ///
    /// `FORMAT JSON` 은 PG 가 plan tree 를 single-row, single-column
    /// `JSON` 결과로 직렬화하게 한다. result row 가 정확히 1개 / column 도
    /// 정확히 1개여야 하며, 그 안에 `Vec<Plan>` 형태의 JSON array 가
    /// 들어있다. `ANALYZE` 는 의도적으로 쓰지 않는다 — Explain UI 는
    /// plan inspection 이지 profiler / activity path 가 아니다.
    pub async fn explain_query(&self, sql: &str) -> Result<serde_json::Value, AppError> {
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL must not be empty".into()));
        }
        let pool = self.active_pool().await?;
        let wrapped = format!("EXPLAIN (FORMAT JSON) {trimmed}");
        let row: (serde_json::Value,) = sqlx::query_as(&wrapped)
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {e}")))?;
        Ok(row.0)
    }

    /// Sprint 340 (U5 live wire) — top-N slow queries from the
    /// `pg_stat_statements` extension. The extension is OPTIONAL — when
    /// it has not been created, sqlx surfaces a `relation
    /// "pg_stat_statements" does not exist` error which we wrap with a
    /// clearer hint so the panel UI can guide the user toward `CREATE
    /// EXTENSION pg_stat_statements`.
    pub async fn slow_queries(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::models::SlowQueryRow>, AppError> {
        let pool = self.active_pool().await?;

        #[allow(clippy::type_complexity)]
        type Row = (
            Option<String>,
            Option<i64>,
            Option<f64>,
            Option<f64>,
            Option<i64>,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT query, calls, total_exec_time, mean_exec_time, rows \
             FROM pg_stat_statements \
             ORDER BY mean_exec_time DESC NULLS LAST \
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("pg_stat_statements") && msg.contains("does not exist") {
                AppError::Database(
                    "pg_stat_statements extension not enabled. Run \
                     `CREATE EXTENSION pg_stat_statements;` as a superuser \
                     and add the library to shared_preload_libraries."
                        .into(),
                )
            } else {
                AppError::Database(format!("pg_stat_statements failed: {msg}"))
            }
        })?;

        Ok(rows
            .into_iter()
            .map(|(q, calls, total, mean, n)| crate::models::SlowQueryRow {
                query: q.unwrap_or_default(),
                calls: calls.unwrap_or(0),
                total_exec_time_ms: total.unwrap_or(0.0),
                mean_exec_time_ms: mean.unwrap_or(0.0),
                rows: n.unwrap_or(0),
                extras: std::collections::HashMap::new(),
            })
            .collect())
    }

    /// Sprint 339 (U4 live wire) — server identity (`version()` +
    /// host) + tuning flags from `pg_settings`. `extras` carries the
    /// full pg_settings whitelist row-by-row so the UI can render a
    /// raw subsection without hardcoding setting names.
    pub async fn server_info(&self) -> Result<crate::models::ServerInfoRow, AppError> {
        let pool = self.active_pool().await?;

        let version: String = sqlx::query_scalar("SELECT version()")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("version() failed: {e}")))?;
        let host: Option<String> = sqlx::query_scalar("SELECT inet_server_addr()::text")
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("inet_server_addr failed: {e}")))?;
        let uptime: Option<f64> = sqlx::query_scalar(
            "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::float8",
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Database(format!("uptime failed: {e}")))?;
        let active: Option<i64> = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE state IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Database(format!("pg_stat_activity count failed: {e}")))?;

        let settings: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT name, setting, category FROM pg_settings \
             WHERE name IN ('server_version', 'shared_buffers', 'work_mem', \
                            'max_connections', 'effective_cache_size', 'timezone') \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(format!("pg_settings failed: {e}")))?;

        let mut extras: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::new();
        for (name, setting, category) in settings {
            extras.insert(
                name,
                serde_json::json!({
                    "setting": setting,
                    "category": category,
                }),
            );
        }

        Ok(crate::models::ServerInfoRow {
            version,
            host,
            uptime_sec: uptime.map(|f| f as i64),
            connections_active: active,
            extras,
        })
    }

    /// Sprint 338 (U3 live wire) — table stats from
    /// `pg_stat_user_tables` + `pg_total_relation_size`. Identifiers
    /// are validated by the shared `validate_identifier` helper before
    /// SQL emission. Returns row count from `n_live_tup` (approximate;
    /// for an exact count the caller would need `SELECT COUNT(*)` which
    /// is intentionally avoided — `pg_stat_user_tables` is meant as
    /// per-relation telemetry, not a precise tally).
    pub async fn collection_stats(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<crate::models::CollectionStatsRow, AppError> {
        use crate::db::postgres::mutations::validate_identifier;
        validate_identifier(schema, "Schema name")?;
        validate_identifier(table, "Table name")?;

        let pool = self.active_pool().await?;

        #[allow(clippy::type_complexity)]
        type Row = (
            Option<i64>,    // n_live_tup
            Option<i64>,    // n_dead_tup
            Option<i64>,    // seq_scan
            Option<i64>,    // idx_scan
            Option<String>, // last_vacuum (text)
            Option<String>, // last_analyze (text)
        );
        let stat: Row = sqlx::query_as(
            "SELECT n_live_tup, n_dead_tup, seq_scan, idx_scan, \
                    to_char(last_vacuum AT TIME ZONE 'UTC', \
                            'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), \
                    to_char(last_analyze AT TIME ZONE 'UTC', \
                            'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \
             FROM pg_stat_user_tables \
             WHERE schemaname = $1 AND relname = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Database(format!("pg_stat_user_tables failed: {e}")))?
        .unwrap_or((None, None, None, None, None, None));

        // Size + index count come from pg_catalog (not pg_stat_user_tables).
        let qualified = format!("\"{schema}\".\"{table}\"");
        let size: i64 = sqlx::query_scalar("SELECT pg_total_relation_size($1)::bigint")
            .bind(&qualified)
            .fetch_one(&pool)
            .await
            .map_err(|e| AppError::Database(format!("pg_total_relation_size failed: {e}")))?;
        let indexes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM pg_indexes \
             WHERE schemaname = $1 AND tablename = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_one(&pool)
        .await
        .map_err(|e| AppError::Database(format!("pg_indexes count failed: {e}")))?;

        Ok(crate::models::CollectionStatsRow {
            rows: stat.0.unwrap_or(0),
            size_bytes: size,
            indexes,
            last_vacuum: stat.4,
            last_analyze: stat.5,
            seq_scans: stat.2,
            idx_scans: stat.3,
            n_dead: stat.1,
            extras: std::collections::HashMap::new(),
        })
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

    #[tokio::test]
    async fn create_database_rejects_empty_name() {
        let adapter = PostgresAdapter::new();
        match adapter.create_database("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_database_rejects_invalid_identifier() {
        let adapter = PostgresAdapter::new();
        match adapter.create_database("1bad-name").await {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn create_database_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.create_database("analytics").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_database_rejects_empty_name() {
        let adapter = PostgresAdapter::new();
        match adapter.drop_database("   ").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Database name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn drop_database_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.drop_database("analytics").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn list_server_activity_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.list_server_activity().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn kill_session_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.kill_session(123).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 337 (U2 live wire) — explain_query unit cases.
    #[tokio::test]
    async fn explain_query_rejects_empty_sql() {
        let adapter = PostgresAdapter::new();
        match adapter.explain_query("").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("must not be empty"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_rejects_whitespace_sql() {
        let adapter = PostgresAdapter::new();
        match adapter.explain_query("   \n\t").await {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn explain_query_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.explain_query("SELECT 1").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 338 (U3 live wire) — collection_stats unit cases.
    #[tokio::test]
    async fn collection_stats_rejects_empty_schema() {
        let adapter = PostgresAdapter::new();
        match adapter.collection_stats("", "users").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Schema name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn collection_stats_rejects_empty_table() {
        let adapter = PostgresAdapter::new();
        match adapter.collection_stats("public", "").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Table name"), "unexpected: {msg}");
            }
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn collection_stats_rejects_invalid_identifier() {
        let adapter = PostgresAdapter::new();
        match adapter.collection_stats("public", "users; DROP").await {
            Err(AppError::Validation(_)) => {}
            other => panic!("expected Validation, got ok? {}", other.is_ok()),
        }
    }

    #[tokio::test]
    async fn collection_stats_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.collection_stats("public", "users").await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 339 (U4 live wire) — server_info: takes no parameters so
    // only the no-connection path is reachable from unit tests; real
    // version()/pg_settings shape is covered by integration tests.
    #[tokio::test]
    async fn server_info_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.server_info().await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
    }

    // Sprint 340 (U5 live wire) — slow_queries: takes only `limit` so
    // only the no-connection path is unit-testable. The real
    // pg_stat_statements shape + missing-extension error wrapping is
    // covered by integration tests.
    #[tokio::test]
    async fn slow_queries_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        match adapter.slow_queries(10).await {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Not connected"), "unexpected: {msg}");
            }
            other => panic!("expected Connection, got ok? {}", other.is_ok()),
        }
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

    #[test]
    fn list_extensions_sql_matches_canonical_fixture() {
        const EXPECTED: &str = "SELECT e.extname AS name,
       n.nspname AS schema,
       e.extversion AS version,
       obj_description(e.oid, 'pg_extension') AS comment
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
 ORDER BY e.extname";
        assert_eq!(LIST_EXTENSIONS_SQL, EXPECTED);
        assert!(LIST_EXTENSIONS_SQL.contains("pg_catalog.pg_extension e"));
        assert!(LIST_EXTENSIONS_SQL.contains("pg_catalog.pg_namespace n"));
        assert!(LIST_EXTENSIONS_SQL.contains("obj_description(e.oid, 'pg_extension')"));
        assert!(LIST_EXTENSIONS_SQL.contains("ORDER BY e.extname"));
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

    #[tokio::test]
    async fn list_extensions_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.list_extensions().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    // ── Sprint 272 — `pg_trigger.tgtype` bitmask decoder unit tests ────
    //
    // 작성 이유 (2026-05-13): decode_tgtype 가 PG 의 int2 bitmask 를
    // 정확히 timing / orientation / events 로 풀어내야 SchemaTree /
    // StructurePanel 양쪽이 거짓말 없이 사용자에게 표시. 4 representative
    // bitmask 값으로 INSTEAD-OF/BEFORE/AFTER × ROW/STATEMENT × INSERT/
    // UPDATE/DELETE/TRUNCATE 조합을 cover. 추가로 TRUNCATE-only/multi-
    // event 경계 케이스 둘과 tgargs 디코더의 happy + empty 케이스.

    #[test]
    fn decode_tgtype_row_before_insert() {
        // 0x07 = ROW (0x01) | BEFORE (0x02) | INSERT (0x04)
        let d = decode_tgtype(0x07);
        assert_eq!(d.timing, "BEFORE");
        assert_eq!(d.orientation, "ROW");
        assert_eq!(d.events, vec!["INSERT"]);
    }

    #[test]
    fn decode_tgtype_statement_after_delete() {
        // 0x08 = DELETE (0x08); no BEFORE → AFTER; no ROW → STATEMENT
        let d = decode_tgtype(0x08);
        assert_eq!(d.timing, "AFTER");
        assert_eq!(d.orientation, "STATEMENT");
        assert_eq!(d.events, vec!["DELETE"]);
    }

    #[test]
    fn decode_tgtype_row_instead_of_insert_on_view() {
        // 0x45 = ROW (0x01) | INSERT (0x04) | INSTEAD (0x40); INSTEAD
        // takes precedence over BEFORE/AFTER. (INSTEAD OF triggers must
        // be ROW per PG, so the orientation bit is set as well.)
        let d = decode_tgtype(0x45);
        assert_eq!(d.timing, "INSTEAD OF");
        assert_eq!(d.orientation, "ROW");
        assert_eq!(d.events, vec!["INSERT"]);
    }

    #[test]
    fn decode_tgtype_row_after_insert_or_update() {
        // 0x15 = ROW (0x01) | INSERT (0x04) | UPDATE (0x10); no BEFORE
        // → AFTER. Multi-event renders as fixed ["INSERT", "UPDATE"]
        // order regardless of bit order in the mask.
        let d = decode_tgtype(0x15);
        assert_eq!(d.timing, "AFTER");
        assert_eq!(d.orientation, "ROW");
        assert_eq!(d.events, vec!["INSERT", "UPDATE"]);
    }

    #[test]
    fn decode_tgtype_truncate_only_yields_empty_events() {
        // 0x21 = ROW (0x01) | TRUNCATE (0x20); the decoder filters
        // TRUNCATE out → empty events list. The caller
        // (`list_triggers`) then drops the trigger entirely.
        let d = decode_tgtype(0x21);
        assert!(
            d.events.is_empty(),
            "TRUNCATE-only mask must produce no events, got: {:?}",
            d.events
        );
        // timing / orientation are still decoded so the caller's
        // diagnostic message can stay accurate if it ever wants to
        // surface a "TRUNCATE-only trigger skipped" log.
        assert_eq!(d.timing, "AFTER");
        assert_eq!(d.orientation, "ROW");
    }

    #[test]
    fn decode_tgtype_insert_or_truncate_drops_truncate_keeps_insert() {
        // 0x25 = ROW (0x01) | INSERT (0x04) | TRUNCATE (0x20); decoder
        // keeps INSERT and silently drops TRUNCATE. The trigger row
        // survives because at least one user-visible event remains.
        let d = decode_tgtype(0x25);
        assert_eq!(d.timing, "AFTER");
        assert_eq!(d.orientation, "ROW");
        assert_eq!(d.events, vec!["INSERT"]);
    }

    #[test]
    fn decode_tgargs_empty_blob_returns_none() {
        assert_eq!(decode_tgargs(&[]), None);
    }

    #[test]
    fn decode_tgargs_single_argument_rendered_quoted() {
        // PG stores `tgargs` as null-delimited C strings ending in an
        // empty terminator. `\0users\0` is the canonical single-arg form.
        let blob = b"users\0";
        assert_eq!(decode_tgargs(blob), Some("'users'".to_string()));
    }

    #[test]
    fn decode_tgargs_multiple_arguments_rendered_comma_separated() {
        let blob = b"users\0DELETE\0";
        assert_eq!(decode_tgargs(blob), Some("'users', 'DELETE'".to_string()));
    }

    // 작성 이유 (2026-05-13, Sprint 272 attempt 2): Evaluator P2a —
    // `decode_tgargs` already documents "PG escapes embedded single
    // quotes in `tgargs` as `''`" but had no test pinning that we
    // surface the raw decoded bytes verbatim (no extra escaping). PG
    // doesn't actually double-encode tgargs (the doubling lives in
    // `pg_get_triggerdef` SQL rendering, not the wire bytes), so the
    // decoded form here is the raw apostrophe — our renderer wraps the
    // whole arg in `'…'` quotes and would emit an invalid SQL literal
    // if surfaced to user-facing DDL. Sprint 273's CREATE TRIGGER
    // emitter is the one that needs to re-escape; this helper's job is
    // only the byte-faithful display form that mirrors `pg_get_triggerdef`'s
    // already-rendered output. Pinning the embedded-quote case keeps
    // future helpers from accidentally double-escaping on read.
    #[test]
    fn decode_tgargs_embedded_single_quote_passes_through_verbatim() {
        // C-string with an embedded `'` (PG stores tgargs as null-
        // delimited raw bytes, no SQL-level escaping at this layer).
        let blob: &[u8] = b"O'Brien\0";
        assert_eq!(decode_tgargs(blob), Some("'O'Brien'".to_string()));
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
