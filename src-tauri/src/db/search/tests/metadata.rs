use super::*;

#[tokio::test]
async fn live_field_stats_derive_from_selected_index_mapping_only() {
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
                            }
                        }
                    }
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
            .get_index_field_stats("logs-elastic-2026.05.24")
            .await
    }
    .await;
    if result.is_err() {
        server.abort();
    }
    let stats = result.unwrap();
    server.await.unwrap();

    assert_eq!(stats.index, "logs-elastic-2026.05.24");
    assert!(stats.fields.iter().any(|field| {
        field.path == "message.keyword"
            && field.field_type == "keyword"
            && field.searchable
            && field.aggregatable
            && field.docs_count.is_none()
            && field.sample_values.is_empty()
    }));
}
