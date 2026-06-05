use crate::error::AppError;
use crate::models::{SearchDeleteByQueryRequest, SearchDestructiveOperationPlan};

use super::search_destructive::{
    build_delete_by_query_plan, delete_by_query_estimate_body, delete_by_query_target,
    validate_delete_by_query_request,
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
        let result = parse_search_response(&payload)?;
        Ok(build_delete_by_query_plan(
            request,
            Some(result.total.value),
        ))
    }
}
