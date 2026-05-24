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

/// Document-store collection kind returned by the catalog path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentCollectionType {
    Collection,
    View,
    Timeseries,
}

/// Document-native collection catalog metadata.
///
/// This intentionally does not reuse `TableInfo`: Mongo collections are not
/// RDBMS tables, and view/validator/options metadata must stay visible at the
/// document catalog boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCollectionInfo {
    pub name: String,
    pub database: String,
    pub collection_type: DocumentCollectionType,
    pub document_count: Option<i64>,
    pub read_only: bool,
    pub options: serde_json::Value,
    pub id_index: Option<serde_json::Value>,
}

/// MongoDB document identifier (Phase 6).
///
/// Sprint 65 promotes this from a `serde_json::Value`-backed placeholder to a
/// native BSON representation now that the `bson` crate is a first-class
/// dependency. `Raw` retains an escape hatch for exotic `_id` shapes
/// (composite documents, binary types) that do not fit the top three cases.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct DocumentQueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub raw_documents: Vec<bson::Document>,
    pub total_count: i64,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentResultEnvelopeKind {
    Document,
}

/// Typed envelope for document read results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentResultEnvelope {
    pub kind: DocumentResultEnvelopeKind,
    pub document_result: DocumentQueryResult,
}

impl DocumentResultEnvelope {
    pub fn document(document_result: DocumentQueryResult) -> Self {
        Self {
            kind: DocumentResultEnvelopeKind::Document,
            document_result,
        }
    }
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
#[serde(rename_all = "camelCase")]
pub struct DocumentRow {
    pub columns: Vec<QueryColumn>,
    pub row: Vec<serde_json::Value>,
    pub raw: bson::Document,
}

#[cfg(test)]
mod wire_shape_tests {
    use super::*;
    use crate::models::ColumnCategory;

    #[test]
    fn document_id_serializes_variant_tags_as_camel_case() {
        let object_id = serde_json::to_value(DocumentId::ObjectId("507f".into())).unwrap();
        assert_eq!(object_id, serde_json::json!({ "objectId": "507f" }));

        let string_id = serde_json::to_value(DocumentId::String("key".into())).unwrap();
        assert_eq!(string_id, serde_json::json!({ "string": "key" }));

        let number_id = serde_json::to_value(DocumentId::Number(42)).unwrap();
        assert_eq!(number_id, serde_json::json!({ "number": 42 }));
    }

    #[test]
    fn document_query_result_serializes_public_keys_as_camel_case() {
        let result = DocumentQueryResult {
            columns: vec![QueryColumn {
                name: "_id".into(),
                data_type: "ObjectId".into(),
                category: ColumnCategory::Uuid,
            }],
            rows: vec![vec![serde_json::json!("507f")]],
            raw_documents: vec![bson::doc! { "_id": "507f" }],
            total_count: 1,
            execution_time_ms: 7,
        };

        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["columns"][0]["dataType"], "ObjectId");
        assert!(json["columns"][0].get("data_type").is_none());
        assert_eq!(json["rawDocuments"][0]["_id"], "507f");
        assert!(json.get("raw_documents").is_none());
        assert_eq!(json["totalCount"], 1);
        assert!(json.get("total_count").is_none());
        assert_eq!(json["executionTimeMs"], 7);
        assert!(json.get("execution_time_ms").is_none());
    }

    #[test]
    fn document_collection_info_is_not_rdb_table_info_on_the_wire() {
        let collection = DocumentCollectionInfo {
            name: "users".into(),
            database: "app".into(),
            collection_type: DocumentCollectionType::Collection,
            document_count: Some(12),
            read_only: false,
            options: serde_json::json!({ "validator": { "$jsonSchema": {} } }),
            id_index: Some(serde_json::json!({ "name": "_id_" })),
        };

        let json = serde_json::to_value(collection).unwrap();
        assert_eq!(json["collectionType"], "collection");
        assert_eq!(json["documentCount"], 12);
        assert_eq!(
            json["options"]["validator"],
            serde_json::json!({ "$jsonSchema": {} })
        );
        assert!(json.get("schema").is_none());
        assert!(json.get("row_count").is_none());
        assert!(json.get("rowCount").is_none());
    }

    #[test]
    fn document_result_envelope_wraps_document_query_result() {
        let result = DocumentQueryResult {
            columns: vec![QueryColumn {
                name: "_id".into(),
                data_type: "ObjectId".into(),
                category: ColumnCategory::Uuid,
            }],
            rows: vec![vec![serde_json::json!("507f")]],
            raw_documents: vec![bson::doc! { "_id": "507f" }],
            total_count: 1,
            execution_time_ms: 7,
        };

        let json = serde_json::to_value(DocumentResultEnvelope::document(result)).unwrap();
        assert_eq!(json["kind"], "document");
        assert_eq!(json["documentResult"]["columns"][0]["dataType"], "ObjectId");
        assert_eq!(json["documentResult"]["rawDocuments"][0]["_id"], "507f");
        assert!(json.get("queryResult").is_none());
    }

    #[test]
    fn document_row_serializes_nested_columns_as_camel_case() {
        let row = DocumentRow {
            columns: vec![QueryColumn {
                name: "name".into(),
                data_type: "String".into(),
                category: ColumnCategory::Text,
            }],
            row: vec![serde_json::json!("Ada")],
            raw: bson::doc! { "name": "Ada" },
        };

        let json = serde_json::to_value(row).unwrap();
        assert_eq!(json["columns"][0]["dataType"], "String");
        assert!(json["columns"][0].get("data_type").is_none());
        assert_eq!(json["row"][0], "Ada");
        assert_eq!(json["raw"]["name"], "Ada");
    }
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

/// Sprint 351 — direction tag for a single field of a Mongo index key spec.
///
/// 작성 이유 (2026-05-15): MongoDB index key documents use `1` / `-1`
/// integers, but the wire shape from the frontend is intentionally a
/// string enum so the JSON payload is self-documenting. The adapter maps
/// `Asc → 1`, `Desc → -1` when assembling the `IndexModel.keys`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MongoIndexDirection {
    Asc,
    Desc,
}

/// Sprint 351 — single field in a compound (or single-field) index key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoIndexField {
    pub name: String,
    pub direction: MongoIndexDirection,
}

/// Sprint 351 — optional collation block for a Mongo index. `locale` is
/// required when the block is present; `strength` is `1..=5` per the
/// ICU level convention (`Primary..Identical`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoIndexCollation {
    pub locale: String,
    #[serde(default)]
    pub strength: Option<u32>,
}

/// Sprint 351 — full-option create-index request.
///
/// 작성 이유 (2026-05-15): Mongo index 의 옵션 전부를 한 request 로 묶어
/// trait surface 를 single-method 로 유지한다. compound 인덱스는 `fields`
/// 의 길이로 결정되고, TTL(`expire_after_seconds`) 는 단일 필드일 때만
/// 허용 — compound + TTL 조합은 command 계층에서 `AppError::Validation`
/// 로 거부한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMongoIndexRequest {
    /// Optional caller-supplied name. `None` lets the driver fall back to
    /// its default `field_dir_field_dir` naming.
    #[serde(default)]
    pub name: Option<String>,
    /// 1+ field rows. Empty input is rejected at the command layer.
    pub fields: Vec<MongoIndexField>,
    #[serde(default)]
    pub unique: Option<bool>,
    #[serde(default)]
    pub sparse: Option<bool>,
    /// TTL — only valid on a single-field index per MongoDB's contract.
    #[serde(default)]
    pub expire_after_seconds: Option<u32>,
    /// Raw JSON object passed through to `partialFilterExpression`.
    /// Validation (must be a `Document`) lives in the adapter.
    #[serde(default)]
    pub partial_filter_expression: Option<serde_json::Value>,
    #[serde(default)]
    pub collation: Option<MongoIndexCollation>,
}

/// Sprint 351 — server-returned canonical index name from `create_index`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMongoIndexResult {
    pub name: String,
}

/// Sprint 352 — round-trip shape for `get_collection_validator`.
///
/// `validator` is the validator expression JSON (or `null` when the
/// collection has no validator configured). `validation_level` and
/// `validation_action` mirror MongoDB's `validationLevel` /
/// `validationAction` options. `None` on either field signals the server
/// never persisted a custom value — the UI then falls back to the
/// MongoDB defaults (`"strict"` / `"error"`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionValidatorRead {
    #[serde(default)]
    pub validator: Option<serde_json::Value>,
    #[serde(default)]
    pub validation_level: Option<String>,
    #[serde(default)]
    pub validation_action: Option<String>,
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
