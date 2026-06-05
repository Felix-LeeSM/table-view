use super::*;
use crate::models::{SearchDeleteByQueryRequest, SearchDestructiveSafety};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};

mod live_query;

#[tokio::test]
async fn fixture_adapter_returns_catalog_without_network() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();

    let identity = adapter.cluster_identity().await.unwrap();
    assert_eq!(identity.product, SearchProductKind::Elasticsearch);

    let indexes = adapter.list_indexes().await.unwrap();
    assert_eq!(indexes.len(), 1);
    assert!(indexes[0].aliases.contains(&"logs-elastic".to_string()));

    let data_streams = adapter.list_data_streams().await.unwrap();
    assert_eq!(data_streams[0].name, "logs-elastic-default");

    let mapping = adapter
        .get_index_mapping("logs-elastic-2026.05.24")
        .await
        .unwrap();
    assert_eq!(mapping.fields[0].path, "@timestamp");

    let settings = adapter
        .get_index_settings("logs-elastic-2026.05.24")
        .await
        .unwrap();
    assert_eq!(settings.analyzers[0].name, "default");

    let stats = adapter
        .get_index_field_stats("logs-elastic-2026.05.24")
        .await
        .unwrap();
    assert_eq!(stats.fields[2].sample_values[0], json!("ok"));

    let samples = adapter
        .sample_documents("logs-elastic-2026.05.24", 1)
        .await
        .unwrap();
    assert_eq!(samples.hits.len(), 1);
}

#[tokio::test]
async fn elasticsearch_network_adapter_detects_root_identity() {
    let body = r#"{
        "cluster_name": "elastic-dev",
        "cluster_uuid": "elastic-uuid-1",
        "version": {
            "number": "8.12.2",
            "build_flavor": "default",
            "lucene_version": "9.9.2"
        }
    }"#;
    let (port, server) = spawn_root_probe_server(200, body, Some("ZWxhc3RpYzpzZWNyZXQ=")).await;
    let adapter = SearchEngineAdapter::new_elasticsearch();
    let mut config = search_config(port);
    config.user = "elastic".into();
    config.password = "secret".into();

    let result = adapter.connect(&config).await;
    if result.is_err() {
        server.abort();
    }
    assert!(
        result.is_ok(),
        "connect should probe Search root: {result:?}"
    );
    server.await.unwrap();

    let identity = adapter.cluster_identity().await.unwrap();
    assert_eq!(identity.product, SearchProductKind::Elasticsearch);
    assert_eq!(identity.cluster_name, "elastic-dev");
    assert_eq!(identity.cluster_uuid.as_deref(), Some("elastic-uuid-1"));
    assert_eq!(identity.version.number, "8.12.2");
    assert_eq!(identity.version.lucene.as_deref(), Some("9.9.2"));
    assert_eq!(
        identity.version.distribution.as_deref(),
        Some("elasticsearch")
    );
}

#[tokio::test]
async fn elasticsearch_live_catalog_reads_indexes_aliases_and_streams() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "cluster_uuid": "elastic-uuid-1",
                "version": { "number": "8.12.2", "lucene_version": "9.9.2" }
            }"#,
        ),
        route(
            "/_cat/indices?",
            r#"[
                {
                    "health": "green",
                    "status": "open",
                    "index": "logs-elastic-2026.05.24",
                    "uuid": "idx-1",
                    "docs.count": "42",
                    "store.size": "8192",
                    "pri": "1",
                    "rep": "1"
                },
                {
                    "health": "yellow",
                    "status": "close",
                    "index": ".kibana_8.12.2",
                    "uuid": "idx-2",
                    "docs.count": "0",
                    "store.size": "512",
                    "pri": "1",
                    "rep": "0"
                }
            ]"#,
        ),
        route(
            "/_aliases",
            r#"{
                "logs-elastic-2026.05.24": {
                    "aliases": {
                        "logs-current": {
                            "is_write_index": true,
                            "search_routing": "tenant-1"
                        }
                    }
                }
            }"#,
        ),
        route(
            "/_aliases",
            r#"{
                "logs-elastic-2026.05.24": {
                    "aliases": {
                        "logs-current": {
                            "is_write_index": true,
                            "search_routing": "tenant-1"
                        }
                    }
                }
            }"#,
        ),
        route(
            "/_data_stream",
            r#"{
                "data_streams": [
                    {
                        "name": "logs-elastic-default",
                        "status": "GREEN",
                        "hidden": false,
                        "indices": [
                            { "index_name": ".ds-logs-elastic-default-2026.05.24-000001" }
                        ]
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
        let indexes = adapter.list_indexes().await?;
        let aliases = adapter.list_aliases().await?;
        let streams = adapter.list_data_streams().await?;
        Ok::<_, AppError>((indexes, aliases, streams))
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let (indexes, aliases, streams) = result.unwrap();
    server.await.unwrap();

    assert_eq!(indexes[0].name, "logs-elastic-2026.05.24");
    assert!(indexes[0].open);
    assert_eq!(indexes[0].docs_count, Some(42));
    assert_eq!(indexes[0].store_size_bytes, Some(8192));
    assert_eq!(indexes[0].aliases, vec!["logs-current"]);
    assert_eq!(indexes[1].health, SearchIndexHealth::Yellow);
    assert!(!indexes[1].open);
    assert_eq!(aliases[0].name, "logs-current");
    assert_eq!(aliases[0].index, "logs-elastic-2026.05.24");
    assert_eq!(aliases[0].routing.as_deref(), Some("tenant-1"));
    assert!(aliases[0].write_index);
    assert_eq!(streams[0].name, "logs-elastic-default");
    assert_eq!(
        streams[0].backing_indices,
        vec![".ds-logs-elastic-default-2026.05.24-000001"]
    );
}

#[tokio::test]
async fn elasticsearch_live_catalog_reads_mappings_settings_and_templates() {
    let routes = vec![
        route(
            "/ ",
            r#"{
                "cluster_name": "elastic-dev",
                "version": { "number": "8.12.2" }
            }"#,
        ),
        route(
            "/logs-elastic-2026.05.24/_mapping",
            r#"{
                "logs-elastic-2026.05.24": {
                    "mappings": {
                        "properties": {
                            "@timestamp": { "type": "date" },
                            "message": {
                                "type": "text",
                                "analyzer": "standard",
                                "fields": {
                                    "keyword": { "type": "keyword" }
                                }
                            },
                            "user": {
                                "properties": {
                                    "name": { "type": "keyword" }
                                }
                            }
                        }
                    }
                }
            }"#,
        ),
        route(
            "/logs-elastic-2026.05.24/_settings",
            r#"{
                "logs-elastic-2026.05.24": {
                    "settings": {
                        "index": {
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
                    }
                }
            }"#,
        ),
        route(
            "/_index_template",
            r#"{
                "index_templates": [
                    {
                        "name": "logs-elastic-template",
                        "index_template": {
                            "index_patterns": ["logs-elastic-*"],
                            "priority": 100
                        }
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
        let mapping = adapter.get_index_mapping("logs-elastic-2026.05.24").await?;
        let settings = adapter
            .get_index_settings("logs-elastic-2026.05.24")
            .await?;
        let templates = adapter.list_index_templates().await?;
        Ok::<_, AppError>((mapping, settings, templates))
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let (mapping, settings, templates) = result.unwrap();
    server.await.unwrap();

    assert_eq!(mapping.index, "logs-elastic-2026.05.24");
    assert!(mapping.fields.iter().any(|field| field.path == "@timestamp"
        && field.field_type == "date"
        && field.aggregatable));
    assert!(mapping.fields.iter().any(|field| field.path == "message"
        && field.field_type == "text"
        && field.analyzer.as_deref() == Some("standard")
        && !field.aggregatable));
    assert!(mapping
        .fields
        .iter()
        .any(|field| field.path == "message.keyword"
            && field.field_type == "keyword"
            && field.aggregatable));
    assert!(mapping
        .fields
        .iter()
        .any(|field| field.path == "user.name" && field.field_type == "keyword"));
    assert_eq!(settings.analyzers[0].name, "default");
    assert_eq!(settings.analyzers[0].tokenizer.as_deref(), Some("standard"));
    assert_eq!(settings.analyzers[0].filters, vec!["lowercase"]);
    assert_eq!(templates[0].name, "logs-elastic-template");
    assert_eq!(templates[0].index_patterns, vec!["logs-elastic-*"]);
    assert_eq!(templates[0].priority, Some(100));
}

#[tokio::test]
async fn elasticsearch_test_connection_surfaces_auth_failures() {
    let (port, server) =
        spawn_root_probe_server(401, r#"{"error":"missing credentials"}"#, None).await;
    let config = search_config(port);

    let result = SearchEngineAdapter::test(&config).await;
    if result.is_err() {
        server.abort();
    }

    match result {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch authentication failed"));
            assert!(message.contains("401"));
        }
        other => panic!("Expected user-facing auth connection error, got {other:?}"),
    }
}

#[tokio::test]
async fn elasticsearch_test_connection_surfaces_network_errors() {
    let port = unused_tcp_port().await;
    let config = search_config(port);

    match SearchEngineAdapter::test(&config).await {
        Err(AppError::Connection(message)) => {
            assert!(message.contains("Elasticsearch network error"));
        }
        other => panic!("Expected user-facing network connection error, got {other:?}"),
    }
}

fn search_config(port: u16) -> ConnectionConfig {
    ConnectionConfig {
        id: "search-1".into(),
        name: "Elastic".into(),
        db_type: DatabaseType::Elasticsearch,
        host: "127.0.0.1".into(),
        port,
        user: String::new(),
        password: String::new(),
        database: String::new(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(1),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: Some(false),
    }
}

fn delete_by_query_request(
    preview_only: bool,
    acknowledged_risk: bool,
    expected_target: Option<&str>,
) -> SearchDeleteByQueryRequest {
    SearchDeleteByQueryRequest {
        index_pattern: "logs-elastic-2026.05.24".into(),
        body: json!({
            "query": { "term": { "status.keyword": "ok" } }
        }),
        preview_only,
        safety: SearchDestructiveSafety {
            acknowledged_risk,
            allow_wildcard: false,
            expected_target: expected_target.map(str::to_string),
        },
    }
}

#[tokio::test]
async fn fixture_delete_by_query_preview_estimates_and_requires_confirmation() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();

    let plan = adapter
        .plan_delete_by_query(&delete_by_query_request(true, false, None))
        .await
        .unwrap();

    assert_eq!(plan.operation, "deleteByQuery");
    assert_eq!(plan.target, "logs-elastic-2026.05.24");
    assert!(plan.preview_only);
    assert!(plan.requires_confirmation);
    assert_eq!(plan.estimated_document_count, Some(1));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("confirmed before execution")));
}

#[tokio::test]
async fn fixture_delete_by_query_confirmed_plan_satisfies_confirmation_gate() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();

    let plan = adapter
        .plan_delete_by_query(&delete_by_query_request(
            false,
            true,
            Some("logs-elastic-2026.05.24"),
        ))
        .await
        .unwrap();

    assert!(!plan.preview_only);
    assert!(!plan.requires_confirmation);
    assert_eq!(plan.estimated_document_count, Some(1));
}

#[tokio::test]
async fn fixture_delete_by_query_rejects_raw_destructive_paths() {
    let adapter = SearchEngineAdapter::fixture_elasticsearch();
    let mut request = delete_by_query_request(false, true, Some("logs-elastic-2026.05.24"));
    request.index_pattern = "logs-elastic-2026.05.24/_delete_by_query".into();
    request.safety.expected_target = Some(request.index_pattern.clone());

    let result = adapter.plan_delete_by_query(&request).await;

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("raw/destructive paths"));
        }
        other => panic!("Expected raw/destructive path validation, got {other:?}"),
    }
}

async fn spawn_root_probe_server(
    status: u16,
    body: &'static str,
    expected_basic_auth: Option<&'static str>,
) -> (u16, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0; 4096];
        let n = socket.read(&mut buf).await.unwrap();
        let request = String::from_utf8_lossy(&buf[..n]);
        assert!(request.starts_with("GET / "));
        if let Some(expected) = expected_basic_auth {
            let authorization = request.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("authorization")
                    .then(|| value.trim())
            });
            let expected_value = format!("Basic {expected}");
            assert_eq!(
                authorization,
                Some(expected_value.as_str()),
                "missing Basic auth header in request:\n{request}"
            );
        }
        let response = format!(
            "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    (port, handle)
}

struct SearchHttpRoute {
    method: &'static str,
    path_prefix: &'static str,
    status: u16,
    expected_body: Option<&'static str>,
    body: &'static str,
    delay_ms: u64,
}

fn route(path_prefix: &'static str, body: &'static str) -> SearchHttpRoute {
    SearchHttpRoute {
        method: "GET",
        path_prefix,
        status: 200,
        expected_body: None,
        body,
        delay_ms: 0,
    }
}

fn post_route(
    path_prefix: &'static str,
    expected_body: &'static str,
    body: &'static str,
) -> SearchHttpRoute {
    post_route_with_status(path_prefix, 200, Some(expected_body), body)
}

fn post_route_with_status(
    path_prefix: &'static str,
    status: u16,
    expected_body: Option<&'static str>,
    body: &'static str,
) -> SearchHttpRoute {
    SearchHttpRoute {
        method: "POST",
        path_prefix,
        status,
        expected_body,
        body,
        delay_ms: 0,
    }
}

fn delayed_post_route(
    path_prefix: &'static str,
    delay_ms: u64,
    body: &'static str,
) -> SearchHttpRoute {
    SearchHttpRoute {
        method: "POST",
        path_prefix,
        status: 200,
        expected_body: None,
        body,
        delay_ms,
    }
}

async fn spawn_search_http_server(routes: Vec<SearchHttpRoute>) -> (u16, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        for route in routes {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 4096];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]);
            let expected_prefix = format!("{} {}", route.method, route.path_prefix);
            assert!(
                request.starts_with(&expected_prefix),
                "expected {expected_prefix:?}, got request:\n{request}"
            );
            if let Some(expected_body) = route.expected_body {
                let actual_body = request.split("\r\n\r\n").nth(1).unwrap_or("");
                let actual_json: serde_json::Value = serde_json::from_str(actual_body)
                    .unwrap_or_else(|err| panic!("invalid request JSON {err}: {actual_body}"));
                let expected_json: serde_json::Value = serde_json::from_str(expected_body)
                    .expect("expected request body fixture should be valid JSON");
                assert_eq!(actual_json, expected_json, "request body drift");
            }
            if route.delay_ms > 0 {
                sleep(Duration::from_millis(route.delay_ms)).await;
            }
            let response = format!(
                "HTTP/1.1 {} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                route.status,
                route.body.len(),
                route.body
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    (port, handle)
}

async fn unused_tcp_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}
