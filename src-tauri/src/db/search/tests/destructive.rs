use super::*;

#[tokio::test]
async fn opensearch_live_delete_by_query_preview_uses_safe_search_estimate() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "open-dev",
                "version": {
                    "number": "2.13.0",
                    "distribution": "opensearch"
                },
                "tagline": "The OpenSearch Project: https://opensearch.org/"
            }"#,
        ),
        post_route(
            "/logs-opensearch-2026.05.24/_search",
            r#"{
                "query": { "term": { "status.keyword": "ok" } },
                "size": 0,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 4,
                "timed_out": false,
                "hits": {
                    "total": { "value": 3, "relation": "eq" },
                    "hits": []
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_opensearch();
    let config = search_config_for(port, DatabaseType::Opensearch);

    let result = async {
        adapter.connect(&config).await?;
        let mut request = delete_by_query_request(true, false, None);
        request.index_pattern = "logs-opensearch-2026.05.24".into();
        adapter.plan_delete_by_query(&request).await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let plan = result.unwrap();
    server.await.unwrap();

    assert_eq!(plan.operation, "deleteByQuery");
    assert_eq!(plan.target, "logs-opensearch-2026.05.24");
    assert_eq!(plan.estimated_document_count, Some(3));
    assert!(plan.preview_only);
    assert!(!plan.requires_confirmation);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("execution is unsupported")));
}

#[tokio::test]
async fn fixture_delete_by_query_execution_plan_is_unsupported() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();

    let result = adapter
        .plan_delete_by_query(&delete_by_query_request(
            false,
            true,
            Some("logs-elastic-2026.05.24"),
        ))
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("only preview plans are available"));
        }
        other => panic!("Expected preview-only unsupported error, got {other:?}"),
    }
}

#[tokio::test]
async fn fixture_delete_by_query_rejects_broad_targets_even_with_wildcard_flag() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();

    for target in ["_all", "*", "logs-*"] {
        let mut request = delete_by_query_request(true, false, None);
        request.index_pattern = target.into();
        request.safety.allow_wildcard = true;

        let result = adapter.plan_delete_by_query(&request).await;

        assert!(
            matches!(result.as_ref(), Err(AppError::Validation(message)) if message.contains("wildcard targets are unsupported")),
            "target {target} should be rejected, got {result:?}"
        );
    }
}

#[tokio::test]
async fn elasticsearch_live_delete_by_query_execution_plan_rejects_before_http() {
    let routes = vec![route(
        "/ ",
        r#"{
            "cluster_name": "elastic-dev",
            "version": { "number": "8.12.2" }
        }"#,
    )];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);

    adapter.connect(&config).await.unwrap();
    let result = adapter
        .plan_delete_by_query(&delete_by_query_request(
            false,
            true,
            Some("logs-elastic-2026.05.24"),
        ))
        .await;
    server.await.unwrap();

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("only preview plans are available"));
        }
        other => panic!("Expected preview-only unsupported error, got {other:?}"),
    }
}
