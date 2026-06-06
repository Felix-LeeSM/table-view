//! Oracle connection lifecycle adapter.
//!
//! Issue #518 intentionally wires only the lifecycle/test path. Catalog,
//! query, edit, and DDL surfaces remain unsupported until their dedicated
//! Oracle parity issues land.

use std::collections::HashMap;
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
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

const ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS: u32 = 300;
const ORACLE_CONNECT_TIMEOUT_MAX_SECS: u64 = 30;
const ORACLE_TEST_CONNECT_TIMEOUT_SECS: u64 = 5;
const ORACLE_UNSUPPORTED_RUNTIME: &str =
    "Oracle catalog, query, edit, and DDL runtime is not supported yet";

#[derive(Default)]
struct OracleConnectionState {
    connection: Option<OracleConnection>,
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
        guard.connection = Some(connection);

        info!("Connected to Oracle at {}:{}", config.host, config.port);
        Ok(())
    }

    async fn disconnect_session(&self) -> Result<(), AppError> {
        let connection = {
            let mut guard = self.state.lock().await;
            guard.server_version = None;
            guard.server_banner = None;
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

    fn connect_config(
        config: &ConnectionConfig,
        timeout_secs: u64,
    ) -> Result<OracleConfig, AppError> {
        let host = config.host.trim();
        let service_name = config.database.trim();
        let username = config.user.trim();

        if host.is_empty() {
            return Err(AppError::Validation("Oracle host is required".into()));
        }
        if service_name.is_empty() {
            return Err(AppError::Validation(
                "Oracle service name is required".into(),
            ));
        }
        if username.is_empty() {
            return Err(AppError::Validation("Oracle user is required".into()));
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
        oracle_unsupported()
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        oracle_unsupported()
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        oracle_unsupported()
    }

    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        oracle_unsupported()
    }

    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        oracle_unsupported()
    }

    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        oracle_unsupported()
    }

    fn execute_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        oracle_unsupported()
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        oracle_unsupported()
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _page: i32,
        _page_size: i32,
        _order_by: Option<&'a str>,
        _filters: Option<&'a [crate::models::FilterCondition]>,
        _raw_where: Option<&'a str>,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        oracle_unsupported()
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_unsupported()
    }

    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        oracle_unsupported()
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        oracle_unsupported()
    }

    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        oracle_unsupported()
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        oracle_unsupported()
    }

    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        oracle_unsupported()
    }

    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        oracle_unsupported()
    }

    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        oracle_unsupported()
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        oracle_unsupported()
    }

    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        oracle_unsupported()
    }
}

fn connection_timeout_secs(config: &ConnectionConfig) -> u64 {
    (config
        .connection_timeout
        .unwrap_or(ORACLE_CONNECT_TIMEOUT_DEFAULT_SECS) as u64)
        .min(ORACLE_CONNECT_TIMEOUT_MAX_SECS)
}

fn map_oracle_connection_error(error: oracle_rs::Error) -> AppError {
    AppError::Connection(error.to_string())
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn oracle_unsupported<'a, T: Send + 'a>() -> BoxFuture<'a, Result<T, AppError>> {
    Box::pin(async {
        Err(AppError::Unsupported(
            ORACLE_UNSUPPORTED_RUNTIME.to_string(),
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};
    use oracle_rs::config::ServiceMethod;

    fn oracle_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "oracle-1".into(),
            name: "Oracle".into(),
            db_type: DatabaseType::Oracle,
            host: " localhost ".into(),
            port: 1521,
            user: " testuser ".into(),
            password: "testpass".into(),
            database: " XEPDB1 ".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: Some(120),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    fn assert_oracle_unsupported<T>(result: Result<T, AppError>) {
        assert!(matches!(
            result,
            Err(AppError::Unsupported(message)) if message == ORACLE_UNSUPPORTED_RUNTIME
        ));
    }

    #[test]
    fn connect_config_uses_service_name_without_sid_wallet_or_tls() {
        let config = OracleAdapter::connect_config(&oracle_config(), 30).unwrap();

        assert_eq!(config.host, "localhost");
        assert_eq!(config.port, 1521);
        assert_eq!(config.username, "testuser");
        assert_eq!(config.connect_timeout, Duration::from_secs(30));
        assert!(!config.is_tls_enabled());
        assert!(config.tls_config.is_none());
        assert!(matches!(
            config.service,
            ServiceMethod::ServiceName(ref service) if service == "XEPDB1"
        ));
    }

    #[test]
    fn connect_config_rejects_empty_service_name() {
        let mut config = oracle_config();
        config.database = " ".into();

        assert!(matches!(
            OracleAdapter::connect_config(&config, 5),
            Err(AppError::Validation(message)) if message.contains("service name")
        ));
    }

    #[test]
    fn configured_timeout_is_clamped_for_runtime_connect() {
        assert_eq!(connection_timeout_secs(&oracle_config()), 30);

        let mut config = oracle_config();
        config.connection_timeout = Some(2);
        assert_eq!(connection_timeout_secs(&config), 2);
    }

    #[tokio::test]
    async fn catalog_query_and_ddl_surfaces_remain_unsupported() {
        let adapter = OracleAdapter::new();
        assert!(matches!(adapter.namespace_label(), NamespaceLabel::Schema));

        let drop_table = DropTableRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            cascade: false,
            preview_only: true,
            expected_database: None,
        };
        let rename_table = RenameTableRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            new_name: "T2".into(),
            preview_only: true,
            expected_database: None,
        };
        let alter_table = AlterTableRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            changes: vec![ColumnChange::Drop { name: "C".into() }],
            preview_only: true,
            expected_database: None,
        };
        let column = ColumnDefinition {
            name: "C".into(),
            data_type: "NUMBER".into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_identity: false,
        };
        let add_column = AddColumnRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            column: column.clone(),
            check_expression: None,
            preview_only: true,
            expected_database: None,
        };
        let drop_column = DropColumnRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            column_name: "C".into(),
            cascade: false,
            preview_only: true,
            expected_database: None,
        };
        let create_table = CreateTableRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            name: "T".into(),
            columns: vec![column],
            primary_key: None,
            preview_only: true,
            table_comment: None,
            expected_database: None,
        };
        let create_index = CreateIndexRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            index_name: "T_C_IDX".into(),
            columns: vec!["C".into()],
            index_type: "btree".into(),
            is_unique: false,
            preview_only: true,
            expected_database: None,
        };
        let drop_index = DropIndexRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            index_name: "T_C_IDX".into(),
            table: "T".into(),
            if_exists: false,
            preview_only: true,
            expected_database: None,
        };
        let add_constraint = AddConstraintRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            constraint_name: "T_C_UNIQ".into(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["C".into()],
            },
            preview_only: true,
            expected_database: None,
        };
        let drop_constraint = DropConstraintRequest {
            connection_id: "oracle-1".into(),
            schema: "SYSTEM".into(),
            table: "T".into(),
            constraint_name: "T_C_UNIQ".into(),
            preview_only: true,
            expected_database: None,
        };

        assert_oracle_unsupported(adapter.list_namespaces().await);
        assert_oracle_unsupported(adapter.list_databases().await);
        assert_oracle_unsupported(adapter.current_database().await);
        assert_oracle_unsupported(adapter.list_tables("SYSTEM").await);
        assert_oracle_unsupported(adapter.get_columns("SYSTEM", "T", None).await);
        assert_oracle_unsupported(adapter.execute_sql("SELECT 1 FROM DUAL", None).await);
        assert_oracle_unsupported(adapter.execute_sql_batch(&["SELECT 1".into()], None).await);
        assert_oracle_unsupported(adapter.dry_run_sql_batch(&["SELECT 1".into()], None).await);
        assert_oracle_unsupported(
            adapter
                .query_table_data("SYSTEM", "T", 1, 100, None, None, None, None)
                .await,
        );
        assert_oracle_unsupported(adapter.drop_table(&drop_table).await);
        assert_oracle_unsupported(adapter.rename_table(&rename_table).await);
        assert_oracle_unsupported(adapter.alter_table(&alter_table).await);
        assert_oracle_unsupported(adapter.add_column(&add_column).await);
        assert_oracle_unsupported(adapter.drop_column(&drop_column).await);
        assert_oracle_unsupported(adapter.create_table(&create_table).await);
        assert_oracle_unsupported(adapter.create_index(&create_index).await);
        assert_oracle_unsupported(adapter.drop_index(&drop_index).await);
        assert_oracle_unsupported(adapter.add_constraint(&add_constraint).await);
        assert_oracle_unsupported(adapter.drop_constraint(&drop_constraint).await);
        assert_oracle_unsupported(adapter.get_table_indexes("SYSTEM", "T", None).await);
        assert_oracle_unsupported(adapter.get_table_constraints("SYSTEM", "T", None).await);
        assert_oracle_unsupported(adapter.list_views("SYSTEM").await);
        assert_oracle_unsupported(adapter.list_functions("SYSTEM").await);
        assert_oracle_unsupported(adapter.get_view_definition("SYSTEM", "V").await);
        assert_oracle_unsupported(adapter.get_view_columns("SYSTEM", "V").await);
        assert_oracle_unsupported(adapter.list_schema_columns("SYSTEM").await);
        assert_oracle_unsupported(adapter.get_function_source("SYSTEM", "F").await);
        assert_oracle_unsupported(adapter.list_triggers("SYSTEM", "T").await);
    }
}
