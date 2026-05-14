//! DTOs and shared type aliases consumed by every adapter paradigm.
//!
//! Hoisted out of `db/mod.rs` (Sprint 213, P5 step 2) so the production
//! mod.rs becomes a thin entry point that just declares submodules and
//! re-exports the public surface. No behaviour change — `crate::db::*`
//! still resolves every type below via `pub use` in `db/mod.rs`.

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::models::{QueryColumn, QueryResult, SchemaInfo};

/// Local BoxFuture alias — the project does not depend on the `futures` crate
/// yet, so we reproduce the common `BoxFuture<'a, T>` shape here. All trait
/// methods in this module use this alias uniformly for readability.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

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
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub raw_documents: Vec<bson::Document>,
    pub total_count: i64,
    pub execution_time_ms: u64,
}

/// Sprint 308 — single-document projection for `find_one`.
///
/// 작성 이유 (2026-05-14): A1 mongosh 파서가 `findOne(...)` 을 dispatch
/// 했을 때 single row 를 grid 또는 scalar panel 로 렌더링할 수 있도록
/// `DocumentQueryResult` 의 단일-문서 슬라이스 shape 을 그대로 매칭한다.
/// `columns` 는 `flatten_cell` 의 BFS 순서를 따르고 (`_id` first), `row` 는
/// `columns` 와 길이가 같다 (`raw` 는 원본 BSON 을 보존해 Quick Look 이
/// 그대로 렌더링).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRow {
    pub columns: Vec<QueryColumn>,
    pub row: Vec<serde_json::Value>,
    pub raw: bson::Document,
}

/// Sprint 308 — `bulkWrite` sub-op wire shape.
///
/// 작성 이유 (2026-05-14): A1 파서가 `db.coll.bulkWrite([...])` 의 배열
/// 항목을 각 variant 로 reify 하면, A5/A6 dispatch 가 그대로 IPC 페이로드로
/// 전송한다. serde `tag = "op"` + `rename_all = "camelCase"` 라 wire JSON 은
/// `{ "op": "updateOne", "filter": {...}, "update": {...} }` 형태.
///
/// `ordered: true` 는 Mongo driver default 라 본 enum 에 포함하지 않는다
/// (contract: "Mongo driver 기본값(`true`)로 고정"). 첫 실패 시 short-circuit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum BulkWriteOp {
    InsertOne {
        document: bson::Document,
    },
    UpdateOne {
        filter: bson::Document,
        update: bson::Document,
        #[serde(default)]
        upsert: bool,
    },
    UpdateMany {
        filter: bson::Document,
        update: bson::Document,
        #[serde(default)]
        upsert: bool,
    },
    DeleteOne {
        filter: bson::Document,
    },
    DeleteMany {
        filter: bson::Document,
    },
    ReplaceOne {
        filter: bson::Document,
        replacement: bson::Document,
        #[serde(default)]
        upsert: bool,
    },
}

/// Sprint 308 — aggregate counters returned by `bulkWrite`.
///
/// 작성 이유 (2026-05-14): A6 `WriteSummaryPanel` 의 per-op breakdown row
/// 와 직접 mapping. `inserted_count` / `matched_count` / `modified_count` /
/// `deleted_count` 4 카운터 + `upserted_ids` (서버가 upsert 한 신규 doc id).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BulkWriteResult {
    pub inserted_count: i64,
    pub matched_count: i64,
    pub modified_count: i64,
    pub deleted_count: i64,
    pub upserted_ids: Vec<DocumentId>,
}
