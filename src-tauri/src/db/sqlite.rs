//! SQLite adapter entrypoint.
//!
//! SQLite currently supports connection lifecycle, explicit file creation,
//! baseline catalog reads, table preview, single-statement query execution,
//! transactional batch execution, and dry-run. DDL, export, and richer
//! PostgreSQL parity surfaces remain explicit `Unsupported` until their
//! feature-order slices land.

mod batch;
mod connection;
mod queries;

pub use connection::SqliteAdapter;

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, IndexInfo,
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
};

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

fn sqlite_unsupported(feature: &str) -> AppError {
    AppError::Unsupported(format!("SQLite adapter does not support {feature} yet"))
}

impl DbAdapter for SqliteAdapter {
    fn kind(&self) -> crate::models::DatabaseType {
        crate::models::DatabaseType::Sqlite
    }

    fn connect<'a>(
        &'a self,
        config: &'a ConnectionConfig,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.connect_pool(config).await })
    }

    fn disconnect<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.disconnect_pool().await })
    }

    fn ping<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.ping().await })
    }
}

impl RdbAdapter for SqliteAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Single { name: "file" }
    }

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.require_connected().await?;
            Ok(vec![NamespaceInfo {
                name: "main".to_string(),
            }])
        })
    }

    fn current_database<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>, AppError>> + Send + 'a>> {
        Box::pin(async move { Ok(self.current_database_path().await) })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TableInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_tables(namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if let Some(token) = cancel {
                tokio::select! {
                    result = self.get_table_columns(namespace, table) => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                }
            } else {
                self.get_table_columns(namespace, table).await
            }
        })
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.execute_query(sql, cancel).await })
    }

    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RdbQueryResult>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RdbQueryResult>, AppError>> + Send + 'a>> {
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
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>> {
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
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("table drop")) })
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("table rename")) })
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("table alteration")) })
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("column creation")) })
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("column drop")) })
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("table creation")) })
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("index creation")) })
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("index drop")) })
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("constraint creation")) })
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("constraint drop")) })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if let Some(token) = cancel {
                tokio::select! {
                    result = SqliteAdapter::get_table_indexes(self, namespace, table) => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                }
            } else {
                SqliteAdapter::get_table_indexes(self, namespace, table).await
            }
        })
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { SqliteAdapter::list_views(self, namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { SqliteAdapter::get_view_definition(self, namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { SqliteAdapter::get_view_columns(self, namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move { self.list_schema_columns(namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async { Err(sqlite_unsupported("function source introspection")) })
    }
}
