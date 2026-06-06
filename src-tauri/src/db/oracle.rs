mod common;
mod ddl;
mod metadata;
mod query;
mod traits;

#[cfg(test)]
mod tests;

use oracle_rs::{Config as OracleDriverConfig, Connection as OracleConnection};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::ConnectionConfig;

use self::common::oracle_error;

pub struct OracleAdapter {
    pub(super) connected_config: Mutex<Option<ConnectionConfig>>,
}

impl OracleAdapter {
    pub fn new() -> Self {
        Self {
            connected_config: Mutex::new(None),
        }
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let connection = Self::connect_driver(config).await?;
        connection
            .query("SELECT banner FROM v$version WHERE ROWNUM = 1", &[])
            .await
            .map_err(|err| oracle_error("Oracle version probe failed", err))?;
        connection
            .close()
            .await
            .map_err(|err| oracle_error("Oracle close failed", err))?;
        Ok(())
    }

    pub(super) async fn connected_config(&self) -> Result<ConnectionConfig, AppError> {
        self.connected_config
            .lock()
            .await
            .clone()
            .ok_or_else(|| AppError::Connection("Oracle connection is not open".into()))
    }

    pub(super) async fn connect_driver(
        config: &ConnectionConfig,
    ) -> Result<OracleConnection, AppError> {
        let oracle_config = Self::build_oracle_config(config)?;
        OracleConnection::connect_with_config(oracle_config)
            .await
            .map_err(|err| oracle_error("Oracle login failed", err))
    }

    fn build_oracle_config(config: &ConnectionConfig) -> Result<OracleDriverConfig, AppError> {
        let host = config.host.trim();
        if host.is_empty() {
            return Err(AppError::Validation("Oracle host is required".into()));
        }

        let user = config.user.trim();
        if user.is_empty() {
            return Err(AppError::Validation("Oracle user is required".into()));
        }

        let service_name = config.database.trim();
        if service_name.is_empty() {
            return Err(AppError::Validation(
                "Oracle service name is required".into(),
            ));
        }

        let mut oracle_config = OracleDriverConfig::new(
            host,
            config.port,
            service_name,
            user,
            config.password.as_str(),
        );
        if config.tls_enabled.unwrap_or(false) {
            oracle_config = oracle_config
                .with_tls()
                .map_err(|err| oracle_error("Oracle TLS setup failed", err))?;
        }
        Ok(oracle_config)
    }
}
