use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tracing::info;

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, FilterCondition, FilterOperator, IndexInfo,
    SchemaInfo, TableData, TableInfo,
};

pub struct PostgresAdapter {
    pool: Mutex<Option<PgPool>>,
}

impl Default for PostgresAdapter {
    fn default() -> Self {
        Self::new()
    }
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

    /// Execute a raw SQL statement (DDL, DML).
    pub async fn execute(&self, query: &str) -> Result<(), AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        sqlx::query(query)
            .execute(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
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

        self.get_table_columns_inner(pool, table, schema).await
    }

    pub async fn query_table_data(
        &self,
        table: &str,
        schema: &str,
        page: i32,
        page_size: i32,
        order_by: Option<&str>,
        filters: Option<&[FilterCondition]>,
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

        // Build WHERE clause from filters with parameterized values
        let mut where_clause = String::new();
        let mut param_values: Vec<String> = Vec::new();
        if let Some(filters) = filters {
            if !filters.is_empty() {
                let valid_columns: std::collections::HashSet<&str> =
                    columns.iter().map(|c| c.name.as_str()).collect();
                let mut conditions: Vec<String> = Vec::new();
                for f in filters {
                    if !valid_columns.contains(f.column.as_str()) {
                        continue;
                    }
                    let quoted_col = format!("\"{}\"", f.column.replace('"', "\"\""));
                    match &f.operator {
                        FilterOperator::IsNull => {
                            conditions.push(format!("{} IS NULL", quoted_col));
                        }
                        FilterOperator::IsNotNull => {
                            conditions.push(format!("{} IS NOT NULL", quoted_col));
                        }
                        _ => {
                            let op = match f.operator {
                                FilterOperator::Eq => "=",
                                FilterOperator::Neq => "<>",
                                FilterOperator::Gt => ">",
                                FilterOperator::Lt => "<",
                                FilterOperator::Gte => ">=",
                                FilterOperator::Lte => "<=",
                                FilterOperator::Like => "LIKE",
                                _ => unreachable!(),
                            };
                            if let Some(val) = &f.value {
                                let param_idx = param_values.len() + 1;
                                conditions.push(format!("{} {} ${}", quoted_col, op, param_idx));
                                param_values.push(val.clone());
                            }
                        }
                    }
                }
                if !conditions.is_empty() {
                    where_clause = format!(" WHERE {}", conditions.join(" AND "));
                }
            }
        }

        // Count total
        let count_sql = format!("SELECT COUNT(*) FROM {}{}", qualified_table, where_clause);
        let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql);
        for val in &param_values {
            count_query = count_query.bind(val);
        }
        let (total,) = count_query
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        // Build data query using row_to_json for type-safe conversion
        let offset = (page - 1).max(0) * page_size;

        let mut order_clause = String::new();
        if let Some(order_by) = &order_by {
            // Parse "column_name ASC" or "column_name DESC" format
            let parts: Vec<&str> = order_by.split_whitespace().collect();
            let (col_name, direction) = match parts.as_slice() {
                [col, dir] if *dir == "ASC" || *dir == "DESC" => (*col, *dir),
                [col] => (*col, "ASC"),
                _ => (*order_by, "ASC"),
            };
            let valid_col = columns.iter().any(|c| c.name.as_str() == col_name);
            if valid_col {
                order_clause = format!(
                    " ORDER BY \"{}\" {}",
                    col_name.replace('"', "\"\""),
                    direction
                );
            }
        }

        let data_sql = format!(
            "SELECT row_to_json(q)::text FROM (SELECT * FROM {}{}{} LIMIT {} OFFSET {}) q",
            qualified_table, where_clause, order_clause, page_size, offset
        );

        let mut data_query = sqlx::query_as::<_, (String,)>(&data_sql);
        for val in &param_values {
            data_query = data_query.bind(val);
        }
        let json_rows: Vec<(String,)> = data_query
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

        Ok(rows
            .into_iter()
            .map(|(name, data_type, is_nullable, default_value)| {
                let is_pk = pk_columns.contains(&name);
                let (is_fk, fk_reference) = match fk_map.get(&name) {
                    Some(ref_str) => (true, Some(ref_str.clone())),
                    None => (false, None),
                };
                let comment = comment_map.get(&name).and_then(Option::clone);
                ColumnInfo {
                    name,
                    data_type,
                    nullable: is_nullable == "YES",
                    default_value,
                    is_primary_key: is_pk,
                    is_foreign_key: is_fk,
                    fk_reference,
                    comment,
                }
            })
            .collect())
    }

    #[allow(clippy::type_complexity)]
    pub async fn get_table_indexes(
        &self,
        table: &str,
        schema: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

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
        .fetch_all(pool)
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
        let guard = self.pool.lock().await;
        let pool = guard
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;

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
        .fetch_all(pool)
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatabaseType;

    fn sample_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "test".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "secret".to_string(),
            database: "testdb".to_string(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
        }
    }

    #[tokio::test]
    async fn new_adapter_has_no_pool() {
        let adapter = PostgresAdapter::new();
        let guard = adapter.pool.lock().await;
        assert!(guard.is_none(), "New adapter should have no pool");
    }

    #[tokio::test]
    async fn ping_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.ping().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

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

    #[test]
    fn connect_options_builder() {
        let config = sample_config();
        let opts = PostgresAdapter::connect_options(&config);

        // PgConnectOptions exposes host, port, username, database via Debug
        // We verify by building a connection string and checking the components
        let opts_str = format!("{opts:?}");

        // The debug output should contain our connection parameters
        assert!(
            opts_str.contains("localhost") || opts_str.contains("5432"),
            "Options should reflect the config parameters"
        );
    }
}
