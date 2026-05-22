//! DuckDB file lifecycle and catalog reads.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use duckdb::{params, AccessMode, Config, Connection};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::{ColumnCategory, ColumnInfo, ConnectionConfig, TableInfo, ViewInfo};

use super::sql_text::quote_identifier;
use super::NamespaceInfo;

pub(super) const DUCKDB_DEFAULT_SCHEMA: &str = "main";

#[derive(Clone, Debug)]
pub(super) struct DuckdbConnectionSettings {
    pub path: String,
    pub read_only: bool,
}

#[derive(Default)]
struct DuckdbState {
    settings: Option<DuckdbConnectionSettings>,
}

#[derive(Clone)]
pub struct DuckdbAdapter {
    inner: Arc<Mutex<DuckdbState>>,
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
            return Err(AppError::Validation(format!(
                "DuckDB database file does not exist: {}",
                path_ref.display()
            )));
        }
        if !path_ref.is_file() {
            return Err(AppError::Validation(format!(
                "DuckDB database path is not a file: {}",
                path_ref.display()
            )));
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
        Ok(())
    }

    pub async fn disconnect_file(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        guard.settings = None;
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

    pub async fn list_namespaces(&self) -> Result<Vec<NamespaceInfo>, AppError> {
        self.with_connection(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT schema_name
                     FROM information_schema.schemata
                     WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
                     ORDER BY schema_name",
                )
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
    let access_mode = if settings.read_only {
        AccessMode::ReadOnly
    } else {
        AccessMode::ReadWrite
    };
    let config = Config::default()
        .access_mode(access_mode)
        .and_then(|config| config.enable_external_access(false))
        .and_then(|config| config.enable_autoload_extension(false))
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Connection::open_with_flags(&settings.path, config)
        .map_err(|e| AppError::Connection(e.to_string()))
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

pub(super) fn collect_duckdb_rows<T, I>(rows: I) -> Result<Vec<T>, AppError>
where
    I: IntoIterator<Item = duckdb::Result<T>>,
{
    rows.into_iter()
        .map(|row| row.map_err(|e| AppError::Database(e.to_string())))
        .collect()
}
