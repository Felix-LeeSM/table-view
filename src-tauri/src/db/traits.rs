//! Adapter trait hierarchy — `DbAdapter` (lifecycle) and the four
//! paradigm-specific extension traits (`RdbAdapter`, `DocumentAdapter`,
//! `SearchAdapter`, `KvAdapter`).
//!
//! Hoisted out of `db/mod.rs` (Sprint 213, P5 step 2). The trait surface
//! is unchanged — `crate::db::DbAdapter` and friends continue to resolve
//! via `pub use` in `db/mod.rs`. Adapter implementations and `ActiveAdapter`
//! enum live in their own siblings.

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig, ConstraintInfo,
    CreateIndexRequest, CreateTableRequest, DatabaseType, DropConstraintRequest, DropIndexRequest,
    FilterCondition, FunctionInfo, IndexInfo, PostgresTypeInfo, SchemaChangeResult, TableData,
    TableInfo, ViewInfo,
};

use super::types::{
    BoxFuture, DocumentId, DocumentQueryResult, FindBody, NamespaceInfo, NamespaceLabel,
    RdbQueryResult,
};

// ── Lifecycle trait ───────────────────────────────────────────────────────

/// Connection lifecycle contract shared by every adapter paradigm.
pub trait DbAdapter: Send + Sync {
    fn kind(&self) -> DatabaseType;

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>>;

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>>;

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>>;
}

// ── RdbAdapter ────────────────────────────────────────────────────────────

/// Relational-database paradigm (PostgreSQL, MySQL, SQLite, …).
///
/// Trait methods accept `(namespace, table)` order uniformly; concrete
/// implementations may reorder arguments internally when delegating to
/// legacy inherent methods.
#[allow(clippy::too_many_arguments)]
pub trait RdbAdapter: DbAdapter {
    fn namespace_label(&self) -> NamespaceLabel;

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    /// List databases visible to the connected user (Sprint 128).
    ///
    /// For paradigm symmetry with `DocumentAdapter::list_databases`. PG
    /// surfaces every non-template database in the cluster; future SQLite /
    /// MySQL adapters fall back to the default `Vec::new()` impl below until
    /// Phase 9 wires their concrete implementations. Empty Vec is the
    /// graceful "no databases to show" signal — frontend renders the
    /// existing read-only label.
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Switch the adapter's "active database" (Sprint 130).
    ///
    /// Concrete adapters that maintain a per-database connection pool (PG)
    /// override this to swap the active sub-pool to `db_name`. Adapters
    /// that do not yet support DB switching (SQLite/MySQL/Redis/ES) fall
    /// back to the default `Unsupported` error so the frontend toast can
    /// surface a clear message rather than silently no-op.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database (Sprint 132).
    ///
    /// Used by the `verify_active_db` Tauri command to compare the
    /// optimistic `setActiveDb` value the frontend wrote after a raw
    /// `\c <db>` against the backend's truth. Default implementation runs
    /// `SELECT current_database()` through `execute_sql` so any RDB
    /// adapter that follows ANSI semantics inherits a working verify path
    /// without a custom override. Adapters that cannot answer (no pool
    /// open) propagate the underlying error.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move {
            let result = self.execute_sql("SELECT current_database()", None).await?;
            let row = result
                .rows
                .first()
                .ok_or_else(|| AppError::Database("current_database() returned no rows".into()))?;
            let val = row.first().ok_or_else(|| {
                AppError::Database("current_database() returned no columns".into())
            })?;
            Ok(val.as_str().map(|s| s.to_string()))
        })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): accepts `Option<&CancellationToken>` so an
    /// in-flight schema-introspection query can be cooperatively aborted via
    /// the same `query_tokens` registry that drives `execute_sql`. Adapters
    /// observe the token at the same `tokio::select!` shape used by
    /// `PostgresAdapter::execute_query`.
    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>>;

    /// Sprint 183 — execute a list of statements inside a single
    /// transaction (BEGIN/COMMIT/ROLLBACK). All-or-nothing: a failure on
    /// statement K rolls back statements 1..K-1. The default impl returns
    /// `Unsupported` so adapters that have not yet wired transactional
    /// commit (SQLite/MySQL placeholders) still type-check.
    fn execute_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support batched transactions".into(),
            ))
        })
    }

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
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
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>>;

    // DDL
    fn drop_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    fn rename_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        new_name: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 226 — `CREATE TABLE` with PG ANSI quoting + identifier
    /// validation + preview/execute branches (transactional commit).
    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>>;

    /// Sprint 192 — server-side cursor 기반 row streaming.
    ///
    /// 호출자는 미리 결정된 `column_names` (source column order) 를 넘긴다.
    /// adapter 는 각 row 의 cell value 를 `column_names` 순서대로 정렬해
    /// `Vec<serde_json::Value>` 로 만들고, batch (= `Vec<Vec<Value>>`) 단위로
    /// `sender` 에 송신한다. 반환값은 송신한 row 총 개수.
    ///
    /// PG 의 정공법 구현은 `BEGIN; DECLARE NO SCROLL CURSOR FOR …; FETCH
    /// FORWARD batch_size; …; CLOSE; COMMIT` — 단일 transaction 안에서
    /// server-side cursor 운영. 매 batch 사이마다 `cancel.is_cancelled()`
    /// 를 체크해 cooperatively abort. receiver drop 도 cancel signal 로
    /// 취급해 transaction 을 ROLLBACK.
    ///
    /// MySQL/SQLite 는 Phase 9 합류 시 dialect 별 streaming 으로 구현.
    /// default 는 `Unsupported` 라 dump 전 dispatch 단계에서 reject.
    fn stream_table_rows<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _batch_size: u32,
        _column_names: &'a [String],
        _sender: tokio::sync::mpsc::Sender<Vec<Vec<serde_json::Value>>>,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Row streaming is not supported by this adapter".into(),
            ))
        })
    }

    // Views/Functions — default: empty list (each DBMS overrides as needed).
    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>>;

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>>;

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>>;

    /// Sprint 230 — list every Postgres-style data type visible to the
    /// active connection. PG overrides to query
    /// `pg_catalog.pg_type ⨝ pg_catalog.pg_namespace`; non-PG adapters
    /// (MySQL/SQLite/Oracle, Phase 17+) inherit the default
    /// `Unsupported` so they continue to compile without code changes
    /// until their dialect-specific implementation lands.
    fn list_types<'a>(&'a self) -> BoxFuture<'a, Result<Vec<PostgresTypeInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not list types".into(),
            ))
        })
    }
}

// ── DocumentAdapter (Phase 6 placeholder — signatures only) ───────────────

pub trait DocumentAdapter: DbAdapter {
    /// Switch the adapter's "active database" (Sprint 131).
    ///
    /// Mirrors `RdbAdapter::switch_database` (Sprint 130): adapters that
    /// maintain a per-connection notion of "current DB" override this to
    /// flip the user's selection. Adapters that do not yet support DB
    /// switching fall back to the default `Unsupported` so the unified
    /// `switch_active_db` Tauri command can dispatch through the trait
    /// without a paradigm-aware match per-adapter.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This document adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database (Sprint 132).
    ///
    /// Mirrors `RdbAdapter::current_database` so the `verify_active_db`
    /// Tauri command can dispatch through a single trait method per
    /// paradigm. Default returns `Ok(None)` — adapters that retain a
    /// `current_active_db` accessor (Mongo) override to surface their
    /// in-memory selection without a backend round-trip.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async { Ok(None) })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation. Adapters observe
    /// the token via the same `tokio::select!` pattern used on the RDB
    /// side; on cancel they return `AppError::Database("Operation cancelled")`.
    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<bson::Document>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    fn insert_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        doc: bson::Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>>;

    fn update_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
        patch: bson::Document,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    fn delete_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 198: bulk delete by filter. Returns deleted_count surfaced
    /// from the driver. Empty filter `{}` is allowed — Safe Mode classifier
    /// gates the call on the frontend (`analyzeMongoOperation`).
    fn delete_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Sprint 198: bulk update by filter. Returns modified_count surfaced
    /// from the driver. `_id` in patch is rejected (mirrors single-doc
    /// `update_document` contract).
    fn update_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        patch: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Sprint 198: drop the entire collection. RDB `dropTable` parallel.
    /// Safe Mode always classifies this as `danger`.
    fn drop_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;
}

// ── SearchAdapter / KvAdapter (Phase 7/8 placeholders) ────────────────────

pub trait SearchAdapter: DbAdapter {}

pub trait KvAdapter: DbAdapter {}
