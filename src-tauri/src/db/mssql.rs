use std::future::Future;
use std::time::Duration;

use tiberius::{AuthMethod, Client, Config as TdsConfig, EncryptionLevel};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::timeout;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, FunctionInfo,
    IndexInfo, QueryResult, RenameTableRequest, SchemaChangeResult, TableData,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter};

pub struct MssqlAdapter {
    connected_config: Mutex<Option<ConnectionConfig>>,
}

impl MssqlAdapter {
    const DEFAULT_CONNECTION_TIMEOUT_SECS: u64 = 10;
    const MAX_CONNECTION_TIMEOUT_SECS: u64 = 300;

    pub fn new() -> Self {
        Self {
            connected_config: Mutex::new(None),
        }
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let timeout = Self::connection_timeout(config);
        let mut client = Self::connect_client(config).await?;
        let version_probe = with_timeout(
            "SQL Server version probe failed",
            timeout,
            client.simple_query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128))"),
        )
        .await?;
        with_timeout(
            "SQL Server version probe failed",
            timeout,
            version_probe.into_results(),
        )
        .await?;
        Ok(())
    }

    async fn connected_config(&self) -> Result<ConnectionConfig, AppError> {
        self.connected_config
            .lock()
            .await
            .clone()
            .ok_or_else(|| AppError::Connection("SQL Server connection is not open".into()))
    }

    async fn connect_client(
        config: &ConnectionConfig,
    ) -> Result<Client<Compat<TcpStream>>, AppError> {
        let tds_config = Self::build_tds_config(config)?;
        let timeout = Self::connection_timeout(config);
        let tcp = with_timeout(
            "SQL Server network connection failed",
            timeout,
            TcpStream::connect(tds_config.get_addr()),
        )
        .await?;
        tcp.set_nodelay(true)
            .map_err(|err| mssql_connection_error("SQL Server TCP setup failed", err))?;
        with_timeout(
            "SQL Server login failed",
            timeout,
            Client::connect(tds_config, tcp.compat_write()),
        )
        .await
    }

    fn build_tds_config(config: &ConnectionConfig) -> Result<TdsConfig, AppError> {
        let host = config.host.trim();
        if host.is_empty() {
            return Err(AppError::Validation("SQL Server host is required".into()));
        }

        let user = config.user.trim();
        if user.is_empty() {
            return Err(AppError::Validation(
                "SQL Server SQL authentication user is required".into(),
            ));
        }

        let mut tds_config = TdsConfig::new();
        tds_config.host(host);
        tds_config.port(config.port);
        if !config.database.trim().is_empty() {
            tds_config.database(config.database.trim());
        }
        tds_config.authentication(AuthMethod::sql_server(user, config.password.as_str()));

        if config.tls_enabled.unwrap_or(false) {
            tds_config.encryption(EncryptionLevel::Required);
            tds_config.trust_cert();
        } else {
            tds_config.encryption(EncryptionLevel::NotSupported);
        }

        Ok(tds_config)
    }

    fn connection_timeout(config: &ConnectionConfig) -> Duration {
        Duration::from_secs(
            config
                .connection_timeout
                .map(u64::from)
                .unwrap_or(Self::DEFAULT_CONNECTION_TIMEOUT_SECS)
                .clamp(1, Self::MAX_CONNECTION_TIMEOUT_SECS),
        )
    }
}

impl Default for MssqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DbAdapter for MssqlAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mssql
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            Self::test(config).await?;
            let mut connected_config = self.connected_config.lock().await;
            *connected_config = Some(config.clone());
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let mut connected_config = self.connected_config.lock().await;
            *connected_config = None;
            Ok(())
        })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            Self::test(&config).await
        })
    }
}

impl RdbAdapter for MssqlAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        unsupported()
    }

    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::TableInfo>, AppError>> {
        unsupported()
    }

    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        unsupported()
    }

    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        unsupported()
    }

    fn query_table_data<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _page: i32,
        _page_size: i32,
        _order_by: Option<&'a str>,
        _filters: Option<&'a [FilterCondition]>,
        _raw_where: Option<&'a str>,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        unsupported()
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        unsupported()
    }

    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        unsupported()
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        unsupported()
    }

    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        unsupported()
    }

    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        unsupported()
    }

    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        unsupported()
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        unsupported()
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        unsupported()
    }
}

fn unsupported<'a, T>() -> BoxFuture<'a, Result<T, AppError>> {
    Box::pin(async {
        Err(AppError::Unsupported(
            "SQL Server support is connection-only".into(),
        ))
    })
}

fn mssql_connection_error(context: &'static str, err: impl std::fmt::Display) -> AppError {
    AppError::Connection(format!("{context}: {err}"))
}

async fn with_timeout<T, E>(
    context: &'static str,
    duration: Duration,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, AppError>
where
    E: std::fmt::Display,
{
    match timeout(duration, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(err)) => Err(mssql_connection_error(context, err)),
        Err(_) => Err(AppError::Connection(format!(
            "{context}: timed out after {}s",
            duration.as_secs()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{DbAdapter, RdbAdapter};

    fn config() -> ConnectionConfig {
        ConnectionConfig {
            id: "conn".into(),
            name: "mssql".into(),
            db_type: DatabaseType::Mssql,
            host: "localhost".into(),
            port: 1433,
            user: "sa".into(),
            password: "secret".into(),
            database: "master".into(),
            read_only: false,
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

    #[test]
    fn connection_config_validation_and_lifecycle_errors_are_local() {
        let adapter = MssqlAdapter::default();
        assert!(matches!(adapter.kind(), DatabaseType::Mssql));
        assert!(matches!(adapter.namespace_label(), NamespaceLabel::Schema));

        let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
            host: " ".into(),
            ..config()
        })
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));

        let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
            user: " ".into(),
            ..config()
        })
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn connection_timeout_clamps_ui_value() {
        assert_eq!(MssqlAdapter::connection_timeout(&config()).as_secs(), 10);
        assert_eq!(
            MssqlAdapter::connection_timeout(&ConnectionConfig {
                connection_timeout: Some(0),
                ..config()
            })
            .as_secs(),
            1
        );
        assert_eq!(
            MssqlAdapter::connection_timeout(&ConnectionConfig {
                connection_timeout: Some(301),
                ..config()
            })
            .as_secs(),
            300
        );
        assert_eq!(
            MssqlAdapter::connection_timeout(&ConnectionConfig {
                connection_timeout: Some(42),
                ..config()
            })
            .as_secs(),
            42
        );
    }

    #[tokio::test]
    async fn query_surface_stays_unsupported_until_runtime_issue_lands() {
        let adapter = MssqlAdapter::new();
        let err = adapter.execute_sql("SELECT 1", None).await.unwrap_err();
        assert!(matches!(err, AppError::Unsupported(_)));
    }
}
