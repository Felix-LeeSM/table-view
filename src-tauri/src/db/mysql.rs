//! MySQL/MariaDB adapter entrypoint.
//!
//! Sub-module layout (PG `db/postgres/*` 와 1:1):
//! - `connection` — `MysqlAdapter` struct + lifecycle + multi-DB sub-pool LRU.
//! - `queries` — `execute_query`, `query_table_data`, `stream_table_rows`,
//!   `count_null_rows` + cell decoder + raw_where validator.
//! - `schema` — namespace / table / column / index / constraint / view /
//!   function / trigger introspection.
//! - `mutations` — DDL family (drop / rename / alter table, add / drop
//!   column, create table, create / drop index, add / drop constraint) +
//!   identifier validators / quoting helpers.
//!
//! `create_trigger` / `drop_trigger` 는 PG-shaped request 와 MySQL trigger
//! body shape 이 달라 `Unsupported` reject 한다.

mod checks;
mod connection;
mod mutations;
mod queries;
mod schema;
mod version;

pub use connection::MysqlAdapter;

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, CreateTriggerRequest, DatabaseType,
    DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest,
    DropTriggerRequest, FilterCondition, FunctionInfo, IndexInfo, RenameTableRequest,
    SchemaChangeResult, TableData, TableInfo, TriggerInfo, ViewInfo,
};

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

impl DbAdapter for MysqlAdapter {
    fn kind(&self) -> DatabaseType {
        self.kind.clone()
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
        Box::pin(async move { MysqlAdapter::ping(self).await })
    }

    fn cancel_query<'a>(
        &'a self,
        server_pid: i64,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.cancel_query_native(server_pid).await })
    }
}

impl RdbAdapter for MysqlAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Database
    }

    /// Sprint 288 — MySQL 은 schema 개념이 없고 database = schema. PG 처럼
    /// 한 connection 안에서 여러 schema 트리를 보여주는 구조가 아니라,
    /// 현재 active DB 한 개만 namespace 로 노출해 sidebar 가 (DB → tables)
    /// 의 단일 hierarchy 로 그려지게 한다. 다른 DB 로의 전환은 별도
    /// `list_databases` + `switch_database` 경로 (sub-pool LRU) 가 담당.
    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            match self.current_database_name().await {
                Some(name) => Ok(vec![NamespaceInfo::from(crate::models::SchemaInfo {
                    name,
                })]),
                None => Ok(Vec::new()),
            }
        })
    }

    fn list_databases<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let dbs = self.list_databases().await?;
            Ok(dbs.into_iter().map(NamespaceInfo::from).collect())
        })
    }

    /// Sprint 287 (Slice G) — delegate to `switch_active_db` (sub-pool LRU).
    fn switch_database<'a>(
        &'a self,
        db_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.switch_active_db(db_name).await })
    }

    /// Sprint 287 — adapter 의 in-memory current_db 를 surface. PG 와 동일.
    fn current_database<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>, AppError>> + Send + 'a>> {
        Box::pin(async move { Ok(self.current_database_name().await) })
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

    /// Issue #1230 — capture `CONNECTION_ID()` on the executing connection so
    /// the frontend can fire `KILL QUERY <id>` against a long query.
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

    fn count_null_rows<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        column: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<i64, AppError>> + Send + 'a>> {
        Box::pin(async move { self.count_null_rows(namespace, table, column).await })
    }

    // ── Slice D (Sprint 284) — DDL ───────────────────────────────────
    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_table(req).await })
    }

    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
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
        Box::pin(async move { self.add_column(req).await })
    }

    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.drop_column(req).await })
    }

    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { self.create_table(req).await })
    }

    // ── Slice E (Sprint 285) — indexes / constraints ─────────────────
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

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
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

    // ── Slice F (Sprint 286) — views / functions / triggers ──────────
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

    fn list_triggers<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TriggerInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.list_triggers(namespace, table).await })
    }

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

    /// MySQL trigger 는 body 가 inline compound statement — PG
    /// `CreateTriggerRequest.function_name` 필드 의미가 없음. 본 어댑터에선
    /// raw SQL 사용을 권하고 dialog 차단 (frontend paradigm-aware 분기).
    fn create_trigger<'a>(
        &'a self,
        _req: &'a CreateTriggerRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            Err(AppError::Unsupported(
                "MySQL trigger creation is dialog-only via raw SQL (CREATE TRIGGER … FOR EACH ROW <body>)".into(),
            ))
        })
    }

    fn drop_trigger<'a>(
        &'a self,
        _req: &'a DropTriggerRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            Err(AppError::Unsupported(
                "MySQL trigger drop is available via raw SQL (DROP TRIGGER name)".into(),
            ))
        })
    }

    // ── Refs #1067 — DB lifecycle + EXPLAIN parity (PG 와 동일 delegate) ──
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

    fn explain_query<'a>(
        &'a self,
        sql: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, AppError>> + Send + 'a>> {
        Box::pin(async move { self.explain_query(sql).await })
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-13, Sprint 281 → 287 누적): trait dispatcher 본
    //! 파일은 대부분 inherent method 로 위임이므로 실 DB 의존 — 여기서는
    //! paradigm tag (`kind`, `namespace_label`) 와 trigger create/drop 의
    //! Unsupported reject copy 만 회귀 가드.
    use super::*;
    use crate::models::{CreateTriggerRequest, DropTriggerRequest};

    #[test]
    fn kind_returns_mysql_paradigm() {
        let a = MysqlAdapter::new();
        assert!(matches!(a.kind(), DatabaseType::Mysql));
    }

    #[test]
    fn kind_preserves_mariadb_when_constructed_for_mariadb() {
        let a = MysqlAdapter::new_mariadb();
        assert!(matches!(a.kind(), DatabaseType::Mariadb));
    }

    #[test]
    fn namespace_label_is_database() {
        let a = MysqlAdapter::new();
        assert!(matches!(a.namespace_label(), NamespaceLabel::Database));
    }

    /// 작성 이유 (2026-05-13, Sprint 288): MySQL list_namespaces 가 모든
    /// schema (= DB) 를 노출하던 회귀 — 사용자가 "한번에 3개 schema 가
    /// 다 뜬다" 고 컴플레인 한 직후 PG 의 (DB → schemas-of-current-DB
    /// → tables) 와 1:1 로 맞추기 위해 current DB 만 namespace 로 surface
    /// 하도록 수정. disconnect 상태에선 빈 Vec 을 반환해 frontend
    /// SchemaTree 가 "no namespaces" placeholder 를 표시한다.
    #[tokio::test]
    async fn list_namespaces_returns_empty_when_disconnected() {
        let a = MysqlAdapter::new();
        let ns = a.list_namespaces().await.unwrap();
        assert!(
            ns.is_empty(),
            "disconnected adapter must surface empty list"
        );
    }

    #[tokio::test]
    async fn create_trigger_rejects_with_clear_copy() {
        let a = MysqlAdapter::new();
        let req = CreateTriggerRequest {
            connection_id: "c".into(),
            schema: "s".into(),
            table: "t".into(),
            trigger_name: "tr".into(),
            timing: "BEFORE".into(),
            events: vec!["INSERT".into()],
            orientation: "ROW".into(),
            function_schema: "s".into(),
            function_name: "f".into(),
            function_arguments: None,
            when_expression: None,
            preview_only: true,
            expected_database: None,
        };
        let err = a.create_trigger(&req).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("MySQL"), "expect dialect tag: {msg}");
    }

    #[tokio::test]
    async fn drop_trigger_rejects_with_clear_copy() {
        let a = MysqlAdapter::new();
        let req = DropTriggerRequest {
            connection_id: "c".into(),
            schema: "s".into(),
            table: "t".into(),
            trigger_name: "tr".into(),
            cascade: false,
            preview_only: true,
            expected_database: None,
        };
        let err = a.drop_trigger(&req).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("MySQL"), "expect dialect tag: {msg}");
    }
}
