import { invoke } from "@tauri-apps/api/core";
import type {
  SearchCatalogSummary,
  SearchDeleteByQueryRequest,
  SearchDeleteByQueryResult,
  SearchDestructiveOperationPlan,
  SearchFieldStatsEnvelope,
  SearchIndexMapping,
  SearchIndexSettings,
  SearchIndexTemplateInfo,
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

export async function getSearchIndexMapping(
  connectionId: string,
  index: string,
): Promise<SearchIndexMapping> {
  return invoke<SearchIndexMapping>("get_search_index_mapping", {
    connectionId,
    index,
  });
}

export async function getSearchIndexSettings(
  connectionId: string,
  index: string,
): Promise<SearchIndexSettings> {
  return invoke<SearchIndexSettings>("get_search_index_settings", {
    connectionId,
    index,
  });
}

export async function listSearchIndexTemplates(
  connectionId: string,
): Promise<SearchIndexTemplateInfo[]> {
  return invoke<SearchIndexTemplateInfo[]>("list_search_index_templates", {
    connectionId,
  });
}

export async function sampleSearchDocuments(
  connectionId: string,
  index: string,
  limit = 5,
): Promise<SearchResultEnvelope> {
  return invoke<SearchResultEnvelope>("sample_search_documents", {
    connectionId,
    index,
    limit,
  });
}

export async function getSearchIndexFieldStats(
  connectionId: string,
  index: string,
): Promise<SearchFieldStatsEnvelope> {
  return invoke<SearchFieldStatsEnvelope>("get_search_index_field_stats", {
    connectionId,
    index,
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

export async function planSearchDeleteByQuery(
  connectionId: string,
  request: SearchDeleteByQueryRequest,
): Promise<SearchDestructiveOperationPlan> {
  return invoke<SearchDestructiveOperationPlan>("plan_search_delete_by_query", {
    connectionId,
    request,
  });
}

export async function executeSearchDeleteByQuery(
  connectionId: string,
  request: SearchDeleteByQueryRequest,
  // Set true only after the Safe Mode confirm dialog is satisfied. The backend
  // gate re-decides against its own store and rejects an unconfirmed delete in
  // a confirm-required context (#1076).
  safetyConfirmed: boolean,
): Promise<SearchDeleteByQueryResult> {
  return invoke<SearchDeleteByQueryResult>("execute_search_delete_by_query", {
    connectionId,
    request,
    safetyConfirmed,
  });
}
