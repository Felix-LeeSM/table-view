use crate::commands::connection::AppState;
use crate::commands::{not_connected, register_cancel_token, release_cancel_token};
use crate::error::AppError;
use crate::models::{
    SearchCatalogSummary, SearchFieldStatsEnvelope, SearchIndexMapping, SearchIndexSettings,
    SearchIndexTemplateInfo, SearchQueryRequest, SearchResultEnvelope,
};

async fn list_search_catalog_summary_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<SearchCatalogSummary, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    let search = active.as_search()?;
    let (identity, indexes, aliases, data_streams) = tokio::try_join!(
        search.cluster_identity(),
        search.list_indexes(),
        search.list_aliases(),
        search.list_data_streams(),
    )?;
    Ok(SearchCatalogSummary {
        identity,
        indexes,
        aliases,
        data_streams,
    })
}

#[tauri::command]
pub async fn list_search_catalog_summary(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<SearchCatalogSummary, AppError> {
    list_search_catalog_summary_inner(state.inner(), &connection_id).await
}

async fn get_search_index_mapping_inner(
    state: &AppState,
    connection_id: &str,
    index: &str,
) -> Result<SearchIndexMapping, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_search()?.get_index_mapping(index).await
}

#[tauri::command]
pub async fn get_search_index_mapping(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    index: String,
) -> Result<SearchIndexMapping, AppError> {
    get_search_index_mapping_inner(state.inner(), &connection_id, &index).await
}

async fn get_search_index_settings_inner(
    state: &AppState,
    connection_id: &str,
    index: &str,
) -> Result<SearchIndexSettings, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_search()?.get_index_settings(index).await
}

#[tauri::command]
pub async fn get_search_index_settings(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    index: String,
) -> Result<SearchIndexSettings, AppError> {
    get_search_index_settings_inner(state.inner(), &connection_id, &index).await
}

async fn list_search_index_templates_inner(
    state: &AppState,
    connection_id: &str,
) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_search()?.list_index_templates().await
}

#[tauri::command]
pub async fn list_search_index_templates(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
    list_search_index_templates_inner(state.inner(), &connection_id).await
}

async fn sample_search_documents_inner(
    state: &AppState,
    connection_id: &str,
    index: &str,
    limit: Option<u64>,
) -> Result<SearchResultEnvelope, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active
        .as_search()?
        .sample_documents(index, limit.unwrap_or(5).clamp(1, 50))
        .await
}

#[tauri::command]
pub async fn sample_search_documents(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    index: String,
    limit: Option<u64>,
) -> Result<SearchResultEnvelope, AppError> {
    sample_search_documents_inner(state.inner(), &connection_id, &index, limit).await
}

async fn get_search_index_field_stats_inner(
    state: &AppState,
    connection_id: &str,
    index: &str,
) -> Result<SearchFieldStatsEnvelope, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(connection_id)
        .ok_or_else(|| not_connected(connection_id))?;
    active.as_search()?.get_index_field_stats(index).await
}

#[tauri::command]
pub async fn get_search_index_field_stats(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    index: String,
) -> Result<SearchFieldStatsEnvelope, AppError> {
    get_search_index_field_stats_inner(state.inner(), &connection_id, &index).await
}

async fn execute_search_query_inner(
    state: &AppState,
    connection_id: &str,
    request: SearchQueryRequest,
    query_id: Option<&str>,
) -> Result<SearchResultEnvelope, AppError> {
    let cancel_handle = register_cancel_token(state, query_id).await;
    let result = async {
        let connections = state.active_connections.lock().await;
        let active = connections
            .get(connection_id)
            .ok_or_else(|| not_connected(connection_id))?;
        active
            .as_search()?
            .search(&request, cancel_handle.as_ref().map(|(_, token)| token))
            .await
    }
    .await;
    release_cancel_token(state, &cancel_handle).await;
    result
}

#[tauri::command]
pub async fn execute_search_query(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    request: SearchQueryRequest,
    query_id: Option<String>,
) -> Result<SearchResultEnvelope, AppError> {
    execute_search_query_inner(state.inner(), &connection_id, request, query_id.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::search::SearchEngineAdapter;
    use crate::db::traits::{DbAdapter, SearchAdapter};
    use crate::db::{ActiveAdapter, BoxFuture};
    use crate::models::{
        ConnectionConfig, DatabaseType, SearchAliasInfo, SearchClusterCapabilities,
        SearchClusterIdentity, SearchDataStreamInfo, SearchFieldStatsEnvelope, SearchIndexHealth,
        SearchIndexInfo, SearchIndexSettings, SearchProductDelta, SearchProductKind,
        SearchTemplateEndpointKind, SearchVersionInfo,
    };
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    async fn search_state() -> AppState {
        let state = AppState::new();
        state.active_connections.lock().await.insert(
            "search".into(),
            ActiveAdapter::Search(Box::new(SearchEngineAdapter::fixture_elasticsearch())),
        );
        state
    }

    fn search_request() -> SearchQueryRequest {
        SearchQueryRequest {
            index: "logs-elastic-2026.05.24".into(),
            body: json!({
                "query": { "match_all": {} },
                "aggs": {
                    "by_status": { "terms": { "field": "status.keyword" } }
                }
            }),
            from: None,
            size: Some(10),
            track_total_hits: Some(true),
        }
    }

    #[tokio::test]
    async fn execute_search_query_routes_to_search_adapter() {
        let state = search_state().await;

        let result = execute_search_query_inner(&state, "search", search_request(), Some("q"))
            .await
            .unwrap();

        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.aggregations[0].name(), "by_status");
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("q"));
    }

    #[tokio::test]
    async fn list_search_catalog_summary_uses_catalog_only_methods() {
        let deep_fetches = Arc::new(AtomicUsize::new(0));
        let state = AppState::new();
        state.active_connections.lock().await.insert(
            "search".into(),
            ActiveAdapter::Search(Box::new(SummaryOnlySearchAdapter {
                deep_fetches: Arc::clone(&deep_fetches),
            })),
        );

        let summary = list_search_catalog_summary_inner(&state, "search")
            .await
            .unwrap();

        assert_eq!(summary.identity.cluster_name, "Search fixture");
        assert_eq!(summary.indexes[0].name, "logs-2026.05.24");
        assert_eq!(summary.aliases[0].name, "logs-current");
        assert_eq!(summary.data_streams[0].name, "logs-default");
        assert_eq!(deep_fetches.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn selected_index_detail_commands_are_explicit() {
        let state = search_state().await;

        let mapping = get_search_index_mapping_inner(&state, "search", "logs-elastic-2026.05.24")
            .await
            .unwrap();
        assert_eq!(mapping.fields[1].path, "message");

        let settings = get_search_index_settings_inner(&state, "search", "logs-elastic-2026.05.24")
            .await
            .unwrap();
        assert_eq!(settings.analyzers[0].analyzer_type, "standard");

        let templates = list_search_index_templates_inner(&state, "search")
            .await
            .unwrap();
        assert_eq!(templates[0].name, "logs-elastic-template");

        let samples =
            sample_search_documents_inner(&state, "search", "logs-elastic-2026.05.24", Some(1))
                .await
                .unwrap();
        assert_eq!(samples.hits.len(), 1);

        let stats = get_search_index_field_stats_inner(&state, "search", "logs-elastic-2026.05.24")
            .await
            .unwrap();
        assert_eq!(stats.fields[2].sample_values[0], json!("ok"));
    }

    #[tokio::test]
    async fn execute_search_query_rejects_unknown_connection() {
        let state = AppState::new();

        assert!(matches!(
            execute_search_query_inner(&state, "missing", search_request(), None).await,
            Err(AppError::NotFound(message)) if message.contains("missing")
        ));
    }

    struct SummaryOnlySearchAdapter {
        deep_fetches: Arc<AtomicUsize>,
    }

    impl DbAdapter for SummaryOnlySearchAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Elasticsearch
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

    impl SearchAdapter for SummaryOnlySearchAdapter {
        fn cluster_identity<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<SearchClusterIdentity, AppError>> {
            Box::pin(async {
                Ok(SearchClusterIdentity {
                    product: SearchProductKind::Elasticsearch,
                    cluster_name: "Search fixture".into(),
                    cluster_uuid: Some("fixture-search".into()),
                    version: SearchVersionInfo {
                        number: "8.12.2".into(),
                        distribution: Some("elasticsearch".into()),
                        lucene: None,
                        build_flavor: None,
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
                    product_delta: SearchProductDelta {
                        product: SearchProductKind::Elasticsearch,
                        supports_elastic_license_api: true,
                        supports_opensearch_plugins_api: false,
                        default_template_endpoint:
                            SearchTemplateEndpointKind::ComposableIndexTemplate,
                    },
                })
            })
        }

        fn list_indexes<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchIndexInfo>, AppError>> {
            Box::pin(async {
                Ok(vec![SearchIndexInfo {
                    name: "logs-2026.05.24".into(),
                    uuid: Some("idx-1".into()),
                    health: SearchIndexHealth::Green,
                    open: true,
                    docs_count: Some(2),
                    store_size_bytes: Some(4096),
                    aliases: vec!["logs-current".into()],
                    primary_shards: Some(1),
                    replica_shards: Some(1),
                }])
            })
        }

        fn list_aliases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchAliasInfo>, AppError>> {
            Box::pin(async {
                Ok(vec![SearchAliasInfo {
                    name: "logs-current".into(),
                    index: "logs-2026.05.24".into(),
                    filter: None,
                    routing: None,
                    write_index: true,
                }])
            })
        }

        fn list_data_streams<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<Vec<SearchDataStreamInfo>, AppError>> {
            Box::pin(async {
                Ok(vec![SearchDataStreamInfo {
                    name: "logs-default".into(),
                    backing_indices: vec![".ds-logs-default-000001".into()],
                    health: SearchIndexHealth::Green,
                    docs_count: Some(2),
                    store_size_bytes: Some(4096),
                    primary_shards: Some(1),
                    replica_shards: Some(1),
                    hidden: false,
                }])
            })
        }

        fn get_index_mapping<'a>(
            &'a self,
            _index: &'a str,
        ) -> BoxFuture<'a, Result<crate::models::SearchIndexMapping, AppError>> {
            self.deep_fetches.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AppError::Unsupported("deep fetch".into())) })
        }

        fn get_index_settings<'a>(
            &'a self,
            _index: &'a str,
        ) -> BoxFuture<'a, Result<SearchIndexSettings, AppError>> {
            self.deep_fetches.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AppError::Unsupported("deep fetch".into())) })
        }

        fn get_index_field_stats<'a>(
            &'a self,
            _index: &'a str,
        ) -> BoxFuture<'a, Result<SearchFieldStatsEnvelope, AppError>> {
            self.deep_fetches.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AppError::Unsupported("deep fetch".into())) })
        }

        fn list_index_templates<'a>(
            &'a self,
        ) -> BoxFuture<'a, Result<Vec<crate::models::SearchIndexTemplateInfo>, AppError>> {
            self.deep_fetches.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AppError::Unsupported("deep fetch".into())) })
        }

        fn sample_documents<'a>(
            &'a self,
            _index: &'a str,
            _limit: u64,
        ) -> BoxFuture<'a, Result<SearchResultEnvelope, AppError>> {
            self.deep_fetches.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(AppError::Unsupported("deep fetch".into())) })
        }
    }
}
