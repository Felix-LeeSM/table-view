use super::*;
use crate::models::SearchAggregationEnvelope;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn elasticsearch_live_search_dispatches_request_and_parses_result_envelope() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route(
            "/logs-elastic-2026.05.24/_search",
            r#"{
                "query": {
                    "bool": {
                        "filter": [{ "term": { "status.keyword": "ok" } }],
                        "must": { "match": { "message": "live" } }
                    }
                },
                "aggs": {
                    "by_status": { "terms": { "field": "status.keyword" } },
                    "message_count": { "value_count": { "field": "message" } }
                },
                "from": 5,
                "size": 10,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 12,
                "timed_out": false,
                "_shards": {
                    "total": 2,
                    "successful": 1,
                    "skipped": 0,
                    "failed": 1,
                    "failures": [
                        {
                            "shard": 0,
                            "index": "logs-elastic-2026.05.24",
                            "node": "node-a",
                            "reason": {
                                "type": "query_shard_exception",
                                "reason": "bad shard"
                            }
                        }
                    ]
                },
                "hits": {
                    "total": { "value": 42, "relation": "gte" },
                    "hits": [
                        {
                            "_index": "logs-elastic-2026.05.24",
                            "_id": "doc-1",
                            "_score": 1.5,
                            "_source": {
                                "message": "live log",
                                "status": "ok"
                            },
                            "fields": { "host.keyword": ["api-1"] },
                            "highlight": { "message": ["<em>live</em> log"] },
                            "sort": ["2026-05-24T00:00:00Z", "doc-1"],
                            "_explanation": { "value": 1.5, "description": "match" }
                        }
                    ]
                },
                "aggregations": {
                    "by_status": {
                        "buckets": [{ "key": "ok", "doc_count": 7 }]
                    },
                    "message_count": { "value": 42 },
                    "latency_percentiles": { "values": { "95.0": 12.5 } }
                },
                "profile": { "shards": [{ "id": "profile-1" }] }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);

    let result = async {
        adapter.connect(&config).await?;
        adapter
            .search(
                &SearchQueryRequest {
                    index: "logs-elastic-2026.05.24".into(),
                    body: json!({
                        "query": {
                            "bool": {
                                "filter": [{ "term": { "status.keyword": "ok" } }],
                                "must": { "match": { "message": "live" } }
                            }
                        },
                        "aggs": {
                            "by_status": { "terms": { "field": "status.keyword" } },
                            "message_count": { "value_count": { "field": "message" } }
                        }
                    }),
                    from: Some(5),
                    size: Some(10),
                    track_total_hits: Some(true),
                },
                None,
            )
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let result = result.unwrap();
    server.await.unwrap();

    assert_eq!(result.took_ms, 12);
    assert!(!result.timed_out);
    assert_eq!(result.total.value, 42);
    assert_eq!(result.total.relation, SearchTotalHitsRelation::Gte);
    assert_eq!(result.hits[0].id, "doc-1");
    assert_eq!(result.hits[0].score, Some(1.5));
    assert_eq!(result.hits[0].source["message"], json!("live log"));
    assert_eq!(
        result.hits[0].fields.as_ref().unwrap()["host.keyword"][0],
        json!("api-1")
    );
    assert_eq!(
        result.hits[0].highlight.as_ref().unwrap()["message"][0],
        json!("<em>live</em> log")
    );
    assert_eq!(result.hits[0].sort[1], json!("doc-1"));
    assert_eq!(
        result.hits[0].explanation.as_ref().unwrap()["description"],
        json!("match")
    );
    assert_eq!(result.shards.as_ref().unwrap().failed, 1);
    assert_eq!(
        result.shards.as_ref().unwrap().failures[0].reason["reason"],
        json!("bad shard")
    );
    assert_eq!(
        result.profile.as_ref().unwrap()["shards"][0]["id"],
        json!("profile-1")
    );
    match &result.aggregations[0] {
        SearchAggregationEnvelope::Terms { name, buckets } => {
            assert_eq!(name, "by_status");
            assert_eq!(buckets[0].key, "ok");
            assert_eq!(buckets[0].doc_count, 7);
        }
        other => panic!("expected terms aggregation, got {other:?}"),
    }
    assert_eq!(
        result.aggregations[1],
        SearchAggregationEnvelope::ValueCount {
            name: "message_count".into(),
            value: 42
        }
    );
    match &result.aggregations[2] {
        SearchAggregationEnvelope::Raw {
            name,
            aggregation_type,
            raw,
        } => {
            assert_eq!(name, "latency_percentiles");
            assert_eq!(aggregation_type.as_deref(), Some("raw"));
            assert_eq!(raw["values"]["95.0"], json!(12.5));
        }
        other => panic!("expected raw aggregation, got {other:?}"),
    }
}

#[tokio::test]
async fn opensearch_live_search_dispatches_request_and_parses_result_envelope() {
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
                "query": {
                    "bool": {
                        "filter": [{ "term": { "status.keyword": "ok" } }],
                        "must": { "match": { "message": "live" } }
                    }
                },
                "aggs": {
                    "by_status": { "terms": { "field": "status.keyword" } },
                    "message_count": { "value_count": { "field": "message" } }
                },
                "from": 5,
                "size": 10,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 9,
                "timed_out": false,
                "_shards": {
                    "total": 2,
                    "successful": 1,
                    "skipped": 0,
                    "failed": 1,
                    "failures": [
                        {
                            "shard": 0,
                            "index": "logs-opensearch-2026.05.24",
                            "node": "node-open-a",
                            "reason": {
                                "type": "query_shard_exception",
                                "reason": "bad OpenSearch shard"
                            }
                        }
                    ]
                },
                "hits": {
                    "total": { "value": 31, "relation": "eq" },
                    "hits": [
                        {
                            "_index": "logs-opensearch-2026.05.24",
                            "_id": "open-doc-1",
                            "_score": 1.25,
                            "_source": {
                                "message": "OpenSearch live log",
                                "status": "ok"
                            },
                            "fields": { "host.keyword": ["open-api-1"] },
                            "highlight": { "message": ["<em>OpenSearch</em> live log"] },
                            "sort": ["2026-05-24T00:00:00Z", "open-doc-1"]
                        }
                    ]
                },
                "aggregations": {
                    "by_status": {
                        "buckets": [{ "key": "ok", "doc_count": 5 }]
                    },
                    "message_count": { "value": 31 }
                },
                "profile": { "shards": [{ "id": "open-profile-1" }] }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_opensearch();
    let config = search_config_for(port, DatabaseType::Opensearch);

    let result = async {
        adapter.connect(&config).await?;
        adapter
            .search(
                &SearchQueryRequest {
                    index: "logs-opensearch-2026.05.24".into(),
                    body: json!({
                        "query": {
                            "bool": {
                                "filter": [{ "term": { "status.keyword": "ok" } }],
                                "must": { "match": { "message": "live" } }
                            }
                        },
                        "aggs": {
                            "by_status": { "terms": { "field": "status.keyword" } },
                            "message_count": { "value_count": { "field": "message" } }
                        }
                    }),
                    from: Some(5),
                    size: Some(10),
                    track_total_hits: Some(true),
                },
                None,
            )
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let result = result.unwrap();
    server.await.unwrap();

    assert_eq!(result.took_ms, 9);
    assert_eq!(result.total.value, 31);
    assert_eq!(result.hits[0].id, "open-doc-1");
    assert_eq!(
        result.hits[0].source["message"],
        json!("OpenSearch live log")
    );
    assert_eq!(
        result.hits[0].fields.as_ref().unwrap()["host.keyword"][0],
        json!("open-api-1")
    );
    assert_eq!(
        result.hits[0].highlight.as_ref().unwrap()["message"][0],
        json!("<em>OpenSearch</em> live log")
    );
    assert_eq!(result.hits[0].sort[1], json!("open-doc-1"));
    assert_eq!(result.shards.as_ref().unwrap().failed, 1);
    assert_eq!(
        result.profile.as_ref().unwrap()["shards"][0]["id"],
        json!("open-profile-1")
    );
    match &result.aggregations[0] {
        SearchAggregationEnvelope::Terms { name, buckets } => {
            assert_eq!(name, "by_status");
            assert_eq!(buckets[0].key, "ok");
            assert_eq!(buckets[0].doc_count, 5);
        }
        other => panic!("expected OpenSearch terms aggregation, got {other:?}"),
    }
    assert_eq!(
        result.aggregations[1],
        SearchAggregationEnvelope::ValueCount {
            name: "message_count".into(),
            value: 31
        }
    );
}

#[tokio::test]
async fn elasticsearch_live_sample_documents_uses_bounded_match_all_search() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route(
            "/logs-elastic-2026.05.24/_search",
            r#"{
                "query": { "match_all": {} },
                "size": 3,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 4,
                "timed_out": false,
                "hits": {
                    "total": 1,
                    "hits": [
                        {
                            "_index": "logs-elastic-2026.05.24",
                            "_id": "doc-1",
                            "_source": { "message": "sample" }
                        }
                    ]
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);

    let result = async {
        adapter.connect(&config).await?;
        adapter.sample_documents("logs-elastic-2026.05.24", 3).await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let result = result.unwrap();
    server.await.unwrap();

    assert_eq!(result.hits.len(), 1);
    assert_eq!(result.hits[0].source["message"], json!("sample"));
    assert_eq!(result.total.value, 1);
}

#[tokio::test]
async fn opensearch_live_sample_documents_uses_bounded_match_all_search() {
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
                "query": { "match_all": {} },
                "size": 3,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 4,
                "timed_out": false,
                "hits": {
                    "total": 1,
                    "hits": [
                        {
                            "_index": "logs-opensearch-2026.05.24",
                            "_id": "open-doc-1",
                            "_source": { "message": "OpenSearch sample" }
                        }
                    ]
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_opensearch();
    let config = search_config_for(port, DatabaseType::Opensearch);

    let result = async {
        adapter.connect(&config).await?;
        adapter
            .sample_documents("logs-opensearch-2026.05.24", 3)
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let result = result.unwrap();
    server.await.unwrap();

    assert_eq!(result.hits.len(), 1);
    assert_eq!(result.hits[0].source["message"], json!("OpenSearch sample"));
    assert_eq!(result.total.value, 1);
}

#[tokio::test]
async fn elasticsearch_live_delete_by_query_preview_uses_safe_search_estimate() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route(
            "/logs-elastic-2026.05.24/_search",
            r#"{
                "query": { "term": { "status.keyword": "error" } },
                "size": 0,
                "track_total_hits": true
            }"#,
            r#"{
                "took": 3,
                "timed_out": false,
                "hits": {
                    "total": { "value": 7, "relation": "eq" },
                    "hits": []
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);

    let result = async {
        adapter.connect(&config).await?;
        adapter
            .plan_delete_by_query(&SearchDeleteByQueryRequest {
                index_pattern: "logs-elastic-2026.05.24".into(),
                body: json!({
                    "query": { "term": { "status.keyword": "error" } }
                }),
                preview_only: true,
                safety: SearchDestructiveSafety {
                    acknowledged_risk: false,
                    allow_wildcard: false,
                    expected_target: None,
                },
            })
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let plan = result.unwrap();
    server.await.unwrap();

    assert_eq!(plan.estimated_document_count, Some(7));
    assert!(!plan.requires_confirmation);
    assert!(plan.preview_only);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("execution is unsupported")));
}

#[tokio::test]
async fn elasticsearch_live_search_surfaces_http_error_body() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route_with_status(
            "/logs-elastic-2026.05.24/_search",
            400,
            None,
            r#"{
                "error": {
                    "type": "parse_exception",
                    "reason": "failed to parse query"
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;
    if result.is_err() {
        server.abort();
    }

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch search request"));
            assert!(message.contains("400"));
            assert!(message.contains("parse_exception"));
        }
        other => panic!("Expected live Search HTTP error, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_live_search_redacts_http_error_body_urls_and_credentials() {
    // Reason: issue #898 requires Search HTTP error bodies to keep diagnostics without leaking secrets (2026-06-16).
    let password = ["unique", "search", "credential"].join("-");
    let leaked_url = format!("http://elastic:{password}@127.0.0.1:9200/_search");
    let body = format!(
        r#"{{
            "error": {{
                "type": "parse_exception",
                "reason": "failed to call {leaked_url} password={password}"
            }}
        }}"#
    );
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route_with_status("/logs-elastic-2026.05.24/_search", 400, None, body),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;
    if result.is_err() {
        server.abort();
    }

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch search request"));
            assert!(message.contains("parse_exception"));
            assert!(
                !message.contains("http://") && !message.contains("https://"),
                "HTTP error body leaked a full URL: {message}"
            );
            assert!(
                !message.contains(&password),
                "HTTP error body leaked a credential: {message}"
            );
        }
        other => panic!("Expected redacted Search HTTP error, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_live_search_timeout_is_classified_and_redacted() {
    // Reason: issue #898 requires Search HTTP timeout failures to be distinct from generic network errors (2026-06-16).
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        delayed_post_route(
            "/logs-elastic-2026.05.24/_search",
            2_000,
            r#"{
                "took": 2000,
                "timed_out": false,
                "hits": { "total": 0, "hits": [] }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let mut config = search_config(port);
    config.connection_timeout = Some(1);
    adapter.connect(&config).await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;
    server.abort();

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch timeout"));
            assert!(message.contains("search request"));
            assert!(
                !message.contains("http://") && !message.contains("https://"),
                "timeout error leaked a full URL: {message}"
            );
        }
        other => panic!("Expected classified timeout error, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_live_search_http_error_reports_shard_failure_detail() {
    // Reason: issue #898 requires shard/partial failure bodies to surface clear diagnostics (2026-06-16).
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        post_route_with_status(
            "/logs-elastic-2026.05.24/_search",
            503,
            None,
            r#"{
                "error": {
                    "type": "search_phase_execution_exception",
                    "reason": "all shards failed",
                    "failed_shards": [
                        {
                            "shard": 0,
                            "index": "logs-elastic-2026.05.24",
                            "reason": {
                                "type": "query_shard_exception",
                                "reason": "bad shard filter"
                            }
                        }
                    ]
                },
                "status": 503
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;
    if result.is_err() {
        server.abort();
    }

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch server error"));
            assert!(message.contains("search_phase_execution_exception"));
            assert!(message.contains("shard failure"));
            assert!(message.contains("query_shard_exception"));
            assert!(message.contains("bad shard filter"));
        }
        other => panic!("Expected shard failure HTTP error, got {other:?}"),
    }
}

#[tokio::test]
async fn opensearch_live_search_surfaces_http_error_body() {
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
        post_route_with_status(
            "/logs-opensearch-2026.05.24/_search",
            400,
            None,
            r#"{
                "error": {
                    "type": "parse_exception",
                    "reason": "failed to parse OpenSearch query"
                }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_opensearch();
    let config = search_config_for(port, DatabaseType::Opensearch);
    adapter.connect(&config).await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-opensearch-2026.05.24".into(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;
    if result.is_err() {
        server.abort();
    }

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("OpenSearch search request"));
            assert!(message.contains("400"));
            assert!(message.contains("parse_exception"));
        }
        other => panic!("Expected OpenSearch live Search HTTP error, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_live_search_honors_in_flight_cancel_token() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        delayed_post_route(
            "/logs-elastic-2026.05.24/_search",
            2_000,
            r#"{
                "took": 2000,
                "timed_out": false,
                "hits": { "total": 0, "hits": [] }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();
    let token = CancellationToken::new();
    let request = SearchQueryRequest {
        index: "logs-elastic-2026.05.24".into(),
        body: json!({ "query": { "match_all": {} } }),
        from: None,
        size: None,
        track_total_hits: None,
    };

    let result = tokio::join!(
        async {
            sleep(Duration::from_millis(50)).await;
            token.cancel();
        },
        adapter.search(&request, Some(&token))
    )
    .1;
    server.abort();

    assert!(matches!(result, Err(AppError::Cancel(_))));
}

#[tokio::test]
async fn opensearch_live_search_honors_in_flight_cancel_token() {
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
        delayed_post_route(
            "/logs-opensearch-2026.05.24/_search",
            2_000,
            r#"{
                "took": 2000,
                "timed_out": false,
                "hits": { "total": 0, "hits": [] }
            }"#,
        ),
    ];
    let (port, server) = spawn_search_http_server(routes).await;
    let adapter = SearchEngineAdapter::new_opensearch();
    let config = search_config_for(port, DatabaseType::Opensearch);
    adapter.connect(&config).await.unwrap();
    let token = CancellationToken::new();
    let request = SearchQueryRequest {
        index: "logs-opensearch-2026.05.24".into(),
        body: json!({ "query": { "match_all": {} } }),
        from: None,
        size: None,
        track_total_hits: None,
    };

    let result = tokio::join!(
        async {
            sleep(Duration::from_millis(50)).await;
            token.cancel();
        },
        adapter.search(&request, Some(&token))
    )
    .1;
    server.abort();

    assert!(matches!(result, Err(AppError::Cancel(_))));
}

#[tokio::test]
async fn elasticsearch_live_search_blocks_raw_or_destructive_paths() {
    let (port, server) = spawn_search_http_server(vec![route(
        "/ ",
        r#"{
            "cluster_name": "elastic-dev",
            "version": { "number": "8.12.2" }
        }"#,
    )])
    .await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();
    server.await.unwrap();

    for index in [
        "logs-elastic-2026.05.24/_delete_by_query",
        "logs-elastic-2026.05.24\\_search",
        "logs-elastic-2026.05.24?allow_no_indices=false",
        "logs-elastic-2026.05.24%2f_search",
    ] {
        let result = adapter
            .search(
                &SearchQueryRequest {
                    index: index.into(),
                    body: json!({ "query": { "match_all": {} } }),
                    from: None,
                    size: None,
                    track_total_hits: None,
                },
                None,
            )
            .await;
        match result {
            Err(AppError::Validation(message)) => {
                assert!(message.contains("raw/destructive paths"));
            }
            other => panic!("Expected raw/destructive path validation, got {other:?}"),
        }
    }

    match adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!(["not", "an", "object"]),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await
    {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("JSON object"));
        }
        other => panic!("Expected body object validation, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_live_search_rejects_unsupported_admin_body_features_before_http() {
    let (port, server) = spawn_search_http_server(vec![route(
        "/ ",
        r#"{
            "cluster_name": "elastic-dev",
            "version": { "number": "8.12.2" }
        }"#,
    )])
    .await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let config = search_config(port);
    adapter.connect(&config).await.unwrap();
    server.await.unwrap();

    let result = adapter
        .search(
            &SearchQueryRequest {
                index: "logs-elastic-2026.05.24".into(),
                body: json!({
                    "query": { "match_all": {} },
                    "profile": true
                }),
                from: None,
                size: None,
                track_total_hits: None,
            },
            None,
        )
        .await;

    assert!(matches!(result, Err(AppError::Unsupported(message)) if message.contains("profile")));
}
