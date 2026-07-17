//! Oracle adapter internals.
//!
//! Issue #1072 dissolves the bounded #905/#906 runtime slice and wires the full
//! `OracleAdapter` into production: service-name lifecycle, catalog metadata,
//! SELECT/DML batch, cooperative cancel, tabular table-data queries, structured
//! table/index/constraint DDL, and PL/SQL body/package source. Raw DDL/admin
//! execution, switch-database, trigger introspection (deferred, empty list),
//! SID/TNS/wallet/TLS, and advanced auth remain unsupported or unclaimed.

mod catalog;
mod ddl;
#[cfg(test)]
mod ddl_tests;
mod runtime;
mod table_data;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;

use oracle_rs::{Config as OracleConfig, Connection as OracleConnection};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FunctionInfo, IndexInfo,
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

const ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS: u32 = 300;
const ORACLE_CONNECT_TIMEOUT_MAX_SECS: u64 = 30;
const ORACLE_TEST_CONNECT_TIMEOUT_SECS: u64 = 5;

#[derive(Default)]
struct OracleConnectionState {
    connection: Option<OracleConnection>,
    connected_config: Option<ConnectionConfig>,
    server_version: Option<String>,
    server_banner: Option<String>,
}

#[derive(Default)]
pub struct OracleAdapter {
    state: Mutex<OracleConnectionState>,
}

impl OracleAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let connection = Self::open_connection(config, ORACLE_TEST_CONNECT_TIMEOUT_SECS).await?;
        let ping_result = connection.ping().await.map_err(map_oracle_connection_error);
        let close_result = connection
            .close()
            .await
            .map_err(map_oracle_connection_error);

        ping_result?;
        close_result?;
        Ok(())
    }

    async fn connect_session(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let timeout_secs = connection_timeout_secs(config);
        let connection = Self::open_connection(config, timeout_secs).await?;
        if let Err(err) = connection.ping().await {
            let _ = connection.close().await;
            return Err(map_oracle_connection_error(err));
        }

        let server_info = connection.server_info().await;
        let mut guard = self.state.lock().await;
        guard.server_version = non_empty(server_info.version);
        guard.server_banner = non_empty(server_info.banner);
        guard.connected_config = Some(config.clone());
        guard.connection = Some(connection);

        info!("Connected to Oracle at {}:{}", config.host, config.port);
        Ok(())
    }

    async fn disconnect_session(&self) -> Result<(), AppError> {
        let connection = {
            let mut guard = self.state.lock().await;
            guard.server_version = None;
            guard.server_banner = None;
            guard.connected_config = None;
            guard.connection.take()
        };

        if let Some(connection) = connection {
            connection
                .close()
                .await
                .map_err(map_oracle_connection_error)?;
        }

        Ok(())
    }

    async fn ping_session(&self) -> Result<(), AppError> {
        let guard = self.state.lock().await;
        let connection = guard
            .connection
            .as_ref()
            .ok_or_else(|| AppError::Connection("Oracle connection is not open".into()))?;

        connection.ping().await.map_err(map_oracle_connection_error)
    }

    async fn connected_config(&self) -> Result<ConnectionConfig, AppError> {
        self.state
            .lock()
            .await
            .connected_config
            .clone()
            .ok_or_else(|| AppError::Connection("Oracle connection is not open".into()))
    }

    async fn current_service_name(&self) -> Option<String> {
        self.state
            .lock()
            .await
            .connected_config
            .as_ref()
            .map(|config| config.database.trim().to_string())
            .filter(|service_name| !service_name.is_empty())
    }

    fn connect_config(
        config: &ConnectionConfig,
        timeout_secs: u64,
    ) -> Result<OracleConfig, AppError> {
        let host = config.host.trim();
        let service_name = config.database.trim();
        let username = config.user.trim();
        let service_name_upper = service_name.to_ascii_uppercase();

        if host.is_empty() {
            return Err(AppError::Validation("Oracle host is required".into()));
        }
        if config.port == 0 {
            return Err(AppError::Validation("Oracle port is required".into()));
        }
        if service_name.is_empty() {
            return Err(AppError::Validation(
                "Oracle service name is required".into(),
            ));
        }
        if service_name_upper.contains("SID=") {
            return Err(AppError::Validation(
                "Oracle SID connections are unsupported in issue #904; use a service name".into(),
            ));
        }
        if service_name_upper.contains("DESCRIPTION=")
            || service_name_upper.contains("CONNECT_DATA=")
            || service_name.starts_with("//")
            || service_name.contains('/')
        {
            return Err(AppError::Validation(
                "Oracle TNS/easy-connect descriptors are unsupported in issue #904; use host, port, and service name fields".into(),
            ));
        }
        if username.is_empty() {
            return Err(AppError::Validation("Oracle user is required".into()));
        }
        if config.password.is_empty() {
            return Err(AppError::Validation(
                "Oracle password authentication is required; advanced/external auth is unsupported in issue #904".into(),
            ));
        }
        if has_non_empty(&config.auth_source) {
            return Err(AppError::Validation(
                "Oracle SID/TNS/advanced auth fields are unsupported in issue #904; use service-name username/password auth".into(),
            ));
        }
        if has_non_empty(&config.replica_set) {
            return Err(AppError::Validation(
                "Oracle TNS/wallet routing fields are unsupported in issue #904; use host, port, and service name".into(),
            ));
        }
        if config.tls_enabled.unwrap_or(false) || config.trust_server_certificate.unwrap_or(false) {
            return Err(AppError::Validation(
                "Oracle wallet/TLS modes are unsupported in issue #904; use service-name username/password without wallet options".into(),
            ));
        }

        Ok(OracleConfig::new(
            host,
            config.port,
            service_name,
            username,
            config.password.as_str(),
        )
        .connect_timeout(Duration::from_secs(timeout_secs)))
    }

    async fn open_connection(
        config: &ConnectionConfig,
        timeout_secs: u64,
    ) -> Result<OracleConnection, AppError> {
        let oracle_config = Self::connect_config(config, timeout_secs)?;
        OracleConnection::connect_with_config(oracle_config)
            .await
            .map_err(map_oracle_connection_error)
    }
}

impl DbAdapter for OracleAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Oracle
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.connect_session(config).await })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.disconnect_session().await })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.ping_session().await })
    }
}

impl RdbAdapter for OracleAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let schemas = OracleAdapter::list_schemas(self).await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let dbs = OracleAdapter::list_databases(self).await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { Ok(self.current_service_name().await) })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_tables(self, namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        cancellable_metadata(
            OracleAdapter::get_table_columns(self, namespace, table),
            cancel,
        )
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        Box::pin(async move {
            self.execute_query(sql, cancel, crate::db::row_cap::current())
                .await
        })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async move { self.dry_run_query_batch(statements, cancel).await })
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [crate::models::FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        Box::pin(async move {
            OracleAdapter::query_table_data(
                self, namespace, table, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_table(self, req).await })
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::rename_table(self, req).await })
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::alter_table(self, req).await })
    }

    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::add_column(self, req).await })
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_column(self, req).await })
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::create_table(self, req).await })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::create_index(self, req).await })
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_index(self, req).await })
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::add_constraint(self, req).await })
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { OracleAdapter::drop_constraint(self, req).await })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        cancellable_metadata(
            OracleAdapter::get_table_indexes(self, namespace, table),
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
            OracleAdapter::get_table_constraints(self, namespace, table),
            cancel,
        )
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_views(self, namespace).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::list_functions(self, namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { OracleAdapter::get_view_definition(self, namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move { OracleAdapter::get_view_columns(self, namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async move { OracleAdapter::list_schema_columns(self, namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { OracleAdapter::get_function_source(self, namespace, function).await })
    }

    // `list_triggers` inherits the RdbAdapter default `Ok(Vec::new())` — Oracle
    // trigger introspection is deferred like MySQL/SQLite, not a live claim.
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

fn connection_timeout_secs(config: &ConnectionConfig) -> u64 {
    (config
        .connection_timeout
        .unwrap_or(ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS) as u64)
        .min(ORACLE_CONNECT_TIMEOUT_MAX_SECS)
}

/// Issue #1453 — Oracle connect/ping errors can echo a DSN / URL with
/// credentials; route through the redacting constructor.
fn map_oracle_connection_error(error: oracle_rs::Error) -> AppError {
    AppError::connection_redacted(error.to_string())
}

fn has_non_empty(value: &Option<String>) -> bool {
    value
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
