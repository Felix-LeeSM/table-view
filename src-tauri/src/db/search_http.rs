use std::time::Duration;

use reqwest::StatusCode;
use serde_json::Value;

use crate::error::AppError;
use crate::models::{
    ConnectionConfig, SearchClusterCapabilities, SearchClusterIdentity, SearchProductDelta,
    SearchProductKind, SearchVersionInfo,
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
            search: false,
            aggregations: false,
            aliases: false,
            mappings: false,
            legacy_index_templates: false,
            composable_index_templates: false,
            delete_by_query: false,
        },
        product_delta: SearchProductDelta::for_product(SearchProductKind::Elasticsearch),
    })
}
