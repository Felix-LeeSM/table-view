mod common;

use bson::doc;
use common::query_result_contracts::assert_unsupported_error;
use serde_json::json;
use table_view_lib::db::{
    BoxFuture, DbAdapter, DocumentQueryResult, DocumentResultEnvelope, SearchAdapter,
};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    ColumnCategory, ConnectionConfig, DatabaseType, QueryColumn, SearchAggregationEnvelope,
    SearchHitEnvelope, SearchQueryRequest, SearchResultEnvelope, SearchTotalHits,
    SearchTotalHitsRelation,
};

#[test]
fn document_result_envelope_stays_document_boundary() {
    let envelope = DocumentResultEnvelope::document(DocumentQueryResult {
        columns: vec![QueryColumn {
            name: "_id".into(),
            data_type: "ObjectId".into(),
            category: ColumnCategory::Uuid,
        }],
        rows: vec![vec![json!("507f1f77bcf86cd799439011")]],
        raw_documents: vec![doc! { "_id": "507f1f77bcf86cd799439011" }],
        total_count: 1,
        execution_time_ms: 7,
        truncated: false,
    });

    let value = serde_json::to_value(envelope).expect("document envelope should serialize");
    assert_eq!(value["kind"], "document");
    assert!(value.get("documentResult").is_some());
    assert!(value.get("columns").is_none());
    assert!(value.get("rows").is_none());

    let document = &value["documentResult"];
    assert_eq!(document["columns"][0]["dataType"], "ObjectId");
    assert_eq!(
        document["rawDocuments"][0]["_id"],
        "507f1f77bcf86cd799439011"
    );
    assert_eq!(document["totalCount"], 1);
    assert_eq!(document["executionTimeMs"], 7);
    assert!(document.get("queryType").is_none());
    assert!(document.get("raw_documents").is_none());
}

#[test]
fn search_result_envelope_stays_search_hits_boundary() {
    let envelope = SearchResultEnvelope {
        took_ms: 3,
        timed_out: false,
        total: SearchTotalHits {
            value: 1,
            relation: SearchTotalHitsRelation::Eq,
        },
        hits: vec![SearchHitEnvelope {
            index: "users".into(),
            id: "1".into(),
            score: Some(1.0),
            source: json!({ "name": "Ada" }),
            fields: None,
            highlight: None,
            explanation: None,
            sort: vec![json!("1")],
        }],
        aggregations: vec![SearchAggregationEnvelope::ValueCount {
            name: "docs".into(),
            value: 1,
        }],
        shards: None,
        explain: None,
        profile: None,
    };

    let value = serde_json::to_value(envelope).expect("search envelope should serialize");
    assert_eq!(value["tookMs"], 3);
    assert_eq!(value["timedOut"], false);
    assert_eq!(value["total"]["relation"], "eq");
    assert_eq!(value["hits"][0]["id"], "1");
    assert_eq!(value["aggregations"][0]["kind"], "value_count");
    assert!(value.get("columns").is_none());
    assert!(value.get("rows").is_none());
    assert!(value.get("queryType").is_none());
    assert!(value.get("took_ms").is_none());
}

#[tokio::test]
async fn search_default_query_execution_returns_unsupported_error_shape() {
    let adapter = QueryUnsupportedSearchAdapter;
    let request = SearchQueryRequest {
        index: "users".into(),
        body: json!({ "query": { "match_all": {} } }),
        from: None,
        size: Some(10),
        track_total_hits: Some(true),
    };

    let result = SearchAdapter::search(&adapter, &request, None).await;
    assert_unsupported_error(result, "Search DSL execution is not wired");
}

struct QueryUnsupportedSearchAdapter;

impl DbAdapter for QueryUnsupportedSearchAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Elasticsearch
    }

    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }
}

impl SearchAdapter for QueryUnsupportedSearchAdapter {}
