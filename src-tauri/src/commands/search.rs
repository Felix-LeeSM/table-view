use crate::commands::connection::AppState;
use crate::commands::{not_connected, register_cancel_token, release_cancel_token};
use crate::error::AppError;
use crate::models::{SearchQueryRequest, SearchResultEnvelope};

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
    use crate::db::ActiveAdapter;
    use serde_json::json;

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

        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.aggregations[0].name, "by_status");
        let tokens = state.query_tokens.lock().await;
        assert!(!tokens.contains_key("q"));
    }

    #[tokio::test]
    async fn execute_search_query_rejects_unknown_connection() {
        let state = AppState::new();

        assert!(matches!(
            execute_search_query_inner(&state, "missing", search_request(), None).await,
            Err(AppError::NotFound(message)) if message.contains("missing")
        ));
    }
}
