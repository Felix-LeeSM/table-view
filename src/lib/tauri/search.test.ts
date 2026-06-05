import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchQueryRequest } from "@/types/search";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  executeSearchQuery,
  getSearchIndexFieldStats,
  getSearchIndexMapping,
  getSearchIndexSettings,
  listSearchCatalogSummary,
  listSearchIndexTemplates,
  planSearchDeleteByQuery,
  sampleSearchDocuments,
} from "./search";

describe("Search Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("forwards fixture-backed catalog summary requests", async () => {
    invokeMock.mockResolvedValueOnce({
      identity: {
        product: "elasticsearch",
        clusterName: "Elasticsearch fixture",
        version: { number: "8.12.2", distribution: "elasticsearch" },
        capabilities: {
          search: true,
          aggregations: true,
          aliases: true,
          mappings: true,
          legacyIndexTemplates: true,
          composableIndexTemplates: true,
          deleteByQuery: true,
        },
        productDelta: {
          product: "elasticsearch",
          supportsElasticLicenseApi: true,
          supportsOpensearchPluginsApi: false,
          defaultTemplateEndpoint: "composableIndexTemplate",
        },
      },
      indexes: [],
      aliases: [],
      dataStreams: [],
    });

    await listSearchCatalogSummary("search-1");

    expect(invokeMock).toHaveBeenLastCalledWith("list_search_catalog_summary", {
      connectionId: "search-1",
    });
  });

  it("forwards selected-index lazy detail requests", async () => {
    invokeMock.mockResolvedValue({});

    await getSearchIndexMapping("search-1", "logs-2026.05.24");
    expect(invokeMock).toHaveBeenLastCalledWith("get_search_index_mapping", {
      connectionId: "search-1",
      index: "logs-2026.05.24",
    });

    await getSearchIndexSettings("search-1", "logs-2026.05.24");
    expect(invokeMock).toHaveBeenLastCalledWith("get_search_index_settings", {
      connectionId: "search-1",
      index: "logs-2026.05.24",
    });

    await listSearchIndexTemplates("search-1");
    expect(invokeMock).toHaveBeenLastCalledWith("list_search_index_templates", {
      connectionId: "search-1",
    });

    await sampleSearchDocuments("search-1", "logs-2026.05.24", 3);
    expect(invokeMock).toHaveBeenLastCalledWith("sample_search_documents", {
      connectionId: "search-1",
      index: "logs-2026.05.24",
      limit: 3,
    });

    await getSearchIndexFieldStats("search-1", "logs-2026.05.24");
    expect(invokeMock).toHaveBeenLastCalledWith(
      "get_search_index_field_stats",
      {
        connectionId: "search-1",
        index: "logs-2026.05.24",
      },
    );
  });

  it("forwards bounded Search DSL execution requests", async () => {
    const request: SearchQueryRequest = {
      index: "logs-2026.05.24",
      body: {
        query: { match_all: {} },
        aggs: {
          by_status: { terms: { field: "status.keyword" } },
        },
      },
      size: 25,
      trackTotalHits: true,
    };
    invokeMock.mockResolvedValueOnce({
      tookMs: 3,
      timedOut: false,
      total: { value: 1, relation: "eq" },
      hits: [],
      aggregations: [],
    });

    await executeSearchQuery("search-1", request, "q-search");

    expect(invokeMock).toHaveBeenLastCalledWith("execute_search_query", {
      connectionId: "search-1",
      request,
      queryId: "q-search",
    });
  });

  it("forwards delete-by-query safety plan requests", async () => {
    const request = {
      indexPattern: "logs-2026.05.24",
      body: { query: { term: { "status.keyword": "error" } } },
      previewOnly: true,
      safety: {
        acknowledgedRisk: false,
        allowWildcard: false,
      },
    };
    invokeMock.mockResolvedValueOnce({
      operation: "deleteByQuery",
      target: "logs-2026.05.24",
      previewOnly: true,
      requiresConfirmation: true,
      warnings: [],
      estimatedDocumentCount: 7,
    });

    await planSearchDeleteByQuery("search-1", request);

    expect(invokeMock).toHaveBeenLastCalledWith("plan_search_delete_by_query", {
      connectionId: "search-1",
      request,
    });
  });
});
