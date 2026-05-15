//! PostgreSQL adapter — Sprint 202 split (4-way module reorg).
//!
//! Pre-split the entire adapter lived in a 3803-line `db/postgres.rs`.
//! Sprint 202 carved that into four topic files mirroring the Sprint 197
//! `db/mongodb.rs` pattern:
//!
//! * [`connection`] — `PostgresAdapter` struct + `PgPoolState` + connection
//!   lifecycle (`new` / `test` / `connect_pool` / `disconnect_pool` /
//!   `switch_active_db` / `current_database` / `ping`) + LRU sub-pool
//!   eviction (Sprint 130) + `is_pg_database_permission_denied` helper.
//! * [`schema`] — schema introspection (`list_schemas` / `list_tables` /
//!   `get_table_columns` / `list_schema_columns` / `get_table_indexes` /
//!   `get_table_constraints` / `list_views` / `list_functions` /
//!   `get_view_columns` / `get_view_definition` / `get_function_source` /
//!   `list_databases`) + `format_fk_reference` wire-format helper.
//! * [`queries`] — free-form SQL execution (`execute` / `execute_query` /
//!   `execute_query_batch`) + table-row paging (`query_table_data`) +
//!   server-side cursor streaming (`stream_table_rows`) + SQL normalization
//!   helpers (`strip_leading_comments` / `strip_trailing_terminator` /
//!   `pg_cast_type`).
//! * [`mutations`] — DDL paths (`drop_table` / `rename_table` / `alter_table` /
//!   `create_index` / `drop_index` / `add_constraint` / `drop_constraint`)
//!   plus identifier validation/quoting helpers (`validate_identifier` /
//!   `quote_identifier` / `qualified_table`).
//!
//! ## Trait dispatch pattern
//!
//! Sub-files define inherent methods on `PostgresAdapter` directly (preserved
//! `pub async fn` visibility — `commands/connection.rs` calls
//! `PostgresAdapter::test` / `::new` directly so we cannot rename to
//! `_impl` like Sprint 197 did for Mongo). This entry holds the single
//! `impl DbAdapter` / `impl RdbAdapter` blocks which wrap each inherent
//! method in `Pin<Box<dyn Future>>` + `tokio::select!` (cancel-token
//! cooperation, ADR-0018) and delegate. Behavior is identical to the
//! pre-split monolith — the split is module-organisational only.

mod category;
mod connection;
mod mutations;
mod queries;
mod schema;

pub use connection::PostgresAdapter;
// Sprint 237 — `validate_identifier` is the shared SQL-identifier guard
// (NAMEDATALEN-63 byte limit + `[a-zA-Z_][a-zA-Z0-9_]*`). The
// `count_null_rows` Tauri command in `commands/rdb/query.rs` reuses
// the same body to defang injection on its raw-SQL interpolation path.
// Hoisting the re-export here keeps `mutations` itself private while
// letting cross-module callers share one validator.
pub(crate) use mutations::validate_identifier;

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, CreateTriggerRequest, DatabaseType,
    DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest,
    DropTriggerRequest, FilterCondition, FunctionInfo, IndexInfo, PostgresTypeInfo,
    RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

impl DbAdapter for PostgresAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Postgresql
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
        Box::pin(async move { PostgresAdapter::ping(self).await })
    }
}

impl RdbAdapter for PostgresAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let schemas = self.list_schemas().await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    fn list_databases<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let dbs = PostgresAdapter::list_databases(self).await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    /// Sprint 130 — delegates to the inherent `switch_active_db` so the
    /// trait dispatcher can drive PG sub-pool swaps from the unified
    /// `switch_active_db` Tauri command.
    fn switch_database<'a>(
        &'a self,
        db_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.switch_active_db(db_name).await })
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
        // Concrete signature is `(table, schema)`; trait passes `(namespace, table)`.
        // Sprint 180 (AC-180-04): cooperate with cancellation. The pattern
        // mirrors `execute_query` — race the inherent future against the
        // token's `cancelled()` future and propagate the same
        // `AppError::Database("Operation cancelled")` shape used at
        // `postgres.rs:541`.
        Box::pin(async move {
            let work = self.get_table_columns(table, namespace);
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
        // Sprint 247 — delegate to the inherent `dry_run_query_batch`
        // (BEGIN → execute statements → ROLLBACK).
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
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.query_table_data(
                table, namespace, page, page_size, order_by, filters, raw_where,
            );
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 235 — request-shaped delegate. Concrete inherent
        // method already takes `&DropTableRequest`.
        Box::pin(async move { self.drop_table(req).await })
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 235 — request-shaped delegate.
        Box::pin(async move { self.rename_table(req).await })
    }

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.alter_table(req).await })
    }

    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 236 — request-shaped delegate.
        Box::pin(async move { self.add_column(req).await })
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 236 — request-shaped delegate.
        Box::pin(async move { self.drop_column(req).await })
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.create_table(req).await })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.create_index(req).await })
    }

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_index(req).await })
    }

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.add_constraint(req).await })
    }

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_constraint(req).await })
    }

    fn create_trigger<'a>(
        &'a self,
        req: &'a CreateTriggerRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 273 — request-shaped delegate. Concrete inherent method
        // already takes `&CreateTriggerRequest` and branches on
        // `preview_only` for preview-vs-execute.
        Box::pin(async move { self.create_trigger(req).await })
    }

    fn drop_trigger<'a>(
        &'a self,
        req: &'a DropTriggerRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        // Sprint 274 — request-shaped delegate. Concrete inherent method
        // already takes `&DropTriggerRequest` and branches on
        // `preview_only` for preview-vs-execute.
        Box::pin(async move { self.drop_trigger(req).await })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`.
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.get_table_indexes(table, namespace);
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
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>> {
        // Concrete signature is `(table, schema)`.
        // Sprint 180 (AC-180-04): cancel-token cooperation.
        Box::pin(async move {
            let work = self.get_table_constraints(table, namespace);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    fn stream_table_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        batch_size: u32,
        column_names: &'a [String],
        sender: tokio::sync::mpsc::Sender<Vec<Vec<serde_json::Value>>>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<u64, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.stream_table_rows(namespace, table, batch_size, column_names, sender, cancel)
                .await
        })
    }

    /// Sprint 237 — delegate to the inherent `count_null_rows` so the
    /// command handler can dispatch through the trait. Identifiers are
    /// validated inside the inherent method; the trait surface stays
    /// dialect-agnostic.
    fn count_null_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        column: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<i64, AppError>> + Send + 'a>> {
        Box::pin(async move { self.count_null_rows(namespace, table, column).await })
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_views(namespace).await })
    }

    fn list_functions<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<FunctionInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_functions(namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_view_definition(namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_view_columns(namespace, view).await })
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
        namespace: &'a str,
        function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { self.get_function_source(namespace, function).await })
    }

    /// Sprint 272 — delegate to the inherent `list_triggers` so the
    /// trait dispatcher can drive the new `list_triggers` Tauri command
    /// without the command site having to downcast to `PostgresAdapter`.
    fn list_triggers<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TriggerInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_triggers(namespace, table).await })
    }

    /// Sprint 272 — delegate to the inherent `get_trigger_source` so the
    /// `get_trigger_source` Tauri command can dispatch through the trait.
    fn get_trigger_source<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        trigger_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.get_trigger_source(namespace, table, trigger_name)
                .await
        })
    }

    /// Sprint 230 — delegate to the inherent `list_types` so the trait
    /// dispatcher can drive the new `list_postgres_types` Tauri command
    /// without the command site having to downcast to `PostgresAdapter`.
    fn list_types<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<PostgresTypeInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_types().await })
    }

    fn create_database<'a>(
        &'a self,
        name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.create_database(name).await })
    }

    fn drop_database<'a>(
        &'a self,
        name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_database(name).await })
    }

    fn list_server_activity<'a>(
        &'a self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<crate::models::ServerActivityRow>, AppError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move { self.list_server_activity().await })
    }

    fn kill_session<'a>(
        &'a self,
        id: i64,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.kill_session(id).await })
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): trait dispatcher 본 파일은
    //! 30+ 메서드가 모두 PG pool 호출에 의존하므로 실 PG 없이는 거의
    //! 회수 불가. 그러나 paradigm tag (`kind`, `namespace_label`) 은
    //! sync 라 pool 없이 즉시 검증 가능 — 회수는 작지만 trait wiring
    //! 회귀(예: namespace_label 을 Database 로 잘못 바꾸는 PR)에 대한
    //! tripwire.
    use super::*;
    use crate::db::postgres::PostgresAdapter;

    #[test]
    fn kind_returns_postgresql_paradigm() {
        let a = PostgresAdapter::new();
        assert!(matches!(a.kind(), DatabaseType::Postgresql));
    }

    #[test]
    fn namespace_label_is_schema() {
        let a = PostgresAdapter::new();
        assert!(matches!(a.namespace_label(), NamespaceLabel::Schema));
    }
}
