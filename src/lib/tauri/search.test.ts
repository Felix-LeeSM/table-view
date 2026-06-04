import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchQueryRequest } from "@/types/search";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { executeSearchQuery, listSearchCatalogSummary } from "./search";

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
});
