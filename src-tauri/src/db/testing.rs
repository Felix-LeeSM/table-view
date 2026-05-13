#![allow(dead_code)]
#![allow(clippy::type_complexity)]
//! 작성 이유 (2026-05-08): commands/rdb/{ddl,schema,query} 와 commands/meta
//! 의 dispatch 테스트가 각자 RdbAdapter / DocumentAdapter stub 을 inline 으로
//! 정의해 ~30 trait method × 3 파일 = ~90 dead method 가 coverage 분모에
//! 잡혔다 (functions/regions 비율 희석). 본 모듈은 그 stub 을 한 곳으로
//! 통합한다.
//!
//! 사용 패턴:
//!   let mut stub = StubRdbAdapter::default();
//!   // override 가 필요한 method 만 closure 지정
//!   stub.drop_table_fn = Some(Box::new(|_| Err(AppError::Database("…"))));
//!   let active = ActiveAdapter::Rdb(Box::new(stub));
//!
//! Default 동작:
//!   - read-only (`list_*`, `get_*`): `Ok(Vec::new())` / `Ok(HashMap::new())`
//!     / `Ok(String::new())` / `Ok(None)`
//!   - DDL (`drop_table`, `add_column`, …): `Ok(SchemaChangeResult { sql:
//!     "<method-name>".into() })` — wiring 테스트가 default 만으로 동작.
//!
//! `cfg(test)` 게이트만 적용 (이 모듈 자체는 production 에 컴파일되지 않음).

use std::collections::HashMap;
use tokio_util::sync::CancellationToken;

use super::traits::{DbAdapter, DocumentAdapter, KvAdapter, RdbAdapter, SearchAdapter};
use super::types::{
    BoxFuture, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo, NamespaceLabel,
    RdbQueryResult,
};
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, IndexInfo,
    PostgresTypeInfo, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, TriggerInfo,
};

/// Closure type alias — `Send + Sync` so the trait `BoxFuture` constraint
/// is satisfied; takes a single ref-typed input (`&Req`) and produces a
/// `Result<Out, AppError>` synchronously (the wrapper wraps it in
/// `async move`).
pub(crate) type FnZero<Out> = Box<dyn Fn() -> Result<Out, AppError> + Send + Sync>;
pub(crate) type FnOne<I, Out> = Box<dyn Fn(&I) -> Result<Out, AppError> + Send + Sync>;
pub(crate) type FnTwo<I1, I2, Out> = Box<dyn Fn(&I1, &I2) -> Result<Out, AppError> + Send + Sync>;

// ── StubRdbAdapter ────────────────────────────────────────────────────────

/// Reusable RDB adapter stub for command-handler dispatch tests.
///
/// Every method has a `*_fn: Option<closure>` field. When `None`, the
/// method returns the documented default (`Ok(empty)` for read paths,
/// `Ok(SchemaChangeResult { sql: "<method>" })` for DDL paths). When
/// `Some`, the closure decides the outcome.
pub(crate) struct StubRdbAdapter {
    pub kind_value: DatabaseType,
    pub namespace_label_value: NamespaceLabel,

    pub connect_fn: Option<FnZero<()>>,
    pub disconnect_fn: Option<FnZero<()>>,
    pub ping_fn: Option<FnZero<()>>,

    pub list_namespaces_fn: Option<FnZero<Vec<NamespaceInfo>>>,
    pub list_databases_fn: Option<FnZero<Vec<NamespaceInfo>>>,
    pub list_tables_fn: Option<FnOne<str, Vec<TableInfo>>>,
    pub get_columns_fn: Option<FnTwo<str, str, Vec<ColumnInfo>>>,
    pub list_schema_columns_fn: Option<FnOne<str, HashMap<String, Vec<ColumnInfo>>>>,
    pub get_table_indexes_fn: Option<FnTwo<str, str, Vec<IndexInfo>>>,
    pub get_table_constraints_fn: Option<FnTwo<str, str, Vec<ConstraintInfo>>>,
    pub list_views_fn: Option<FnOne<str, Vec<crate::models::ViewInfo>>>,
    pub list_functions_fn: Option<FnOne<str, Vec<crate::models::FunctionInfo>>>,
    pub get_view_definition_fn: Option<FnTwo<str, str, String>>,
    pub get_view_columns_fn: Option<FnTwo<str, str, Vec<ColumnInfo>>>,
    pub get_function_source_fn: Option<FnTwo<str, str, String>>,
    pub list_types_fn: Option<FnZero<Vec<PostgresTypeInfo>>>,
    /// Sprint 272 — override for `list_triggers(namespace, table)`. `None`
    /// falls back to the trait default (`Ok(Vec::new())`) so wiring tests
    /// that don't care about triggers still type-check.
    pub list_triggers_fn: Option<FnTwo<str, str, Vec<TriggerInfo>>>,
    /// Sprint 272 — override for `get_trigger_source(namespace, table,
    /// trigger_name)`. `None` falls back to a sentinel `Ok("")` (the trait
    /// default `Unsupported` would force every dispatch test to set the
    /// override). The mismatch panic-closure pattern uses this slot.
    pub get_trigger_source_fn:
        Option<Box<dyn Fn(&str, &str, &str) -> Result<String, AppError> + Send + Sync>>,

    pub current_database_fn: Option<FnZero<Option<String>>>,
    pub switch_database_fn: Option<FnOne<str, ()>>,
    pub execute_sql_fn: Option<FnOne<str, RdbQueryResult>>,
    pub execute_sql_batch_fn:
        Option<Box<dyn Fn(&[String]) -> Result<Vec<RdbQueryResult>, AppError> + Send + Sync>>,
    /// Sprint 247 — `dry_run_sql_batch` override. `None` falls back to the
    /// trait default (`Unsupported`) so wiring tests that don't care about
    /// dry-run still type-check.
    pub dry_run_sql_batch_fn:
        Option<Box<dyn Fn(&[String]) -> Result<Vec<RdbQueryResult>, AppError> + Send + Sync>>,
    pub query_table_data_fn: Option<FnTwo<str, str, TableData>>,

    pub drop_table_fn: Option<FnOne<DropTableRequest, SchemaChangeResult>>,
    pub rename_table_fn: Option<FnOne<RenameTableRequest, SchemaChangeResult>>,
    pub alter_table_fn: Option<FnOne<AlterTableRequest, SchemaChangeResult>>,
    pub add_column_fn: Option<FnOne<AddColumnRequest, SchemaChangeResult>>,
    pub drop_column_fn: Option<FnOne<DropColumnRequest, SchemaChangeResult>>,
    pub create_table_fn: Option<FnOne<CreateTableRequest, SchemaChangeResult>>,
    pub create_index_fn: Option<FnOne<CreateIndexRequest, SchemaChangeResult>>,
    pub drop_index_fn: Option<FnOne<DropIndexRequest, SchemaChangeResult>>,
    pub add_constraint_fn: Option<FnOne<AddConstraintRequest, SchemaChangeResult>>,
    pub drop_constraint_fn: Option<FnOne<DropConstraintRequest, SchemaChangeResult>>,
}

impl Default for StubRdbAdapter {
    fn default() -> Self {
        Self {
            kind_value: DatabaseType::Postgresql,
            namespace_label_value: NamespaceLabel::Schema,
            connect_fn: None,
            disconnect_fn: None,
            ping_fn: None,
            list_namespaces_fn: None,
            list_databases_fn: None,
            list_tables_fn: None,
            get_columns_fn: None,
            list_schema_columns_fn: None,
            get_table_indexes_fn: None,
            get_table_constraints_fn: None,
            list_views_fn: None,
            list_functions_fn: None,
            get_view_definition_fn: None,
            get_view_columns_fn: None,
            get_function_source_fn: None,
            list_types_fn: None,
            list_triggers_fn: None,
            get_trigger_source_fn: None,
            current_database_fn: None,
            switch_database_fn: None,
            execute_sql_fn: None,
            execute_sql_batch_fn: None,
            dry_run_sql_batch_fn: None,
            query_table_data_fn: None,
            drop_table_fn: None,
            rename_table_fn: None,
            alter_table_fn: None,
            add_column_fn: None,
            drop_column_fn: None,
            create_table_fn: None,
            create_index_fn: None,
            drop_index_fn: None,
            add_constraint_fn: None,
            drop_constraint_fn: None,
        }
    }
}

fn ddl_default_sql(name: &str) -> Result<SchemaChangeResult, AppError> {
    Ok(SchemaChangeResult {
        sql: name.to_string(),
    })
}

impl DbAdapter for StubRdbAdapter {
    fn kind(&self) -> DatabaseType {
        self.kind_value.clone()
    }
    fn connect<'a>(&'a self, _: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.connect_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.disconnect_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.ping_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
}

impl RdbAdapter for StubRdbAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        self.namespace_label_value.clone()
    }
    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        let r = self
            .list_namespaces_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f());
        Box::pin(async move { r })
    }
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        let r = self
            .list_databases_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f());
        Box::pin(async move { r })
    }
    fn list_tables<'a>(&'a self, ns: &'a str) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        let r = self
            .list_tables_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns));
        Box::pin(async move { r })
    }
    fn get_columns<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        let r = self
            .get_columns_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns, table));
        Box::pin(async move { r })
    }
    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        let r = self.execute_sql_fn.as_ref().map_or_else(
            || Err(AppError::Unsupported("stub default execute_sql".into())),
            |f| f(sql),
        );
        Box::pin(async move { r })
    }
    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        let r = self.execute_sql_batch_fn.as_ref().map_or_else(
            || {
                Err(AppError::Unsupported(
                    "stub default execute_sql_batch".into(),
                ))
            },
            |f| f(statements),
        );
        Box::pin(async move { r })
    }
    fn dry_run_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        let r = self.dry_run_sql_batch_fn.as_ref().map_or_else(
            || {
                Err(AppError::Unsupported(
                    "stub default dry_run_sql_batch".into(),
                ))
            },
            |f| f(statements),
        );
        Box::pin(async move { r })
    }
    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
        _: i32,
        _: i32,
        _: Option<&'a str>,
        _: Option<&'a [FilterCondition]>,
        _: Option<&'a str>,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        let r = self.query_table_data_fn.as_ref().map_or_else(
            || {
                Err(AppError::Unsupported(
                    "stub default query_table_data".into(),
                ))
            },
            |f| f(ns, table),
        );
        Box::pin(async move { r })
    }
    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .drop_table_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("drop_table"), |f| f(req));
        Box::pin(async move { r })
    }
    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .rename_table_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("rename_table"), |f| f(req));
        Box::pin(async move { r })
    }
    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .alter_table_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("alter_table"), |f| f(req));
        Box::pin(async move { r })
    }
    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .add_column_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("add_column"), |f| f(req));
        Box::pin(async move { r })
    }
    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .drop_column_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("drop_column"), |f| f(req));
        Box::pin(async move { r })
    }
    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .create_table_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("create_table"), |f| f(req));
        Box::pin(async move { r })
    }
    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .create_index_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("create_index"), |f| f(req));
        Box::pin(async move { r })
    }
    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .drop_index_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("drop_index"), |f| f(req));
        Box::pin(async move { r })
    }
    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .add_constraint_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("add_constraint"), |f| f(req));
        Box::pin(async move { r })
    }
    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        let r = self
            .drop_constraint_fn
            .as_ref()
            .map_or_else(|| ddl_default_sql("drop_constraint"), |f| f(req));
        Box::pin(async move { r })
    }
    fn get_table_indexes<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        let r = self
            .get_table_indexes_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns, table));
        Box::pin(async move { r })
    }
    fn get_table_constraints<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        let r = self
            .get_table_constraints_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns, table));
        Box::pin(async move { r })
    }
    fn list_views<'a>(
        &'a self,
        ns: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ViewInfo>, AppError>> {
        let r = self
            .list_views_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns));
        Box::pin(async move { r })
    }
    fn list_functions<'a>(
        &'a self,
        ns: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::FunctionInfo>, AppError>> {
        let r = self
            .list_functions_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns));
        Box::pin(async move { r })
    }
    fn get_view_definition<'a>(
        &'a self,
        ns: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        let r = self
            .get_view_definition_fn
            .as_ref()
            .map_or(Ok(String::new()), |f| f(ns, view));
        Box::pin(async move { r })
    }
    fn get_view_columns<'a>(
        &'a self,
        ns: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        let r = self
            .get_view_columns_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns, view));
        Box::pin(async move { r })
    }
    fn list_schema_columns<'a>(
        &'a self,
        ns: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        let r = self
            .list_schema_columns_fn
            .as_ref()
            .map_or(Ok(HashMap::new()), |f| f(ns));
        Box::pin(async move { r })
    }
    fn get_function_source<'a>(
        &'a self,
        ns: &'a str,
        func: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        let r = self
            .get_function_source_fn
            .as_ref()
            .map_or(Ok(String::new()), |f| f(ns, func));
        Box::pin(async move { r })
    }
    fn list_types<'a>(&'a self) -> BoxFuture<'a, Result<Vec<PostgresTypeInfo>, AppError>> {
        let r = self.list_types_fn.as_ref().map_or(Ok(Vec::new()), |f| f());
        Box::pin(async move { r })
    }
    fn list_triggers<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        let r = self
            .list_triggers_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(ns, table));
        Box::pin(async move { r })
    }
    fn get_trigger_source<'a>(
        &'a self,
        ns: &'a str,
        table: &'a str,
        trigger_name: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        let r = self
            .get_trigger_source_fn
            .as_ref()
            .map_or(Ok(String::new()), |f| f(ns, table, trigger_name));
        Box::pin(async move { r })
    }
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        let r = self.current_database_fn.as_ref().map_or(Ok(None), |f| f());
        Box::pin(async move { r })
    }
    fn switch_database<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.switch_database_fn.as_ref().map_or(Ok(()), |f| f(name));
        Box::pin(async move { r })
    }
}

// ── StubDocumentAdapter ──────────────────────────────────────────────────

pub(crate) struct StubDocumentAdapter {
    pub kind_value: DatabaseType,

    pub connect_fn: Option<FnZero<()>>,
    pub disconnect_fn: Option<FnZero<()>>,
    pub ping_fn: Option<FnZero<()>>,

    pub list_databases_fn: Option<FnZero<Vec<NamespaceInfo>>>,
    pub current_database_fn: Option<FnZero<Option<String>>>,
    pub switch_database_fn: Option<FnOne<str, ()>>,

    pub list_collections_fn: Option<FnOne<str, Vec<TableInfo>>>,
    pub infer_collection_fields_fn: Option<FnTwo<str, str, Vec<ColumnInfo>>>,

    pub drop_collection_fn: Option<FnTwo<str, str, ()>>,
}

impl Default for StubDocumentAdapter {
    fn default() -> Self {
        Self {
            kind_value: DatabaseType::Mongodb,
            connect_fn: None,
            disconnect_fn: None,
            ping_fn: None,
            list_databases_fn: None,
            current_database_fn: None,
            switch_database_fn: None,
            list_collections_fn: None,
            infer_collection_fields_fn: None,
            drop_collection_fn: None,
        }
    }
}

impl DbAdapter for StubDocumentAdapter {
    fn kind(&self) -> DatabaseType {
        self.kind_value.clone()
    }
    fn connect<'a>(&'a self, _: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.connect_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.disconnect_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.ping_fn.as_ref().map_or(Ok(()), |f| f());
        Box::pin(async move { r })
    }
}

impl DocumentAdapter for StubDocumentAdapter {
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        let r = self
            .list_databases_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f());
        Box::pin(async move { r })
    }
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        let r = self.current_database_fn.as_ref().map_or(Ok(None), |f| f());
        Box::pin(async move { r })
    }
    fn switch_database<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self.switch_database_fn.as_ref().map_or(Ok(()), |f| f(name));
        Box::pin(async move { r })
    }
    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        let r = self
            .list_collections_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(db));
        Box::pin(async move { r })
    }
    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        coll: &'a str,
        _: usize,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        let r = self
            .infer_collection_fields_fn
            .as_ref()
            .map_or(Ok(Vec::new()), |f| f(db, coll));
        Box::pin(async move { r })
    }
    fn find<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: FindBody,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async {
            Ok(DocumentQueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                raw_documents: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
            })
        })
    }
    fn aggregate<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: Vec<bson::Document>,
        _: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
        Box::pin(async {
            Ok(DocumentQueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                raw_documents: Vec::new(),
                total_count: 0,
                execution_time_ms: 0,
            })
        })
    }
    fn insert_document<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: bson::Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
        Box::pin(async { Ok(DocumentId::Number(0)) })
    }
    fn update_document<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: DocumentId,
        _: bson::Document,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn delete_document<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn delete_many<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async { Ok(0) })
    }
    fn update_many<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: bson::Document,
        _: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async { Ok(0) })
    }
    fn drop_collection<'a>(
        &'a self,
        db: &'a str,
        coll: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        let r = self
            .drop_collection_fn
            .as_ref()
            .map_or(Ok(()), |f| f(db, coll));
        Box::pin(async move { r })
    }
}

// ── StubSearchAdapter / StubKvAdapter (marker traits) ────────────────────

pub(crate) struct StubSearchAdapter {
    pub kind_value: DatabaseType,
}

impl Default for StubSearchAdapter {
    fn default() -> Self {
        Self {
            kind_value: DatabaseType::Postgresql,
        }
    }
}

impl DbAdapter for StubSearchAdapter {
    fn kind(&self) -> DatabaseType {
        self.kind_value.clone()
    }
    fn connect<'a>(&'a self, _: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl SearchAdapter for StubSearchAdapter {}

pub(crate) struct StubKvAdapter {
    pub kind_value: DatabaseType,
}

impl Default for StubKvAdapter {
    fn default() -> Self {
        Self {
            kind_value: DatabaseType::Mongodb,
        }
    }
}

impl DbAdapter for StubKvAdapter {
    fn kind(&self) -> DatabaseType {
        self.kind_value.clone()
    }
    fn connect<'a>(&'a self, _: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl KvAdapter for StubKvAdapter {}

// ── helpers ─────────────────────────────────────────────────────────────

/// Clone an `AppError` (which is not `Clone` natively). Used inside
/// closures that need to return the same error multiple times.
pub(crate) fn clone_app_error(e: &AppError) -> AppError {
    match e {
        AppError::NotFound(s) => AppError::NotFound(s.clone()),
        AppError::Unsupported(s) => AppError::Unsupported(s.clone()),
        AppError::Database(s) => AppError::Database(s.clone()),
        AppError::Connection(s) => AppError::Connection(s.clone()),
        AppError::Validation(s) => AppError::Validation(s.clone()),
        other => AppError::Unsupported(format!("clone: {:?}", other)),
    }
}
