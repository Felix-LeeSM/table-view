mod catalog;
mod ddl;
#[cfg(test)]
mod ddl_tests;
mod runtime;
#[cfg(test)]
mod tests;

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
    ConstraintInfo, CreateIndexRequest, CreateTablePlanRequest, CreateTableRequest, DatabaseType,
    DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition,
    FunctionInfo, IndexInfo, QueryResult, RenameTableRequest, SchemaChangeResult, TableData,
    TableInfo, TriggerInfo, ViewInfo,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter};

pub struct MssqlAdapter {
    connected_config: Mutex<Option<ConnectionConfig>>,
}

pub struct MssqlConnectionOnlyAdapter {
    inner: MssqlAdapter,
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
        if host.contains('\\') {
            return Err(AppError::Validation(
                "SQL Server named instances are unsupported; use host and port".into(),
            ));
        }
        if config.port == 0 {
            return Err(AppError::Validation("SQL Server port is required".into()));
        }

        let user = config.user.trim();
        if user.is_empty() {
            return Err(AppError::Validation(
                "SQL Server SQL authentication user is required".into(),
            ));
        }
        if user.contains('\\') {
            return Err(AppError::Validation(
                "SQL Server Windows authentication is unsupported; use SQL authentication".into(),
            ));
        }
        if config.password.is_empty() {
            return Err(AppError::Validation(
                "SQL Server SQL authentication password is required".into(),
            ));
        }
        if config
            .auth_source
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(AppError::Validation(
                "SQL Server AAD/authSource modes are unsupported; use SQL authentication".into(),
            ));
        }
        if config
            .replica_set
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(AppError::Validation(
                "SQL Server named instance/replica-set routing is unsupported; use host and port"
                    .into(),
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
            match config.trust_server_certificate {
                Some(true) | Some(false) => {}
                None => {
                    return Err(AppError::Validation(
                        "SQL Server TLS requires an explicit trustServerCertificate decision"
                            .into(),
                    ));
                }
            }
            tds_config.encryption(EncryptionLevel::Required);
            if config.trust_server_certificate == Some(true) {
                tds_config.trust_cert();
            }
        } else {
            if config.trust_server_certificate == Some(true) {
                return Err(AppError::Validation(
                    "SQL Server trustServerCertificate requires TLS/encryption".into(),
                ));
            }
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

impl MssqlConnectionOnlyAdapter {
    pub fn new() -> Self {
        Self {
            inner: MssqlAdapter::new(),
        }
    }
}

impl Default for MssqlConnectionOnlyAdapter {
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

impl DbAdapter for MssqlConnectionOnlyAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mssql
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        self.inner.connect(config)
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        self.inner.disconnect()
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        self.inner.ping()
    }
}

impl RdbAdapter for MssqlConnectionOnlyAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        mssql_connection_only_unsupported()
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn execute_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        mssql_connection_only_unsupported()
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
        mssql_connection_only_unsupported()
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn create_table_plan<'a>(
        &'a self,
        _req: &'a CreateTablePlanRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }

    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        mssql_connection_only_unsupported()
    }
}

fn mssql_connection_only_unsupported<'a, T>() -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async {
        Err(AppError::Unsupported(
            "SQL Server supports connection test, connect, and ping only in this slice; query/catalog/edit/DDL runtime is unsupported".into(),
        ))
    })
}

impl RdbAdapter for MssqlAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let schemas = MssqlAdapter::list_schemas(self).await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let dbs = MssqlAdapter::list_databases(self).await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn switch_database<'a>(&'a self, db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.switch_active_database(db_name).await })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { self.current_database_name().await })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move { MssqlAdapter::list_tables(self, namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        cancellable_metadata(
            MssqlAdapter::get_table_columns(self, namespace, table),
            cancel,
        )
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move {
            self.execute_query(sql, cancel, crate::db::row_cap::current())
                .await
        })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move { self.dry_run_query_batch(statements, cancel).await })
    }

    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async move {
            self.query_table_data(
                namespace, table, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        mssql_structured_ddl_unsupported()
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        cancellable_metadata(
            MssqlAdapter::get_table_indexes(self, namespace, table),
            cancel,
        )
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        cancellable_metadata(
            MssqlAdapter::get_table_constraints(self, namespace, table),
            cancel,
        )
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async move { MssqlAdapter::list_views(self, namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { MssqlAdapter::get_view_definition(self, namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move { MssqlAdapter::get_view_columns(self, namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async move { MssqlAdapter::list_schema_columns(self, namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { MssqlAdapter::get_function_source(self, namespace, function).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async move { MssqlAdapter::list_functions(self, namespace).await })
    }
}

fn cancellable_metadata<'a, T>(
    work: impl Future<Output = Result<T, AppError>> + Send + 'a,
    cancel: Option<&'a CancellationToken>,
) -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async move {
        match cancel {
            Some(token) => tokio::select! {
                result = work => result,
                _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
            },
            None => work.await,
        }
    })
}

fn mssql_structured_ddl_unsupported<'a, T>() -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async {
        Err(AppError::Unsupported(
            "SQL Server structured DDL is outside issue #903 runtime/edit boundary".into(),
        ))
    })
}

pub(super) fn mssql_connection_error(
    context: &'static str,
    err: impl std::fmt::Display,
) -> AppError {
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
