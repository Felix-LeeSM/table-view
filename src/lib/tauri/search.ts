import { invoke } from "@tauri-apps/api/core";
import type {
  SearchCatalogSummary,
  SearchQueryRequest,
  SearchResultEnvelope,
} from "@/types/search";

export async function listSearchCatalogSummary(
  connectionId: string,
): Promise<SearchCatalogSummary> {
  return invoke<SearchCatalogSummary>("list_search_catalog_summary", {
    connectionId,
  });
}

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
