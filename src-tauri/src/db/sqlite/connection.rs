//! SQLite connection lifecycle and baseline catalog reads.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::{ColumnCategory, ColumnInfo, ConnectionConfig, TableInfo};

const SQLITE_POOL_MAX_CONNECTIONS: u32 = 5;
const SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u64 = 30;
const SQLITE_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS: u32 = 300;
pub(super) const SQLITE_NAMESPACE: &str = "main";

#[derive(Default)]
pub struct SqlitePoolState {
    pool: Option<SqlitePool>,
    database_path: Option<String>,
}

#[derive(Clone)]
pub struct SqliteAdapter {
    inner: Arc<Mutex<SqlitePoolState>>,
}

impl Default for SqliteAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl SqliteAdapter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SqlitePoolState::default())),
        }
    }

    fn database_path(config: &ConnectionConfig) -> Result<&str, AppError> {
        let path = config.database.trim();
        if path.is_empty() {
            return Err(AppError::Validation(
                "SQLite database file is required".into(),
            ));
        }
        Ok(path)
    }

    fn connect_options(config: &ConnectionConfig) -> Result<SqliteConnectOptions, AppError> {
        let path = Self::database_path(config)?;
        Ok(SqliteConnectOptions::new()
            .filename(Path::new(path))
            .create_if_missing(false)
            .foreign_keys(true))
    }

    pub async fn create_database_file(path: &str) -> Result<String, AppError> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "SQLite database file path is required".into(),
            ));
        }

        let path = Path::new(trimmed);
        if !path.is_absolute() {
            return Err(AppError::Validation(
                "SQLite database file path must be absolute".into(),
            ));
        }
        let parent = path.parent().ok_or_else(|| {
            AppError::Validation("SQLite database file parent directory is required".into())
        })?;
        if !parent.is_dir() {
            return Err(AppError::Validation(format!(
                "SQLite database file parent directory does not exist: {}",
                parent.display()
            )));
        }

        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(file) => drop(file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(AppError::Validation(format!(
                    "SQLite database file already exists: {}",
                    path.display()
                )));
            }
            Err(error) => return Err(AppError::Io(error)),
        }

        let init_result = async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(path)
                        .create_if_missing(false)
                        .foreign_keys(true),
                )
                .await
                .map_err(|e| AppError::Connection(e.to_string()))?;

            // Force SQLite to write a valid database header while leaving no
            // application schema behind.
            let result = async {
                sqlx::query("PRAGMA user_version = 1")
                    .execute(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                sqlx::query("PRAGMA user_version = 0")
                    .execute(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Ok::<(), AppError>(())
            }
            .await;
            pool.close().await;
            result
        }
        .await;

        if let Err(error) = init_result {
            let _ = std::fs::remove_file(path);
            return Err(error);
        }

        Ok(trimmed.to_string())
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()));

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let timeout_secs = config
            .connection_timeout
            .unwrap_or(SQLITE_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS);
        let pool = SqlitePoolOptions::new()
            .max_connections(SQLITE_POOL_MAX_CONNECTIONS)
            .acquire_timeout(std::time::Duration::from_secs(
                (timeout_secs as u64).min(SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS),
            ))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let old_pool = {
            let mut guard = self.inner.lock().await;
            let old_pool = guard.pool.replace(pool);
            guard.database_path = Some(Self::database_path(config)?.to_string());
            old_pool
        };
        if let Some(old_pool) = old_pool {
            old_pool.close().await;
        }
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        let pool = guard.pool.take();
        guard.database_path = None;
        drop(guard);
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(())
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    pub async fn require_connected(&self) -> Result<(), AppError> {
        self.active_pool().await.map(|_| ())
    }

    pub async fn current_database_path(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard.database_path.clone()
    }

    pub(super) async fn active_pool(&self) -> Result<SqlitePool, AppError> {
        let guard = self.inner.lock().await;
        guard
            .pool
            .clone()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    pub async fn list_tables(&self, namespace: &str) -> Result<Vec<TableInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        let mut tables = Vec::with_capacity(rows.len());
        for (name,) in rows {
            let count_sql = format!("SELECT COUNT(*) FROM {}", quote_identifier(&name));
            let row_count: i64 = sqlx::query_scalar(&count_sql)
                .fetch_one(&pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            tables.push(TableInfo {
                name,
                schema: SQLITE_NAMESPACE.to_string(),
                row_count: Some(row_count),
            });
        }
        Ok(tables)
    }

    pub async fn get_table_columns(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let table_ident = quote_identifier(table);
        let fk_map = sqlite_foreign_keys(&pool, &table_ident).await?;
        let pragma_sql = format!("PRAGMA table_info({table_ident})");
        let rows = sqlx::query(&pragma_sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut columns = Vec::with_capacity(rows.len());
        for row in rows {
            let name: String = row
                .try_get("name")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let data_type: String = row
                .try_get("type")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let not_null: i64 = row
                .try_get("notnull")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let default_value: Option<String> = row
                .try_get("dflt_value")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let pk: i64 = row
                .try_get("pk")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let fk_reference = fk_map.get(&name).cloned();

            columns.push(ColumnInfo {
                name,
                data_type: data_type.clone(),
                nullable: not_null == 0 && pk == 0,
                default_value,
                is_primary_key: pk > 0,
                is_foreign_key: fk_reference.is_some(),
                fk_reference,
                comment: None,
                check_clauses: Vec::new(),
                category: sqlite_column_category(&data_type),
            });
        }
        Ok(columns)
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

pub(super) fn validate_namespace(namespace: &str) -> Result<(), AppError> {
    if namespace.is_empty() || namespace == SQLITE_NAMESPACE {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "SQLite only supports the '{SQLITE_NAMESPACE}' namespace"
        )))
    }
}

pub(super) fn quote_identifier(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

async fn sqlite_foreign_keys(
    pool: &SqlitePool,
    table_ident: &str,
) -> Result<HashMap<String, String>, AppError> {
    let fk_sql = format!("PRAGMA foreign_key_list({table_ident})");
    let rows = sqlx::query(&fk_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut map = HashMap::with_capacity(rows.len());
    for row in rows {
        let from: String = row
            .try_get("from")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let target_table: String = row
            .try_get("table")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let target_column: String = row
            .try_get("to")
            .map_err(|e| AppError::Database(e.to_string()))?;
        map.insert(from, format!("{target_table}({target_column})"));
    }
    Ok(map)
}

pub(super) fn sqlite_column_category(data_type: &str) -> ColumnCategory {
    let normalized = data_type.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return ColumnCategory::Unknown;
    }

    let tokens: HashSet<&str> = normalized
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|token| !token.is_empty())
        .collect();

    if tokens.contains("int") || normalized.contains("integer") {
        ColumnCategory::Int
    } else if tokens.contains("real")
        || tokens.contains("double")
        || tokens.contains("float")
        || tokens.contains("numeric")
        || tokens.contains("decimal")
    {
        ColumnCategory::Float
    } else if tokens.contains("bool") || tokens.contains("boolean") {
        ColumnCategory::Bool
    } else if tokens.contains("date")
        || tokens.contains("datetime")
        || tokens.contains("timestamp")
        || tokens.contains("time")
    {
        ColumnCategory::Datetime
    } else if tokens.contains("blob") || normalized.contains("binary") {
        ColumnCategory::Binary
    } else if tokens.contains("json") {
        ColumnCategory::Object
    } else if tokens.contains("uuid") {
        ColumnCategory::Uuid
    } else if tokens.contains("char")
        || tokens.contains("clob")
        || tokens.contains("text")
        || tokens.contains("varchar")
    {
        ColumnCategory::Text
    } else {
        ColumnCategory::Unknown
    }
}

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;
