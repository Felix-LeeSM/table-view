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

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>>;

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>>;

    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
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

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>>;

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>>;

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
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    fn list_collections<'a>(
        &'a self,
        db: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>>;

    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<bson::Document>,
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
            ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn infer_collection_fields<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _sample_size: usize,
            ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
                Box::pin(async { Ok(Vec::new()) })
            }
            fn find<'a>(
                &'a self,
                _db: &'a str,
                _collection: &'a str,
                _body: FindBody,
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
}
