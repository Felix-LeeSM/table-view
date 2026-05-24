use serde_json::{json, Value};

use crate::db::search::SearchCatalogFixture;
use crate::error::AppError;
use crate::models::{
    SearchAggregationEnvelope, SearchHitEnvelope, SearchQueryRequest, SearchResultEnvelope,
    SearchTotalHits, SearchTotalHitsRelation,
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

    let mut hits = filter_fixture_hits(&fixture.search_result.hits, body.get("query"))?;
    let total = hits.len() as u64;

    let from = request
        .from
        .or_else(|| body.get("from").and_then(Value::as_u64))
        .unwrap_or(0) as usize;
    let size = request
        .size
        .or_else(|| body.get("size").and_then(Value::as_u64))
        .unwrap_or(hits.len() as u64) as usize;
    hits = hits.into_iter().skip(from).take(size).collect();

    let mut result = fixture.search_result.clone();
    result.total = SearchTotalHits {
        value: total,
        relation: SearchTotalHitsRelation::Eq,
    };
    result.hits = hits;
    result.aggregations = aggregation_envelopes(body, &result.hits)?;
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
            "query"
                | "aggs"
                | "aggregations"
                | "from"
                | "size"
                | "sort"
                | "track_total_hits"
                | "_source"
                | "fields"
                | "highlight"
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
        .map(|(key, doc_count)| json!({ "key": key, "doc_count": doc_count }))
        .collect::<Vec<_>>();
    Ok(SearchAggregationEnvelope {
        name: name.into(),
        kind: "terms".into(),
        value: json!({ "buckets": buckets }),
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
    Ok(SearchAggregationEnvelope {
        name: name.into(),
        kind: "value_count".into(),
        value: json!({ "value": value }),
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
