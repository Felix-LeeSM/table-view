use std::collections::HashMap;

use tokio_util::sync::CancellationToken;

use crate::db::{BoxFuture, DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, FunctionInfo,
    IndexInfo, QueryResult, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
};

use super::OracleAdapter;

impl Default for OracleAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DbAdapter for OracleAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Oracle
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

#[allow(clippy::too_many_arguments)]
impl RdbAdapter for OracleAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move { self.list_namespaces_impl().await })
    }

    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move { self.current_database_impl().await })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move { self.list_tables_impl(namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move { self.get_columns_impl(namespace, table, cancel).await })
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move { self.execute_sql_impl(sql, cancel).await })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move { self.execute_sql_batch_impl(statements, cancel).await })
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<QueryResult>, AppError>> {
        Box::pin(async move { self.dry_run_sql_batch_impl(statements, cancel).await })
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
            self.query_table_data_impl(
                namespace, table, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.drop_table_impl(req).await })
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.rename_table_impl(req).await })
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.alter_table_impl(req).await })
    }

    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.add_column_impl(req).await })
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.drop_column_impl(req).await })
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.create_table_impl(req).await })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.create_index_impl(req).await })
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.drop_index_impl(req).await })
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.add_constraint_impl(req).await })
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move { self.drop_constraint_impl(req).await })
    }

    fn count_null_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        column: &'a str,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move { self.count_null_rows_impl(namespace, table, column).await })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        Box::pin(async move { self.get_table_indexes_impl(namespace, table, cancel).await })
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        Box::pin(async move {
            self.get_table_constraints_impl(namespace, table, cancel)
                .await
        })
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async move { self.list_views_impl(namespace).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async move { self.list_functions_impl(namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { self.get_view_definition_impl(namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move { self.get_view_columns_impl(namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async move { self.list_schema_columns_impl(namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move { self.get_function_source_impl(namespace, function).await })
    }
}
