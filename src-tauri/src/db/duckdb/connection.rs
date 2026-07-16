//! DuckDB file lifecycle and catalog reads.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use duckdb::{params, AccessMode, Config, Connection, InterruptHandle};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnInfo, ConnectionConfig, ConstraintInfo, FileAnalyticsSource,
    FileAnalyticsSourceKind, IndexInfo, TableInfo, ViewInfo,
};

use super::sql_text::quote_identifier;
use super::NamespaceInfo;

pub(super) const DUCKDB_DEFAULT_SCHEMA: &str = "main";

/// Schemas a DuckDB connection exposes to the sidebar. `information_schema.schemata`
/// spans every attached catalog, so the internal `system` and `temp` catalogs each
/// contribute their own `main` schema (empty → renders as a duplicate "No Tables"
/// sibling in the flat tree). Blacklist the internal catalogs and the two catalog
/// schemas so only the user database's schemas (`main` + user `CREATE SCHEMA`) show.
// ponytail: filename edge — a user db file literally named `system`/`temp` would be
// hidden. Swap `catalog_name NOT IN (...)` for `catalog_name = current_database()`
// if that ever matters.
pub(super) const LIST_NAMESPACES_SQL: &str = "\
SELECT schema_name
FROM information_schema.schemata
WHERE catalog_name NOT IN ('system', 'temp')
  AND schema_name NOT IN ('information_schema', 'pg_catalog')
ORDER BY schema_name";

#[derive(Clone, Debug)]
pub(super) struct DuckdbConnectionSettings {
    pub path: String,
    pub read_only: bool,
}

#[derive(Default)]
struct DuckdbState {
    settings: Option<DuckdbConnectionSettings>,
    file_sources: HashMap<String, RegisteredFileAnalyticsSource>,
    next_file_source_id: u64,
}

#[derive(Clone)]
pub struct DuckdbAdapter {
    inner: Arc<Mutex<DuckdbState>>,
}

#[derive(Clone, Debug)]
pub(super) struct RegisteredFileAnalyticsSource {
    pub path: String,
    pub public: FileAnalyticsSource,
}

impl Default for DuckdbAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DuckdbAdapter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(DuckdbState::default())),
        }
    }

    pub(crate) fn validate_user_database_path(path: &str) -> Result<&str, AppError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(AppError::Validation(
                "DuckDB database file is required".into(),
            ));
        }

        let path_ref = Path::new(path);
        if !path_ref.is_absolute() {
            return Err(AppError::Validation(
                "DuckDB database file path must be absolute".into(),
            ));
        }
        if !path_ref.exists() {
            return Err(AppError::Validation(
                "DuckDB database file does not exist".into(),
            ));
        }
        if !path_ref.is_file() {
            return Err(AppError::Validation(
                "DuckDB database path is not a file".into(),
            ));
        }
        let is_duckdb_file = path_ref
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("duckdb"));
        if !is_duckdb_file {
            return Err(AppError::Validation(
                "DuckDB database file must use the .duckdb extension".into(),
            ));
        }

        // P3-1 (#1455) — same confinement the SQLite connect path and DuckDB
        // file-analytics source already enforce: a user database file must not
        // resolve into the app's own data directory, so a crafted
        // `<data_dir>/state.duckdb` can't be opened to read/overwrite internal
        // state (`.key`, `connections.json`, `state.db`). Same risk = same
        // guard.
        crate::storage::local::reject_internal_app_data_path(path_ref)?;

        Ok(path)
    }

    fn settings_from_config(
        config: &ConnectionConfig,
    ) -> Result<DuckdbConnectionSettings, AppError> {
        Ok(DuckdbConnectionSettings {
            path: Self::validate_user_database_path(&config.database)?.to_string(),
            read_only: config.read_only,
        })
    }

    pub async fn connect_file(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let settings = Self::settings_from_config(config)?;
        let test_settings = settings.clone();
        run_blocking(move || {
            let conn = open_connection(&test_settings)?;
            conn.execute("SELECT 1", [])
                .map_err(|e| AppError::Connection(e.to_string()))?;
            Ok(())
        })
        .await?;

        let mut guard = self.inner.lock().await;
        guard.settings = Some(settings);
        guard.file_sources.clear();
        guard.next_file_source_id = 0;
        Ok(())
    }

    pub async fn disconnect_file(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        guard.settings = None;
        guard.file_sources.clear();
        guard.next_file_source_id = 0;
        Ok(())
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        self.with_connection(|conn| {
            conn.execute("SELECT 1", [])
                .map_err(|e| AppError::Connection(e.to_string()))?;
            Ok(())
        })
        .await
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let settings = Self::settings_from_config(config)?;
        run_blocking(move || {
            let conn = open_connection(&settings)?;
            conn.execute("SELECT 1", [])
                .map_err(|e| AppError::Connection(e.to_string()))?;
            Ok(())
        })
        .await
    }

    pub async fn require_connected(&self) -> Result<(), AppError> {
        self.active_settings().await.map(|_| ())
    }

    pub async fn current_database_path(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard
            .settings
            .as_ref()
            .map(|settings| settings.path.clone())
    }

    pub(super) async fn active_settings(&self) -> Result<DuckdbConnectionSettings, AppError> {
        let guard = self.inner.lock().await;
        guard
            .settings
            .clone()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    pub(super) async fn store_file_analytics_source(
        &self,
        path: String,
        file_name: String,
        kind: FileAnalyticsSourceKind,
        size_bytes: u64,
    ) -> Result<FileAnalyticsSource, AppError> {
        let mut guard = self.inner.lock().await;
        guard
            .settings
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        guard.next_file_source_id = guard
            .next_file_source_id
            .checked_add(1)
            .ok_or_else(|| AppError::Database("DuckDB file analytics source id overflow".into()))?;
        let sequence = guard.next_file_source_id;
        let source = FileAnalyticsSource {
            id: format!("duckdb-file-{sequence}"),
            alias: format!("file_{sequence:08x}"),
            file_name,
            kind,
            size_bytes,
        };
        guard.file_sources.insert(
            source.id.clone(),
            RegisteredFileAnalyticsSource {
                path,
                public: source.clone(),
            },
        );
        Ok(source)
    }

    pub(super) async fn get_file_analytics_source(
        &self,
        source_id: &str,
    ) -> Result<RegisteredFileAnalyticsSource, AppError> {
        let source_id = source_id.trim();
        if source_id.is_empty() {
            return Err(AppError::Validation(
                "File source ID cannot be empty".into(),
            ));
        }
        let guard = self.inner.lock().await;
        guard
            .file_sources
            .get(source_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("File source '{source_id}' not found")))
    }

    pub(super) async fn list_registered_file_analytics_sources(
        &self,
    ) -> Result<Vec<RegisteredFileAnalyticsSource>, AppError> {
        let guard = self.inner.lock().await;
        guard
            .settings
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        let mut sources = guard.file_sources.values().cloned().collect::<Vec<_>>();
        sources.sort_by(|left, right| left.public.id.cmp(&right.public.id));
        Ok(sources)
    }

    pub(super) async fn clear_registered_file_analytics_sources(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        guard
            .settings
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        guard.file_sources.clear();
        guard.next_file_source_id = 0;
        Ok(())
    }

    pub(super) async fn with_connection<T, F>(&self, work: F) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
    {
        let settings = self.active_settings().await?;
        run_blocking(move || {
            let conn = open_connection(&settings)?;
            work(&conn)
        })
        .await
    }

    /// Issue #1269 (gap #5) — run `work` on a fresh connection, interrupting the
    /// in-flight statement when `cancel_token` fires. DuckDB is in-process, so
    /// `execute_query` blocks a worker thread; without this the cooperative
    /// token only pre-checks and a long scan runs to completion (the SQL-tab
    /// Cancel button was inert). `Connection::interrupt_handle` returns a
    /// `Send + Sync` handle whose `interrupt()` raises INTERRUPT on the
    /// statement running on that exact connection — the DuckDB analogue of the
    /// SQLite progress-handler interrupt (PR #1514). The handle is handed to a
    /// watcher the moment the connection opens; `interrupt()` after the
    /// connection drops is a documented noop (the handle nulls its pointer under
    /// its own mutex on close), so the non-cancel path just aborts the watcher
    /// once the work returns. A per-call token pins to this call's connection,
    /// so a stale token can never abort a later query.
    pub(super) async fn with_connection_cancellable<T, F>(
        &self,
        cancel_token: Option<&CancellationToken>,
        work: F,
    ) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
    {
        let Some(token) = cancel_token else {
            return self.with_connection(work).await;
        };
        let settings = self.active_settings().await?;
        let token = token.clone();
        let (handle_tx, handle_rx) = tokio::sync::oneshot::channel::<Arc<InterruptHandle>>();

        let join = tokio::task::spawn_blocking(move || {
            let conn = open_connection(&settings)?;
            // Hand the interrupt handle to the watcher before the blocking run.
            // A dropped receiver (watcher already gone) just means uninterruptible.
            let _ = handle_tx.send(conn.interrupt_handle());
            work(&conn)
        });

        let watcher = tokio::spawn(async move {
            if let Ok(handle) = handle_rx.await {
                token.cancelled().await;
                handle.interrupt();
            }
        });

        let result = join
            .await
            .map_err(|e| AppError::Database(format!("DuckDB worker failed: {e}")))?;
        watcher.abort();
        result
    }

    pub async fn list_namespaces(&self) -> Result<Vec<NamespaceInfo>, AppError> {
        self.with_connection(|conn| {
            let mut stmt = conn
                .prepare(LIST_NAMESPACES_SQL)
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| AppError::Database(e.to_string()))?;
            collect_duckdb_rows(rows).map(|names| {
                names
                    .into_iter()
                    .map(|name| NamespaceInfo { name })
                    .collect()
            })
        })
        .await
    }

    pub async fn list_tables(&self, namespace: &str) -> Result<Vec<TableInfo>, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        self.with_connection(move |conn| {
            let names = table_names(conn, &namespace, "BASE TABLE")?;
            let mut tables = Vec::with_capacity(names.len());
            for name in names {
                let count_sql = format!(
                    "SELECT COUNT(*) FROM {}",
                    quote_qualified_identifier(&namespace, &name)
                );
                let row_count: i64 = conn
                    .query_row(&count_sql, [], |row| row.get(0))
                    .map_err(|e| AppError::Database(e.to_string()))?;
                tables.push(TableInfo {
                    name,
                    schema: namespace.clone(),
                    row_count: Some(row_count),
                });
            }
            Ok(tables)
        })
        .await
    }

    pub async fn get_table_columns(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        let table = table.to_string();
        self.with_connection(move |conn| get_columns_uncancelled(conn, &namespace, &table))
            .await
    }

    pub async fn list_views(&self, namespace: &str) -> Result<Vec<ViewInfo>, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        self.with_connection(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT table_name, view_definition
                     FROM information_schema.views
                     WHERE table_schema = ?
                     ORDER BY table_name",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map(params![namespace.as_str()], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            collect_duckdb_rows(rows).map(|views| {
                views
                    .into_iter()
                    .map(|(name, definition)| ViewInfo {
                        name,
                        schema: namespace.clone(),
                        definition,
                    })
                    .collect()
            })
        })
        .await
    }

    /// Issue #1070 — real index introspection (was a silent `Ok(vec![])` stub
    /// that mislabelled every DuckDB table as index-free). DuckDB lists only
    /// explicit `CREATE INDEX` objects here; PK/UNIQUE constraints surface via
    /// `get_table_constraints`. `expressions` is the indexed column/expression
    /// list, joined on the unit separator (never present in identifiers) so it
    /// round-trips to `Vec<String>` without a list `FromSql` impl.
    pub async fn get_table_indexes(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        let table = table.to_string();
        self.with_connection(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT index_name, is_unique, is_primary,
                            array_to_string(expressions, chr(31))
                     FROM duckdb_indexes()
                     WHERE schema_name = ? AND table_name = ?
                     ORDER BY index_name",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map(params![namespace, table], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, bool>(1)?,
                        row.get::<_, bool>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            collect_duckdb_rows(rows).map(|rows| {
                rows.into_iter()
                    .map(|(name, is_unique, is_primary, cols)| IndexInfo {
                        name,
                        columns: split_duckdb_list(cols.as_deref()),
                        // ART is DuckDB's only index type.
                        index_type: "ART".to_string(),
                        is_unique,
                        is_primary,
                    })
                    .collect()
            })
        })
        .await
    }

    /// Issue #1070 — real constraint introspection (was a silent `Ok(vec![])`
    /// stub). NOT NULL is a column property, not surfaced as a constraint row
    /// (mirrors the pg/sqlite shape); the type strings match pg's
    /// `information_schema` so the wire contract is identical. FK reference
    /// table/columns come straight from the catalog.
    pub async fn get_table_constraints(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        let table = table.to_string();
        self.with_connection(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT constraint_name, constraint_type,
                            array_to_string(constraint_column_names, chr(31)),
                            referenced_table,
                            array_to_string(referenced_column_names, chr(31))
                     FROM duckdb_constraints()
                     WHERE schema_name = ? AND table_name = ?
                       AND constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
                     ORDER BY constraint_type, constraint_name",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map(params![namespace, table], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            collect_duckdb_rows(rows).map(|rows| {
                rows.into_iter()
                    .map(|(name, constraint_type, cols, ref_table, ref_cols)| {
                        let reference_columns = split_duckdb_list(ref_cols.as_deref());
                        ConstraintInfo {
                            // DuckDB auto-names constraints; fall back to the
                            // type label if a row ever lacks one.
                            name: name.unwrap_or_else(|| constraint_type.clone()),
                            constraint_type,
                            columns: split_duckdb_list(cols.as_deref()),
                            reference_table: ref_table,
                            reference_columns: (!reference_columns.is_empty())
                                .then_some(reference_columns),
                        }
                    })
                    .collect()
            })
        })
        .await
    }

    pub async fn get_view_definition(
        &self,
        namespace: &str,
        view: &str,
    ) -> Result<String, AppError> {
        let namespace = normalize_namespace(namespace).to_string();
        let view = view.to_string();
        self.with_connection(move |conn| {
            let result = conn.query_row(
                "SELECT view_definition
                 FROM information_schema.views
                 WHERE table_schema = ? AND table_name = ?",
                params![namespace.as_str(), view.as_str()],
                |row| row.get::<_, Option<String>>(0),
            );
            match result {
                Ok(Some(definition)) => Ok(definition),
                Ok(None) => Ok(String::new()),
                Err(duckdb::Error::QueryReturnedNoRows) => Err(AppError::Connection(format!(
                    "View {namespace}.{view} not found"
                ))),
                Err(error) => Err(AppError::Database(error.to_string())),
            }
        })
        .await
    }

    pub async fn list_schema_columns(
        &self,
        namespace: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let tables = self.list_tables(namespace).await?;
        let mut result = HashMap::with_capacity(tables.len());
        for table in tables {
            let columns = self.get_table_columns(namespace, &table.name).await?;
            result.insert(table.name, columns);
        }
        Ok(result)
    }
}

pub(super) fn normalize_namespace(namespace: &str) -> &str {
    let trimmed = namespace.trim();
    if trimmed.is_empty() {
        DUCKDB_DEFAULT_SCHEMA
    } else {
        trimmed
    }
}

pub(super) fn quote_qualified_identifier(namespace: &str, name: &str) -> String {
    format!(
        "{}.{}",
        quote_identifier(normalize_namespace(namespace)),
        quote_identifier(name)
    )
}

pub(super) fn duckdb_column_category(data_type: &str) -> ColumnCategory {
    let normalized = data_type.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return ColumnCategory::Unknown;
    }

    if normalized.contains("tinyint")
        || normalized.contains("smallint")
        || normalized.contains("integer")
        || normalized.contains("bigint")
        || normalized.contains("hugeint")
        || normalized == "int"
        || normalized == "int4"
        || normalized == "int8"
        || normalized == "ubigint"
        || normalized == "uinteger"
        || normalized == "usmallint"
        || normalized == "utinyint"
    {
        ColumnCategory::Int
    } else if normalized.contains("double")
        || normalized.contains("float")
        || normalized.contains("real")
        || normalized.contains("decimal")
        || normalized.contains("numeric")
    {
        ColumnCategory::Float
    } else if normalized.contains("bool") {
        ColumnCategory::Bool
    } else if normalized.contains("date")
        || normalized.contains("time")
        || normalized.contains("timestamp")
        || normalized.contains("interval")
    {
        ColumnCategory::Datetime
    } else if normalized.contains("blob") || normalized.contains("binary") {
        ColumnCategory::Binary
    } else if normalized.contains("uuid") {
        ColumnCategory::Uuid
    } else if normalized.contains("json")
        || normalized.contains("struct")
        || normalized.contains("list")
        || normalized.contains("map")
        || normalized.ends_with("[]")
    {
        ColumnCategory::Object
    } else if normalized.contains("enum") {
        ColumnCategory::Enum
    } else if normalized.contains("char")
        || normalized.contains("text")
        || normalized.contains("varchar")
        || normalized.contains("string")
    {
        ColumnCategory::Text
    } else {
        ColumnCategory::Unknown
    }
}

pub(super) async fn run_blocking<T, F>(work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Database(format!("DuckDB worker failed: {e}")))?
}

fn open_connection(settings: &DuckdbConnectionSettings) -> Result<Connection, AppError> {
    open_connection_with_external_access(settings, false)
}

pub(super) fn open_file_analytics_connection() -> Result<Connection, AppError> {
    let config = Config::default()
        .enable_external_access(true)
        .and_then(|config| config.enable_autoload_extension(false))
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Connection::open_in_memory_with_flags(config).map_err(|e| AppError::Connection(e.to_string()))
}

fn open_connection_with_external_access(
    settings: &DuckdbConnectionSettings,
    external_access: bool,
) -> Result<Connection, AppError> {
    let access_mode = if settings.read_only {
        AccessMode::ReadOnly
    } else {
        AccessMode::ReadWrite
    };
    let config = Config::default()
        .access_mode(access_mode)
        .and_then(|config| config.enable_external_access(external_access))
        .and_then(|config| config.enable_autoload_extension(false))
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Connection::open_with_flags(&settings.path, config)
        .map_err(|e| AppError::Connection(redact_duckdb_path(&e.to_string(), &settings.path)))
}

fn redact_duckdb_path(message: &str, path: &str) -> String {
    message.replace(path, "<local-file>")
}

fn table_names(
    conn: &Connection,
    namespace: &str,
    table_type: &str,
) -> Result<Vec<String>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = ? AND table_type = ?
             ORDER BY table_name",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map(params![namespace, table_type], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    collect_duckdb_rows(rows)
}

fn get_columns_uncancelled(
    conn: &Connection,
    namespace: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map(params![namespace, table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    collect_duckdb_rows(rows).map(|rows| {
        rows.into_iter()
            .map(|(name, data_type, is_nullable, default_value)| ColumnInfo {
                name,
                data_type: data_type.clone(),
                nullable: is_nullable.eq_ignore_ascii_case("YES"),
                default_value,
                // DuckDB sequences surface as a `default_value`, which the
                // INSERT generator already omits — no separate flag needed.
                is_identity: false,
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
                check_clauses: Vec::new(),
                category: duckdb_column_category(&data_type),
            })
            .collect()
    })
}

/// Split a `chr(31)`-joined catalog list back into its elements. DuckDB list
/// columns (index expressions, constraint columns) are flattened on the unit
/// separator in SQL so they round-trip as plain `VARCHAR` without a list
/// `FromSql` impl; an empty list arrives as `""` and yields `vec![]`.
fn split_duckdb_list(joined: Option<&str>) -> Vec<String> {
    joined
        .map(|value| {
            value
                .split('\u{1f}')
                .filter(|part| !part.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn collect_duckdb_rows<T, I>(rows: I) -> Result<Vec<T>, AppError>
where
    I: IntoIterator<Item = duckdb::Result<T>>,
{
    rows.into_iter()
        .map(|row| row.map_err(|e| AppError::Database(e.to_string())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_list_namespaces_sql(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare(LIST_NAMESPACES_SQL).unwrap();
        stmt.query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    // Bug: `information_schema.schemata` spans the internal `system` and `temp`
    // catalogs, each of which owns a `main` schema. The old filter only excluded
    // `information_schema`/`pg_catalog` by name, so `main` came back three times —
    // the two empty internal copies rendered as duplicate "No Tables" siblings next
    // to the real one in the flat (header-less) tree.
    #[test]
    fn list_namespaces_sql_hides_internal_catalog_duplicates() {
        let conn = Connection::open_in_memory().unwrap();
        // `analytics` stands in for a user `CREATE SCHEMA` that must survive.
        conn.execute_batch("CREATE SCHEMA analytics;").unwrap();

        let names = run_list_namespaces_sql(&conn);

        // Exactly the user database's schemas, each once — no internal duplicates.
        assert_eq!(names, vec!["analytics".to_string(), "main".to_string()]);
        assert_eq!(
            names.iter().filter(|n| n.as_str() == "main").count(),
            1,
            "internal system/temp catalogs must not leak extra `main` namespaces"
        );
    }

    #[test]
    fn list_namespaces_sql_blacklists_internal_namespaces() {
        // Catalog-level internals live in the FROM/WHERE; schema-level internals are
        // excluded by name. Guards the query text against silent drift.
        assert!(LIST_NAMESPACES_SQL.contains("'system'"));
        assert!(LIST_NAMESPACES_SQL.contains("'temp'"));
        assert!(LIST_NAMESPACES_SQL.contains("'information_schema'"));
        assert!(LIST_NAMESPACES_SQL.contains("'pg_catalog'"));
        // User-facing `main` is never hardcoded into an exclusion.
        assert!(!LIST_NAMESPACES_SQL.contains("'main'"));
    }

    #[test]
    fn validate_user_database_path_hides_missing_absolute_path() {
        let path = "/Users/felix/private/missing.duckdb";
        let err = DuckdbAdapter::validate_user_database_path(path).unwrap_err();

        let message = err.to_string();
        assert!(message.contains("DuckDB database file does not exist"));
        assert!(!message.contains(path));
    }

    // P3-1 (#1455) — a `.duckdb` file that lives inside the app data dir must
    // be rejected before connect, mirroring the SQLite connect guard. Before
    // the guard, an existing `<data_dir>/state.duckdb` passed every check
    // (absolute + exists + is_file + `.duckdb`) and would open the file.
    #[test]
    #[serial_test::serial]
    fn validate_user_database_path_rejects_internal_app_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());

        let internal = dir.path().join("state.duckdb");
        std::fs::write(&internal, b"").unwrap();
        let err =
            DuckdbAdapter::validate_user_database_path(internal.to_str().unwrap()).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "internal .duckdb must be rejected, got: {err:?}"
        );

        // Regression: a `.duckdb` file outside the data dir still validates.
        let outside = tempfile::tempdir().unwrap();
        let external = outside.path().join("user.duckdb");
        std::fs::write(&external, b"").unwrap();
        DuckdbAdapter::validate_user_database_path(external.to_str().unwrap())
            .expect("external .duckdb must still validate");

        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[test]
    fn redact_duckdb_path_replaces_database_path_in_driver_errors() {
        let path = "/Users/felix/private/app.duckdb";
        let message = redact_duckdb_path(
            "IO Error: cannot open /Users/felix/private/app.duckdb",
            path,
        );

        assert_eq!(message, "IO Error: cannot open <local-file>");
    }
}
