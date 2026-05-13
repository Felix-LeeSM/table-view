//! MySQL adapter — Sprint 281 (Phase 17 Slice A).
//!
//! 진입 모듈. PG (`db/postgres.rs`) 와 동일한 entry pattern:
//! - `connection` — `MysqlAdapter` struct + `MySqlPool` lifecycle.
//! - `schema` — namespace / table / column introspection (Slice A).
//! - 후속 sub-file (`queries`, `mutations`) 는 Phase 17 의 다음 slice 에서.
//!
//! 현재 surface = `MysqlAdapter` + `DbAdapter` impl (4 method) +
//! `RdbAdapter` impl 의 read path 4 method (namespace_label /
//! list_namespaces / list_tables / get_columns). 나머지 required
//! method (DDL / queries / streaming / views / triggers) 는 dialect-
//! correct 구현이 도착하기 전까지 `AppError::Unsupported` 로 friendly
//! reject — Slice B~G 가 점진 채운다.

mod connection;
mod schema;

pub use connection::MysqlAdapter;

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, FunctionInfo,
    IndexInfo, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
};

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

impl DbAdapter for MysqlAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mysql
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
}

/// Slice 별 채워질 예정인 method 들의 placeholder 메시지. 한 곳에 모아
/// 두면 sprint 번호 / 메시지 톤을 일관 유지하기 쉽다.
fn unsupported_slice(slice: &str, op: &str) -> AppError {
    AppError::Unsupported(format!(
        "MySQL adapter: {op} is not yet implemented (Phase 17 {slice})"
    ))
}

impl RdbAdapter for MysqlAdapter {
    /// MySQL 은 database 가 곧 namespace — sidebar 그룹 라벨이 'Database'
    /// 로 렌더되도록 PG 의 'Schema' 와 분기.
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Database
    }

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let schemas = self.list_schemas().await?;
            Ok(schemas.into_iter().map(NamespaceInfo::from).collect())
        })
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
        // PG 패턴 답습 (Sprint 180 AC-180-04): work future 를 cancel token
        // 과 race 시켜 동일한 `Operation cancelled` 에러 shape 으로 정렬.
        // table 인자 순서는 inherent `get_table_columns(table, schema)`
        // 와 trait `get_columns(namespace, table)` 가 반대 — 명시적 매핑.
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

    // ── Slice B (Sprint 282) — query path ────────────────────────────
    fn execute_sql<'a>(
        &'a self,
        _sql: &'a str,
        _cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice B", "execute_sql")) })
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _page: i32,
        _page_size: i32,
        _order_by: Option<&'a str>,
        _filters: Option<&'a [FilterCondition]>,
        _raw_where: Option<&'a str>,
        _cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice B", "query_table_data")) })
    }

    // ── Slice D (Sprint 284) — DDL ───────────────────────────────────
    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "drop_table")) })
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "rename_table")) })
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "alter_table")) })
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "add_column")) })
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "drop_column")) })
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice D", "create_table")) })
    }

    // ── Slice E (Sprint 285) — indexes / constraints ─────────────────
    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice E", "create_index")) })
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice E", "drop_index")) })
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice E", "add_constraint")) })
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice E", "drop_constraint")) })
    }

    fn get_table_indexes<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
        // Slice A 단계에선 sidebar 가 index 노드를 펼칠 때 friendly 한
        // 빈 결과를 보이도록 `Ok(empty)` 로 처리. Slice E 에서 실 구현.
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn get_table_constraints<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>> {
        // 동일하게 Slice A 에선 빈 결과 — table inspector 가 깨지지 않게.
        Box::pin(async move { Ok(Vec::new()) })
    }

    // ── Slice F (Sprint 286) — views / functions ────────────────────
    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<FunctionInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn get_view_definition<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice F", "get_view_definition")) })
    }

    fn get_view_columns<'a>(
        &'a self,
        _namespace: &'a str,
        _view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice F", "get_view_columns")) })
    }

    fn list_schema_columns<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>,
                > + Send
                + 'a,
        >,
    > {
        // Sprint 287 (Slice G) — schema-wide column dump (frontend
        // schema overview). Slice A 에선 빈 map 으로 graceful degrade.
        Box::pin(async move { Ok(std::collections::HashMap::new()) })
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { Err(unsupported_slice("Slice F", "get_function_source")) })
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-13, Sprint 281): DbAdapter / RdbAdapter trait 의
    //! sync method (`kind`, `namespace_label`) 와 Slice A 미구현 method 의
    //! placeholder 메시지가 사용자에게 보일 friendly copy 인지 회귀 가드.
    //! 실 DB 통합은 schema introspection unit test 가 `schema.rs` 에 있고,
    //! 본격 통합 테스트는 Slice B+ 에서 mysql_test_config opt-in 으로.
    use super::*;

    #[test]
    fn kind_returns_mysql_paradigm() {
        let a = MysqlAdapter::new();
        assert!(matches!(a.kind(), DatabaseType::Mysql));
    }

    #[test]
    fn namespace_label_is_database() {
        let a = MysqlAdapter::new();
        assert!(matches!(a.namespace_label(), NamespaceLabel::Database));
    }

    #[test]
    fn unsupported_slice_message_names_slice_and_op() {
        let err = unsupported_slice("Slice B", "execute_sql");
        let msg = err.to_string();
        assert!(msg.contains("Slice B"), "missing slice tag: {msg}");
        assert!(msg.contains("execute_sql"), "missing op name: {msg}");
        assert!(msg.contains("MySQL"), "missing dialect tag: {msg}");
    }
}
