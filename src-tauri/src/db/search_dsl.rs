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
    if target.contains('/')
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
    ]
    .contains(&target)
}

fn validate_search_body(body: &Map<String, Value>) -> Result<(), AppError> {
    for (key, value) in body {
        match key.as_str() {
            "query" => validate_query_clause(value)?,
            "aggs" | "aggregations" => validate_aggregations(value)?,
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
