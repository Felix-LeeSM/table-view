use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tracing::info;

use crate::error::AppError;
use crate::models::ConnectionConfig;

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
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(10))
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

    #[allow(dead_code)]
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
}
