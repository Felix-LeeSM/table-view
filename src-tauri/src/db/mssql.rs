mod catalog;
mod runtime;

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
    IndexInfo, QueryResult, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
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
        Box::pin(async move {
            let work = MssqlAdapter::get_table_columns(self, namespace, table);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move { self.execute_query(sql, cancel).await })
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
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        Box::pin(async move {
            let work = MssqlAdapter::get_table_indexes(self, namespace, table);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        Box::pin(async move {
            let work = MssqlAdapter::get_table_constraints(self, namespace, table);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
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

fn unsupported<'a, T>() -> BoxFuture<'a, Result<T, AppError>> {
    Box::pin(async {
        Err(AppError::Unsupported(
            "SQL Server edit/table-data/admin support is not implemented in this metadata slice"
                .into(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{DbAdapter, RdbAdapter};
    use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};

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
    async fn pre_cancelled_query_short_circuits_before_connection_lookup() {
        let adapter = MssqlAdapter::new();
        let cancel = CancellationToken::new();
        cancel.cancel();

        let err = adapter
            .execute_sql("SELECT 1", Some(&cancel))
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));
    }

    #[tokio::test]
    async fn catalog_surfaces_fail_locally_without_open_connection() {
        let adapter = MssqlAdapter::new();

        assert_not_open(RdbAdapter::list_namespaces(&adapter).await);
        assert_not_open(RdbAdapter::list_databases(&adapter).await);
        assert_not_open(RdbAdapter::switch_database(&adapter, "master").await);
        assert_not_open(RdbAdapter::current_database(&adapter).await);
        assert_not_open(RdbAdapter::list_tables(&adapter, "dbo").await);
        assert_not_open(RdbAdapter::get_columns(&adapter, "dbo", "users", None).await);
        assert_not_open(RdbAdapter::get_table_indexes(&adapter, "dbo", "users", None).await);
        assert_not_open(RdbAdapter::get_table_constraints(&adapter, "dbo", "users", None).await);
        assert_not_open(RdbAdapter::list_views(&adapter, "dbo").await);
        assert_not_open(RdbAdapter::get_view_definition(&adapter, "dbo", "active_users").await);
        assert_not_open(RdbAdapter::get_view_columns(&adapter, "dbo", "active_users").await);
        assert_not_open(RdbAdapter::list_schema_columns(&adapter, "dbo").await);
        assert_not_open(RdbAdapter::list_functions(&adapter, "dbo").await);
        assert_not_open(RdbAdapter::get_function_source(&adapter, "dbo", "touch_user").await);

        let err = RdbAdapter::switch_database(&adapter, " ")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(message) if message.contains("database name")));
    }

    #[tokio::test]
    async fn table_data_and_edit_surfaces_stay_explicitly_unsupported() {
        let adapter = MssqlAdapter::new();

        assert_unsupported(
            adapter
                .query_table_data("dbo", "users", 1, 25, None, None, None, None)
                .await,
        );

        let column = ColumnDefinition {
            name: "id".into(),
            data_type: "int".into(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        };
        let drop_table = DropTableRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            cascade: false,
            preview_only: false,
            expected_database: None,
        };
        let rename_table = RenameTableRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            new_name: "people".into(),
            preview_only: false,
            expected_database: None,
        };
        let alter_table = AlterTableRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            changes: vec![ColumnChange::Drop { name: "old".into() }],
            preview_only: false,
            expected_database: None,
        };
        let add_column = AddColumnRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            column: column.clone(),
            check_expression: None,
            preview_only: false,
            expected_database: None,
        };
        let drop_column = DropColumnRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            column_name: "old".into(),
            cascade: false,
            preview_only: false,
            expected_database: None,
        };
        let create_table = CreateTableRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            name: "users".into(),
            columns: vec![column],
            primary_key: None,
            preview_only: false,
            table_comment: None,
            expected_database: None,
        };
        let create_index = CreateIndexRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            index_name: "idx_users_id".into(),
            columns: vec!["id".into()],
            index_type: "btree".into(),
            is_unique: false,
            preview_only: false,
            expected_database: None,
        };
        let drop_index = DropIndexRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            index_name: "idx_users_id".into(),
            table: "users".into(),
            if_exists: false,
            preview_only: false,
            expected_database: None,
        };
        let add_constraint = AddConstraintRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            constraint_name: "pk_users".into(),
            definition: ConstraintDefinition::PrimaryKey {
                columns: vec!["id".into()],
            },
            preview_only: false,
            expected_database: None,
        };
        let drop_constraint = DropConstraintRequest {
            connection_id: "conn".into(),
            schema: "dbo".into(),
            table: "users".into(),
            constraint_name: "pk_users".into(),
            preview_only: false,
            expected_database: None,
        };

        assert_unsupported(adapter.drop_table(&drop_table).await);
        assert_unsupported(adapter.rename_table(&rename_table).await);
        assert_unsupported(adapter.alter_table(&alter_table).await);
        assert_unsupported(adapter.add_column(&add_column).await);
        assert_unsupported(adapter.drop_column(&drop_column).await);
        assert_unsupported(adapter.create_table(&create_table).await);
        assert_unsupported(adapter.create_index(&create_index).await);
        assert_unsupported(adapter.drop_index(&drop_index).await);
        assert_unsupported(adapter.add_constraint(&add_constraint).await);
        assert_unsupported(adapter.drop_constraint(&drop_constraint).await);
    }

    fn assert_unsupported<T>(result: Result<T, AppError>) {
        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("not implemented"))
        );
    }

    fn assert_not_open<T>(result: Result<T, AppError>) {
        assert!(
            matches!(result, Err(AppError::Connection(message)) if message.contains("not open"))
        );
    }
}
