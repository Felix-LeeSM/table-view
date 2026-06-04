use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

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

async fn unused_tcp_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}
