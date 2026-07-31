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
mod value_search;

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
    DropTriggerRequest, FilterCondition, FunctionInfo, IndexInfo, PostgresExtensionInfo,
    PostgresTypeInfo, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo,
    ValueSearchResult, ViewInfo,
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

    fn cancel_query<'a>(
        &'a self,
        server_pid: i64,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.cancel_query_native(server_pid).await })
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
        Box::pin(async move {
            self.execute_query(sql, cancel, crate::db::row_cap::current())
                .await
        })
    }

    /// Issue #1230 — capture `pg_backend_pid()` on the executing connection
    /// so the frontend can fire `pg_cancel_backend` against a long query.
    fn execute_sql_tracked<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
        pid_tx: tokio::sync::oneshot::Sender<i64>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.execute_query_tracked(sql, cancel, crate::db::row_cap::current(), Some(pid_tx))
                .await
        })
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
        Box::pin(async move {
            self.query_table_data(
                table, namespace, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    /// Issue #1269 — capture `pg_backend_pid()` on the connection running the
    /// browse so the grid Stop button can fire `pg_cancel_backend` against a
    /// long table scan. Concrete signature is `(table, schema)`; trait passes
    /// `(namespace, table)`.
    #[allow(clippy::too_many_arguments)]
    fn query_table_data_tracked<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
        pid_tx: tokio::sync::oneshot::Sender<i64>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.query_table_data_tracked(
                table, namespace, page, page_size, order_by, filters, raw_where, cancel, pid_tx,
            )
            .await
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

    // Issue #1525 — read-only cross-table value search (PG-only feature).
    fn search_values<'a>(
        &'a self,
        schemas: &'a [String],
        term: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
        row_cap: usize,
    ) -> Pin<Box<dyn Future<Output = Result<ValueSearchResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.search_values(schemas, term, cancel, row_cap).await })
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

    fn list_extensions<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<PostgresExtensionInfo>, AppError>> + Send + 'a>>
    {
        Box::pin(async move { self.list_extensions().await })
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

    fn explain_query<'a>(
        &'a self,
        sql: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, AppError>> + Send + 'a>> {
        Box::pin(async move { self.explain_query(sql).await })
    }

    fn collection_stats<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<
        Box<dyn Future<Output = Result<crate::models::CollectionStatsRow, AppError>> + Send + 'a>,
    > {
        Box::pin(async move { self.collection_stats(namespace, table).await })
    }

    fn slow_queries<'a>(
        &'a self,
        limit: i64,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<crate::models::SlowQueryRow>, AppError>> + Send + 'a>>
    {
        Box::pin(async move { self.slow_queries(limit).await })
    }

    fn server_info<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<crate::models::ServerInfoRow, AppError>> + Send + 'a>>
    {
        Box::pin(async move { self.server_info().await })
    }

    fn list_database_users<'a>(
        &'a self,
    ) -> Pin<
        Box<dyn Future<Output = Result<Vec<crate::models::DatabaseUserRow>, AppError>> + Send + 'a>,
    > {
        Box::pin(async move { self.list_database_users().await })
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

    // 작성 이유 (2026-05-15, Sprint 339): RdbAdapter trait wrapper async
    // blocks for Sprint 337/338/339 (`explain_query`, `collection_stats`,
    // `server_info`) — exercised via UFCS so the wrapper body itself is
    // counted by the coverage instrumentation, not just the inherent
    // method. PostgresAdapter::new() has no pool so each wrapper bottoms
    // out in `active_pool()` → `Connection("Not connected")`.
    #[tokio::test]
    async fn trait_explain_query_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::explain_query(&a, "SELECT 1").await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }

    #[tokio::test]
    async fn trait_collection_stats_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::collection_stats(&a, "public", "users").await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }

    #[tokio::test]
    async fn trait_server_info_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::server_info(&a).await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }

    #[tokio::test]
    async fn trait_list_server_activity_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::list_server_activity(&a).await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }

    #[tokio::test]
    async fn trait_kill_session_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::kill_session(&a, 12345).await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }

    // 작성 이유 (2026-07-24, 이슈 #1625): 아래 24개 `..._without_connection_fails`
    // 는 `is_err()` 만 봐서 wrapper 가 *어떤* 에러로 실패했는지 무관 —
    // change-detector 라 wrapper 가 `Connection` 이 아닌 다른 에러로 퇴행해도
    // 통과했다. pool 없는 `PostgresAdapter` 의 모든 RdbAdapter wrapper 를 하나의
    // 테스트로 몰아 회수(wrapper future 는 UFCS 로 각각 별개 region → coverage
    // 동일)하되, 단언을 실 계약 `Connection("Not connected")` 로 강화한다.
    // `list_database_users` wrapper 는 이전에 테스트 부재였으나 여기서 함께
    // 회수해 production region coverage 를 넓힌다.

    /// pool 없는 wrapper future 가 공유 `Connection("Not connected")` 로
    /// short-circuit 하는지 단언. 예전 `is_err()` probe 를 typed variant +
    /// 메시지로 승격 — wrapper 가 다른 에러 kind (또는 `Ok`) 로 퇴행하면 fail.
    macro_rules! assert_not_connected {
        ($label:literal, $call:expr) => {
            match $call.await {
                Err(AppError::Connection(msg)) => assert!(
                    msg.contains("Not connected"),
                    "{}: expected 'Not connected', got: {msg}",
                    $label
                ),
                Err(e) => panic!("{}: expected Connection error, got: {e:?}", $label),
                Ok(_) => panic!("{}: expected Connection error, got Ok", $label),
            }
        };
    }

    #[tokio::test]
    async fn trait_rdb_wrappers_without_connection_return_not_connected() {
        let a = PostgresAdapter::new();
        let stmts = vec!["SELECT 1".to_string()];
        assert_not_connected!(
            "list_namespaces",
            <PostgresAdapter as RdbAdapter>::list_namespaces(&a)
        );
        assert_not_connected!(
            "list_databases",
            <PostgresAdapter as RdbAdapter>::list_databases(&a)
        );
        assert_not_connected!(
            "switch_database",
            <PostgresAdapter as RdbAdapter>::switch_database(&a, "any")
        );
        assert_not_connected!(
            "list_tables",
            <PostgresAdapter as RdbAdapter>::list_tables(&a, "public")
        );
        assert_not_connected!(
            "get_columns",
            <PostgresAdapter as RdbAdapter>::get_columns(&a, "public", "users", None)
        );
        assert_not_connected!(
            "execute_sql",
            <PostgresAdapter as RdbAdapter>::execute_sql(&a, "SELECT 1", None)
        );
        assert_not_connected!(
            "execute_sql_batch",
            <PostgresAdapter as RdbAdapter>::execute_sql_batch(&a, &stmts, None)
        );
        assert_not_connected!(
            "dry_run_sql_batch",
            <PostgresAdapter as RdbAdapter>::dry_run_sql_batch(&a, &stmts, None)
        );
        assert_not_connected!(
            "query_table_data",
            <PostgresAdapter as RdbAdapter>::query_table_data(
                &a, "public", "users", 1, 10, None, None, None, None
            )
        );
        assert_not_connected!(
            "get_table_indexes",
            <PostgresAdapter as RdbAdapter>::get_table_indexes(&a, "public", "users", None)
        );
        assert_not_connected!(
            "get_table_constraints",
            <PostgresAdapter as RdbAdapter>::get_table_constraints(&a, "public", "users", None)
        );
        assert_not_connected!(
            "count_null_rows",
            <PostgresAdapter as RdbAdapter>::count_null_rows(&a, "public", "users", "col")
        );
        assert_not_connected!(
            "list_views",
            <PostgresAdapter as RdbAdapter>::list_views(&a, "public")
        );
        assert_not_connected!(
            "list_functions",
            <PostgresAdapter as RdbAdapter>::list_functions(&a, "public")
        );
        assert_not_connected!(
            "get_view_definition",
            <PostgresAdapter as RdbAdapter>::get_view_definition(&a, "public", "v")
        );
        assert_not_connected!(
            "get_view_columns",
            <PostgresAdapter as RdbAdapter>::get_view_columns(&a, "public", "v")
        );
        assert_not_connected!(
            "list_schema_columns",
            <PostgresAdapter as RdbAdapter>::list_schema_columns(&a, "public")
        );
        assert_not_connected!(
            "get_function_source",
            <PostgresAdapter as RdbAdapter>::get_function_source(&a, "public", "f")
        );
        assert_not_connected!(
            "list_triggers",
            <PostgresAdapter as RdbAdapter>::list_triggers(&a, "public", "users")
        );
        assert_not_connected!(
            "get_trigger_source",
            <PostgresAdapter as RdbAdapter>::get_trigger_source(&a, "public", "users", "trg")
        );
        assert_not_connected!(
            "list_types",
            <PostgresAdapter as RdbAdapter>::list_types(&a)
        );
        assert_not_connected!(
            "list_extensions",
            <PostgresAdapter as RdbAdapter>::list_extensions(&a)
        );
        assert_not_connected!(
            "create_database",
            <PostgresAdapter as RdbAdapter>::create_database(&a, "newdb")
        );
        assert_not_connected!(
            "drop_database",
            <PostgresAdapter as RdbAdapter>::drop_database(&a, "olddb")
        );
        assert_not_connected!(
            "list_database_users",
            <PostgresAdapter as RdbAdapter>::list_database_users(&a)
        );
    }

    // Sprint 340 (U5 live wire) — slow_queries trait wrapper.
    #[tokio::test]
    async fn trait_slow_queries_without_connection_fails() {
        let a = PostgresAdapter::new();
        let r = <PostgresAdapter as RdbAdapter>::slow_queries(&a, 10).await;
        assert!(matches!(r, Err(AppError::Connection(_))));
    }
}
