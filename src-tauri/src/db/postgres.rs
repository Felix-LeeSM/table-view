use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tracing::info;

use crate::error::AppError;
use crate::models::{ColumnInfo, ConnectionConfig, SchemaInfo, TableData, TableInfo};

pub struct PostgresAdapter {
    pool: Mutex<Option<PgPool>>,
}

impl PostgresAdapter {
    pub fn new() -> Self {
        Self {
            pool: Mutex::new(None),
        }
    }

    /// Build PgConnectOptions safely without string interpolation (prevents injection).
    fn connect_options(config: &ConnectionConfig) -> PgConnectOptions {
        PgConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            .database(&config.database)
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Use defer pattern: close pool in all code paths
        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()));

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let timeout_secs = config.connection_timeout.unwrap_or(300);
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(timeout_secs.min(30) as u64))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        info!("Connected to PostgreSQL at {}:{}", config.host, config.port);

        let mut guard = self.pool.lock().await;
        *guard = Some(pool);
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.pool.lock().await;
        if let Some(pool) = guard.take() {
            pool.close().await;
            info!("Disconnected from PostgreSQL");
        }
        Ok(())
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        sqlx::query("SELECT 1")
            .execute(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
             ORDER BY schema_name",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name,)| SchemaInfo { name })
            .collect())
    }

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        let rows: Vec<(String, Option<i64>)> = sqlx::query_as(
            "SELECT t.table_name, s.n_live_tup \
             FROM information_schema.tables t \
             LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema \
             WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' \
             ORDER BY t.table_name",
        )
        .bind(schema)
        .fetch_all(pool)
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
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        // Get column info from information_schema
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

        // Get primary key columns
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

        // Get foreign key references
        let fk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT kcu.column_name, ccu.table_name || '.' || ccu.column_name \
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

        let fk_map: std::collections::HashMap<String, String> = fk_rows.into_iter().collect();

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let is_pk = pk_columns.contains(&name);
                let (is_fk, fk_reference) = match fk_map.get(&name) {
                    Some(ref_str) => (true, Some(ref_str.clone())),
                    None => (false, None),
                };
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable == "YES",
                    default_value,
                    is_primary_key: is_pk,
                    is_foreign_key: is_fk,
                    fk_reference,
                }
            })
            .collect())
    }

    pub async fn query_table_data(
        &self,
        table: &str,
        schema: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
    ) -> Result<TableData, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

        // Get columns first
        let columns = self.get_table_columns_inner(pool, table, schema).await?;

        // Build safe query — table/schema are validated identifiers
        let qualified_table = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM {}", qualified_table);
        let (total,): (i64,) = sqlx::query_as(&count_sql)
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build data query using row_to_json for type-safe conversion
        let offset = (page - 1).max(0) * page_size;

        let mut order_clause = String::new();
        if let Some(col) = &order_by {
            let valid_col = columns.iter().any(|c| c.name.as_str() == *col);
            if valid_col {
                order_clause = format!(" ORDER BY \"{}\" ASC", col.replace('"', "\"\""));
            }
        }

        let data_sql = format!(
            "SELECT row_to_json(q) FROM (SELECT * FROM {}{} LIMIT {} OFFSET {}) q",
            qualified_table, order_clause, page_size, offset
        );

        let json_rows: Vec<(String,)> = sqlx::query_as(&data_sql)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Parse JSON strings into Vec<Vec<serde_json::Value>> in column order
        let result_rows: Vec<Vec<serde_json::Value>> = json_rows
            .into_iter()
            .map(|(json_str,)| {
                let obj: serde_json::Map<String, serde_json::Value> =
                    serde_json::from_str(&json_str).unwrap_or_default();
                columns
                    .iter()
                    .map(|col| {
                        obj.get(&col.name)
                            .cloned()
                            .unwrap_or(serde_json::Value::Null)
                    })
                    .collect()
            })
            .collect();

        Ok(TableData {
            columns,
            rows: result_rows,
            total_count: total,
            page,
            page_size,
        })
    }

    /// Inner helper that takes a pool reference directly (avoids double-lock).
    async fn get_table_columns_inner(
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

        let fk_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT kcu.column_name, ccu.table_name || '.' || ccu.column_name \
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

        let fk_map: std::collections::HashMap<String, String> = fk_rows.into_iter().collect();

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let is_pk = pk_columns.contains(&name);
                let (is_fk, fk_reference) = match fk_map.get(&name) {
                    Some(ref_str) => (true, Some(ref_str.clone())),
                    None => (false, None),
                };
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable == "YES",
                    default_value,
                    is_primary_key: is_pk,
                    is_foreign_key: is_fk,
                    fk_reference,
                }
            })
            .collect())
    }
}
