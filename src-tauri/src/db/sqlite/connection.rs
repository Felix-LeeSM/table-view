//! SQLite connection lifecycle and baseline catalog reads.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::{ColumnCategory, ColumnInfo, ConnectionConfig, TableInfo};

const SQLITE_POOL_MAX_CONNECTIONS: u32 = 5;
const SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u64 = 30;
const SQLITE_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS: u32 = 300;
const SQLITE_NAMESPACE: &str = "main";

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

    async fn active_pool(&self) -> Result<SqlitePool, AppError> {
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

fn validate_namespace(namespace: &str) -> Result<(), AppError> {
    if namespace.is_empty() || namespace == SQLITE_NAMESPACE {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "SQLite only supports the '{SQLITE_NAMESPACE}' namespace"
        )))
    }
}

fn quote_identifier(ident: &str) -> String {
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

fn sqlite_column_category(data_type: &str) -> ColumnCategory {
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
mod tests {
    use super::*;
    use crate::models::DatabaseType;

    fn sqlite_config(path: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: "sqlite-1".to_string(),
            name: "SQLite".to_string(),
            db_type: DatabaseType::Sqlite,
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: path.to_string(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    async fn seed_sqlite(path: &std::path::Path) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                total_cents INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO users(id, email, name) VALUES (1, 'ada@example.test', 'Ada')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    #[tokio::test]
    async fn test_sqlite_connection_opens_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("app.sqlite");
        seed_sqlite(&db_path).await;

        SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap()))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_sqlite_connection_rejects_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("missing.sqlite");

        let result = SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap())).await;

        assert!(matches!(result, Err(AppError::Connection(_))));
        assert!(!db_path.exists(), "test_connection must not create files");
    }

    #[tokio::test]
    async fn test_sqlite_adapter_lists_main_namespace_and_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("app.sqlite");
        seed_sqlite(&db_path).await;
        let adapter = SqliteAdapter::new();
        adapter
            .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
            .await
            .unwrap();

        assert_eq!(
            adapter.current_database_path().await,
            Some(db_path.display().to_string())
        );
        let tables = adapter.list_tables("main").await.unwrap();
        assert_eq!(
            tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            vec!["orders", "users"]
        );
        assert_eq!(
            tables.iter().find(|t| t.name == "users").unwrap().row_count,
            Some(1)
        );
    }

    #[tokio::test]
    async fn test_sqlite_adapter_reads_columns_and_foreign_keys() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("app.sqlite");
        seed_sqlite(&db_path).await;
        let adapter = SqliteAdapter::new();
        adapter
            .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
            .await
            .unwrap();

        let columns = adapter.get_table_columns("main", "orders").await.unwrap();
        let user_id = columns.iter().find(|c| c.name == "user_id").unwrap();

        assert_eq!(user_id.data_type, "INTEGER");
        assert!(user_id.is_foreign_key);
        assert_eq!(user_id.fk_reference.as_deref(), Some("users(id)"));
        assert_eq!(user_id.category, ColumnCategory::Int);
    }
}
