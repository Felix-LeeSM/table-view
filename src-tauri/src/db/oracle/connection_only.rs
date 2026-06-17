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

pub struct OracleRuntimeAdapter {
    inner: OracleAdapter,
}

impl OracleRuntimeAdapter {
    pub fn new() -> Self {
        Self {
            inner: OracleAdapter::new(),
        }
    }
}

impl Default for OracleRuntimeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DbAdapter for OracleRuntimeAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Oracle
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        DbAdapter::connect(&self.inner, config)
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        DbAdapter::disconnect(&self.inner)
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        DbAdapter::ping(&self.inner)
    }
}

impl RdbAdapter for OracleRuntimeAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        RdbAdapter::list_namespaces(&self.inner)
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        RdbAdapter::list_databases(&self.inner)
    }

    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        oracle_runtime_slice_unsupported("database switching")
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        RdbAdapter::current_database(&self.inner)
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        RdbAdapter::list_tables(&self.inner, namespace)
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        RdbAdapter::get_columns(&self.inner, namespace, table, cancel)
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        RdbAdapter::execute_sql(&self.inner, sql, cancel)
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        RdbAdapter::execute_sql_batch(&self.inner, statements, cancel)
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        RdbAdapter::dry_run_sql_batch(&self.inner, statements, cancel)
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
        RdbAdapter::query_table_data(
            &self.inner,
            namespace,
            table,
            page,
            page_size,
            order_by,
            filters,
            raw_where,
            cancel,
        )
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn create_table_plan<'a>(
        &'a self,
        _req: &'a CreateTablePlanRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        oracle_runtime_slice_unsupported("structured DDL")
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        RdbAdapter::get_table_indexes(&self.inner, namespace, table, cancel)
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        RdbAdapter::get_table_constraints(&self.inner, namespace, table, cancel)
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        RdbAdapter::list_views(&self.inner, namespace)
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        RdbAdapter::list_functions(&self.inner, namespace)
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        RdbAdapter::get_view_definition(&self.inner, namespace, view)
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        RdbAdapter::get_view_columns(&self.inner, namespace, view)
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        RdbAdapter::list_schema_columns(&self.inner, namespace)
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        oracle_runtime_slice_unsupported("PL/SQL body/package source")
    }

    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        oracle_runtime_slice_unsupported("trigger catalog")
    }
}

fn oracle_runtime_slice_unsupported<'a, T>(
    surface: &'static str,
) -> BoxFuture<'a, Result<T, AppError>>
where
    T: Send + 'a,
{
    Box::pin(async move {
        Err(AppError::Unsupported(
            format!(
                "Oracle {surface} is outside issue #905; supported runtime is limited to lifecycle, catalog metadata, SELECT/DML batch, cooperative cancel, and tabular table-data queries"
            ),
        ))
    })
}
