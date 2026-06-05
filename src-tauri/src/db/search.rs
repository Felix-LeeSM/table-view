use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::error::{AppError, CancelError};
use crate::models::{
    ConnectionConfig, DatabaseType, SearchAliasInfo, SearchAnalyzerInfo, SearchClusterCapabilities,
    SearchClusterIdentity, SearchDataStreamInfo, SearchDeleteByQueryRequest,
    SearchDestructiveOperationPlan, SearchFieldStatsEnvelope, SearchFieldStatsInfo,
    SearchHitEnvelope, SearchIndexHealth, SearchIndexInfo, SearchIndexMapping, SearchIndexSettings,
    SearchIndexTemplateInfo, SearchMappingField, SearchProductDelta, SearchProductKind,
    SearchQueryRequest, SearchResultEnvelope, SearchTemplateEndpointKind, SearchTotalHits,
    SearchTotalHitsRelation, SearchVersionInfo,
};

use super::search_destructive::{build_delete_by_query_plan, validate_delete_by_query_request};
use super::search_executor::{estimate_fixture_delete_by_query, execute_fixture_search};
use super::search_http::{
    open_elasticsearch_connection, open_opensearch_connection, SearchHttpConnection,
};
use super::traits::{DbAdapter, SearchAdapter};
use super::types::BoxFuture;

#[derive(Debug, Clone)]
pub struct SearchCatalogFixture {
    pub identity: SearchClusterIdentity,
    pub indexes: Vec<SearchIndexInfo>,
    pub aliases: Vec<SearchAliasInfo>,
    pub data_streams: Vec<SearchDataStreamInfo>,
    pub mappings: Vec<SearchIndexMapping>,
    pub settings: Vec<SearchIndexSettings>,
    pub field_stats: Vec<SearchFieldStatsEnvelope>,
    pub templates: Vec<SearchIndexTemplateInfo>,
    pub search_result: SearchResultEnvelope,
}

#[derive(Debug, Clone)]
pub struct SearchEngineAdapter {
    product: SearchProductKind,
    fixture: Option<SearchCatalogFixture>,
    live: Arc<Mutex<Option<SearchHttpConnection>>>,
}

impl SearchEngineAdapter {
    pub fn new_elasticsearch() -> Self {
        Self {
            product: SearchProductKind::Elasticsearch,
            fixture: None,
            live: Arc::new(Mutex::new(None)),
        }
    }

    pub fn new_opensearch() -> Self {
        Self {
            product: SearchProductKind::OpenSearch,
            fixture: None,
            live: Arc::new(Mutex::new(None)),
        }
    }

    pub fn fixture_elasticsearch() -> Self {
        Self {
            product: SearchProductKind::Elasticsearch,
            fixture: Some(SearchCatalogFixture::sample(
                SearchProductKind::Elasticsearch,
            )),
            live: Arc::new(Mutex::new(None)),
        }
    }

    pub fn fixture_opensearch() -> Self {
        Self {
            product: SearchProductKind::OpenSearch,
            fixture: Some(SearchCatalogFixture::sample(SearchProductKind::OpenSearch)),
            live: Arc::new(Mutex::new(None)),
        }
    }

    pub fn product(&self) -> SearchProductKind {
        self.product
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        match config.db_type {
            DatabaseType::Elasticsearch => {
                open_elasticsearch_connection(config).await?;
                Ok(())
            }
            DatabaseType::Opensearch => {
                open_opensearch_connection(config).await?;
                Ok(())
            }
            _ => Err(AppError::Unsupported(format!(
                "{:?} is not a Search live HTTP connection",
                config.db_type
            ))),
        }
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

    fn settings_for_fixture(
        fixture: &SearchCatalogFixture,
        index: &str,
    ) -> Result<SearchIndexSettings, AppError> {
        fixture
            .settings
            .iter()
            .find(|settings| settings.index == index)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Search index '{}' not found", index)))
    }

    fn field_stats_for_fixture(
        fixture: &SearchCatalogFixture,
        index: &str,
    ) -> Result<SearchFieldStatsEnvelope, AppError> {
        fixture
            .field_stats
            .iter()
            .find(|stats| stats.index == index)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Search index '{}' not found", index)))
    }

    fn sample_documents_for_fixture(
        fixture: &SearchCatalogFixture,
        index: &str,
        limit: u64,
    ) -> Result<SearchResultEnvelope, AppError> {
        let known = fixture.indexes.iter().any(|item| item.name == index)
            || fixture
                .mappings
                .iter()
                .any(|mapping| mapping.index == index);
        if !known {
            return Err(AppError::NotFound(format!(
                "Search index '{}' not found",
                index
            )));
        }
        let mut result = fixture.search_result.clone();
        result.hits.retain(|hit| hit.index == index);
        result.hits.truncate(limit as usize);
        result.total.value = result.hits.len() as u64;
        Ok(result)
    }

    fn not_connected_error(&self) -> AppError {
        AppError::Connection(format!(
            "{} connection is not established",
            self.product.label()
        ))
    }

    async fn live_connection(&self) -> Result<SearchHttpConnection, AppError> {
        self.live
            .lock()
            .await
            .clone()
            .ok_or_else(|| self.not_connected_error())
    }
}

impl DbAdapter for SearchEngineAdapter {
    fn kind(&self) -> DatabaseType {
        match self.product {
            SearchProductKind::Elasticsearch => DatabaseType::Elasticsearch,
            SearchProductKind::OpenSearch => DatabaseType::Opensearch,
        }
    }

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            if self.fixture.is_some() {
                return Ok(());
            }
            match self.product {
                SearchProductKind::Elasticsearch => {
                    let connection = open_elasticsearch_connection(config).await?;
                    *self.live.lock().await = Some(connection);
                }
                SearchProductKind::OpenSearch => {
                    let connection = open_opensearch_connection(config).await?;
                    *self.live.lock().await = Some(connection);
                }
            }
            Ok(())
        })
    }

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            *self.live.lock().await = None;
            Ok(())
        })
    }

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            if self.fixture.is_some() {
                return Ok(());
            }
            let connection = self
                .live
                .lock()
                .await
                .clone()
                .ok_or_else(|| self.not_connected_error())?;
            connection.ping().await?;
            Ok(())
        })
    }
}

impl SearchAdapter for SearchEngineAdapter {
    fn cluster_identity<'a>(&'a self) -> BoxFuture<'a, Result<SearchClusterIdentity, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Ok(fixture.identity.clone());
            }
            self.live
                .lock()
                .await
                .as_ref()
                .map(SearchHttpConnection::identity)
                .ok_or_else(|| self.not_connected_error())
        })
    }

    fn list_indexes<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchIndexInfo>, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Ok(fixture.indexes.clone());
            }
            self.live_connection().await?.list_indexes().await
        })
    }

    fn list_aliases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchAliasInfo>, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Ok(fixture.aliases.clone());
            }
            self.live_connection().await?.list_aliases().await
        })
    }

    fn list_data_streams<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<SearchDataStreamInfo>, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Ok(fixture.data_streams.clone());
            }
            self.live_connection().await?.list_data_streams().await
        })
    }

    fn get_index_mapping<'a>(
        &'a self,
        index: &'a str,
    ) -> BoxFuture<'a, Result<SearchIndexMapping, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Self::mapping_for_fixture(fixture, index);
            }
            self.live_connection().await?.get_index_mapping(index).await
        })
    }

    fn get_index_settings<'a>(
        &'a self,
        index: &'a str,
    ) -> BoxFuture<'a, Result<SearchIndexSettings, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Self::settings_for_fixture(fixture, index);
            }
            self.live_connection()
                .await?
                .get_index_settings(index)
                .await
        })
    }

    fn get_index_field_stats<'a>(
        &'a self,
        index: &'a str,
    ) -> BoxFuture<'a, Result<SearchFieldStatsEnvelope, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Self::field_stats_for_fixture(fixture, index);
            }
            self.live_connection()
                .await?
                .get_index_field_stats(index)
                .await
        })
    }

    fn list_index_templates<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<SearchIndexTemplateInfo>, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Ok(fixture.templates.clone());
            }
            self.live_connection().await?.list_index_templates().await
        })
    }

    fn sample_documents<'a>(
        &'a self,
        index: &'a str,
        limit: u64,
    ) -> BoxFuture<'a, Result<SearchResultEnvelope, AppError>> {
        Box::pin(async move {
            if let Some(fixture) = self.fixture.as_ref() {
                return Self::sample_documents_for_fixture(fixture, index, limit);
            }
            self.live_connection()
                .await?
                .sample_documents(index, limit)
                .await
        })
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
            if let Some(fixture) = self.fixture.as_ref() {
                return execute_fixture_search(fixture, request);
            }
            self.live_connection().await?.search(request, cancel).await
        })
    }

    fn plan_delete_by_query<'a>(
        &'a self,
        request: &'a SearchDeleteByQueryRequest,
    ) -> BoxFuture<'a, Result<SearchDestructiveOperationPlan, AppError>> {
        Box::pin(async move {
            validate_delete_by_query_request(request)?;
            if let Some(fixture) = self.fixture.as_ref() {
                let estimate = estimate_fixture_delete_by_query(fixture, request)?;
                return Ok(build_delete_by_query_plan(request, Some(estimate)));
            }
            self.live_connection()
                .await?
                .plan_delete_by_query(request)
                .await
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
        let data_stream_name = match product {
            SearchProductKind::Elasticsearch => "logs-elastic-default",
            SearchProductKind::OpenSearch => "logs-opensearch-default",
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
            data_streams: vec![SearchDataStreamInfo {
                name: data_stream_name.into(),
                backing_indices: vec![format!(".ds-{}-2026.05.24-000001", data_stream_name)],
                health: SearchIndexHealth::Green,
                docs_count: Some(2),
                store_size_bytes: Some(4096),
                primary_shards: Some(1),
                replica_shards: Some(1),
                hidden: false,
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
            settings: vec![SearchIndexSettings {
                index: index_name.into(),
                raw: settings_raw(),
                analyzers: vec![SearchAnalyzerInfo {
                    name: "default".into(),
                    analyzer_type: "standard".into(),
                    tokenizer: Some("standard".into()),
                    filters: vec!["lowercase".into()],
                }],
            }],
            field_stats: vec![SearchFieldStatsEnvelope {
                index: index_name.into(),
                fields: vec![
                    SearchFieldStatsInfo {
                        path: "@timestamp".into(),
                        field_type: "date".into(),
                        searchable: true,
                        aggregatable: true,
                        docs_count: Some(2),
                        sample_values: vec![
                            json!("2026-05-24T00:00:00Z"),
                            json!("2026-05-24T00:01:00Z"),
                        ],
                    },
                    SearchFieldStatsInfo {
                        path: "message".into(),
                        field_type: "text".into(),
                        searchable: true,
                        aggregatable: false,
                        docs_count: Some(2),
                        sample_values: vec![json!("fixture log"), json!("fixture error")],
                    },
                    SearchFieldStatsInfo {
                        path: "status".into(),
                        field_type: "keyword".into(),
                        searchable: true,
                        aggregatable: true,
                        docs_count: Some(2),
                        sample_values: vec![json!("ok"), json!("error")],
                    },
                ],
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
                hits: vec![
                    SearchHitEnvelope {
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
                        explanation: None,
                        sort: Vec::<Value>::new(),
                    },
                    SearchHitEnvelope {
                        index: index_name.into(),
                        id: "doc-2".into(),
                        score: Some(0.8),
                        source: json!({
                            "@timestamp": "2026-05-24T00:01:00Z",
                            "message": "fixture error",
                            "status": "error"
                        }),
                        fields: None,
                        highlight: None,
                        explanation: None,
                        sort: Vec::<Value>::new(),
                    },
                ],
                aggregations: Vec::new(),
                shards: None,
                explain: None,
                profile: None,
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

fn settings_raw() -> Value {
    json!({
        "index": {
            "number_of_shards": "1",
            "number_of_replicas": "1",
            "analysis": {
                "analyzer": {
                    "default": {
                        "type": "standard",
                        "tokenizer": "standard",
                        "filter": ["lowercase"]
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests;
