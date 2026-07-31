use serde_json::{Map, Value};

use crate::error::AppError;
use crate::models::SearchQueryRequest;

const RAW_PATH_TARGET_ERROR: &str =
    "Search DSL execution only accepts index or alias targets, not raw/destructive paths";

pub(crate) fn validate_search_dsl_request(request: &SearchQueryRequest) -> Result<(), AppError> {
    validate_search_target(&request.index)?;
    validate_search_body(search_body_object(request)?)
}

pub(crate) fn search_body_object(
    request: &SearchQueryRequest,
) -> Result<&Map<String, Value>, AppError> {
    request
        .body
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL body must be a JSON object".into()))
}

pub(crate) fn validate_search_target(raw_target: &str) -> Result<(), AppError> {
    let target = raw_target.trim();
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

    let lower = target.to_ascii_lowercase();
    // `.` / `..` are RFC 3986 unreserved dot-segments: they survive percent-encoding
    // and reqwest's Url::parse normalizes `/../_mapping` -> `/_mapping`, reaching the
    // whole cluster. Reject them like any other raw path (#1107).
    if matches!(target, "." | "..")
        || target.contains('/')
        || target.contains('\\')
        || target.contains('?')
        || target.contains('#')
        || target.contains(',')
        || target
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("_delete_by_query")
        || lower.contains("_update_by_query")
        || lower.contains("_bulk")
        || lower.contains("_reindex")
        || lower.contains("_scripts")
        || matches_admin_target(&lower)
    {
        return Err(AppError::Validation(RAW_PATH_TARGET_ERROR.into()));
    }
    Ok(())
}

fn matches_admin_target(target: &str) -> bool {
    [
        "_cat",
        "_cluster",
        "_tasks",
        "_snapshot",
        "_security",
        "_ilm",
        "_aliases",
        "_template",
        "_index_template",
        "_nodes",
        "_plugins",
    ]
    .contains(&target)
}

fn validate_search_body(body: &Map<String, Value>) -> Result<(), AppError> {
    for (key, value) in body {
        match key.as_str() {
            "query" => validate_query_clause(value)?,
            "aggs" | "aggregations" => validate_aggregations(value)?,
            "sort" => validate_sort_clause(value)?,
            "_source" => validate_source_filter(value)?,
            "from" | "size" => validate_u64_field(key, value)?,
            "track_total_hits" => validate_track_total_hits(value)?,
            other => {
                return Err(AppError::Unsupported(format!(
                    "Search DSL feature '{}' is not supported by the bounded Search DSL parser",
                    other
                )));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_query_clause(query: &Value) -> Result<(), AppError> {
    let query = query
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL query must be a JSON object".into()))?;
    let Some((clause, value)) = single_entry(query) else {
        return Err(AppError::Validation(
            "Search DSL query requires exactly one supported clause".into(),
        ));
    };

    match clause.as_str() {
        "match_all" => validate_object_clause("match_all", value),
        "term" => validate_single_field_object("term", value, validate_term_value),
        "terms" => validate_single_field_object("terms", value, validate_terms_value),
        "match" => validate_single_field_object("match", value, validate_match_value),
        "range" => validate_single_field_object("range", value, validate_range_value),
        "exists" => validate_exists_clause(value),
        "bool" => validate_bool_clause(value),
        other => Err(AppError::Unsupported(format!(
            "Search DSL query clause '{}' is not supported",
            other
        ))),
    }
}

fn validate_aggregations(aggs: &Value) -> Result<(), AppError> {
    let aggs = aggs.as_object().ok_or_else(|| {
        AppError::Validation("Search DSL aggregations must be a JSON object".into())
    })?;
    for (name, spec) in aggs {
        validate_aggregation(name, spec)?;
    }
    Ok(())
}

fn validate_aggregation(name: &str, spec: &Value) -> Result<(), AppError> {
    let spec = spec.as_object().ok_or_else(|| {
        AppError::Validation(format!("Search aggregation '{}' must be an object", name))
    })?;
    let Some((kind, config)) = single_entry(spec) else {
        return Err(AppError::Validation(format!(
            "Search aggregation '{}' requires exactly one supported kind",
            name
        )));
    };
    match kind.as_str() {
        "terms" => validate_terms_aggregation(config),
        "value_count" => validate_value_count_aggregation(config),
        other => Err(AppError::Unsupported(format!(
            "Search aggregation '{}' kind '{}' is not supported",
            name, other
        ))),
    }
}

fn validate_terms_aggregation(config: &Value) -> Result<(), AppError> {
    let config = config
        .as_object()
        .ok_or_else(|| AppError::Validation("Search terms aggregation must be an object".into()))?;
    validate_string_field(config, "terms")?;
    for (key, value) in config {
        match key.as_str() {
            "field" => {}
            "size" => validate_u64_field("terms.size", value)?,
            other => {
                return Err(AppError::Unsupported(format!(
                    "Search terms aggregation option '{}' is not supported",
                    other
                )));
            }
        }
    }
    Ok(())
}

fn validate_value_count_aggregation(config: &Value) -> Result<(), AppError> {
    let config = config.as_object().ok_or_else(|| {
        AppError::Validation("Search value_count aggregation must be an object".into())
    })?;
    validate_string_field(config, "value_count")?;
    for key in config.keys() {
        if key != "field" {
            return Err(AppError::Unsupported(format!(
                "Search value_count aggregation option '{}' is not supported",
                key
            )));
        }
    }
    Ok(())
}

fn validate_object_clause(name: &str, value: &Value) -> Result<(), AppError> {
    value.as_object().ok_or_else(|| {
        AppError::Validation(format!("Search DSL {} query must be an object", name))
    })?;
    Ok(())
}

fn validate_single_field_object(
    name: &str,
    value: &Value,
    validate_value: fn(&Value) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let value = value.as_object().ok_or_else(|| {
        AppError::Validation(format!("Search DSL {} query must be an object", name))
    })?;
    let Some((_field, inner)) = single_entry(value) else {
        return Err(AppError::Validation(format!(
            "Search DSL {} query requires exactly one field",
            name
        )));
    };
    validate_value(inner)
}

fn validate_term_value(value: &Value) -> Result<(), AppError> {
    let value = match value.as_object() {
        Some(object) => {
            if object.len() != 1 {
                return Err(AppError::Unsupported(
                    "Search DSL term query only supports the value option".into(),
                ));
            }
            object.get("value").ok_or_else(|| {
                AppError::Unsupported("Search DSL term query only supports scalar values".into())
            })?
        }
        None => value,
    };
    if is_scalar(value) {
        return Ok(());
    }
    Err(AppError::Unsupported(
        "Search DSL term query only supports scalar values".into(),
    ))
}

fn validate_terms_value(value: &Value) -> Result<(), AppError> {
    let values = value.as_array().ok_or_else(|| {
        AppError::Unsupported("Search DSL terms query only supports value arrays".into())
    })?;
    if values.is_empty() || values.iter().any(|value| !is_scalar(value)) {
        return Err(AppError::Validation(
            "Search DSL terms query requires scalar values".into(),
        ));
    }
    Ok(())
}

fn validate_match_value(value: &Value) -> Result<(), AppError> {
    if value.as_str().is_some() {
        return Ok(());
    }
    if let Some(object) = value.as_object() {
        if object.len() != 1 {
            return Err(AppError::Unsupported(
                "Search DSL match query only supports the query option".into(),
            ));
        }
        if object.get("query").and_then(Value::as_str).is_some() {
            return Ok(());
        }
    }
    Err(AppError::Unsupported(
        "Search DSL match query only supports string values".into(),
    ))
}

fn validate_range_value(value: &Value) -> Result<(), AppError> {
    let range = value.as_object().ok_or_else(|| {
        AppError::Validation("Search DSL range query value must be an object".into())
    })?;
    if range.is_empty() {
        return Err(AppError::Validation(
            "Search DSL range query requires at least one bound".into(),
        ));
    }
    for (operator, bound) in range {
        if !matches!(operator.as_str(), "gt" | "gte" | "lt" | "lte") {
            return Err(AppError::Unsupported(format!(
                "Search DSL range operator '{}' is not supported",
                operator
            )));
        }
        if !is_scalar(bound) {
            return Err(AppError::Validation(
                "Search DSL range bounds must be scalar values".into(),
            ));
        }
    }
    Ok(())
}

fn validate_exists_clause(value: &Value) -> Result<(), AppError> {
    let value = value
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL exists query must be an object".into()))?;
    let field = value
        .get("field")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("Search DSL exists query requires field".into()))?;
    if field.trim().is_empty() {
        return Err(AppError::Validation(
            "Search DSL exists query requires a non-empty field".into(),
        ));
    }
    for key in value.keys() {
        if key != "field" {
            return Err(AppError::Unsupported(format!(
                "Search DSL exists query option '{}' is not supported",
                key
            )));
        }
    }
    Ok(())
}

fn validate_bool_clause(value: &Value) -> Result<(), AppError> {
    let value = value
        .as_object()
        .ok_or_else(|| AppError::Validation("Search DSL bool query must be an object".into()))?;
    for (key, clause) in value {
        match key.as_str() {
            "must" | "filter" | "should" | "must_not" => validate_query_list(key, clause)?,
            "minimum_should_match" => validate_minimum_should_match(clause)?,
            other => {
                return Err(AppError::Unsupported(format!(
                    "Search DSL bool option '{}' is not supported",
                    other
                )));
            }
        }
    }
    Ok(())
}

fn validate_sort_clause(value: &Value) -> Result<(), AppError> {
    let items = value
        .as_array()
        .ok_or_else(|| AppError::Validation("Search DSL sort must be an array".into()))?;
    if items.is_empty() {
        return Err(AppError::Validation(
            "Search DSL sort requires at least one field".into(),
        ));
    }
    for item in items {
        validate_sort_item(item)?;
    }
    Ok(())
}

fn validate_sort_item(value: &Value) -> Result<(), AppError> {
    if let Some(field) = value.as_str() {
        return validate_sort_field(field);
    }
    let object = value.as_object().ok_or_else(|| {
        AppError::Validation("Search DSL sort entries must be field strings or objects".into())
    })?;
    let Some((field, spec)) = single_entry(object) else {
        return Err(AppError::Validation(
            "Search DSL sort objects require exactly one field".into(),
        ));
    };
    validate_sort_field(field)?;
    if let Some(direction) = spec.as_str() {
        return validate_sort_direction(direction);
    }
    validate_sort_options(spec)
}

fn validate_sort_options(value: &Value) -> Result<(), AppError> {
    let object = value.as_object().ok_or_else(|| {
        AppError::Validation("Search DSL sort object values must be strings or objects".into())
    })?;
    if object.is_empty() {
        return Err(AppError::Validation(
            "Search DSL sort object requires at least one supported option".into(),
        ));
    }
    for (key, value) in object {
        match key.as_str() {
            "order" => {
                let direction = value.as_str().ok_or_else(|| {
                    AppError::Validation("Search DSL sort order must be asc or desc".into())
                })?;
                validate_sort_direction(direction)?;
            }
            "missing" => {
                let Some(missing) = value.as_str() else {
                    return Err(AppError::Validation(
                        "Search DSL sort missing must be _first or _last".into(),
                    ));
                };
                if !matches!(missing, "_first" | "_last") {
                    return Err(AppError::Unsupported(format!(
                        "Search DSL sort missing value '{}' is not supported",
                        missing
                    )));
                }
            }
            "unmapped_type" => validate_non_empty_string(value, "Search DSL sort unmapped_type")?,
            other => {
                return Err(AppError::Unsupported(format!(
                    "Search DSL sort option '{}' is not supported",
                    other
                )));
            }
        }
    }
    Ok(())
}

fn validate_sort_field(field: &str) -> Result<(), AppError> {
    validate_non_empty_text(field, "Search DSL sort field")?;
    if field == "_score" {
        return Ok(());
    }
    if field.starts_with('_') || field.contains('/') || field.contains('\\') {
        return Err(AppError::Unsupported(format!(
            "Search DSL sort field '{}' is not supported",
            field
        )));
    }
    Ok(())
}

fn validate_sort_direction(value: &str) -> Result<(), AppError> {
    if matches!(value, "asc" | "desc") {
        return Ok(());
    }
    Err(AppError::Unsupported(format!(
        "Search DSL sort direction '{}' is not supported",
        value
    )))
}

fn validate_source_filter(value: &Value) -> Result<(), AppError> {
    if value.as_bool().is_some() {
        return Ok(());
    }
    if let Some(field) = value.as_str() {
        return validate_non_empty_text(field, "Search DSL _source field");
    }
    if value.as_array().is_some() {
        return validate_string_list(value, "Search DSL _source");
    }
    let object = value.as_object().ok_or_else(|| {
        AppError::Validation(
            "Search DSL _source must be a boolean, field string, field array, or object".into(),
        )
    })?;
    if object.is_empty() {
        return Err(AppError::Validation(
            "Search DSL _source object requires includes or excludes".into(),
        ));
    }
    for (key, value) in object {
        match key.as_str() {
            "includes" | "excludes" => validate_string_or_list(value, "Search DSL _source")?,
            other => {
                return Err(AppError::Unsupported(format!(
                    "Search DSL _source option '{}' is not supported",
                    other
                )));
            }
        }
    }
    Ok(())
}

fn validate_query_list(name: &str, value: &Value) -> Result<(), AppError> {
    if let Some(items) = value.as_array() {
        for item in items {
            validate_query_clause(item)?;
        }
        return Ok(());
    }
    if value.is_object() {
        return validate_query_clause(value);
    }
    Err(AppError::Validation(format!(
        "Search DSL bool {} requires a query object or array",
        name
    )))
}

fn validate_minimum_should_match(value: &Value) -> Result<(), AppError> {
    if value.as_u64().is_some() {
        return Ok(());
    }
    Err(AppError::Validation(
        "Search DSL minimum_should_match must be an unsigned integer".into(),
    ))
}

fn validate_u64_field(name: &str, value: &Value) -> Result<(), AppError> {
    if value.as_u64().is_some() {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "Search DSL {} must be an unsigned integer",
        name
    )))
}

fn validate_track_total_hits(value: &Value) -> Result<(), AppError> {
    if value.as_bool().is_some() || value.as_u64().is_some() {
        return Ok(());
    }
    Err(AppError::Validation(
        "Search DSL track_total_hits must be a boolean or unsigned integer".into(),
    ))
}

fn validate_string_field(config: &Map<String, Value>, kind: &str) -> Result<(), AppError> {
    let field = config.get("field").and_then(Value::as_str).ok_or_else(|| {
        AppError::Validation(format!(
            "Search {} aggregation requires a string field",
            kind
        ))
    })?;
    if field.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "Search {} aggregation requires a non-empty field",
            kind
        )));
    }
    Ok(())
}

fn validate_string_or_list(value: &Value, label: &str) -> Result<(), AppError> {
    if let Some(field) = value.as_str() {
        return validate_non_empty_text(field, label);
    }
    validate_string_list(value, label)
}

fn validate_string_list(value: &Value, label: &str) -> Result<(), AppError> {
    let values = value
        .as_array()
        .ok_or_else(|| AppError::Validation(format!("{label} must be a string or string array")))?;
    if values.is_empty() {
        return Err(AppError::Validation(format!(
            "{label} requires at least one field"
        )));
    }
    for value in values {
        validate_non_empty_string(value, label)?;
    }
    Ok(())
}

fn validate_non_empty_string(value: &Value, label: &str) -> Result<(), AppError> {
    let field = value
        .as_str()
        .ok_or_else(|| AppError::Validation(format!("{label} must be a string")))?;
    validate_non_empty_text(field, label)
}

fn validate_non_empty_text(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "{label} requires a non-empty field"
        )));
    }
    if value
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::Validation(format!(
            "{label} cannot contain whitespace or control characters"
        )));
    }
    Ok(())
}

fn single_entry(map: &Map<String, Value>) -> Option<(&String, &Value)> {
    if map.len() == 1 {
        map.iter().next()
    } else {
        None
    }
}

fn is_scalar(value: &Value) -> bool {
    matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn request(body: Value) -> SearchQueryRequest {
        SearchQueryRequest {
            index: "logs-opensearch-2026.05.24".into(),
            body,
            from: None,
            size: None,
            track_total_hits: None,
        }
    }

    #[test]
    fn opensearch_compatible_bounded_search_body_accepts_shared_query_aggs_sort_and_source() {
        // Reason: #504 locks the OpenSearch-compatible shared Search DSL subset before live dispatch (2026-06-05).
        validate_search_dsl_request(&request(json!({
            "query": {
                "bool": {
                    "filter": [
                        { "term": { "status.keyword": "ok" } },
                        { "range": { "@timestamp": { "gte": "2026-05-24T00:00:00Z" } } },
                        { "exists": { "field": "message" } }
                    ],
                    "must": { "match": { "message": { "query": "live" } } },
                    "should": [{ "terms": { "service.keyword": ["api", "worker"] } }],
                    "minimum_should_match": 0
                }
            },
            "aggs": {
                "by_status": { "terms": { "field": "status.keyword", "size": 10 } },
                "message_count": { "value_count": { "field": "message" } }
            },
            "sort": [
                { "@timestamp": { "order": "desc", "missing": "_last", "unmapped_type": "date" } },
                "_score"
            ],
            "_source": { "includes": ["message", "status"], "excludes": "secret" },
            "from": 0,
            "size": 25,
            "track_total_hits": true
        })))
        .unwrap();
    }

    #[test]
    fn opensearch_safety_policy_blocks_raw_admin_or_destructive_targets() {
        // Reason: #504 keeps live OpenSearch search execution on index/alias targets, not admin paths (2026-06-05).
        for target in [
            "_cat",
            "_plugins",
            ".",
            "..",
            "logs-opensearch-2026.05.24/_bulk",
            "logs-opensearch-2026.05.24/_delete_by_query",
            "logs-opensearch-2026.05.24?pretty=true",
            "logs-opensearch-2026.05.24%2f_search",
        ] {
            let mut request = request(json!({ "query": { "match_all": {} } }));
            request.index = target.into();
            assert!(
                matches!(
                    validate_search_dsl_request(&request),
                    Err(AppError::Validation(message))
                        if message.contains("raw/destructive paths")
                            || message.contains("wildcard")
                ),
                "target should be rejected: {target}"
            );
        }
    }

    #[test]
    fn unsupported_search_body_features_reject_before_http_dispatch() {
        // Reason: #504 documents that admin/profile/plugin DSL extensions stay outside the bounded parser (2026-06-05).
        for key in ["profile", "suggest", "knn", "script_fields", "pit"] {
            let mut body = json!({ "query": { "match_all": {} } });
            body.as_object_mut()
                .unwrap()
                .insert(key.into(), json!(true));
            assert!(
                matches!(
                    validate_search_dsl_request(&request(body)),
                    Err(AppError::Unsupported(message)) if message.contains(key)
                ),
                "body key should be rejected: {key}"
            );
        }
    }

    #[test]
    fn bounded_sort_and_source_filters_reject_unsafe_shapes() {
        // Reason: #504 adds safe sort/_source validation without opening script sort or broad source options (2026-06-05).
        for body in [
            json!({ "query": { "match_all": {} }, "sort": [{ "_script": { "order": "desc" } }] }),
            json!({ "query": { "match_all": {} }, "sort": [{ "status.keyword": { "mode": "avg" } }] }),
            json!({ "query": { "match_all": {} }, "_source": { "include": ["message"] } }),
            json!({ "query": { "match_all": {} }, "_source": ["message", 42] }),
        ] {
            assert!(
                validate_search_dsl_request(&request(body)).is_err(),
                "unsafe body shape should be rejected"
            );
        }
    }
}
