use crate::error::AppError;
use crate::models::{
    SearchDeleteByQueryRequest, SearchDeleteByQueryResult, SearchDestructiveOperationPlan,
};

use super::search_destructive::{
    build_delete_by_query_plan, delete_by_query_estimate_body, delete_by_query_execute_body,
    delete_by_query_target, parse_delete_by_query_response, validate_delete_by_query_request,
};
use super::search_http::SearchHttpConnection;
use super::search_live_query::parse_search_response;

impl SearchHttpConnection {
    pub(crate) async fn plan_delete_by_query(
        &self,
        request: &SearchDeleteByQueryRequest,
    ) -> Result<SearchDestructiveOperationPlan, AppError> {
        validate_delete_by_query_request(request)?;
        let path = format!("/{}/_search", delete_by_query_target(request));
        let body = delete_by_query_estimate_body(request)?;
        let payload = self.post_json(&path, &body, None).await?;
        let result = parse_search_response(&payload, self.label())?;
        Ok(build_delete_by_query_plan(
            request,
            Some(result.total.value),
        ))
    }

    pub(crate) async fn execute_delete_by_query(
        &self,
        request: &SearchDeleteByQueryRequest,
    ) -> Result<SearchDeleteByQueryResult, AppError> {
        validate_delete_by_query_request(request)?;
        let target = delete_by_query_target(request);
        // `conflicts=proceed` keeps deleting past version conflicts instead of
        // aborting the whole run, reporting them via `version_conflicts` /
        // `failures[]` so a partial delete is surfaced honestly (#1076).
        // `refresh=true` makes the removals immediately visible to the catalog
        // read that follows in the UI. The target is a bare index/alias name
        // already validated against path/segment injection (parity with the
        // preview `_search` path above).
        let path = format!("/{target}/_delete_by_query?conflicts=proceed&refresh=true");
        let body = delete_by_query_execute_body(request)?;
        let payload = self.post_json(&path, &body, None).await?;
        Ok(parse_delete_by_query_response(&payload, target))
    }
}
