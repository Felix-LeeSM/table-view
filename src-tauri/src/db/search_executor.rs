use std::cmp::Ordering;

use serde_json::Value;

use crate::db::search::SearchCatalogFixture;
use crate::db::search_destructive::{
    delete_by_query_body_object, delete_by_query_target, target_pattern_matches,
    validate_delete_by_query_request,
};
use crate::db::search_dsl::{search_body_object, validate_search_dsl_request};
use crate::error::AppError;
use crate::models::{
    SearchAggregationEnvelope, SearchDeleteByQueryRequest, SearchHitEnvelope, SearchQueryRequest,
    SearchResultEnvelope, SearchTermsBucket, SearchTotalHits, SearchTotalHitsRelation,
};

pub(crate) fn execute_fixture_search(
    fixture: &SearchCatalogFixture,
    request: &SearchQueryRequest,
) -> Result<SearchResultEnvelope, AppError> {
    validate_fixture_search_request(fixture, request)?;
    let body = search_body_object(request)?;

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

pub(crate) fn estimate_fixture_delete_by_query(
    fixture: &SearchCatalogFixture,
    request: &SearchDeleteByQueryRequest,
) -> Result<u64, AppError> {
    validate_delete_by_query_request(request)?;
    let target = delete_by_query_target(request);
    let indices = fixture_target_indices(fixture, target)?;
    let candidate_hits = fixture
        .search_result
        .hits
        .iter()
        .filter(|hit| indices.iter().any(|index| index == &hit.index))
        .cloned()
        .collect::<Vec<_>>();
    Ok(filter_fixture_hits(
        &candidate_hits,
        delete_by_query_body_object(request)?.get("query"),
    )?
    .len() as u64)
}

fn validate_fixture_search_request(
    fixture: &SearchCatalogFixture,
    request: &SearchQueryRequest,
) -> Result<(), AppError> {
    validate_search_dsl_request(request)?;

    let target = request.index.trim();
    let known_target = fixture.indexes.iter().any(|index| index.name == target)
        || fixture.aliases.iter().any(|alias| alias.name == target);
    if !known_target {
        return Err(AppError::NotFound(format!(
            "Search index or alias '{}' not found",
            target
        )));
    }

    Ok(())
}

fn fixture_target_indices(
    fixture: &SearchCatalogFixture,
    target: &str,
) -> Result<Vec<String>, AppError> {
    let mut indices = Vec::new();
    for index in &fixture.indexes {
        if target_pattern_matches(target, &index.name) {
            indices.push(index.name.clone());
        }
    }
    for alias in &fixture.aliases {
        if target_pattern_matches(target, &alias.name) && !indices.contains(&alias.index) {
            indices.push(alias.index.clone());
        }
    }
    if indices.is_empty() {
        return Err(AppError::NotFound(format!(
            "Search index or alias pattern '{}' not found",
            target
        )));
    }
    Ok(indices)
}

fn filter_fixture_hits(
    hits: &[SearchHitEnvelope],
    query: Option<&Value>,
) -> Result<Vec<SearchHitEnvelope>, AppError> {
    let Some(query) = query else {
        return Ok(hits.to_vec());
    };
    hits.iter()
        .filter_map(|hit| match query_matches_hit(hit, query) {
            Ok(true) => Some(Ok(hit.clone())),
            Ok(false) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn query_matches_hit(hit: &SearchHitEnvelope, query: &Value) -> Result<bool, AppError> {
    let query = query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL query must be a JSON object".into()))?;
    if query.contains_key("match_all") {
        return Ok(true);
    }
    if let Some(term) = query.get("term") {
        return term_matches_hit(hit, term);
    }
    if let Some(terms) = query.get("terms") {
        return terms_matches_hit(hit, terms);
    }
    if let Some(match_query) = query.get("match") {
        return text_matches_hit(hit, match_query);
    }
    if let Some(range) = query.get("range") {
        return range_matches_hit(hit, range);
    }
    if let Some(exists) = query.get("exists") {
        return exists_matches_hit(hit, exists);
    }
    if let Some(bool_query) = query.get("bool") {
        return bool_matches_hit(hit, bool_query);
    }
    Ok(false)
}

fn term_matches_hit(hit: &SearchHitEnvelope, term: &Value) -> Result<bool, AppError> {
    let term = term
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL term query must be an object".into()))?;
    let Some((field, expected)) = term.iter().next() else {
        return Err(AppError::Validation(
            "Search DSL term query requires a field".into(),
        ));
    };
    let expected = expected.get("value").unwrap_or(expected);
    Ok(source_field_value(&hit.source, field) == Some(expected))
}

fn terms_matches_hit(hit: &SearchHitEnvelope, terms: &Value) -> Result<bool, AppError> {
    let terms = terms
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL terms query must be an object".into()))?;
    let Some((field, expected_values)) = terms.iter().next() else {
        return Err(AppError::Validation(
            "Search DSL terms query requires a field".into(),
        ));
    };
    let expected_values = expected_values.as_array().ok_or_else(|| {
        AppError::Unsupported("Search DSL terms query only supports value arrays".into())
    })?;
    Ok(source_field_value(&hit.source, field)
        .is_some_and(|actual| expected_values.iter().any(|expected| expected == actual)))
}

fn text_matches_hit(hit: &SearchHitEnvelope, match_query: &Value) -> Result<bool, AppError> {
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
    Ok(source_field_value(&hit.source, field)
        .and_then(Value::as_str)
        .is_some_and(|value| value.contains(needle)))
}

fn range_matches_hit(hit: &SearchHitEnvelope, range: &Value) -> Result<bool, AppError> {
    let range = range
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL range query must be an object".into()))?;
    let Some((field, bounds)) = range.iter().next() else {
        return Err(AppError::Validation(
            "Search DSL range query requires a field".into(),
        ));
    };
    let Some(actual) = source_field_value(&hit.source, field) else {
        return Ok(false);
    };
    let bounds = bounds.as_object().ok_or_else(|| {
        AppError::Validation("Search DSL range query value must be an object".into())
    })?;

    for (operator, expected) in bounds {
        let Some(ordering) = compare_range_values(actual, expected) else {
            return Ok(false);
        };
        let matches = match operator.as_str() {
            "gt" => ordering == Ordering::Greater,
            "gte" => matches!(ordering, Ordering::Greater | Ordering::Equal),
            "lt" => ordering == Ordering::Less,
            "lte" => matches!(ordering, Ordering::Less | Ordering::Equal),
            _ => false,
        };
        if !matches {
            return Ok(false);
        }
    }
    Ok(true)
}

fn exists_matches_hit(hit: &SearchHitEnvelope, exists: &Value) -> Result<bool, AppError> {
    let exists = exists
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL exists query must be an object".into()))?;
    let field = exists
        .get("field")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("Search DSL exists query requires field".into()))?;
    Ok(source_field_value(&hit.source, field).is_some_and(|value| !value.is_null()))
}

fn bool_matches_hit(hit: &SearchHitEnvelope, bool_query: &Value) -> Result<bool, AppError> {
    let bool_query = bool_query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL bool query must be an object".into()))?;
    let has_required = bool_query.contains_key("must") || bool_query.contains_key("filter");

    if let Some(must) = bool_query.get("must") {
        if !query_collection_all(hit, must)? {
            return Ok(false);
        }
    }
    if let Some(filter) = bool_query.get("filter") {
        if !query_collection_all(hit, filter)? {
            return Ok(false);
        }
    }
    if let Some(must_not) = bool_query.get("must_not") {
        if query_collection_any(hit, must_not)? {
            return Ok(false);
        }
    }
    if let Some(should) = bool_query.get("should") {
        let matches = query_collection_match_count(hit, should)?;
        let minimum = bool_query
            .get("minimum_should_match")
            .and_then(Value::as_u64)
            .unwrap_or(if has_required { 0 } else { 1 });
        if matches < minimum {
            return Ok(false);
        }
    }
    Ok(true)
}

fn query_collection_all(hit: &SearchHitEnvelope, value: &Value) -> Result<bool, AppError> {
    if let Some(items) = value.as_array() {
        for item in items {
            if !query_matches_hit(hit, item)? {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    query_matches_hit(hit, value)
}

fn query_collection_any(hit: &SearchHitEnvelope, value: &Value) -> Result<bool, AppError> {
    Ok(query_collection_match_count(hit, value)? > 0)
}

fn query_collection_match_count(hit: &SearchHitEnvelope, value: &Value) -> Result<u64, AppError> {
    if let Some(items) = value.as_array() {
        let mut count = 0;
        for item in items {
            if query_matches_hit(hit, item)? {
                count += 1;
            }
        }
        return Ok(count);
    }
    Ok(u64::from(query_matches_hit(hit, value)?))
}

fn compare_range_values(actual: &Value, expected: &Value) -> Option<Ordering> {
    match (actual, expected) {
        (Value::Number(actual), Value::Number(expected)) => {
            actual.as_f64()?.partial_cmp(&expected.as_f64()?)
        }
        (Value::String(actual), Value::String(expected)) => Some(actual.cmp(expected)),
        _ => None,
    }
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
            "Search aggregation '{}' kind '{}' is not supported",
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
    let size = config
        .get("size")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let mut counts = std::collections::BTreeMap::<String, u64>::new();
    for hit in hits {
        let key = source_field_value(&hit.source, field)
            .and_then(Value::as_str)
            .unwrap_or("(missing)");
        *counts.entry(key.to_string()).or_default() += 1;
    }
    let mut buckets = counts
        .into_iter()
        .map(|(key, doc_count)| SearchTermsBucket { key, doc_count })
        .collect::<Vec<_>>();
    if let Some(size) = size {
        buckets.truncate(size);
    }
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
    fn fixture_search_terms_aggregation_honors_size() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "aggs": {
                    "by_status": {
                        "terms": { "field": "status.keyword", "size": 1 }
                    }
                }
            })),
        )
        .unwrap();

        match &result.aggregations[0] {
            SearchAggregationEnvelope::Terms { buckets, .. } => {
                assert_eq!(buckets.len(), 1);
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
    fn fixture_search_supports_terms_query_claimed_by_contract() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "terms": { "status.keyword": ["ok", "missing"] } }
            })),
        )
        .unwrap();

        assert_eq!(result.total.value, 1);
        assert_eq!(result.hits[0].id, "doc-1");
    }

    #[test]
    fn fixture_search_supports_bounded_bool_filter_range_and_exists() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": {
                    "bool": {
                        "filter": [
                            { "term": { "status.keyword": "ok" } },
                            { "range": { "@timestamp": { "gte": "2026-05-24T00:00:00Z", "lt": "2026-05-24T00:01:00Z" } } },
                            { "exists": { "field": "message" } }
                        ],
                        "must_not": { "match": { "message": "error" } }
                    }
                }
            })),
        )
        .unwrap();

        assert_eq!(result.total.value, 1);
        assert_eq!(result.hits[0].id, "doc-1");
    }

    #[test]
    fn fixture_search_rejects_unsupported_aggregations_before_raw_fallback() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "aggs": {
                    "latency_percentiles": {
                        "percentiles": { "field": "@timestamp" }
                    }
                }
            })),
        );

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("percentiles"))
        );
    }

    #[test]
    fn fixture_search_rejects_ignored_dsl_features_clearly() {
        for feature in ["fields", "highlight"] {
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
    fn fixture_search_rejects_admin_body_features_clearly() {
        let result = execute_fixture_search(
            &fixture(),
            &request(json!({
                "query": { "match_all": {} },
                "profile": true
            })),
        );

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("profile"))
        );
    }
}
