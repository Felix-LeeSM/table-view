use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use regex::Regex;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde_json::{json, Map, Value};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, CancelError};
use crate::models::{
    ConnectionConfig, SearchAliasInfo, SearchAnalyzerInfo, SearchCatalogSummary,
    SearchClusterCapabilities, SearchClusterIdentity, SearchDataStreamInfo,
    SearchFieldStatsEnvelope, SearchFieldStatsInfo, SearchIndexHealth, SearchIndexInfo,
    SearchIndexMapping, SearchIndexSettings, SearchIndexTemplateInfo, SearchMappingField,
    SearchProductDelta, SearchProductKind, SearchQueryRequest, SearchResultEnvelope,
    SearchTemplateEndpointKind, SearchVersionInfo,
};

use super::search_dsl::validate_search_target;
use super::search_live_query::{
    live_search_body, parse_search_response, search_error_detail, validate_live_search_request,
};

// RFC 3986 unreserved set (ALPHA / DIGIT / `-` `.` `_` `~`) stays literal; every
// other byte — including non-ASCII UTF-8 — is percent-encoded so a validated index
// name can never break out of its URL path segment. ES/OpenSearch percent-decode
// the path, so this round-trips to the original name on the cluster.
const INDEX_PATH_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// #1107 — single chokepoint for `/{index}/{suffix}` URLs: reuse the live-search
/// `validate_search_target` allowlist, then percent-encode the surviving name.
/// `get_index_field_stats` routes through `get_index_mapping`, so it inherits this.
fn validated_index_path(index: &str, suffix: &str) -> Result<String, AppError> {
    validate_search_target(index)?;
    let encoded = utf8_percent_encode(index.trim(), INDEX_PATH_SEGMENT);
    Ok(format!("/{encoded}/{suffix}"))
}

#[derive(Debug, Clone)]
pub(crate) struct SearchHttpConnection {
    base_url: String,
    client: reqwest::Client,
    auth: SearchHttpAuth,
    product: SearchProductKind,
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
    open_search_connection(config, SearchProductKind::Elasticsearch).await
}

pub(crate) async fn open_opensearch_connection(
    config: &ConnectionConfig,
) -> Result<SearchHttpConnection, AppError> {
    open_search_connection(config, SearchProductKind::OpenSearch).await
}

async fn open_search_connection(
    config: &ConnectionConfig,
    product: SearchProductKind,
) -> Result<SearchHttpConnection, AppError> {
    let label = product.label();
    let timeout_secs = config.connection_timeout.unwrap_or(10).clamp(1, 300);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.into()))
        // #1063 — `trust_server_certificate = true` opts into skip-verify; for
        // the reqwest-backed search adapters this is `danger_accept_invalid_certs`
        // (applies only over https, which the `https` scheme selects when TLS is
        // on). Absent/false trust keeps reqwest's default full verification.
        .danger_accept_invalid_certs(config.trust_server_certificate.unwrap_or(false))
        .build()
        .map_err(|err| AppError::Connection(format!("{label} HTTP client error: {err}")))?;
    let base_url = base_url(config);
    let auth = SearchHttpAuth::from_config(config);
    let identity = probe_search_root(&client, &base_url, &auth, product).await?;

    Ok(SearchHttpConnection {
        base_url,
        client,
        auth,
        product,
        identity,
    })
}

impl SearchHttpConnection {
    pub(crate) fn identity(&self) -> SearchClusterIdentity {
        self.identity.clone()
    }

    pub(crate) async fn ping(&self) -> Result<(), AppError> {
        probe_search_root(&self.client, &self.base_url, &self.auth, self.product)
            .await
            .map(|_| ())
    }

    pub(crate) async fn list_indexes(&self) -> Result<Vec<SearchIndexInfo>, AppError> {
        let indexes = self.list_index_summaries().await?;
        let aliases = self.list_aliases().await?;
        Ok(attach_aliases(indexes, &aliases))
    }

    pub(crate) async fn catalog_summary(&self) -> Result<SearchCatalogSummary, AppError> {
        let identity = self.identity();
        let indexes = self.list_index_summaries().await?;
        let aliases = self.list_aliases().await?;
        let data_streams = self.list_data_streams().await?;
        Ok(SearchCatalogSummary {
            identity,
            indexes: attach_aliases(indexes, &aliases),
            aliases,
            data_streams,
        })
    }

    /// #1712 — `_field_caps` (in the `read` privilege bucket via
    /// `indices:data/read/field_caps`) is the authoritative index-visibility
    /// source. `_cat/indices` only enumerates `monitor`/`view_index_metadata`
    /// authorized indices, so a role with only `read` would have its indices
    /// hidden from the sidebar (sibling of #1709). We union the field_caps names
    /// (source of truth) with `_cat` meta (best-effort enrichment); if
    /// field_caps itself fails the error is terminal.
    async fn list_index_summaries(&self) -> Result<Vec<SearchIndexInfo>, AppError> {
        let visible = self.list_field_caps_indices().await?;
        // `_cat/indices` is monitor-gated: tolerate a permission denial as "no
        // meta" instead of hiding every index. Non-permission failures still
        // propagate.
        let mut indexes = permission_tolerant(self.list_cat_indices().await)?.unwrap_or_default();

        // Union: field_caps guarantees read-visible (open) indices appear even
        // when `_cat` is forbidden or omits them; `_cat`-only entries (closed or
        // monitored indices) keep their full meta.
        let known: HashSet<&str> = indexes.iter().map(|index| index.name.as_str()).collect();
        let extra: Vec<String> = visible
            .into_iter()
            .filter(|name| !known.contains(name.as_str()))
            .collect();
        indexes.extend(extra.into_iter().map(synthesize_index_info));
        Ok(indexes)
    }

    async fn list_cat_indices(&self) -> Result<Vec<SearchIndexInfo>, AppError> {
        let payload = self
            .get_json(
                "/_cat/indices?format=json&bytes=b&h=health,status,index,uuid,docs.count,store.size,pri,rep",
            )
            .await?;
        parse_cat_indices(&payload, self.label())
    }

    /// #1712 — the read-authorized index name set. `fields=_index` keeps the
    /// payload minimal (a single metadata field) rather than `fields=*`, which
    /// is huge on large clusters. field_caps returns only open indices.
    async fn list_field_caps_indices(&self) -> Result<Vec<String>, AppError> {
        let payload = self.get_json("/*/_field_caps?fields=_index").await?;
        Ok(parse_field_caps_indices(&payload))
    }

    pub(crate) async fn list_aliases(&self) -> Result<Vec<SearchAliasInfo>, AppError> {
        // #1712 — alias privilege is separate from `read`; a 403 here must not
        // hide read-visible indices. Tolerate permission denial as "no aliases".
        match permission_tolerant(self.get_json("/_aliases").await)? {
            Some(payload) => parse_aliases(&payload, self.label()),
            None => Ok(Vec::new()),
        }
    }

    pub(crate) async fn list_data_streams(&self) -> Result<Vec<SearchDataStreamInfo>, AppError> {
        // #1712 — `GET /_data_stream` needs indices:admin/data_stream/get (a
        // monitor-class privilege separate from `read`). `catalog_summary()` is
        // the sidebar command, so a 403 here must not fail the whole catalog:
        // tolerate it as "no data streams" and keep the field_caps indices.
        match permission_tolerant(self.get_json("/_data_stream").await)? {
            Some(payload) => parse_data_streams(&payload, self.label()),
            None => Ok(Vec::new()),
        }
    }

    pub(crate) async fn get_index_mapping(
        &self,
        index: &str,
    ) -> Result<SearchIndexMapping, AppError> {
        let payload = self
            .get_json(&validated_index_path(index, "_mapping")?)
            .await?;
        parse_mapping_response(index, &payload)
    }

    pub(crate) async fn get_index_settings(
        &self,
        index: &str,
    ) -> Result<SearchIndexSettings, AppError> {
        let payload = self
            .get_json(&validated_index_path(index, "_settings")?)
            .await?;
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
        let mut templates = Vec::new();
        if self.identity.capabilities.composable_index_templates {
            let payload = self.get_json("/_index_template").await?;
            templates.extend(parse_composable_index_templates(&payload, self.label())?);
        }
        if self.identity.capabilities.legacy_index_templates {
            let payload = self.get_json("/_template").await?;
            templates.extend(parse_legacy_index_templates(&payload, self.label())?);
        }
        Ok(templates)
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
        // Same allowlist as validate_live_search_request above, but this also
        // percent-encodes the surviving name for URL-segment parity with the
        // mapping/settings paths (#1107).
        let path = validated_index_path(&request.index, "_search")?;
        let body = live_search_body(request)?;
        let payload = self.post_json(&path, &Value::Object(body), cancel).await?;
        parse_search_response(&payload, self.label())
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
            .map_err(|err| search_network_error(self.label(), "catalog request", err))?;
        let status = response.status();
        if !status.is_success() {
            let detail = response
                .text()
                .await
                .ok()
                .map(|body| search_http_error_detail(&body, false));
            return Err(search_http_status_error(
                self.label(),
                "catalog request",
                status,
                Some(path),
                detail.as_deref(),
            ));
        }
        response.json::<Value>().await.map_err(|err| {
            AppError::Connection(format!(
                "{} catalog request {path} returned invalid JSON: {err}",
                self.label()
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
        let response = send_with_cancel(request, cancel, self.label()).await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await;
            let detail = match body {
                Ok(body) => search_http_error_detail(&body, true),
                Err(err) => format!("failed to read error body: {}", err.without_url()),
            };
            return Err(search_http_status_error(
                self.label(),
                "search request",
                status,
                Some(path),
                Some(detail.as_str()),
            ));
        }
        response.json::<Value>().await.map_err(|err| {
            AppError::Connection(format!(
                "{} search request {path} returned invalid JSON: {err}",
                self.label()
            ))
        })
    }

    pub(crate) fn label(&self) -> &'static str {
        self.product.label()
    }
}

/// Send `request`, aborting the instant `cancel` fires. The abort lever is a
/// biased `select!` that drops the in-flight `send()` future — reqwest cannot
/// pool a half-finished request, so the drop closes the HTTP connection.
///
/// #1269 gap #7 — that connection close IS a real server-side abort, not just a
/// client that stopped waiting: Elasticsearch (>= 7) and OpenSearch (>= 1)
/// cancel the running search task when the REST channel closes
/// (`RestCancellableNodeClient`, default-on). So the Search-tab Stop button
/// needs no `_tasks/{id}/_cancel` round-trip — issuing one would only duplicate
/// what the cluster already does on close. The single cancellation window is
/// the header-wait phase, but that is exactly when the server is doing the
/// search work (it flushes response headers only once the query completes), so
/// closing during that phase is what actually stops the cluster.
/// `elasticsearch_cancel_closes_the_http_connection_server_side` locks the
/// client half of this contract: cancel must close the socket, not pool it.
async fn send_with_cancel(
    request: RequestBuilder,
    cancel: Option<&CancellationToken>,
    label: &str,
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
    response.map_err(|err| search_network_error(label, "search request", err))
}

fn search_network_error(label: &str, endpoint_class: &str, err: reqwest::Error) -> AppError {
    if err.is_timeout() {
        return AppError::SearchTimeout(format!("{label} timeout during {endpoint_class}"));
    }
    if is_tls_error(&err) {
        return AppError::SearchTls(format!("{label} TLS error during {endpoint_class}"));
    }
    AppError::SearchNetwork(format!(
        "{label} network error during {endpoint_class}: {}",
        err.without_url()
    ))
}

fn is_tls_error(err: &reqwest::Error) -> bool {
    if !(err.is_connect() || err.is_decode() || err.is_request()) {
        return false;
    }
    let message = format!("{err:?}").to_ascii_lowercase();
    [
        "tls",
        "rustls",
        "certificate",
        "handshake",
        "invalidcontenttype",
        "invalid content type",
        "received corrupt message",
        "unexpected eof",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

fn search_http_status_error(
    label: &str,
    endpoint_class: &str,
    status: StatusCode,
    path: Option<&str>,
    detail: Option<&str>,
) -> AppError {
    let (mut message, variant) = if status == StatusCode::UNAUTHORIZED {
        (
            format!("{label} authentication failed during {endpoint_class} ({status})"),
            SearchHttpStatusVariant::Authentication,
        )
    } else if status == StatusCode::FORBIDDEN {
        (
            format!("{label} permission denied during {endpoint_class} ({status})"),
            SearchHttpStatusVariant::Permission,
        )
    } else if status.is_server_error() {
        (
            format!("{label} server error during {endpoint_class} ({status})"),
            SearchHttpStatusVariant::Server,
        )
    } else if let Some(path) = path {
        (
            format!("{label} {endpoint_class} {path} failed with HTTP {status}"),
            SearchHttpStatusVariant::Other,
        )
    } else {
        (
            format!("{label} {endpoint_class} failed with HTTP {status}"),
            SearchHttpStatusVariant::Other,
        )
    };

    if let Some(detail) = detail.filter(|value| !value.trim().is_empty()) {
        message.push_str(": ");
        message.push_str(detail);
    }
    match variant {
        SearchHttpStatusVariant::Authentication => AppError::SearchAuthentication(message),
        SearchHttpStatusVariant::Permission => AppError::SearchPermission(message),
        SearchHttpStatusVariant::Server | SearchHttpStatusVariant::Other
            if detail_has_shard_failure(detail) =>
        {
            AppError::SearchShardFailure(message)
        }
        SearchHttpStatusVariant::Server | SearchHttpStatusVariant::Other => {
            AppError::Connection(message)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchHttpStatusVariant {
    Authentication,
    Permission,
    Server,
    Other,
}

fn detail_has_shard_failure(detail: Option<&str>) -> bool {
    detail.is_some_and(|value| value.contains("shard failure"))
}

fn search_http_error_detail(body: &str, include_shard_failure: bool) -> String {
    let mut detail = search_error_detail(body.to_string());
    if include_shard_failure {
        if let Some(shard_detail) = shard_failure_detail(body) {
            detail.push_str("; shard failure: ");
            detail.push_str(&shard_detail);
        }
    }
    sanitize_search_error_detail(&detail)
}

fn sanitize_search_error_detail(detail: &str) -> String {
    static URL_RE: OnceLock<Regex> = OnceLock::new();
    static AUTH_HEADER_RE: OnceLock<Regex> = OnceLock::new();
    static JSON_SECRET_RE: OnceLock<Regex> = OnceLock::new();
    static SECRET_RE: OnceLock<Regex> = OnceLock::new();

    let without_urls = URL_RE
        .get_or_init(|| Regex::new(r#"https?://[^\s"'<>]+"#).expect("URL redaction regex compiles"))
        .replace_all(detail, "[redacted-url]");
    let without_auth = AUTH_HEADER_RE
        .get_or_init(|| {
            Regex::new(r#"(?i)\b(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s,;]+"#)
                .expect("Search auth header redaction regex compiles")
        })
        .replace_all(&without_urls, "$1$2 [redacted]");
    let without_json_secrets = JSON_SECRET_RE
        .get_or_init(|| {
            Regex::new(
                r#"(?i)(["']?(?:password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?token|secret)["']?\s*:\s*)["'][^"']+["']"#,
            )
            .expect("Search JSON secret redaction regex compiles")
        })
        .replace_all(&without_auth, "$1\"[redacted]\"");
    SECRET_RE
        .get_or_init(|| {
            Regex::new(
                r#"(?i)\b(password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?token|secret)=([^\s&"'<>]+)"#,
            )
                .expect("Search secret redaction regex compiles")
        })
        .replace_all(&without_json_secrets, "$1=[redacted]")
        .into_owned()
}

fn shard_failure_detail(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body).ok()?;
    let reason = value
        .pointer("/error/failed_shards/0/reason")
        .or_else(|| value.pointer("/_shards/failures/0/reason"))?;
    let error_type = reason.get("type").and_then(Value::as_str);
    let reason_text = reason.get("reason").and_then(Value::as_str);
    match (error_type, reason_text) {
        (Some(error_type), Some(reason_text)) => Some(format!("{error_type}: {reason_text}")),
        (Some(error_type), None) => Some(error_type.to_string()),
        (None, Some(reason_text)) => Some(reason_text.to_string()),
        (None, None) => Some(reason.to_string()),
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

async fn probe_search_root(
    client: &reqwest::Client,
    base_url: &str,
    auth: &SearchHttpAuth,
    expected_product: SearchProductKind,
) -> Result<SearchClusterIdentity, AppError> {
    let label = expected_product.label();
    let request = auth.apply(client.get(format!("{}/", base_url.trim_end_matches('/'))));
    let response = request
        .send()
        .await
        .map_err(|err| search_network_error(label, "root probe", err))?;
    let status = response.status();

    if !status.is_success() {
        let detail = response
            .text()
            .await
            .ok()
            .map(|body| search_http_error_detail(&body, false));
        return Err(search_http_status_error(
            label,
            "root probe",
            status,
            None,
            detail.as_deref(),
        ));
    }

    let product_header = response
        .headers()
        .get("x-elastic-product")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let root = response.json::<Value>().await.map_err(|err| {
        AppError::Connection(format!("{label} root probe returned invalid JSON: {err}"))
    })?;

    identity_from_root(&root, product_header.as_deref(), expected_product)
}

fn identity_from_root(
    root: &Value,
    product_header: Option<&str>,
    expected_product: SearchProductKind,
) -> Result<SearchClusterIdentity, AppError> {
    let version = root.get("version").unwrap_or(&Value::Null);
    let raw_distribution = version
        .get("distribution")
        .and_then(Value::as_str)
        .map(str::to_string);
    let tagline = root.get("tagline").and_then(Value::as_str).unwrap_or("");
    let has_opensearch_signal = raw_distribution
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("opensearch"))
        || tagline.to_ascii_lowercase().contains("opensearch");
    let has_elasticsearch_signal = product_header
        .is_some_and(|value| value.eq_ignore_ascii_case("Elasticsearch"))
        || raw_distribution
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("elasticsearch"));
    let distribution = match expected_product {
        SearchProductKind::Elasticsearch => {
            if product_header.is_some_and(|value| !value.eq_ignore_ascii_case("Elasticsearch")) {
                return Err(AppError::SearchProductMismatch(
                    "Expected Elasticsearch endpoint but detected a different product".into(),
                ));
            }
            if has_opensearch_signal {
                return Err(AppError::SearchProductMismatch(
                    "Expected Elasticsearch endpoint but detected OpenSearch".into(),
                ));
            }
            raw_distribution.unwrap_or_else(|| "elasticsearch".to_string())
        }
        SearchProductKind::OpenSearch => {
            if product_header.is_some_and(|value| !value.eq_ignore_ascii_case("Elasticsearch"))
                && !has_opensearch_signal
            {
                return Err(AppError::SearchProductMismatch(
                    "Expected OpenSearch endpoint but detected a different product".into(),
                ));
            }
            if has_elasticsearch_signal {
                return Err(AppError::SearchProductMismatch(
                    "Expected OpenSearch endpoint but detected Elasticsearch".into(),
                ));
            }
            if !has_opensearch_signal {
                return Err(AppError::SearchProductMismatch(
                    "Expected OpenSearch endpoint but product could not be verified".into(),
                ));
            }
            raw_distribution.unwrap_or_else(|| "opensearch".to_string())
        }
    };
    let version_number = version
        .get("number")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::SearchUnsupportedVersion(format!(
                "{} root probe did not include a version number",
                expected_product.label()
            ))
        })?;
    ensure_supported_search_version(expected_product, version_number)?;

    Ok(SearchClusterIdentity {
        product: expected_product,
        cluster_name: root
            .get("cluster_name")
            .and_then(Value::as_str)
            .unwrap_or(match expected_product {
                SearchProductKind::Elasticsearch => "Elasticsearch cluster",
                SearchProductKind::OpenSearch => "OpenSearch cluster",
            })
            .to_string(),
        cluster_uuid: root
            .get("cluster_uuid")
            .and_then(Value::as_str)
            .map(str::to_string),
        version: SearchVersionInfo {
            number: version_number.to_string(),
            distribution: Some(distribution),
            lucene: version
                .get("lucene_version")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_flavor: version
                .get("build_flavor")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_type: version
                .get("build_type")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_hash: version
                .get("build_hash")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_date: version
                .get("build_date")
                .and_then(Value::as_str)
                .map(str::to_string),
            build_snapshot: version.get("build_snapshot").and_then(Value::as_bool),
        },
        capabilities: root_probe_capabilities(expected_product),
        product_delta: SearchProductDelta::for_product(expected_product),
    })
}

fn ensure_supported_search_version(
    product: SearchProductKind,
    version_number: &str,
) -> Result<(), AppError> {
    let Some(major) = search_major_version(version_number) else {
        return Err(AppError::SearchUnsupportedVersion(format!(
            "{} version {version_number} is not supported: expected a semantic major version",
            product.label()
        )));
    };
    let minimum_major = match product {
        SearchProductKind::Elasticsearch => 7,
        SearchProductKind::OpenSearch => 1,
    };
    if major < minimum_major {
        return Err(AppError::SearchUnsupportedVersion(format!(
            "{} version {version_number} is not supported: requires major version {minimum_major} or newer",
            product.label()
        )));
    }
    Ok(())
}

fn search_major_version(version_number: &str) -> Option<u64> {
    version_number
        .split('.')
        .next()
        .filter(|part| !part.is_empty())
        .and_then(|part| part.parse::<u64>().ok())
}

fn root_probe_capabilities(product: SearchProductKind) -> SearchClusterCapabilities {
    match product {
        SearchProductKind::Elasticsearch => SearchClusterCapabilities {
            search: true,
            aggregations: true,
            aliases: true,
            mappings: true,
            legacy_index_templates: false,
            composable_index_templates: true,
            delete_by_query: true,
        },
        SearchProductKind::OpenSearch => SearchClusterCapabilities {
            search: true,
            aggregations: true,
            aliases: true,
            mappings: true,
            legacy_index_templates: true,
            composable_index_templates: true,
            delete_by_query: true,
        },
    }
}

/// #1712 — a permission-class error (403 → `AppError::SearchPermission`) on a
/// best-effort meta endpoint (`_cat/indices`, `_aliases`) must not fail the
/// whole catalog: the authoritative visibility source is `_field_caps`. Map such
/// errors to `None`; propagate every other error unchanged.
fn permission_tolerant<T>(result: Result<T, AppError>) -> Result<Option<T>, AppError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(AppError::SearchPermission(_)) => Ok(None),
        Err(err) => Err(err),
    }
}

/// #1712 — the `_field_caps` response carries a top-level `indices` array of the
/// read-authorized (open) index names. Absent/non-array => empty set.
fn parse_field_caps_indices(payload: &Value) -> Vec<String> {
    payload
        .get("indices")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(value_to_string).collect())
        .unwrap_or_default()
}

/// #1712 — field_caps proved this index is read-visible but `_cat/indices` meta
/// is unavailable (permission-denied or omitted). Surface it with Unknown meta
/// rather than hiding it. field_caps only returns open indices.
fn synthesize_index_info(name: String) -> SearchIndexInfo {
    SearchIndexInfo {
        name,
        uuid: None,
        health: SearchIndexHealth::Unknown,
        open: true,
        docs_count: None,
        store_size_bytes: None,
        aliases: Vec::new(),
        primary_shards: None,
        replica_shards: None,
    }
}

fn parse_cat_indices(payload: &Value, label: &str) -> Result<Vec<SearchIndexInfo>, AppError> {
    let rows = payload.as_array().ok_or_else(|| {
        AppError::Connection(format!("{label} indices catalog returned non-array JSON"))
    })?;
    rows.iter()
        .map(|row| {
            let item = row.as_object().ok_or_else(|| {
                AppError::Connection(format!("{label} index catalog row is not an object"))
            })?;
            let name = string_field(item, "index").ok_or_else(|| {
                AppError::Connection(format!("{label} index catalog row is missing index"))
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

fn parse_aliases(payload: &Value, label: &str) -> Result<Vec<SearchAliasInfo>, AppError> {
    let root = payload.as_object().ok_or_else(|| {
        AppError::Connection(format!("{label} aliases catalog returned non-object JSON"))
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

fn parse_data_streams(payload: &Value, label: &str) -> Result<Vec<SearchDataStreamInfo>, AppError> {
    let streams = payload
        .get("data_streams")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Connection(format!("{label} data stream catalog returned invalid JSON"))
        })?;
    streams
        .iter()
        .map(|stream| {
            let item = stream.as_object().ok_or_else(|| {
                AppError::Connection(format!("{label} data stream row is not an object"))
            })?;
            let name = string_field(item, "name").ok_or_else(|| {
                AppError::Connection(format!("{label} data stream row is missing name"))
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
    // Defense-in-depth: never silently hand back the whole payload when the index
    // key is absent — a malformed/broadened response must surface as an error (#1107).
    let entry = index_entry(index, payload).ok_or_else(|| {
        AppError::Connection(format!(
            "Search mapping response did not include index '{index}'"
        ))
    })?;
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
    let entry = index_entry(index, payload).ok_or_else(|| {
        AppError::Connection(format!(
            "Search settings response did not include index '{index}'"
        ))
    })?;
    let settings = entry.get("settings").unwrap_or(entry);
    Ok(SearchIndexSettings {
        index: index.into(),
        raw: settings.clone(),
        analyzers: parse_analyzers(settings),
    })
}

fn parse_composable_index_templates(
    payload: &Value,
    label: &str,
) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
    let templates = payload
        .get("index_templates")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Connection(format!("{label} index templates returned invalid JSON"))
        })?;
    Ok(templates
        .iter()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(value_to_string)?;
            let body = entry.get("index_template").unwrap_or(entry);
            Some(SearchIndexTemplateInfo {
                name,
                endpoint: SearchTemplateEndpointKind::ComposableIndexTemplate,
                index_patterns: template_patterns(body),
                priority: body.get("priority").and_then(Value::as_i64),
                raw: body.clone(),
            })
        })
        .collect())
}

fn parse_legacy_index_templates(
    payload: &Value,
    label: &str,
) -> Result<Vec<SearchIndexTemplateInfo>, AppError> {
    let templates = payload.as_object().ok_or_else(|| {
        AppError::Connection(format!("{label} legacy templates returned invalid JSON"))
    })?;
    Ok(templates
        .iter()
        .filter_map(|(name, body)| {
            let patterns = template_patterns(body);
            if patterns.is_empty() {
                return None;
            }
            Some(SearchIndexTemplateInfo {
                name: name.clone(),
                endpoint: SearchTemplateEndpointKind::LegacyIndexTemplate,
                index_patterns: patterns,
                priority: None,
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

fn attach_aliases(
    mut indexes: Vec<SearchIndexInfo>,
    aliases: &[SearchAliasInfo],
) -> Vec<SearchIndexInfo> {
    let aliases_by_index =
        aliases
            .iter()
            .fold(HashMap::<String, Vec<String>>::new(), |mut acc, alias| {
                acc.entry(alias.index.clone())
                    .or_default()
                    .push(alias.name.clone());
                acc
            });
    for index in &mut indexes {
        index.aliases = aliases_by_index
            .get(&index.name)
            .cloned()
            .unwrap_or_default();
    }
    indexes
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

fn template_patterns(template: &Value) -> Vec<String> {
    let modern = string_array(template.get("index_patterns"));
    if modern.is_empty() {
        string_array(template.get("template"))
    } else {
        modern
    }
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_http_status_auth_and_permission_win_over_shard_detail() {
        let shard_detail = Some("search_phase_execution_exception; shard failure: bad shard");

        let auth = search_http_status_error(
            "Elasticsearch",
            "search request",
            StatusCode::UNAUTHORIZED,
            Some("/logs/_search"),
            shard_detail,
        );
        assert!(matches!(auth, AppError::SearchAuthentication(_)));

        let permission = search_http_status_error(
            "Elasticsearch",
            "search request",
            StatusCode::FORBIDDEN,
            Some("/logs/_search"),
            shard_detail,
        );
        assert!(matches!(permission, AppError::SearchPermission(_)));
    }

    #[test]
    fn search_http_status_shard_detail_overrides_server_error() {
        let error = search_http_status_error(
            "Elasticsearch",
            "search request",
            StatusCode::SERVICE_UNAVAILABLE,
            Some("/logs/_search"),
            Some("search_phase_execution_exception; shard failure: bad shard"),
        );

        assert!(matches!(error, AppError::SearchShardFailure(_)));
    }

    #[test]
    fn parse_field_caps_indices_reads_top_level_names_and_tolerates_gaps() {
        // Reason: #1712 — `_field_caps?fields=_index` is the authoritative index
        // visibility source; parse its top-level `indices` array. A cluster with
        // no indices returns an empty array, and a malformed/absent field must
        // degrade to an empty set (never a whole-catalog failure). (2026-07-22)
        let full = json!({
            "indices": ["logs-a", "logs-b"],
            "fields": { "_index": { "_index": { "type": "_index" } } }
        });
        assert_eq!(parse_field_caps_indices(&full), vec!["logs-a", "logs-b"]);
        assert!(parse_field_caps_indices(&json!({ "indices": [] })).is_empty());
        assert!(parse_field_caps_indices(&json!({ "fields": {} })).is_empty());
    }

    #[test]
    fn permission_tolerant_swallows_only_permission_errors() {
        // Reason: #1712 — best-effort meta endpoints (`_cat/indices`, `_aliases`)
        // tolerate a 403 (→ None) but must still surface every other error so a
        // genuine transport/parse fault is not silently hidden. (2026-07-22)
        assert_eq!(permission_tolerant(Ok::<_, AppError>(7)).unwrap(), Some(7));
        assert_eq!(
            permission_tolerant(Err::<i32, _>(AppError::SearchPermission("403".into()))).unwrap(),
            None
        );
        assert!(matches!(
            permission_tolerant(Err::<i32, _>(AppError::Connection("boom".into()))),
            Err(AppError::Connection(_))
        ));
    }

    fn test_connection() -> SearchHttpConnection {
        SearchHttpConnection {
            // Unroutable target: the guard must reject before any request is sent.
            base_url: "http://127.0.0.1:0".into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(1))
                .build()
                .expect("test client builds"),
            auth: SearchHttpAuth {
                user: String::new(),
                password: String::new(),
            },
            product: SearchProductKind::Elasticsearch,
            identity: SearchClusterIdentity {
                product: SearchProductKind::Elasticsearch,
                cluster_name: "test".into(),
                cluster_uuid: None,
                version: SearchVersionInfo {
                    number: "8.12.2".into(),
                    distribution: None,
                    lucene: None,
                    build_flavor: None,
                    build_type: None,
                    build_hash: None,
                    build_date: None,
                    build_snapshot: None,
                },
                capabilities: root_probe_capabilities(SearchProductKind::Elasticsearch),
                product_delta: SearchProductDelta::for_product(SearchProductKind::Elasticsearch),
            },
        }
    }

    #[test]
    fn validated_index_path_preserves_valid_names_and_encodes_the_rest() {
        // Happy path: ASCII index names use only RFC 3986 unreserved chars, so they
        // round-trip unchanged — the mock-server contract (`/logs-.../_mapping`) holds.
        assert_eq!(
            validated_index_path("logs-elastic-2026.05.24", "_mapping").unwrap(),
            "/logs-elastic-2026.05.24/_mapping"
        );
        // Unicode index names percent-encode to UTF-8 bytes, which the cluster
        // decodes back to the original name — still cluster-compatible.
        assert_eq!(
            validated_index_path("한글", "_settings").unwrap(),
            "/%ED%95%9C%EA%B8%80/_settings"
        );
        // The allowlist still rejects the dangerous classes before any encoding.
        // `.` / `..` are RFC 3986 unreserved, so they survive percent-encoding and
        // reqwest's Url::parse normalizes `/../_mapping` -> `/_mapping` (whole-cluster
        // dump); they must be rejected up front (#1107 review).
        for bad in [
            "*",
            "_all",
            ".",
            "..",
            "../_cluster/settings",
            "logs?pretty=true",
            "logs%2f_search",
        ] {
            assert!(
                matches!(
                    validated_index_path(bad, "_mapping"),
                    Err(AppError::Validation(_))
                ),
                "validated_index_path should reject {bad}"
            );
        }
    }

    #[tokio::test]
    async fn index_detail_paths_reject_unvalidated_targets() {
        // Reason: #1107 — mapping/settings/field-stats must not bypass the
        // validate_search_target allowlist the live search() path already enforces.
        // wildcard dump / `../_cluster` admin reach / `?` query-param injection.
        let conn = test_connection();
        for target in ["*", ".", "..", "../_cluster/settings", "logs?pretty=true"] {
            assert!(
                matches!(
                    conn.get_index_mapping(target).await,
                    Err(AppError::Validation(_))
                ),
                "get_index_mapping should reject {target} before any HTTP request"
            );
            assert!(
                matches!(
                    conn.get_index_settings(target).await,
                    Err(AppError::Validation(_))
                ),
                "get_index_settings should reject {target} before any HTTP request"
            );
            assert!(
                matches!(
                    conn.get_index_field_stats(target).await,
                    Err(AppError::Validation(_))
                ),
                "get_index_field_stats should inherit the mapping guard for {target}"
            );
        }
    }
}
