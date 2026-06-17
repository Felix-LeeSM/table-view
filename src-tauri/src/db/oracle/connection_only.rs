use std::collections::HashMap;

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTablePlanRequest, CreateTableRequest, DatabaseType,
    DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest, FunctionInfo,
    IndexInfo, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::OracleAdapter;
use crate::db::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

pub struct OracleConnectionOnlyAdapter {
    inner: OracleAdapter,
}

impl OracleConnectionOnlyAdapter {
    pub fn new() -> Self {
        Self {
            inner: OracleAdapter::new(),
        }
    }
}

impl Default for OracleConnectionOnlyAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DbAdapter for OracleConnectionOnlyAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Oracle
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

impl RdbAdapter for OracleConnectionOnlyAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        oracle_connection_only_unsupported()
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_tables<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn execute_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        oracle_connection_only_unsupported()
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
        oracle_connection_only_unsupported()
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn create_table_plan<'a>(
        &'a self,
        _req: &'a CreateTablePlanRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        oracle_connection_only_unsupported()
    }

    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        oracle_connection_only_unsupported()
    }
}

fn oracle_connection_only_unsupported<'a, T>() -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async {
        Err(AppError::Unsupported(
            "Oracle supports connection test, connect, and ping only in issue #904; query/catalog/edit/DDL/PLSQL runtime is unsupported".into(),
        ))
    })
}
