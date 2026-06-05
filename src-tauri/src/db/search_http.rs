use std::collections::HashMap;
use std::time::Duration;

use reqwest::{RequestBuilder, Response, StatusCode};
use serde_json::{json, Map, Value};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, CancelError};
use crate::models::{
    ConnectionConfig, SearchAliasInfo, SearchAnalyzerInfo, SearchClusterCapabilities,
    SearchClusterIdentity, SearchDataStreamInfo, SearchFieldStatsEnvelope, SearchFieldStatsInfo,
    SearchIndexHealth, SearchIndexInfo, SearchIndexMapping, SearchIndexSettings,
    SearchIndexTemplateInfo, SearchMappingField, SearchProductDelta, SearchProductKind,
    SearchQueryRequest, SearchResultEnvelope, SearchTemplateEndpointKind, SearchVersionInfo,
};

use super::search_live_query::{
    live_search_body, parse_search_response, search_error_detail, validate_live_search_request,
};

#[derive(Debug, Clone)]
pub(crate) struct SearchHttpConnection {
    base_url: String,
    client: reqwest::Client,
    auth: SearchHttpAuth,
    identity: SearchClusterIdentity,
}

#[derive(Debug, Clone)]
struct SearchHttpAuth {
    user: String,
    password: String,
}

pub(crate) async fn open_elasticsearch_connection(
    config: &ConnectionConfig,
) -> Result<SearchHttpConnection, AppError> {
    let timeout_secs = config.connection_timeout.unwrap_or(10).clamp(1, 300);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.into()))
        .build()
        .map_err(|err| AppError::Connection(format!("Elasticsearch HTTP client error: {err}")))?;
    let base_url = base_url(config);
    let auth = SearchHttpAuth::from_config(config);
    let identity = probe_elasticsearch_root(&client, &base_url, &auth).await?;

    Ok(SearchHttpConnection {
        base_url,
        client,
        auth,
        identity,
    })
}

impl SearchHttpConnection {
    pub(crate) fn identity(&self) -> SearchClusterIdentity {
        self.identity.clone()
    }

    pub(crate) async fn ping(&self) -> Result<(), AppError> {
        probe_elasticsearch_root(&self.client, &self.base_url, &self.auth)
            .await
            .map(|_| ())
    }

    pub(crate) async fn list_indexes(&self) -> Result<Vec<SearchIndexInfo>, AppError> {
        let payload = self
            .get_json(
                "/_cat/indices?format=json&bytes=b&h=health,status,index,uuid,docs.count,store.size,pri,rep",
            )
            .await?;
        let aliases = self.list_aliases().await?;
        let aliases_by_index =
            aliases
                .into_iter()
                .fold(HashMap::<String, Vec<String>>::new(), |mut acc, alias| {
                    acc.entry(alias.index).or_default().push(alias.name);
                    acc
                });
        let mut indexes = parse_cat_indices(&payload)?;
        for index in &mut indexes {
            index.aliases = aliases_by_index
                .get(&index.name)
                .cloned()
                .unwrap_or_default();
        }
        Ok(indexes)
    }

    pub(crate) async fn list_aliases(&self) -> Result<Vec<SearchAliasInfo>, AppError> {
        let payload = self.get_json("/_aliases").await?;
        parse_aliases(&payload)
    }

    pub(crate) async fn list_data_streams(&self) -> Result<Vec<SearchDataStreamInfo>, AppError> {
        let payload = self.get_json("/_data_stream").await?;
        parse_data_streams(&payload)
    }

    pub(crate) async fn get_index_mapping(
        &self,
        index: &str,
    ) -> Result<SearchIndexMapping, AppError> {
        let payload = self.get_json(&format!("/{index}/_mapping")).await?;
        parse_mapping_response(index, &payload)
    }

    pub(crate) async fn get_index_settings(
        &self,
        index: &str,
    ) -> Result<SearchIndexSettings, AppError> {
        let payload = self.get_json(&format!("/{index}/_settings")).await?;
        parse_settings_response(index, &payload)
    }

    pub(crate) async fn get_index_field_stats(
        &self,
        index: &str,
    ) -> Result<SearchFieldStatsEnvelope, AppError> {
        let mapping = self.get_index_mapping(index).await?;
        Ok(SearchFieldStatsEnvelope {
            index: mapping.index,
            fields: mapping
                .fields
                .into_iter()
                .map(|field| SearchFieldStatsInfo {
                    path: field.path,
                    field_type: field.field_type,
                    searchable: field.searchable,
                    aggregatable: field.aggregatable,
                    docs_count: None,
                    sample_values: Vec::new(),
                })
                .collect(),
        })
    }

    pub(crate) async fn list_index_templates(
        &self,
    ) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
        let payload = self.get_json("/_index_template").await?;
        parse_index_templates(&payload)
    }

    pub(crate) async fn sample_documents(
        &self,
        index: &str,
        limit: u64,
    ) -> Result<SearchResultEnvelope, AppError> {
        self.search(
            &SearchQueryRequest {
                index: index.to_string(),
                body: json!({ "query": { "match_all": {} } }),
                from: None,
                size: Some(limit),
                track_total_hits: Some(true),
            },
            None,
        )
        .await
    }

    pub(crate) async fn search(
        &self,
        request: &SearchQueryRequest,
        cancel: Option<&CancellationToken>,
    ) -> Result<SearchResultEnvelope, AppError> {
        validate_live_search_request(request)?;
        let path = format!("/{}/_search", request.index.trim());
        let body = live_search_body(request)?;
        let payload = self.post_json(&path, &Value::Object(body), cancel).await?;
        parse_search_response(&payload)
    }

    async fn get_json(&self, path: &str) -> Result<Value, AppError> {
        let request = self.auth.apply(self.client.get(format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            path
        )));
        let response = request
            .send()
            .await
            .map_err(|err| AppError::Connection(format!("Elasticsearch network error: {err}")))?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(AppError::Connection(format!(
                "Elasticsearch authentication failed ({status})"
            )));
        }
        if !status.is_success() {
            return Err(AppError::Connection(format!(
                "Elasticsearch catalog request {path} failed with HTTP {status}"
            )));
        }
        response.json::<Value>().await.map_err(|err| {
            AppError::Connection(format!(
                "Elasticsearch catalog request {path} returned invalid JSON: {err}"
            ))
        })
    }

    pub(crate) async fn post_json(
        &self,
        path: &str,
        body: &Value,
        cancel: Option<&CancellationToken>,
    ) -> Result<Value, AppError> {
        let request = self.auth.apply(
            self.client
                .post(format!("{}{}", self.base_url.trim_end_matches('/'), path))
                .json(body),
        );
        let response = send_with_cancel(request, cancel).await?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(AppError::Connection(format!(
                "Elasticsearch authentication failed ({status})"
            )));
        }
        if !status.is_success() {
            let detail = response
                .text()
                .await
                .map(search_error_detail)
                .unwrap_or_else(|err| format!("failed to read error body: {err}"));
            return Err(AppError::Connection(format!(
                "Elasticsearch search request {path} failed with HTTP {status}: {detail}"
            )));
        }
        response.json::<Value>().await.map_err(|err| {
            AppError::Connection(format!(
                "Elasticsearch search request {path} returned invalid JSON: {err}"
            ))
        })
    }
}

async fn send_with_cancel(
    request: RequestBuilder,
    cancel: Option<&CancellationToken>,
) -> Result<Response, AppError> {
    let response = if let Some(token) = cancel {
        tokio::select! {
            biased;
            _ = token.cancelled() => return Err(AppError::Cancel(CancelError::AlreadyCompleted)),
            response = request.send() => response,
        }
    } else {
        request.send().await
    };
    response.map_err(|err| AppError::Connection(format!("Elasticsearch network error: {err}")))
}

impl SearchHttpAuth {
    fn from_config(config: &ConnectionConfig) -> Self {
        Self {
            user: config.user.clone(),
            password: config.password.clone(),
        }
    }

    fn apply(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.user.is_empty() && self.password.is_empty() {
            builder
        } else {
            builder.basic_auth(self.user.as_str(), Some(self.password.as_str()))
        }
    }
}

fn base_url(config: &ConnectionConfig) -> String {
    let scheme = if config.tls_enabled.unwrap_or(false) {
        "https"
    } else {
        "http"
    };
    let host = format_host(config.host.trim());
    format!("{scheme}://{host}:{}", config.port)
}

fn format_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

async fn probe_elasticsearch_root(
    client: &reqwest::Client,
    base_url: &str,
    auth: &SearchHttpAuth,
) -> Result<SearchClusterIdentity, AppError> {
    let request = auth.apply(client.get(format!("{}/", base_url.trim_end_matches('/'))));
    let response = request
        .send()
        .await
        .map_err(|err| AppError::Connection(format!("Elasticsearch network error: {err}")))?;
    let status = response.status();

    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(AppError::Connection(format!(
            "Elasticsearch authentication failed ({status})"
        )));
    }
    if !status.is_success() {
        return Err(AppError::Connection(format!(
            "Elasticsearch root probe failed with HTTP {status}"
        )));
    }

    let product_header = response
        .headers()
        .get("x-elastic-product")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let root = response.json::<Value>().await.map_err(|err| {
        AppError::Connection(format!(
            "Elasticsearch root probe returned invalid JSON: {err}"
        ))
    })?;

    identity_from_root(&root, product_header.as_deref())
}

fn identity_from_root(
    root: &Value,
    product_header: Option<&str>,
) -> Result<SearchClusterIdentity, AppError> {
    if product_header.is_some_and(|value| value != "Elasticsearch") {
        return Err(AppError::Connection(
            "Expected Elasticsearch endpoint but detected a different product".into(),
        ));
    }

    let version = root.get("version").unwrap_or(&Value::Null);
    let distribution = version
        .get("distribution")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "elasticsearch".to_string());
    let tagline = root.get("tagline").and_then(Value::as_str).unwrap_or("");
    if distribution.eq_ignore_ascii_case("opensearch")
        || tagline.to_ascii_lowercase().contains("opensearch")
    {
        return Err(AppError::Connection(
            "Expected Elasticsearch endpoint but detected OpenSearch".into(),
        ));
    }

    Ok(SearchClusterIdentity {
        product: SearchProductKind::Elasticsearch,
        cluster_name: root
            .get("cluster_name")
            .and_then(Value::as_str)
            .unwrap_or("Elasticsearch cluster")
            .to_string(),
        cluster_uuid: root
            .get("cluster_uuid")
            .and_then(Value::as_str)
            .map(str::to_string),
        version: SearchVersionInfo {
            number: version
                .get("number")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            distribution: Some(distribution),
            lucene: version
                .get("lucene_version")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_flavor: version
                .get("build_flavor")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        capabilities: SearchClusterCapabilities {
            search: true,
            aggregations: true,
            aliases: true,
            mappings: true,
            legacy_index_templates: false,
            composable_index_templates: true,
            delete_by_query: false,
        },
        product_delta: SearchProductDelta::for_product(SearchProductKind::Elasticsearch),
    })
}

fn parse_cat_indices(payload: &Value) -> Result<Vec<SearchIndexInfo>, AppError> {
    let rows = payload.as_array().ok_or_else(|| {
        AppError::Connection("Elasticsearch indices catalog returned non-array JSON".into())
    })?;
    rows.iter()
        .map(|row| {
            let item = row.as_object().ok_or_else(|| {
                AppError::Connection("Elasticsearch index catalog row is not an object".into())
            })?;
            let name = string_field(item, "index").ok_or_else(|| {
                AppError::Connection("Elasticsearch index catalog row is missing index".into())
            })?;
            let status = string_field(item, "status").unwrap_or_else(|| "open".into());
            Ok(SearchIndexInfo {
                name,
                uuid: string_field(item, "uuid"),
                health: parse_health(string_field(item, "health").as_deref()),
                open: !matches_ignore_ascii_case(&status, &["close", "closed"]),
                docs_count: u64_field(item, "docs.count"),
                store_size_bytes: u64_field(item, "store.size"),
                aliases: Vec::new(),
                primary_shards: u32_field(item, "pri"),
                replica_shards: u32_field(item, "rep"),
            })
        })
        .collect()
}

fn parse_aliases(payload: &Value) -> Result<Vec<SearchAliasInfo>, AppError> {
    let root = payload.as_object().ok_or_else(|| {
        AppError::Connection("Elasticsearch aliases catalog returned non-object JSON".into())
    })?;
    let mut aliases = Vec::new();
    for (index, entry) in root {
        let Some(alias_map) = entry.get("aliases").and_then(Value::as_object) else {
            continue;
        };
        for (alias_name, alias_value) in alias_map {
            let alias_object = alias_value.as_object();
            aliases.push(SearchAliasInfo {
                name: alias_name.clone(),
                index: index.clone(),
                filter: alias_object
                    .and_then(|object| object.get("filter"))
                    .cloned(),
                routing: alias_object.and_then(alias_routing),
                write_index: alias_object
                    .and_then(|object| object.get("is_write_index"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            });
        }
    }
    Ok(aliases)
}

fn parse_data_streams(payload: &Value) -> Result<Vec<SearchDataStreamInfo>, AppError> {
    let streams = payload
        .get("data_streams")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Connection("Elasticsearch data stream catalog returned invalid JSON".into())
        })?;
    streams
        .iter()
        .map(|stream| {
            let item = stream.as_object().ok_or_else(|| {
                AppError::Connection("Elasticsearch data stream row is not an object".into())
            })?;
            let name = string_field(item, "name").ok_or_else(|| {
                AppError::Connection("Elasticsearch data stream row is missing name".into())
            })?;
            Ok(SearchDataStreamInfo {
                name,
                backing_indices: stream
                    .get("indices")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.get("index_name").and_then(value_to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                health: parse_health(string_field(item, "status").as_deref()),
                docs_count: optional_u64_fields(item, &["docs_count", "docs.count"]),
                store_size_bytes: optional_u64_fields(
                    item,
                    &["store_size_bytes", "store_size", "store.size"],
                ),
                primary_shards: optional_u32_fields(item, &["pri", "primary_shards"]),
                replica_shards: optional_u32_fields(item, &["rep", "replica_shards"]),
                hidden: item.get("hidden").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect()
}

fn parse_mapping_response(index: &str, payload: &Value) -> Result<SearchIndexMapping, AppError> {
    let entry = index_entry(index, payload).unwrap_or(payload);
    let mapping = entry.get("mappings").unwrap_or(entry);
    let mut fields = Vec::new();
    if let Some(properties) = mapping.get("properties").and_then(Value::as_object) {
        collect_mapping_fields("", properties, &mut fields);
    }
    Ok(SearchIndexMapping {
        index: index.into(),
        fields,
        raw: mapping.clone(),
    })
}

fn parse_settings_response(index: &str, payload: &Value) -> Result<SearchIndexSettings, AppError> {
    let entry = index_entry(index, payload).unwrap_or(payload);
    let settings = entry.get("settings").unwrap_or(entry);
    Ok(SearchIndexSettings {
        index: index.into(),
        raw: settings.clone(),
        analyzers: parse_analyzers(settings),
    })
}

fn parse_index_templates(payload: &Value) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
    let templates = payload
        .get("index_templates")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Connection("Elasticsearch index templates returned invalid JSON".into())
        })?;
    Ok(templates
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(value_to_string)?;
            let body = entry.get("index_template").unwrap_or(entry);
            Some(SearchIndexTemplateInfo {
                name,
                endpoint: SearchTemplateEndpointKind::ComposableIndexTemplate,
                index_patterns: string_array(body.get("index_patterns")),
                priority: body.get("priority").and_then(Value::as_i64),
                raw: body.clone(),
            })
        })
        .collect())
}

fn collect_mapping_fields(
    prefix: &str,
    properties: &Map<String, Value>,
    fields: &mut Vec<SearchMappingField>,
) {
    for (name, definition) in properties {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        if let Some(field_type) = definition.get("type").and_then(Value::as_str) {
            fields.push(mapping_field(path.clone(), field_type, definition));
        }
        if let Some(multi_fields) = definition.get("fields").and_then(Value::as_object) {
            collect_mapping_fields(&path, multi_fields, fields);
        }
        if let Some(nested) = definition.get("properties").and_then(Value::as_object) {
            collect_mapping_fields(&path, nested, fields);
        }
    }
}

fn mapping_field(path: String, field_type: &str, definition: &Value) -> SearchMappingField {
    SearchMappingField {
        path,
        field_type: field_type.into(),
        searchable: !matches_ignore_ascii_case(field_type, &["object", "nested"]),
        aggregatable: matches_ignore_ascii_case(
            field_type,
            &[
                "keyword",
                "constant_keyword",
                "wildcard",
                "date",
                "date_nanos",
                "boolean",
                "byte",
                "short",
                "integer",
                "long",
                "unsigned_long",
                "float",
                "half_float",
                "scaled_float",
                "double",
                "ip",
                "version",
            ],
        ),
        analyzer: definition
            .get("analyzer")
            .or_else(|| definition.get("search_analyzer"))
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn parse_analyzers(settings: &Value) -> Vec<SearchAnalyzerInfo> {
    settings
        .pointer("/index/analysis/analyzer")
        .or_else(|| settings.pointer("/analysis/analyzer"))
        .and_then(Value::as_object)
        .map(|analyzers| {
            analyzers
                .iter()
                .map(|(name, definition)| SearchAnalyzerInfo {
                    name: name.clone(),
                    analyzer_type: definition
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("custom")
                        .into(),
                    tokenizer: definition
                        .get("tokenizer")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    filters: string_array(definition.get("filter")),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn index_entry<'a>(index: &str, payload: &'a Value) -> Option<&'a Value> {
    payload.get(index).or_else(|| {
        payload
            .as_object()
            .and_then(|object| object.values().next())
    })
}

fn alias_routing(object: &Map<String, Value>) -> Option<String> {
    ["routing", "search_routing", "index_routing"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_to_string))
}

fn parse_health(value: Option<&str>) -> SearchIndexHealth {
    match value.unwrap_or("").to_ascii_lowercase().as_str() {
        "green" => SearchIndexHealth::Green,
        "yellow" => SearchIndexHealth::Yellow,
        "red" => SearchIndexHealth::Red,
        _ => SearchIndexHealth::Unknown,
    }
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(value_to_string)
}

fn u64_field(object: &Map<String, Value>, key: &str) -> Option<u64> {
    object.get(key).and_then(value_to_u64)
}

fn u32_field(object: &Map<String, Value>, key: &str) -> Option<u32> {
    u64_field(object, key).and_then(|value| u32::try_from(value).ok())
}

fn optional_u64_fields(object: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| u64_field(object, key))
}

fn optional_u32_fields(object: &Map<String, Value>, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| u32_field(object, key))
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn value_to_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(value_to_string).collect(),
        Some(item) => value_to_string(item).into_iter().collect(),
        None => Vec::new(),
    }
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}
