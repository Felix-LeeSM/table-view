use tiberius::{AuthMethod, Client, Config as TdsConfig, EncryptionLevel};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
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

mod catalog;
mod ddl;
mod query;
mod support;

#[cfg(test)]
mod tests;

use support::{mssql_error, validate_identifier};

pub struct MssqlAdapter {
    connected_config: Mutex<Option<ConnectionConfig>>,
}

impl MssqlAdapter {
    pub fn new() -> Self {
        Self {
            connected_config: Mutex::new(None),
        }
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let mut client = Self::connect_client(config).await?;
        let version_probe = client
            .simple_query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128))")
            .await
            .map_err(|err| mssql_error("SQL Server version probe failed", err))?;
        version_probe
            .into_results()
            .await
            .map_err(|err| mssql_error("SQL Server version probe failed", err))?;
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
        let tcp = TcpStream::connect(tds_config.get_addr())
            .await
            .map_err(|err| mssql_error("SQL Server network connection failed", err))?;
        tcp.set_nodelay(true)
            .map_err(|err| mssql_error("SQL Server TCP setup failed", err))?;
        Client::connect(tds_config, tcp.compat_write())
            .await
            .map_err(|err| mssql_error("SQL Server login failed", err))
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
            tds_config.encryption(EncryptionLevel::Off);
        }

        Ok(tds_config)
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
        self.list_namespaces_box()
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        self.list_databases_box()
    }

    fn switch_database<'a>(&'a self, db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            validate_identifier(db_name, "Database name")?;
            let mut next = self.connected_config().await?;
            next.database = db_name.trim().to_string();
            Self::test(&next).await?;
            let mut connected_config = self.connected_config.lock().await;
            *connected_config = Some(next);
            Ok(())
        })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        self.current_database_box()
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        self.list_tables_box(namespace)
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        self.get_columns_box(namespace, table, cancel)
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        self.execute_sql_box(sql, cancel)
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        self.execute_sql_batch_box(statements, cancel)
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        self.dry_run_sql_batch_box(statements, cancel)
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
        self.query_table_data_box(
            namespace, table, page, page_size, order_by, filters, raw_where, cancel,
        )
    }

    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.drop_table_box(req)
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.rename_table_box(req)
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.alter_table_box(req)
    }

    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.add_column_box(req)
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.drop_column_box(req)
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.create_table_box(req)
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.create_index_box(req)
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.drop_index_box(req)
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.add_constraint_box(req)
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        self.drop_constraint_box(req)
    }

    fn count_null_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        column: &'a str,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        self.count_null_rows_box(namespace, table, column)
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        self.get_table_indexes_box(namespace, table, cancel)
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        self.get_table_constraints_box(namespace, table, cancel)
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        self.list_views_box(namespace)
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        self.list_functions_box(namespace)
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        self.get_view_definition_box(namespace, view)
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        self.get_view_columns_box(namespace, view)
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>> {
        self.list_schema_columns_box(namespace)
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        self.get_function_source_box(namespace, function)
    }
}
