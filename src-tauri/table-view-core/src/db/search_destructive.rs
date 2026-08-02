use serde_json::{json, Map, Value};

use crate::error::AppError;
use crate::models::{
    validate_search_destructive_request, SearchDeleteByQueryRequest, SearchDeleteByQueryResult,
    SearchDestructiveOperationPlan, SearchWriteFailure,
};

use super::search_dsl::validate_query_clause;

const RAW_PATH_TARGET_ERROR: &str =
    "delete-by-query only accepts index or alias targets, not raw/destructive paths";

pub(crate) fn validate_delete_by_query_request(
    request: &SearchDeleteByQueryRequest,
) -> Result<(), AppError> {
    validate_search_destructive_request(request)?;
    validate_delete_by_query_target(delete_by_query_target(request))?;
    let body = delete_by_query_body_object(request)?;
    for key in body.keys() {
        if key != "query" {
            return Err(AppError::Unsupported(format!(
                "delete-by-query body feature '{}' is not supported",
                key
            )));
        }
    }
    validate_query_clause(
        body.get("query")
            .ok_or_else(|| AppError::Validation("delete-by-query requires a query body".into()))?,
    )
}

pub(crate) fn delete_by_query_target(request: &SearchDeleteByQueryRequest) -> &str {
    request.index_pattern.trim()
}

pub(crate) fn delete_by_query_body_object(
    request: &SearchDeleteByQueryRequest,
) -> Result<&Map<String, Value>, AppError> {
    request
        .body
        .as_object()
        .ok_or_else(|| AppError::Validation("delete-by-query body must be a JSON object".into()))
}

pub(crate) fn delete_by_query_estimate_body(
    request: &SearchDeleteByQueryRequest,
) -> Result<Value, AppError> {
    let query = delete_by_query_body_object(request)?
        .get("query")
        .cloned()
        .ok_or_else(|| AppError::Validation("delete-by-query requires a query body".into()))?;
    Ok(json!({
        "query": query,
        "size": 0,
        "track_total_hits": true
    }))
}

pub(crate) fn build_delete_by_query_plan(
    request: &SearchDeleteByQueryRequest,
    estimated_document_count: Option<u64>,
) -> SearchDestructiveOperationPlan {
    let target = delete_by_query_target(request).to_string();
    // #1076 — execution is now live behind the Safe Mode confirm gate, so the
    // plan always requests confirmation and warns that the count is a
    // point-in-time estimate that may drift before the live delete runs.
    let mut warnings = vec![
        "Delete-by-query permanently removes every matched document and cannot be undone".into(),
        "The matched count is a point-in-time estimate from a live _search; the number actually \
         deleted may differ if documents change between preview and execution"
            .into(),
    ];
    if estimated_document_count.is_none() {
        warnings.push("Document estimate is unavailable for this target".into());
    }

    SearchDestructiveOperationPlan {
        operation: "deleteByQuery".into(),
        target,
        preview_only: request.preview_only,
        requires_confirmation: true,
        warnings,
        estimated_document_count,
    }
}

/// Body for the live `_delete_by_query` request — just the user's `query`
/// clause (already `validate_query_clause`-checked by
/// [`validate_delete_by_query_request`]). Unlike [`delete_by_query_estimate_body`]
/// this carries no `size` / `track_total_hits`; the delete endpoint owns those.
pub(crate) fn delete_by_query_execute_body(
    request: &SearchDeleteByQueryRequest,
) -> Result<Value, AppError> {
    let query = delete_by_query_body_object(request)?
        .get("query")
        .cloned()
        .ok_or_else(|| AppError::Validation("delete-by-query requires a query body".into()))?;
    Ok(json!({ "query": query }))
}

/// Parse an ES/OS `_delete_by_query` response into the typed result envelope.
/// `deleted < total` or a non-empty `failures[]` is a partial success — kept
/// as data (not an error) so the caller surfaces "deleted N, failed M" instead
/// of hiding that documents were already removed (#1076).
pub(crate) fn parse_delete_by_query_response(
    payload: &Value,
    target: &str,
) -> SearchDeleteByQueryResult {
    let u64_at = |key: &str| payload.get(key).and_then(value_as_u64).unwrap_or(0);
    let failures = payload
        .get("failures")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(parse_write_failure).collect())
        .unwrap_or_default();
    SearchDeleteByQueryResult {
        target: target.to_string(),
        took_ms: u64_at("took"),
        timed_out: payload
            .get("timed_out")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        total: u64_at("total"),
        deleted: u64_at("deleted"),
        version_conflicts: u64_at("version_conflicts"),
        batches: u64_at("batches"),
        failures,
    }
}

fn parse_write_failure(value: &Value) -> SearchWriteFailure {
    SearchWriteFailure {
        index: value
            .get("index")
            .and_then(Value::as_str)
            .map(str::to_string),
        id: value.get("id").and_then(Value::as_str).map(str::to_string),
        status: value.get("status").and_then(value_as_u64),
        cause: value.get("cause").cloned().unwrap_or(Value::Null),
    }
}

fn value_as_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

pub(crate) fn target_pattern_matches(pattern: &str, value: &str) -> bool {
    if pattern == "_all" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern == value;
    }
    wildcard_match(pattern.as_bytes(), value.as_bytes())
}

fn validate_delete_by_query_target(target: &str) -> Result<(), AppError> {
    let lower = target.to_ascii_lowercase();
    // Parity with validate_search_target: `.` / `..` normalize to a bare `/` path
    // on the cluster, so reject them here too (#1107 review).
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
    if target == "_all" || target.contains('*') {
        return Err(AppError::Validation(
            "delete-by-query wildcard targets are unsupported".into(),
        ));
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
    .iter()
    .any(|admin| target == *admin || target.starts_with(&format!("{admin}*")))
}

fn wildcard_match(pattern: &[u8], value: &[u8]) -> bool {
    let (mut p, mut v) = (0, 0);
    let mut star = None;
    let mut star_match = 0;
    while v < value.len() {
        if p < pattern.len() && pattern[p] == value[v] {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            p += 1;
            star_match = v;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            star_match += 1;
            v = star_match;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_partial_delete_by_query_response_with_failures() {
        // #1076 — a partial delete (some deleted, some conflicted) must stay
        // data, not an error: deleted + failure detail both survive so the UI
        // can tell the user documents were removed AND some failed.
        let payload = json!({
            "took": 42,
            "timed_out": false,
            "total": 5,
            "deleted": 3,
            "version_conflicts": 2,
            "batches": 1,
            "failures": [
                {
                    "index": "logs-elastic-2026.05.24",
                    "id": "doc-9",
                    "status": 409,
                    "cause": { "type": "version_conflict_engine_exception", "reason": "stale" }
                }
            ]
        });

        let result = parse_delete_by_query_response(&payload, "logs-elastic-2026.05.24");

        assert_eq!(result.target, "logs-elastic-2026.05.24");
        assert_eq!(result.total, 5);
        assert_eq!(result.deleted, 3);
        assert_eq!(result.version_conflicts, 2);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(result.failures[0].status, Some(409));
        assert_eq!(result.failures[0].id.as_deref(), Some("doc-9"));
    }

    #[test]
    fn delete_by_query_execute_body_carries_only_query() {
        let request = SearchDeleteByQueryRequest {
            index_pattern: "logs-elastic-2026.05.24".into(),
            body: json!({ "query": { "term": { "status.keyword": "ok" } } }),
            preview_only: false,
            safety: crate::models::SearchDestructiveSafety {
                acknowledged_risk: true,
                allow_wildcard: false,
                expected_target: None,
            },
        };
        let body = delete_by_query_execute_body(&request).unwrap();
        assert_eq!(
            body,
            json!({ "query": { "term": { "status.keyword": "ok" } } })
        );
    }

    #[test]
    fn delete_by_query_target_rejects_dot_segments() {
        // #1107 parity with validate_search_target: `.` / `..` normalize to a bare
        // cluster path and must be rejected before dispatch.
        for target in [".", ".."] {
            assert!(
                matches!(
                    validate_delete_by_query_target(target),
                    Err(AppError::Validation(_))
                ),
                "delete-by-query should reject {target}"
            );
        }
    }
}
