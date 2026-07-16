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
    // #1076 — execution is live behind the confirm gate; the plan now asks for
    // confirmation and drops the old "execution unsupported" warning.
    assert!(plan.requires_confirmation);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("cannot be undone")));
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
async fn elasticsearch_live_delete_by_query_executes_and_reports_partial_failure() {
    // #1076 — the live execute path POSTs `_delete_by_query?conflicts=proceed`
    // with just the query clause and parses ES's `deleted` / `failures[]` into
    // the typed result. A partial delete (some deleted, some conflicted) stays
    // data so the UI can report "deleted N, failed M".
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route(
            "/logs-elastic-2026.05.24/_delete_by_query",
            r#"{ "query": { "term": { "status.keyword": "ok" } } }"#,
            r#"{
                "took": 12,
                "timed_out": false,
                "total": 4,
                "deleted": 3,
                "version_conflicts": 1,
                "batches": 1,
                "failures": [
                    {
                        "index": "logs-elastic-2026.05.24",
                        "id": "doc-9",
                        "status": 409,
                        "cause": { "type": "version_conflict_engine_exception", "reason": "stale" }
                    }
                ]
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);

    let result = async {
        adapter.connect(&config).await?;
        adapter
            .execute_delete_by_query(&delete_by_query_request(false, true, None))
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let outcome = result.unwrap();
    server.await.unwrap();

    assert_eq!(outcome.target, "logs-elastic-2026.05.24");
    assert_eq!(outcome.total, 4);
    assert_eq!(outcome.deleted, 3);
    assert_eq!(outcome.version_conflicts, 1);
    assert_eq!(outcome.failures.len(), 1);
    assert_eq!(outcome.failures[0].status, Some(409));
}
