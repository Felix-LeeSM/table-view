pub mod postgres;

#[allow(dead_code)]
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
/// yet, so we reproduce the common `BoxFuture<'a, T>` shape here.
#[allow(dead_code)]
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

// ── DTOs ──────────────────────────────────────────────────────────────────

/// UI hint for how an RDBMS-style namespace should be presented.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NamespaceLabel {
    Schema,
    Database,
    Single { name: &'static str },
}

/// Paradigm-neutral namespace descriptor returned by `RdbAdapter::list_namespaces`.
/// For Sprint A1 this mirrors `SchemaInfo` — future DBMS adapters may extend
/// additional fields without breaking existing call sites.
#[allow(dead_code)]
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
#[allow(dead_code)]
pub type RdbQueryResult = QueryResult;

/// MongoDB document identifier (Phase 6).
///
/// The underlying `bson::ObjectId` type is introduced by Sprint B together
/// with the `bson` crate dependency. For Sprint A1 we keep a thin placeholder
/// keyed by the extended-JSON string representation so that the trait
/// compiles without pulling `bson` into `Cargo.toml` prematurely.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DocumentId {
    ObjectId(String),
    String(String),
    Number(i64),
    Raw(serde_json::Value),
}

/// Parameter bundle for `DocumentAdapter::find` (Phase 6).
///
/// Represented as `serde_json::Value` for Sprint A1 — Sprint B will migrate
/// these to `bson::Document` once the `bson` crate is added.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FindBody {
    pub filter: serde_json::Value,
    pub sort: Option<serde_json::Value>,
    pub projection: Option<serde_json::Value>,
    pub skip: u64,
    pub limit: i64,
}

/// Result shape for document-oriented query/aggregation (Phase 6).
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentQueryResult {
    pub columns: Vec<crate::models::QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub raw_documents: Vec<serde_json::Value>,
    pub total_count: i64,
    pub execution_time_ms: u64,
}

// ── Lifecycle trait ───────────────────────────────────────────────────────

/// Connection lifecycle contract shared by every adapter paradigm.
#[allow(dead_code)]
pub trait DbAdapter: Send + Sync {
    fn kind(&self) -> DatabaseType;

    fn connect<'a>(
        &'a self,
        config: &'a ConnectionConfig,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

    fn disconnect<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

    fn ping<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;
}

// ── RdbAdapter ────────────────────────────────────────────────────────────

/// Relational-database paradigm (PostgreSQL, MySQL, SQLite, …).
///
/// Trait methods accept `(namespace, table)` order uniformly; concrete
/// implementations may reorder arguments internally when delegating to
/// legacy inherent methods.
#[allow(clippy::too_many_arguments)]
#[allow(dead_code)]
pub trait RdbAdapter: DbAdapter {
    fn namespace_label(&self) -> NamespaceLabel;

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>>;

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TableInfo>, AppError>> + Send + 'a>>;

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>>;

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>>;

    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>>;

    // DDL
    fn drop_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

    fn rename_table<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        new_name: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>>;

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>>;

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>>;

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>>;

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>>;

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>>;

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>>;

    // Views/Functions — default: empty list (each DBMS overrides as needed).
    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<FunctionInfo>, AppError>> + Send + 'a>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>>;

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>>;
}

// ── DocumentAdapter (Phase 6 placeholder — signatures only) ───────────────

#[allow(dead_code)]
pub trait DocumentAdapter: DbAdapter {
    fn list_databases<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>>;

    fn list_collections<'a>(
        &'a self,
        db: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TableInfo>, AppError>> + Send + 'a>>;

    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>>;

    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
    ) -> Pin<Box<dyn Future<Output = Result<DocumentQueryResult, AppError>> + Send + 'a>>;

    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<DocumentQueryResult, AppError>> + Send + 'a>>;

    fn insert_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        doc: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<DocumentId, AppError>> + Send + 'a>>;

    fn update_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
        patch: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

    fn delete_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;
}

// ── SearchAdapter / KvAdapter (Phase 7/8 placeholders) ────────────────────

#[allow(dead_code)]
pub trait SearchAdapter: DbAdapter {}

#[allow(dead_code)]
pub trait KvAdapter: DbAdapter {}

// ── ActiveAdapter enum ────────────────────────────────────────────────────

/// Runtime-dispatched adapter handle stored per active connection.
///
/// Wraps one of the paradigm-specific traits. Accessors return a typed
/// reference or a paradigm-mismatch error so that RDB-only commands can
/// reject document/search/kv connections cleanly.
#[allow(dead_code)]
pub enum ActiveAdapter {
    Rdb(Box<dyn RdbAdapter>),
    Document(Box<dyn DocumentAdapter>),
    Search(Box<dyn SearchAdapter>),
    Kv(Box<dyn KvAdapter>),
}

#[allow(dead_code)]
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
            // `AppError::Unsupported` does not yet exist; Sprint A1 reuses
            // `Validation` to flag a paradigm mismatch at the command boundary
            // until Sprint A2 introduces a dedicated variant.
            _ => Err(AppError::Validation(
                "Operation requires a relational (RDB) connection".into(),
            )),
        }
    }

    pub fn as_document(&self) -> Result<&dyn DocumentAdapter, AppError> {
        match self {
            ActiveAdapter::Document(a) => Ok(a.as_ref()),
            _ => Err(AppError::Validation(
                "Operation requires a document (MongoDB) connection".into(),
            )),
        }
    }

    pub fn as_search(&self) -> Result<&dyn SearchAdapter, AppError> {
        match self {
            ActiveAdapter::Search(a) => Ok(a.as_ref()),
            _ => Err(AppError::Validation(
                "Operation requires a search connection".into(),
            )),
        }
    }

    pub fn as_kv(&self) -> Result<&dyn KvAdapter, AppError> {
        match self {
            ActiveAdapter::Kv(a) => Ok(a.as_ref()),
            _ => Err(AppError::Validation(
                "Operation requires a key-value connection".into(),
            )),
        }
    }
}
