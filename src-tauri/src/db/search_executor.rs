use serde_json::Value;

use crate::db::search::SearchCatalogFixture;
use crate::error::AppError;
use crate::models::{
    SearchAggregationEnvelope, SearchHitEnvelope, SearchQueryRequest, SearchResultEnvelope,
    SearchTermsBucket, SearchTotalHits, SearchTotalHitsRelation,
};

pub(crate) fn execute_fixture_search(
    fixture: &SearchCatalogFixture,
    request: &SearchQueryRequest,
) -> Result<SearchResultEnvelope, AppError> {
    validate_fixture_search_request(fixture, request)?;
    let body = request
        .body
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL body must be a JSON object".into()))?;

    let filtered_hits = filter_fixture_hits(&fixture.search_result.hits, body.get("query"))?;
    let total = filtered_hits.len() as u64;
    let aggregations = aggregation_envelopes(body, &filtered_hits)?;

    let from = request
        .from
        .or_else(|| body.get("from").and_then(Value::as_u64))
        .unwrap_or(0) as usize;
    let size = request
        .size
        .or_else(|| body.get("size").and_then(Value::as_u64))
        .unwrap_or(filtered_hits.len() as u64) as usize;
    let hits = filtered_hits.into_iter().skip(from).take(size).collect();

    let mut result = fixture.search_result.clone();
    result.total = SearchTotalHits {
        value: total,
        relation: SearchTotalHitsRelation::Eq,
    };
    result.hits = hits;
    result.aggregations = aggregations;
    Ok(result)
}

fn validate_fixture_search_request(
    fixture: &SearchCatalogFixture,
    request: &SearchQueryRequest,
) -> Result<(), AppError> {
    let target = request.index.trim();
    if target.is_empty() {
        return Err(AppError::Validation(
            "Search DSL requires an index target".into(),
        ));
    }
    if target == "_all" || target.contains('*') {
        return Err(AppError::Validation(
            "Search DSL wildcard targets require an explicit safe contract".into(),
        ));
    }
    if looks_like_raw_or_destructive_path(target) {
        return Err(AppError::Validation(
            "Search DSL execution only accepts index or alias targets, not raw/destructive paths"
                .into(),
        ));
    }
    let known_target = fixture.indexes.iter().any(|index| index.name == target)
        || fixture.aliases.iter().any(|alias| alias.name == target);
    if !known_target {
        return Err(AppError::NotFound(format!(
            "Search index or alias '{}' not found",
            target
        )));
    }

    let body = request
        .body
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL body must be a JSON object".into()))?;
    for key in body.keys() {
        if !matches!(
            key.as_str(),
            "query" | "aggs" | "aggregations" | "from" | "size" | "track_total_hits"
        ) {
            return Err(AppError::Unsupported(format!(
                "Search DSL feature '{}' is not supported by the bounded fixture executor",
                key
            )));
        }
    }
    if let Some(query) = body.get("query") {
        validate_query_clause(query)?;
    }
    Ok(())
}

fn looks_like_raw_or_destructive_path(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    target.contains('/')
        || lower.contains("_delete_by_query")
        || lower.contains("_update_by_query")
        || lower.contains("_bulk")
        || lower.contains("_reindex")
        || lower.contains("_scripts")
}

fn validate_query_clause(query: &Value) -> Result<(), AppError> {
    let query = query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL query must be a JSON object".into()))?;
    for key in query.keys() {
        if !matches!(key.as_str(), "match_all" | "term" | "match") {
            return Err(AppError::Unsupported(format!(
                "Search DSL query clause '{}' is not supported",
                key
            )));
        }
    }
    Ok(())
}

fn filter_fixture_hits(
    hits: &[SearchHitEnvelope],
    query: Option<&Value>,
) -> Result<Vec<SearchHitEnvelope>, AppError> {
    let Some(query) = query else {
        return Ok(hits.to_vec());
    };
    let query = query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL query must be a JSON object".into()))?;
    if query.contains_key("match_all") {
        return Ok(hits.to_vec());
    }
    if let Some(term) = query.get("term") {
        return filter_by_exact_field(hits, term);
    }
    if let Some(match_query) = query.get("match") {
        return filter_by_text_field(hits, match_query);
    }
    Ok(hits.to_vec())
}

fn filter_by_exact_field(
    hits: &[SearchHitEnvelope],
    term: &Value,
) -> Result<Vec<SearchHitEnvelope>, AppError> {
    let term = term
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL term query must be an object".into()))?;
    let Some((field, expected)) = term.iter().next() else {
        return Err(AppError::Validation(
            "Search DSL term query requires a field".into(),
        ));
    };
    let expected = expected.get("value").unwrap_or(expected);
    Ok(hits
        .iter()
        .filter(|hit| source_field_value(&hit.source, field) == Some(expected))
        .cloned()
        .collect())
}

fn filter_by_text_field(
    hits: &[SearchHitEnvelope],
    match_query: &Value,
) -> Result<Vec<SearchHitEnvelope>, AppError> {
    let match_query = match_query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL match query must be an object".into()))?;
    let Some((field, expected)) = match_query.iter().next() else {
        return Err(AppError::Validation(
            "Search DSL match query requires a field".into(),
        ));
    };
    let expected = expected.get("query").unwrap_or(expected);
    let needle = expected.as_str().ok_or_else(|| {
        AppError::Unsupported("Search DSL match query only supports string values".into())
    })?;
    Ok(hits
        .iter()
        .filter(|hit| {
            source_field_value(&hit.source, field)
                .and_then(Value::as_str)
                .is_some_and(|value| value.contains(needle))
        })
        .cloned()
        .collect())
}

fn aggregation_envelopes(
    body: &serde_json::Map<String, Value>,
    hits: &[SearchHitEnvelope],
) -> Result<Vec<SearchAggregationEnvelope>, AppError> {
    let Some(aggs) = body.get("aggs").or_else(|| body.get("aggregations")) else {
        return Ok(Vec::new());
    };
    let aggs = aggs
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL aggregations must be an object".into()))?;

    aggs.iter()
        .map(|(name, spec)| aggregation_envelope(name, spec, hits))
        .collect()
}

fn aggregation_envelope(
    name: &str,
    spec: &Value,
    hits: &[SearchHitEnvelope],
) -> Result<SearchAggregationEnvelope, AppError> {
    let spec = spec.as_object().ok_or_else(|| {
        AppError::Validation(format!("Search aggregation '{}' must be an object", name))
    })?;
    let Some((kind, config)) = spec.iter().next() else {
        return Err(AppError::Validation(format!(
            "Search aggregation '{}' requires a kind",
            name
        )));
    };
    match kind.as_str() {
        "terms" => terms_aggregation(name, config, hits),
        "value_count" => value_count_aggregation(name, config, hits),
        other => Err(AppError::Unsupported(format!(
            "Search aggregation '{}' uses unsupported kind '{}'",
            name, other
        ))),
    }
}

fn terms_aggregation(
    name: &str,
    config: &Value,
    hits: &[SearchHitEnvelope],
) -> Result<SearchAggregationEnvelope, AppError> {
    let field = aggregation_field(config, "terms")?;
    let mut counts = std::collections::BTreeMap::<String, u64>::new();
    for hit in hits {
        let key = source_field_value(&hit.source, field)
            .and_then(Value::as_str)
            .unwrap_or("(missing)");
        *counts.entry(key.to_string()).or_default() += 1;
    }
    let buckets = counts
        .into_iter()
        .map(|(key, doc_count)| SearchTermsBucket { key, doc_count })
        .collect::<Vec<_>>();
    Ok(SearchAggregationEnvelope::Terms {
        name: name.into(),
        buckets,
    })
}

fn value_count_aggregation(
    name: &str,
    config: &Value,
    hits: &[SearchHitEnvelope],
) -> Result<SearchAggregationEnvelope, AppError> {
    let field = aggregation_field(config, "value_count")?;
    let value = hits
        .iter()
        .filter(|hit| source_field_value(&hit.source, field).is_some())
        .count();
    Ok(SearchAggregationEnvelope::ValueCount {
        name: name.into(),
        value: value as u64,
    })
}

fn aggregation_field<'a>(config: &'a Value, kind: &str) -> Result<&'a str, AppError> {
    config.get("field").and_then(Value::as_str).ok_or_else(|| {
        AppError::Validation(format!(
            "Search {} aggregation requires a string field",
            kind
        ))
    })
}

fn source_field_value<'a>(source: &'a Value, field: &str) -> Option<&'a Value> {
    let normalized = field.strip_suffix(".keyword").unwrap_or(field);
    normalized
        .split('.')
        .try_fold(source, |current, part| current.get(part))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::search::SearchCatalogFixture;
    use crate::models::SearchProductKind;
    use serde_json::json;

    fn fixture() -> SearchCatalogFixture {
        SearchCatalogFixture::sample(SearchProductKind::Elasticsearch)
    }

    fn request(body: Value) -> SearchQueryRequest {
        SearchQueryRequest {
            index: "logs-elastic-2026.05.24".into(),
            body,
            from: None,
            size: Some(10),
            track_total_hits: Some(true),
        }
    }

    #[test]
    fn fixture_search_returns_typed_aggregation_envelopes() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "aggs": {
                    "by_status": {
                        "terms": { "field": "status.keyword" }
                    }
                }
            })),
        )
        .unwrap();

        assert_eq!(result.hits[0].id, "doc-1");
        assert_eq!(result.aggregations.len(), 1);
        match &result.aggregations[0] {
            SearchAggregationEnvelope::Terms { name, buckets } => {
                assert_eq!(name, "by_status");
                assert_eq!(buckets.len(), 2);
                assert!(buckets
                    .iter()
                    .any(|bucket| bucket.key == "ok" && bucket.doc_count == 1));
                assert!(buckets
                    .iter()
                    .any(|bucket| bucket.key == "error" && bucket.doc_count == 1));
            }
            other => panic!("expected terms aggregation, got {other:?}"),
        }
    }

    #[test]
    fn fixture_search_returns_typed_value_count_aggregation() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "aggs": {
                    "messages": {
                        "value_count": { "field": "message" }
                    }
                }
            })),
        )
        .unwrap();

        assert_eq!(
            result.aggregations[0],
            SearchAggregationEnvelope::ValueCount {
                name: "messages".into(),
                value: 2
            }
        );
    }

    #[test]
    fn fixture_search_aggregates_before_paginating_hits() {
        let mut req = request(json!({
            "query": { "match_all": {} },
            "aggs": {
                "by_status": {
                    "terms": { "field": "status.keyword" }
                }
            }
        }));
        req.size = Some(1);

        let result = execute_fixture_search(&fixture(), &req).unwrap();

        assert_eq!(result.hits.len(), 1);
        match &result.aggregations[0] {
            SearchAggregationEnvelope::Terms { buckets, .. } => {
                let total_bucket_docs: u64 = buckets.iter().map(|bucket| bucket.doc_count).sum();
                assert_eq!(total_bucket_docs, 2);
            }
            other => panic!("expected terms aggregation, got {other:?}"),
        }
    }

    #[test]
    fn fixture_search_blocks_broad_wildcard_targets_by_default() {
        let mut req = request(json!({ "query": { "match_all": {} } }));
        req.index = "*".into();

        let result = execute_fixture_search(&fixture(), &req);

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("wildcard"))
        );
    }

    #[test]
    fn fixture_search_blocks_destructive_path_shaped_targets() {
        let mut req = request(json!({ "query": { "match_all": {} } }));
        req.index = "/logs-elastic-2026.05.24/_delete_by_query".into();

        let result = execute_fixture_search(&fixture(), &req);

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("destructive"))
        );
    }

    #[test]
    fn fixture_search_rejects_unsupported_dsl_features_clearly() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "suggest": {
                    "message-suggest": {
                        "text": "fixture",
                        "term": { "field": "message" }
                    }
                }
            })),
        );

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("suggest"))
        );
    }

    #[test]
    fn fixture_search_rejects_ignored_dsl_features_clearly() {
        for feature in ["sort", "_source", "fields", "highlight"] {
            let result = execute_fixture_search(
                &fixture(),
                &request(json!({
                    "query": { "match_all": {} },
                    feature: []
                })),
            );

            assert!(
                matches!(result, Err(AppError::Unsupported(ref message)) if message.contains(feature)),
                "feature {feature} should fail clearly, got {result:?}"
            );
        }
    }

    #[test]
    fn aggregation_envelope_rejects_unknown_raw_kind() {
        let raw = json!({
            "kind": "raw",
            "name": "raw_payload",
            "value": { "opaque": true }
        });

        let result = serde_json::from_value::<SearchAggregationEnvelope>(raw);

        assert!(result.is_err());
    }
}
