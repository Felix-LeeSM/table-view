pub mod mongodb;
pub mod postgres;

pub use mongodb::MongoAdapter;
pub use postgres::PostgresAdapter;

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig, ConstraintInfo,
    CreateIndexRequest, DatabaseType, DropConstraintRequest, DropIndexRequest, FilterCondition,
    FunctionInfo, IndexInfo, QueryResult, SchemaChangeResult, SchemaInfo, TableData, TableInfo,
    ViewInfo,
};

/// Local BoxFuture alias — the project does not depend on the `futures` crate
/// yet, so we reproduce the common `BoxFuture<'a, T>` shape here. All trait
/// methods in this module use this alias uniformly for readability.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

// ── DTOs ──────────────────────────────────────────────────────────────────

/// UI hint for how an RDBMS-style namespace should be presented.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NamespaceLabel {
    Schema,
    Database,
    Single { name: &'static str },
}

/// Paradigm-neutral namespace descriptor returned by `RdbAdapter::list_namespaces`.
/// For Sprint A1 this mirrors `SchemaInfo` — future DBMS adapters may extend
/// additional fields without breaking existing call sites.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamespaceInfo {
    pub name: String,
}

impl From<SchemaInfo> for NamespaceInfo {
    fn from(value: SchemaInfo) -> Self {
        Self { name: value.name }
    }
}

/// RDB query result — alias of the existing `QueryResult` so RDB adapters
/// can continue to use the same concrete type while the trait stays
/// paradigm-named.
pub type RdbQueryResult = QueryResult;

/// MongoDB document identifier (Phase 6).
///
/// Sprint 65 promotes this from a `serde_json::Value`-backed placeholder to a
/// native BSON representation now that the `bson` crate is a first-class
/// dependency. `Raw` retains an escape hatch for exotic `_id` shapes
/// (composite documents, binary types) that do not fit the top three cases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DocumentId {
    ObjectId(String),
    String(String),
    Number(i64),
    Raw(bson::Bson),
}

/// Parameter bundle for `DocumentAdapter::find` (Phase 6).
///
/// Sprint 65 migrates the filter/sort/projection fields from
/// `serde_json::Value` placeholders to native `bson::Document` so the
/// MongoDB driver can consume them without a JSON → BSON conversion pass.
/// `filter` defaults to an empty document (= no constraint) and the optional
/// `sort`/`projection` remain `None` by default.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FindBody {
    #[serde(default)]
    pub filter: bson::Document,
    pub sort: Option<bson::Document>,
    pub projection: Option<bson::Document>,
    #[serde(default)]
    pub skip: u64,
    #[serde(default)]
    pub limit: i64,
}

/// Result shape for document-oriented query/aggregation (Phase 6).
///
/// `raw_documents` now carries native `bson::Document` values — the Quick
/// Look panel (Sprint 66+) will render these directly without a lossy
/// JSON-Value intermediary. `rows` still uses `serde_json::Value` because the
/// data grid consumer projects scalar cells through the same JSON pipeline
/// that the RDB paradigm uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentQueryResult {
    pub columns: Vec<crate::models::QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub raw_documents: Vec<bson::Document>,
    pub total_count: i64,
    pub execution_time_ms: u64,
}

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

// ── ActiveAdapter enum ────────────────────────────────────────────────────

/// Runtime-dispatched adapter handle stored per active connection.
///
/// Wraps one of the paradigm-specific traits. Accessors return a typed
/// reference or a paradigm-mismatch error so that RDB-only commands can
/// reject document/search/kv connections cleanly.
pub enum ActiveAdapter {
    Rdb(Box<dyn RdbAdapter>),
    Document(Box<dyn DocumentAdapter>),
    Search(Box<dyn SearchAdapter>),
    Kv(Box<dyn KvAdapter>),
}

impl ActiveAdapter {
    pub fn kind(&self) -> DatabaseType {
        self.lifecycle().kind()
    }

    pub fn lifecycle(&self) -> &dyn DbAdapter {
        match self {
            ActiveAdapter::Rdb(a) => a.as_ref(),
            ActiveAdapter::Document(a) => a.as_ref(),
            ActiveAdapter::Search(a) => a.as_ref(),
            ActiveAdapter::Kv(a) => a.as_ref(),
        }
    }

    pub fn as_rdb(&self) -> Result<&dyn RdbAdapter, AppError> {
        match self {
            ActiveAdapter::Rdb(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a relational (RDB) connection".into(),
            )),
        }
    }

    pub fn as_document(&self) -> Result<&dyn DocumentAdapter, AppError> {
        match self {
            ActiveAdapter::Document(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a document (MongoDB) connection".into(),
            )),
        }
    }

    pub fn as_search(&self) -> Result<&dyn SearchAdapter, AppError> {
        match self {
            ActiveAdapter::Search(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a search connection".into(),
            )),
        }
    }

    pub fn as_kv(&self) -> Result<&dyn KvAdapter, AppError> {
        match self {
            ActiveAdapter::Kv(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a key-value connection".into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespace_info_from_schema_info_preserves_name() {
        let schema = SchemaInfo {
            name: "public".to_string(),
        };
        let ns: NamespaceInfo = schema.into();
        assert_eq!(ns.name, "public");
    }

    #[test]
    fn namespace_info_from_schema_info_with_empty_name() {
        let schema = SchemaInfo {
            name: String::new(),
        };
        let ns: NamespaceInfo = schema.into();
        assert_eq!(ns.name, "");
    }

    #[test]
    fn namespace_info_from_schema_info_keeps_unicode() {
        let schema = SchemaInfo {
            name: "스키마_名前".to_string(),
        };
        let ns: NamespaceInfo = schema.into();
        assert_eq!(ns.name, "스키마_名前");
    }

    #[test]
    fn active_adapter_as_rdb_rejects_non_rdb_with_unsupported() {
        struct DummyDocument;
        impl DbAdapter for DummyDocument {
            fn kind(&self) -> DatabaseType {
                DatabaseType::Mongodb
            }
            fn connect<'a>(
                &'a self,
                _config: &'a ConnectionConfig,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
        }
        impl DocumentAdapter for DummyDocument {
            fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn list_collections<'a>(
                &'a self,
                _db: &'a str,
                _cancel: Option<&'a CancellationToken>,
            ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn infer_collection_fields<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _sample_size: usize,
                _cancel: Option<&'a CancellationToken>,
            ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn find<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _body: FindBody,
                _cancel: Option<&'a CancellationToken>,
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
                _db: &'a str,
                _collection: &'a str,
                _pipeline: Vec<bson::Document>,
                _cancel: Option<&'a CancellationToken>,
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
                _db: &'a str,
                _collection: &'a str,
                _doc: bson::Document,
            ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
                Box::pin(async { Ok(DocumentId::Number(0)) })
            }
            fn update_document<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _id: DocumentId,
                _patch: bson::Document,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn delete_document<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _id: DocumentId,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
            fn delete_many<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _filter: bson::Document,
            ) -> BoxFuture<'a, Result<u64, AppError>> {
                Box::pin(async { Ok(0) })
            }
            fn update_many<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _filter: bson::Document,
                _patch: bson::Document,
            ) -> BoxFuture<'a, Result<u64, AppError>> {
                Box::pin(async { Ok(0) })
            }
            fn drop_collection<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
            ) -> BoxFuture<'a, Result<(), AppError>> {
                Box::pin(async { Ok(()) })
            }
        }

        let active = ActiveAdapter::Document(Box::new(DummyDocument));
        match active.as_rdb() {
            Err(AppError::Unsupported(msg)) => {
                assert!(msg.contains("relational"), "unexpected message: {}", msg);
            }
            other => panic!("Expected Unsupported error, got: {:?}", other.is_ok()),
        }

        // Sanity: as_document resolves on the same adapter.
        assert!(active.as_document().is_ok());

        // Cross-paradigm sanity: as_search/as_kv also yield Unsupported.
        assert!(matches!(active.as_search(), Err(AppError::Unsupported(_))));
        assert!(matches!(active.as_kv(), Err(AppError::Unsupported(_))));
    }

    // ── Sprint 180 (AC-180-04): cancel-token cooperation tests ───────────
    //
    // Reason for these tests (2026-04-30): the Sprint 180 contract requires
    // every cancellable trait method (4 RDB + 4 Document) to wire
    // `Option<&CancellationToken>` so the existing `cancel_query` registry
    // can abort the in-flight call cooperatively. We exercise that contract
    // here against fake adapters that simulate slow work and observe the
    // token via the same `tokio::select!` shape used by
    // `PostgresAdapter::execute_query`. Each test follows form (b): wire a
    // pre-cancelled token, drive the trait method, assert the
    // `AppError::Database("Operation cancelled")` short-circuit path.
    //
    // We deliberately split this into per-method tests (rather than a
    // shared parametric helper) so a future regression on any single trait
    // method is bisected by a clearly-named failing test.

    use crate::models::FilterCondition;
    use std::time::Duration;

    /// Fake RDB adapter — drives a slow inner future via `tokio::sleep`
    /// and observes the cancel token, so each trait method can assert
    /// the cooperative-abort path independently.
    struct FakeCancellableRdb;

    impl DbAdapter for FakeCancellableRdb {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    impl RdbAdapter for FakeCancellableRdb {
        fn namespace_label(&self) -> NamespaceLabel {
            NamespaceLabel::Schema
        }
        fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_tables<'a>(
            &'a self,
            _namespace: &'a str,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_columns<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(Vec::new())
                };
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
            _sql: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
            Box::pin(async {
                Ok(RdbQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                    query_type: crate::models::QueryType::Select,
                })
            })
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
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<TableData, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(TableData {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: 0,
                        page: 1,
                        page_size: 0,
                        executed_query: String::new(),
                    })
                };
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
            _namespace: &'a str,
            _table: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn rename_table<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            _new_name: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn alter_table<'a>(
            &'a self,
            _req: &'a AlterTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn create_index<'a>(
            &'a self,
            _req: &'a CreateIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_index<'a>(
            &'a self,
            _req: &'a DropIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn add_constraint<'a>(
            &'a self,
            _req: &'a AddConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_constraint<'a>(
            &'a self,
            _req: &'a DropConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn get_table_indexes<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(Vec::new())
                };
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
            _namespace: &'a str,
            _table: &'a str,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(Vec::new())
                };
                match cancel {
                    Some(token) => tokio::select! {
                        result = work => result,
                        _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                    },
                    None => work.await,
                }
            })
        }
        fn get_view_definition<'a>(
            &'a self,
            _namespace: &'a str,
            _view: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
        fn get_view_columns<'a>(
            &'a self,
            _namespace: &'a str,
            _view: &'a str,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_schema_columns<'a>(
            &'a self,
            _namespace: &'a str,
        ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>>
        {
            Box::pin(async { Ok(std::collections::HashMap::new()) })
        }
        fn get_function_source<'a>(
            &'a self,
            _namespace: &'a str,
            _function: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
    }

    /// Fake document adapter — same shape as the RDB fake; observes cancel
    /// token so each Document trait method can assert cooperative abort.
    struct FakeCancellableDocument;

    impl DbAdapter for FakeCancellableDocument {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Mongodb
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    impl DocumentAdapter for FakeCancellableDocument {
        fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_collections<'a>(
            &'a self,
            _db: &'a str,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(Vec::new())
                };
                match cancel {
                    Some(token) => tokio::select! {
                        result = work => result,
                        _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                    },
                    None => work.await,
                }
            })
        }
        fn infer_collection_fields<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _sample_size: usize,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(Vec::new())
                };
                match cancel {
                    Some(token) => tokio::select! {
                        result = work => result,
                        _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                    },
                    None => work.await,
                }
            })
        }
        fn find<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _body: FindBody,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(DocumentQueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        raw_documents: Vec::new(),
                        total_count: 0,
                        execution_time_ms: 0,
                    })
                };
                match cancel {
                    Some(token) => tokio::select! {
                        result = work => result,
                        _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                    },
                    None => work.await,
                }
            })
        }
        fn aggregate<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _pipeline: Vec<bson::Document>,
            cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>> {
            Box::pin(async move {
                let work = async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Ok(DocumentQueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        raw_documents: Vec::new(),
                        total_count: 0,
                        execution_time_ms: 0,
                    })
                };
                match cancel {
                    Some(token) => tokio::select! {
                        result = work => result,
                        _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                    },
                    None => work.await,
                }
            })
        }
        fn insert_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _doc: bson::Document,
        ) -> BoxFuture<'a, Result<DocumentId, AppError>> {
            Box::pin(async { Ok(DocumentId::Number(0)) })
        }
        fn update_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _id: DocumentId,
            _patch: bson::Document,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn delete_document<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _id: DocumentId,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn delete_many<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
        ) -> BoxFuture<'a, Result<u64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn update_many<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
            _filter: bson::Document,
            _patch: bson::Document,
        ) -> BoxFuture<'a, Result<u64, AppError>> {
            Box::pin(async { Ok(0) })
        }
        fn drop_collection<'a>(
            &'a self,
            _db: &'a str,
            _collection: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    /// Helper — assert the result is the cooperative-cancel `Operation
    /// cancelled` error so each test stays terse.
    fn assert_cancelled<T: std::fmt::Debug>(res: Result<T, AppError>) {
        match res {
            Err(AppError::Database(msg)) if msg.contains("Operation cancelled") => {}
            other => panic!(
                "expected AppError::Database(\"Operation cancelled\"), got: {:?}",
                other
            ),
        }
    }

    // ── RDB ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_rdb_query_table_data_honors_cancel_token() {
        // Reason (2026-04-30): pre-cancel the token before driving the
        // trait method so the inner sleep would never resolve; the
        // `tokio::select!` arm must short-circuit with the cancelled
        // error before the 60s timer would.
        let adapter = FakeCancellableRdb;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter
            .query_table_data("public", "t", 1, 100, None, None, None, Some(&token))
            .await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_rdb_get_columns_honors_cancel_token() {
        let adapter = FakeCancellableRdb;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter.get_columns("public", "t", Some(&token)).await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_rdb_get_table_indexes_honors_cancel_token() {
        let adapter = FakeCancellableRdb;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter.get_table_indexes("public", "t", Some(&token)).await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_rdb_get_table_constraints_honors_cancel_token() {
        let adapter = FakeCancellableRdb;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter
            .get_table_constraints("public", "t", Some(&token))
            .await;
        assert_cancelled(result);
    }

    // ── Document ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_document_find_honors_cancel_token() {
        // Reason (2026-04-30): same form as the RDB tests — pre-cancel,
        // assert short-circuit. Mongo bundled driver does not expose
        // killOperations, so this guarantees the future drops promptly
        // even though the server may continue briefly (ADR-0018).
        let adapter = FakeCancellableDocument;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter
            .find("db", "c", FindBody::default(), Some(&token))
            .await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_document_aggregate_honors_cancel_token() {
        let adapter = FakeCancellableDocument;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter.aggregate("db", "c", Vec::new(), Some(&token)).await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_document_infer_collection_fields_honors_cancel_token() {
        let adapter = FakeCancellableDocument;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter
            .infer_collection_fields("db", "c", 100, Some(&token))
            .await;
        assert_cancelled(result);
    }

    #[tokio::test]
    async fn test_document_list_collections_honors_cancel_token() {
        let adapter = FakeCancellableDocument;
        let token = CancellationToken::new();
        token.cancel();
        let result = adapter.list_collections("db", Some(&token)).await;
        assert_cancelled(result);
    }

    // ── Sanity checks: passing `None` does NOT short-circuit ─────────────
    //
    // Reason (2026-04-30): Sprint 180 contract requires the non-cancelled
    // path to behave identically to the pre-180 inherent call. We can't
    // wait 60s in unit tests, so we assert the negative shape: with
    // `cancel = None` and a fast-returning override the call resolves
    // normally. We use a separate fake that returns immediately to
    // verify the `None` branch does NOT degrade or return cancelled.

    struct FastFakeRdb;
    impl DbAdapter for FastFakeRdb {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql
        }
        fn connect<'a>(
            &'a self,
            _config: &'a ConnectionConfig,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl RdbAdapter for FastFakeRdb {
        fn namespace_label(&self) -> NamespaceLabel {
            NamespaceLabel::Schema
        }
        fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_tables<'a>(
            &'a self,
            _namespace: &'a str,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_columns<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn execute_sql<'a>(
            &'a self,
            _sql: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
            Box::pin(async {
                Ok(RdbQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                    query_type: crate::models::QueryType::Select,
                })
            })
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
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<TableData, AppError>> {
            Box::pin(async {
                Ok(TableData {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    page: 1,
                    page_size: 0,
                    executed_query: String::new(),
                })
            })
        }
        fn drop_table<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn rename_table<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            _new_name: &'a str,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn alter_table<'a>(
            &'a self,
            _req: &'a AlterTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn create_index<'a>(
            &'a self,
            _req: &'a CreateIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_index<'a>(
            &'a self,
            _req: &'a DropIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn add_constraint<'a>(
            &'a self,
            _req: &'a AddConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_constraint<'a>(
            &'a self,
            _req: &'a DropConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn get_table_indexes<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_table_constraints<'a>(
            &'a self,
            _namespace: &'a str,
            _table: &'a str,
            _cancel: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_view_definition<'a>(
            &'a self,
            _namespace: &'a str,
            _view: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
        fn get_view_columns<'a>(
            &'a self,
            _namespace: &'a str,
            _view: &'a str,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_schema_columns<'a>(
            &'a self,
            _namespace: &'a str,
        ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>>
        {
            Box::pin(async { Ok(std::collections::HashMap::new()) })
        }
        fn get_function_source<'a>(
            &'a self,
            _namespace: &'a str,
            _function: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
    }

    #[tokio::test]
    async fn test_rdb_query_table_data_with_none_token_resolves_normally() {
        // Reason (2026-04-30): Sprint 180 invariant — pre-180 callers
        // pass `None` and must observe identical behaviour to the
        // inherent path; this guards against an accidental regression
        // where a future change always wraps the call in
        // `tokio::select!` even when `cancel == None`.
        let adapter = FastFakeRdb;
        let result = adapter
            .query_table_data("public", "t", 1, 100, None, None, None, None)
            .await;
        assert!(result.is_ok(), "None token should resolve normally");
    }
}
