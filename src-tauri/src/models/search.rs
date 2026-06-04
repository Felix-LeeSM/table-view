use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchProductKind {
    Elasticsearch,
    OpenSearch,
}

impl SearchProductKind {
    pub fn label(self) -> &'static str {
        match self {
            SearchProductKind::Elasticsearch => "Elasticsearch",
            SearchProductKind::OpenSearch => "OpenSearch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchTemplateEndpointKind {
    LegacyIndexTemplate,
    ComposableIndexTemplate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProductDelta {
    pub product: SearchProductKind,
    pub supports_elastic_license_api: bool,
    pub supports_opensearch_plugins_api: bool,
    pub default_template_endpoint: SearchTemplateEndpointKind,
}

impl SearchProductDelta {
    pub fn for_product(product: SearchProductKind) -> Self {
        match product {
            SearchProductKind::Elasticsearch => Self {
                product,
                supports_elastic_license_api: true,
                supports_opensearch_plugins_api: false,
                default_template_endpoint: SearchTemplateEndpointKind::ComposableIndexTemplate,
            },
            SearchProductKind::OpenSearch => Self {
                product,
                supports_elastic_license_api: false,
                supports_opensearch_plugins_api: true,
                default_template_endpoint: SearchTemplateEndpointKind::ComposableIndexTemplate,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchVersionInfo {
    pub number: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lucene: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_flavor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchClusterCapabilities {
    pub search: bool,
    pub aggregations: bool,
    pub aliases: bool,
    pub mappings: bool,
    pub legacy_index_templates: bool,
    pub composable_index_templates: bool,
    pub delete_by_query: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchClusterIdentity {
    pub product: SearchProductKind,
    pub cluster_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cluster_uuid: Option<String>,
    pub version: SearchVersionInfo,
    pub capabilities: SearchClusterCapabilities,
    pub product_delta: SearchProductDelta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchIndexHealth {
    Green,
    Yellow,
    Red,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uuid: Option<String>,
    pub health: SearchIndexHealth,
    pub open: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_size_bytes: Option<u64>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_shards: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replica_shards: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDataStreamInfo {
    pub name: String,
    #[serde(default)]
    pub backing_indices: Vec<String>,
    pub health: SearchIndexHealth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_shards: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replica_shards: Option<u32>,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAliasInfo {
    pub name: String,
    pub index: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routing: Option<String>,
    #[serde(default)]
    pub write_index: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCatalogSummary {
    pub identity: SearchClusterIdentity,
    pub indexes: Vec<SearchIndexInfo>,
    pub aliases: Vec<SearchAliasInfo>,
    pub data_streams: Vec<SearchDataStreamInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMappingField {
    pub path: String,
    pub field_type: String,
    #[serde(default)]
    pub searchable: bool,
    #[serde(default)]
    pub aggregatable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analyzer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexMapping {
    pub index: String,
    pub fields: Vec<SearchMappingField>,
    pub raw: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexTemplateInfo {
    pub name: String,
    pub endpoint: SearchTemplateEndpointKind,
    #[serde(default)]
    pub index_patterns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i64>,
    pub raw: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAnalyzerInfo {
    pub name: String,
    pub analyzer_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokenizer: Option<String>,
    #[serde(default)]
    pub filters: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexSettings {
    pub index: String,
    pub raw: Value,
    #[serde(default)]
    pub analyzers: Vec<SearchAnalyzerInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFieldStatsInfo {
    pub path: String,
    pub field_type: String,
    #[serde(default)]
    pub searchable: bool,
    #[serde(default)]
    pub aggregatable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_count: Option<u64>,
    #[serde(default)]
    pub sample_values: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFieldStatsEnvelope {
    pub index: String,
    #[serde(default)]
    pub fields: Vec<SearchFieldStatsInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryRequest {
    pub index: String,
    pub body: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_total_hits: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchTotalHitsRelation {
    Eq,
    Gte,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTotalHits {
    pub value: u64,
    pub relation: SearchTotalHitsRelation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitEnvelope {
    pub index: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    pub source: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<Value>,
    #[serde(default)]
    pub sort: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTermsBucket {
    pub key: String,
    pub doc_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchAggregationEnvelope {
    Terms {
        name: String,
        buckets: Vec<SearchTermsBucket>,
    },
    ValueCount {
        name: String,
        value: u64,
    },
    Raw {
        name: String,
        #[serde(
            rename = "aggregationType",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        aggregation_type: Option<String>,
        raw: Value,
    },
}

impl SearchAggregationEnvelope {
    pub fn name(&self) -> &str {
        match self {
            SearchAggregationEnvelope::Terms { name, .. }
            | SearchAggregationEnvelope::ValueCount { name, .. }
            | SearchAggregationEnvelope::Raw { name, .. } => name,
        }
    }
}

#[cfg(test)]
mod search_aggregation_tests {
    use serde_json::json;

    use super::SearchAggregationEnvelope;

    #[test]
    fn raw_aggregation_serializes_frontend_contract_field_names() {
        let value = serde_json::to_value(SearchAggregationEnvelope::Raw {
            name: "latency".into(),
            aggregation_type: Some("percentiles".into()),
            raw: json!({ "percentiles": { "field": "duration_ms" } }),
        })
        .expect("raw aggregation should serialize");

        assert_eq!(
            value,
            json!({
                "kind": "raw",
                "name": "latency",
                "aggregationType": "percentiles",
                "raw": { "percentiles": { "field": "duration_ms" } }
            })
        );
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchShardFailure {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shard: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    pub reason: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchShardSummary {
    pub total: u64,
    pub successful: u64,
    pub skipped: u64,
    pub failed: u64,
    #[serde(default)]
    pub failures: Vec<SearchShardFailure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultEnvelope {
    pub took_ms: u64,
    pub timed_out: bool,
    pub total: SearchTotalHits,
    pub hits: Vec<SearchHitEnvelope>,
    #[serde(default)]
    pub aggregations: Vec<SearchAggregationEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shards: Option<SearchShardSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explain: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDestructiveSafety {
    pub acknowledged_risk: bool,
    pub allow_wildcard: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDeleteByQueryRequest {
    pub index_pattern: String,
    pub body: Value,
    pub preview_only: bool,
    pub safety: SearchDestructiveSafety,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDestructiveOperationPlan {
    pub operation: String,
    pub target: String,
    pub preview_only: bool,
    pub requires_confirmation: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_document_count: Option<u64>,
}

pub fn validate_search_destructive_request(
    request: &SearchDeleteByQueryRequest,
) -> Result<(), AppError> {
    let target = request.index_pattern.trim();
    if target.is_empty() {
        return Err(AppError::Validation(
            "delete-by-query requires an index target".into(),
        ));
    }

    let wildcard_target = target == "_all" || target.contains('*');
    if wildcard_target && !request.safety.allow_wildcard {
        return Err(AppError::Validation(
            "delete-by-query wildcard targets require allowWildcard".into(),
        ));
    }

    if !request.preview_only {
        if !request.safety.acknowledged_risk {
            return Err(AppError::Validation(
                "delete-by-query execution requires acknowledgedRisk".into(),
            ));
        }
        if request.safety.expected_target.as_deref() != Some(target) {
            return Err(AppError::Validation(
                "delete-by-query execution requires expectedTarget to match the target".into(),
            ));
        }
    }

    let has_query = request
        .body
        .as_object()
        .is_some_and(|body| body.contains_key("query"));
    if !has_query {
        return Err(AppError::Validation(
            "delete-by-query requires a query body".into(),
        ));
    }

    Ok(())
}
