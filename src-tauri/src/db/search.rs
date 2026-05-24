use serde_json::{json, Value};

use crate::error::{AppError, CancelError};
use crate::models::{
    validate_search_destructive_request, ConnectionConfig, DatabaseType, SearchAliasInfo,
    SearchClusterCapabilities, SearchClusterIdentity, SearchDeleteByQueryRequest,
    SearchDestructiveOperationPlan, SearchHitEnvelope, SearchIndexHealth, SearchIndexInfo,
    SearchIndexMapping, SearchIndexTemplateInfo, SearchMappingField, SearchProductDelta,
    SearchProductKind, SearchQueryRequest, SearchResultEnvelope, SearchTemplateEndpointKind,
    SearchTotalHits, SearchTotalHitsRelation, SearchVersionInfo,
};

use super::search_executor::execute_fixture_search;
use super::traits::{DbAdapter, SearchAdapter};
use super::types::BoxFuture;

#[derive(Debug, Clone)]
pub struct SearchCatalogFixture {
    pub identity: SearchClusterIdentity,
    pub indexes: Vec<SearchIndexInfo>,
    pub aliases: Vec<SearchAliasInfo>,
    pub mappings: Vec<SearchIndexMapping>,
    pub templates: Vec<SearchIndexTemplateInfo>,
    pub search_result: SearchResultEnvelope,
}

#[derive(Debug, Clone)]
pub struct SearchEngineAdapter {
    product: SearchProductKind,
    fixture: Option<SearchCatalogFixture>,
}

impl SearchEngineAdapter {
    pub fn new_elasticsearch() -> Self {
        Self {
            product: SearchProductKind::Elasticsearch,
            fixture: None,
        }
    }

    pub fn new_opensearch() -> Self {
        Self {
            product: SearchProductKind::OpenSearch,
            fixture: None,
        }
    }

    pub fn fixture_elasticsearch() -> Self {
        Self {
            product: SearchProductKind::Elasticsearch,
            fixture: Some(SearchCatalogFixture::sample(
                SearchProductKind::Elasticsearch,
            )),
        }
    }

    pub fn fixture_opensearch() -> Self {
        Self {
            product: SearchProductKind::OpenSearch,
            fixture: Some(SearchCatalogFixture::sample(SearchProductKind::OpenSearch)),
        }
    }

    pub fn product(&self) -> SearchProductKind {
        self.product
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        Err(AppError::Unsupported(format!(
            "{:?} network connection is not wired in Sprint 470; catalog tests use fixtures",
            config.db_type
        )))
    }

    fn fixture(&self) -> Result<&SearchCatalogFixture, AppError> {
        self.fixture.as_ref().ok_or_else(|| {
            AppError::Unsupported(format!(
                "{} network Search adapter is not wired in Sprint 470",
                self.product.label()
            ))
        })
    }

    fn mapping_for_fixture(
        fixture: &SearchCatalogFixture,
        index: &str,
    ) -> Result<SearchIndexMapping, AppError> {
        fixture
            .mappings
            .iter()
            .find(|mapping| mapping.index == index)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Search index '{}' not found", index)))
    }
}

impl DbAdapter for SearchEngineAdapter {
    fn kind(&self) -> DatabaseType {
        match self.product {
            SearchProductKind::Elasticsearch => DatabaseType::Elasticsearch,
            SearchProductKind::OpenSearch => DatabaseType::Opensearch,
        }
    }

    fn connect<'a>(&'a self, _config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.fixture()?;
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async { Ok(()) })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.fixture()?;
            Ok(())
        })
    }
}

impl SearchAdapter for SearchEngineAdapter {
    fn cluster_identity<'a>(&'a self) -> BoxFuture<'a, Result<SearchClusterIdentity, AppError>> {
        Box::pin(async move { Ok(self.fixture()?.identity.clone()) })
    }

    fn list_indexes<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchIndexInfo>, AppError>> {
        Box::pin(async move { Ok(self.fixture()?.indexes.clone()) })
    }

    fn list_aliases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchAliasInfo>, AppError>> {
        Box::pin(async move { Ok(self.fixture()?.aliases.clone()) })
    }

    fn get_index_mapping<'a>(
        &'a self,
        index: &'a str,
    ) -> BoxFuture<'a, Result<SearchIndexMapping, AppError>> {
        Box::pin(async move { Self::mapping_for_fixture(self.fixture()?, index) })
    }

    fn list_index_templates<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<SearchIndexTemplateInfo>, AppError>> {
        Box::pin(async move { Ok(self.fixture()?.templates.clone()) })
    }

    fn search<'a>(
        &'a self,
        request: &'a SearchQueryRequest,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> BoxFuture<'a, Result<SearchResultEnvelope, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(|token| token.is_cancelled()) {
                return Err(AppError::Cancel(CancelError::AlreadyCompleted));
            }
            execute_fixture_search(self.fixture()?, request)
        })
    }

    fn plan_delete_by_query<'a>(
        &'a self,
        request: &'a SearchDeleteByQueryRequest,
    ) -> BoxFuture<'a, Result<SearchDestructiveOperationPlan, AppError>> {
        let validation = validate_search_destructive_request(request);
        let target = request.index_pattern.clone();
        let preview_only = request.preview_only;
        Box::pin(async move {
            validation?;
            Ok(SearchDestructiveOperationPlan {
                operation: "deleteByQuery".into(),
                target,
                preview_only,
                requires_confirmation: !preview_only,
                warnings: vec![
                    "Delete-by-query is destructive and must be confirmed before execution".into(),
                ],
                estimated_document_count: None,
            })
        })
    }
}

impl SearchCatalogFixture {
    pub fn sample(product: SearchProductKind) -> Self {
        let version_number = match product {
            SearchProductKind::Elasticsearch => "8.12.2",
            SearchProductKind::OpenSearch => "2.13.0",
        };
        let index_name = match product {
            SearchProductKind::Elasticsearch => "logs-elastic-2026.05.24",
            SearchProductKind::OpenSearch => "logs-opensearch-2026.05.24",
        };
        let alias_name = match product {
            SearchProductKind::Elasticsearch => "logs-elastic",
            SearchProductKind::OpenSearch => "logs-opensearch",
        };
        let template_name = match product {
            SearchProductKind::Elasticsearch => "logs-elastic-template",
            SearchProductKind::OpenSearch => "logs-opensearch-template",
        };
        let distribution = match product {
            SearchProductKind::Elasticsearch => Some("elasticsearch".to_string()),
            SearchProductKind::OpenSearch => Some("opensearch".to_string()),
        };

        Self {
            identity: SearchClusterIdentity {
                product,
                cluster_name: format!("{} fixture", product.label()),
                cluster_uuid: Some(format!("fixture-{}", product.label().to_lowercase())),
                version: SearchVersionInfo {
                    number: version_number.into(),
                    distribution,
                    lucene: Some("9.9.2".into()),
                    build_flavor: Some("default".into()),
                },
                capabilities: SearchClusterCapabilities {
                    search: true,
                    aggregations: true,
                    aliases: true,
                    mappings: true,
                    legacy_index_templates: true,
                    composable_index_templates: true,
                    delete_by_query: true,
                },
                product_delta: SearchProductDelta::for_product(product),
            },
            indexes: vec![SearchIndexInfo {
                name: index_name.into(),
                uuid: Some("idx-fixture-001".into()),
                health: SearchIndexHealth::Green,
                open: true,
                docs_count: Some(2),
                store_size_bytes: Some(4096),
                aliases: vec![alias_name.into()],
                primary_shards: Some(1),
                replica_shards: Some(1),
            }],
            aliases: vec![SearchAliasInfo {
                name: alias_name.into(),
                index: index_name.into(),
                filter: None,
                routing: None,
                write_index: true,
            }],
            mappings: vec![SearchIndexMapping {
                index: index_name.into(),
                fields: vec![
                    SearchMappingField {
                        path: "@timestamp".into(),
                        field_type: "date".into(),
                        searchable: true,
                        aggregatable: true,
                        analyzer: None,
                    },
                    SearchMappingField {
                        path: "message".into(),
                        field_type: "text".into(),
                        searchable: true,
                        aggregatable: false,
                        analyzer: Some("standard".into()),
                    },
                    SearchMappingField {
                        path: "status".into(),
                        field_type: "keyword".into(),
                        searchable: true,
                        aggregatable: true,
                        analyzer: None,
                    },
                ],
                raw: mapping_raw(),
            }],
            templates: vec![SearchIndexTemplateInfo {
                name: template_name.into(),
                endpoint: SearchTemplateEndpointKind::ComposableIndexTemplate,
                index_patterns: vec![format!("{}-*", alias_name)],
                priority: Some(100),
                raw: json!({
                    "index_patterns": [format!("{}-*", alias_name)],
                    "template": { "settings": { "number_of_shards": 1 } }
                }),
            }],
            search_result: SearchResultEnvelope {
                took_ms: 3,
                timed_out: false,
                total: SearchTotalHits {
                    value: 1,
                    relation: SearchTotalHitsRelation::Eq,
                },
                hits: vec![SearchHitEnvelope {
                    index: index_name.into(),
                    id: "doc-1".into(),
                    score: Some(1.0),
                    source: json!({
                        "@timestamp": "2026-05-24T00:00:00Z",
                        "message": "fixture log",
                        "status": "ok"
                    }),
                    fields: None,
                    highlight: None,
                    sort: Vec::<Value>::new(),
                }],
                aggregations: Vec::new(),
            },
        }
    }
}

fn mapping_raw() -> Value {
    json!({
        "properties": {
            "@timestamp": { "type": "date" },
            "message": { "type": "text", "analyzer": "standard" },
            "status": {
                "type": "keyword",
                "fields": { "keyword": { "type": "keyword" } }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fixture_adapter_returns_catalog_without_network() {
        let adapter = SearchEngineAdapter::fixture_elasticsearch();

        let identity = adapter.cluster_identity().await.unwrap();
        assert_eq!(identity.product, SearchProductKind::Elasticsearch);

        let indexes = adapter.list_indexes().await.unwrap();
        assert_eq!(indexes.len(), 1);
        assert!(indexes[0].aliases.contains(&"logs-elastic".to_string()));

        let mapping = adapter
            .get_index_mapping("logs-elastic-2026.05.24")
            .await
            .unwrap();
        assert_eq!(mapping.fields[0].path, "@timestamp");
    }

    #[tokio::test]
    async fn network_adapter_returns_safe_unsupported_without_http_dependency() {
        let adapter = SearchEngineAdapter::new_opensearch();

        assert!(matches!(
            adapter.list_indexes().await,
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            adapter.ping().await,
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn fixture_search_returns_typed_aggregation_envelopes() {
        let adapter = SearchEngineAdapter::fixture_elasticsearch();

        let result = adapter
            .search(
                &SearchQueryRequest {
                    index: "logs-elastic-2026.05.24".into(),
                    body: json!({
                        "query": { "match_all": {} },
                        "aggs": {
                            "by_status": {
                                "terms": { "field": "status.keyword" }
                            }
                        }
                    }),
                    from: None,
                    size: Some(10),
                    track_total_hits: Some(true),
                },
                None,
            )
            .await
            .unwrap();

        assert_eq!(result.hits[0].id, "doc-1");
        assert_eq!(result.aggregations.len(), 1);
        assert_eq!(result.aggregations[0].name, "by_status");
        assert_eq!(result.aggregations[0].kind, "terms");
    }

    #[tokio::test]
    async fn fixture_search_blocks_broad_wildcard_targets_by_default() {
        let adapter = SearchEngineAdapter::fixture_elasticsearch();

        let result = adapter
            .search(
                &SearchQueryRequest {
                    index: "*".into(),
                    body: json!({ "query": { "match_all": {} } }),
                    from: None,
                    size: Some(10),
                    track_total_hits: None,
                },
                None,
            )
            .await;

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("wildcard"))
        );
    }

    #[tokio::test]
    async fn fixture_search_blocks_destructive_path_shaped_targets() {
        let adapter = SearchEngineAdapter::fixture_elasticsearch();

        let result = adapter
            .search(
                &SearchQueryRequest {
                    index: "/logs-elastic-2026.05.24/_delete_by_query".into(),
                    body: json!({ "query": { "match_all": {} } }),
                    from: None,
                    size: Some(10),
                    track_total_hits: None,
                },
                None,
            )
            .await;

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("destructive"))
        );
    }

    #[tokio::test]
    async fn fixture_search_rejects_unsupported_dsl_features_clearly() {
        let adapter = SearchEngineAdapter::fixture_elasticsearch();

        let result = adapter
            .search(
                &SearchQueryRequest {
                    index: "logs-elastic-2026.05.24".into(),
                    body: json!({
                        "query": { "match_all": {} },
                        "suggest": {
                            "message-suggest": {
                                "text": "fixture",
                                "term": { "field": "message" }
                            }
                        }
                    }),
                    from: None,
                    size: Some(10),
                    track_total_hits: None,
                },
                None,
            )
            .await;

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("suggest"))
        );
    }
}
