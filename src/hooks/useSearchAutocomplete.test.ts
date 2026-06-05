import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchCatalogSummary, SearchIndexMapping } from "@/types/search";
import { useSearchAutocomplete } from "./useSearchAutocomplete";

const listSearchCatalogSummaryMock = vi.hoisted(() => vi.fn());
const getSearchIndexMappingMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri/search", () => ({
  listSearchCatalogSummary: (...args: unknown[]) =>
    listSearchCatalogSummaryMock(...args),
  getSearchIndexMapping: (...args: unknown[]) =>
    getSearchIndexMappingMock(...args),
}));

const opensearchCatalog = {
  identity: {
    product: "opensearch",
    clusterName: "open-dev",
    version: { number: "2.13.0", distribution: "opensearch" },
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
      product: "opensearch",
      supportsElasticLicenseApi: false,
      supportsOpensearchPluginsApi: true,
      defaultTemplateEndpoint: "composableIndexTemplate",
    },
  },
  indexes: [
    {
      name: "logs-opensearch-2026.05.24",
      health: "green",
      open: true,
      aliases: ["logs-opensearch"],
    },
  ],
  aliases: [
    {
      name: "logs-opensearch",
      index: "logs-opensearch-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [],
} as const satisfies SearchCatalogSummary;

const opensearchMapping = {
  index: "logs-opensearch-2026.05.24",
  fields: [
    {
      path: "trace.id",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
    },
  ],
  raw: {},
} as const satisfies SearchIndexMapping;

describe("useSearchAutocomplete", () => {
  beforeEach(() => {
    listSearchCatalogSummaryMock.mockReset();
    getSearchIndexMappingMock.mockReset();
  });

  it("hydrates OpenSearch catalog and mapping context for completion", async () => {
    listSearchCatalogSummaryMock.mockResolvedValue(opensearchCatalog);
    getSearchIndexMappingMock.mockResolvedValue(opensearchMapping);

    const queryText = JSON.stringify({
      index: "logs-opensearch",
      body: { query: { match_all: {} } },
    });

    const { result } = renderHook(() =>
      useSearchAutocomplete({
        connectionId: "conn-opensearch",
        queryText,
        enabled: true,
        target: "opensearch",
      }),
    );

    expect(result.current).toHaveLength(1);
    await waitFor(() =>
      expect(listSearchCatalogSummaryMock).toHaveBeenCalledWith(
        "conn-opensearch",
      ),
    );
    await waitFor(() =>
      expect(getSearchIndexMappingMock).toHaveBeenCalledWith(
        "conn-opensearch",
        "logs-opensearch-2026.05.24",
      ),
    );
  });
});
