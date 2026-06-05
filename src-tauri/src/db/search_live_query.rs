use serde_json::{json, Map, Value};

use crate::db::search_dsl::{search_body_object, validate_search_dsl_request};
use crate::error::AppError;
use crate::models::{
    SearchAggregationEnvelope, SearchHitEnvelope, SearchQueryRequest, SearchResultEnvelope,
    SearchShardFailure, SearchShardSummary, SearchTermsBucket, SearchTotalHits,
    SearchTotalHitsRelation,
};

pub(crate) fn validate_live_search_request(request: &SearchQueryRequest) -> Result<(), AppError> {
    validate_search_dsl_request(request)
}

pub(crate) fn live_search_body(
    request: &SearchQueryRequest,
) -> Result<Map<String, Value>, AppError> {
    let mut body = search_body_object(request)?.clone();
    if let Some(from) = request.from {
        body.insert("from".into(), json!(from));
    }
    if let Some(size) = request.size {
        body.insert("size".into(), json!(size));
    }
    if let Some(track_total_hits) = request.track_total_hits {
        body.insert("track_total_hits".into(), json!(track_total_hits));
    }
    Ok(body)
}

pub(crate) fn parse_search_response(payload: &Value) -> Result<SearchResultEnvelope, AppError> {
    let hits_root = payload
        .get("hits")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            AppError::Connection("Elasticsearch search response missing hits object".into())
        })?;
    let hits = hits_root
        .get("hits")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Connection("Elasticsearch search response missing hits.hits array".into())
        })?
        .iter()
        .map(parse_search_hit)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SearchResultEnvelope {
        took_ms: payload.get("took").and_then(value_to_u64).unwrap_or(0),
        timed_out: payload
            .get("timed_out")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        total: parse_total_hits(hits_root.get("total")),
        hits,
        aggregations: parse_search_aggregations(payload.get("aggregations"))?,
        shards: parse_shards(payload.get("_shards"))?,
        explain: payload.get("explain").cloned(),
        profile: payload.get("profile").cloned(),
    })
}

pub(crate) fn search_error_detail(body: String) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "empty response body".into();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return trimmed.chars().take(500).collect();
    };
    let reason = value
        .pointer("/error/reason")
        .or_else(|| value.pointer("/error/root_cause/0/reason"))
        .and_then(Value::as_str);
    let error_type = value
        .pointer("/error/type")
        .or_else(|| value.pointer("/error/root_cause/0/type"))
        .and_then(Value::as_str);
    match (error_type, reason) {
        (Some(error_type), Some(reason)) => format!("{error_type}: {reason}"),
        (Some(error_type), None) => error_type.to_string(),
        (None, Some(reason)) => reason.to_string(),
        (None, None) => trimmed.chars().take(500).collect(),
    }
}

fn parse_total_hits(value: Option<&Value>) -> SearchTotalHits {
    match value {
        Some(Value::Object(total)) => SearchTotalHits {
            value: optional_u64_fields(total, &["value"]).unwrap_or(0),
            relation: total
                .get("relation")
                .and_then(Value::as_str)
                .map(parse_total_hits_relation)
                .unwrap_or(SearchTotalHitsRelation::Eq),
        },
        Some(value) => SearchTotalHits {
            value: value_to_u64(value).unwrap_or(0),
            relation: SearchTotalHitsRelation::Eq,
        },
        None => SearchTotalHits {
            value: 0,
            relation: SearchTotalHitsRelation::Eq,
        },
    }
}

fn parse_total_hits_relation(value: &str) -> SearchTotalHitsRelation {
    if value.eq_ignore_ascii_case("gte") {
        SearchTotalHitsRelation::Gte
    } else {
        SearchTotalHitsRelation::Eq
    }
}

fn parse_search_hit(hit: &Value) -> Result<SearchHitEnvelope, AppError> {
    let object = hit.as_object().ok_or_else(|| {
        AppError::Connection("Elasticsearch search hit row is not an object".into())
    })?;
    Ok(SearchHitEnvelope {
        index: string_field(object, "_index").unwrap_or_default(),
        id: string_field(object, "_id").unwrap_or_default(),
        score: object.get("_score").and_then(Value::as_f64),
        source: object.get("_source").cloned().unwrap_or(Value::Null),
        fields: object.get("fields").cloned(),
        highlight: object.get("highlight").cloned(),
        explanation: object.get("_explanation").cloned(),
        sort: object
            .get("sort")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

fn parse_search_aggregations(
    value: Option<&Value>,
) -> Result<Vec<SearchAggregationEnvelope>, AppError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let object = value.as_object().ok_or_else(|| {
        AppError::Connection("Elasticsearch aggregations response is not an object".into())
    })?;
    object
        .iter()
        .map(|(name, aggregation)| parse_search_aggregation(name, aggregation))
        .collect()
}

fn parse_search_aggregation(
    name: &str,
    aggregation: &Value,
) -> Result<SearchAggregationEnvelope, AppError> {
    let Some(object) = aggregation.as_object() else {
        return Ok(raw_aggregation(name, None, aggregation));
    };
    if let Some(buckets) = object.get("buckets").and_then(Value::as_array) {
        let parsed = buckets
            .iter()
            .map(parse_terms_bucket)
            .collect::<Option<Vec<_>>>();
        if let Some(buckets) = parsed {
            return Ok(SearchAggregationEnvelope::Terms {
                name: name.into(),
                buckets,
            });
        }
    }
    if let Some(value) = object.get("value").and_then(value_to_u64) {
        return Ok(SearchAggregationEnvelope::ValueCount {
            name: name.into(),
            value,
        });
    }
    Ok(raw_aggregation(name, Some("raw"), aggregation))
}

fn parse_terms_bucket(bucket: &Value) -> Option<SearchTermsBucket> {
    let object = bucket.as_object()?;
    Some(SearchTermsBucket {
        key: object.get("key").and_then(value_to_string)?,
        doc_count: object.get("doc_count").and_then(value_to_u64)?,
    })
}

fn raw_aggregation(
    name: &str,
    aggregation_type: Option<&str>,
    raw: &Value,
) -> SearchAggregationEnvelope {
    SearchAggregationEnvelope::Raw {
        name: name.into(),
        aggregation_type: aggregation_type.map(str::to_string),
        raw: raw.clone(),
    }
}

fn parse_shards(value: Option<&Value>) -> Result<Option<SearchShardSummary>, AppError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value.as_object().ok_or_else(|| {
        AppError::Connection("Elasticsearch shard summary is not an object".into())
    })?;
    Ok(Some(SearchShardSummary {
        total: optional_u64_fields(object, &["total"]).unwrap_or(0),
        successful: optional_u64_fields(object, &["successful"]).unwrap_or(0),
        skipped: optional_u64_fields(object, &["skipped"]).unwrap_or(0),
        failed: optional_u64_fields(object, &["failed"]).unwrap_or(0),
        failures: object
            .get("failures")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(parse_shard_failure).collect())
            .transpose()?
            .unwrap_or_default(),
    }))
}

fn parse_shard_failure(value: &Value) -> Result<SearchShardFailure, AppError> {
    let object = value.as_object().ok_or_else(|| {
        AppError::Connection("Elasticsearch shard failure is not an object".into())
    })?;
    Ok(SearchShardFailure {
        shard: optional_u64_fields(object, &["shard"]),
        index: string_field(object, "index"),
        node: string_field(object, "node"),
        reason: object.get("reason").cloned().unwrap_or(Value::Null),
    })
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(value_to_string)
}

fn optional_u64_fields(object: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(value_to_u64))
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
        .or_else(|| value.as_bool().map(|bool_value| bool_value.to_string()))
}

fn value_to_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}
