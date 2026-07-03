use serde_json::{json, Map, Value};

use crate::error::AppError;
use crate::models::{
    validate_search_destructive_request, SearchDeleteByQueryRequest, SearchDestructiveOperationPlan,
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
    let mut warnings =
        vec!["Delete-by-query is destructive; execution is unsupported in this milestone".into()];
    if target == "_all" || target.contains('*') {
        warnings
            .push("Target uses a wildcard; confirm the expanded target before execution".into());
    }
    if estimated_document_count.is_none() {
        warnings.push("Document estimate is unavailable for this target".into());
    }

    SearchDestructiveOperationPlan {
        operation: "deleteByQuery".into(),
        target,
        preview_only: request.preview_only,
        requires_confirmation: false,
        warnings,
        estimated_document_count,
    }
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
            "delete-by-query wildcard targets are unsupported for preview-only planning".into(),
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
