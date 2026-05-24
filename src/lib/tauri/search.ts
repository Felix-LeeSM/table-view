import { invoke } from "@tauri-apps/api/core";
import type { SearchQueryRequest, SearchResultEnvelope } from "@/types/search";

export async function executeSearchQuery(
  connectionId: string,
  request: SearchQueryRequest,
  queryId?: string,
): Promise<SearchResultEnvelope> {
  return invoke<SearchResultEnvelope>("execute_search_query", {
    connectionId,
    request,
    queryId,
  });
}
