import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  SearchCatalogSummary,
  SearchFieldStatsEnvelope,
  SearchIndexMapping,
  SearchIndexSettings,
  SearchIndexTemplateInfo,
  SearchResultEnvelope,
} from "@/types/search";
import SearchIndexDetailPanel from "./SearchIndexDetailPanel";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const catalog: SearchCatalogSummary = {
  identity: {
    product: "elasticsearch",
    clusterName: "Elasticsearch fixture",
    clusterUuid: "fixture-elasticsearch",
    version: {
      number: "8.12.2",
      distribution: "elasticsearch",
      lucene: "9.9.2",
      buildFlavor: "default",
    },
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
  indexes: [
    {
      name: "logs-elastic-2026.05.24",
      health: "green",
      open: true,
      docsCount: 2,
      storeSizeBytes: 4096,
      aliases: ["logs-elastic"],
      primaryShards: 1,
      replicaShards: 1,
    },
    {
      name: ".kibana_8.12.2",
      health: "yellow",
      open: true,
      docsCount: 12,
      storeSizeBytes: 2048,
      aliases: [],
      primaryShards: 1,
      replicaShards: 0,
    },
  ],
  aliases: [],
  dataStreams: [],
};

const mapping: SearchIndexMapping = {
  index: "logs-elastic-2026.05.24",
  fields: Array.from({ length: 60 }, (_, idx) => ({
    path: idx === 0 ? "@timestamp" : `field_${idx}`,
    fieldType: idx === 0 ? "date" : "keyword",
    searchable: true,
    aggregatable: idx !== 2,
    analyzer: idx === 3 ? "standard" : undefined,
  })),
  raw: { properties: { message: { type: "text" } } },
};

const settings: SearchIndexSettings = {
  index: "logs-elastic-2026.05.24",
  analyzers: [
    {
      name: "default",
      analyzerType: "standard",
      tokenizer: "standard",
      filters: ["lowercase"],
    },
  ],
  raw: { index: { analysis: { analyzer: { default: { type: "standard" } } } } },
};

const templates: SearchIndexTemplateInfo[] = [
  {
    name: "logs-elastic-template",
    endpoint: "composableIndexTemplate",
    indexPatterns: ["logs-elastic-*"],
    priority: 100,
    raw: { index_patterns: ["logs-elastic-*"] },
  },
  {
    name: "metrics-template",
    endpoint: "composableIndexTemplate",
    indexPatterns: ["metrics-*"],
    priority: 50,
    raw: { index_patterns: ["metrics-*"] },
  },
];

const samples: SearchResultEnvelope = {
  tookMs: 2,
  timedOut: false,
  total: { value: 2, relation: "eq" },
  hits: [
    {
      index: "logs-elastic-2026.05.24",
      id: "doc-1",
      score: 1,
      source: { message: "fixture log" },
      sort: [],
    },
    {
      index: "logs-elastic-2026.05.24",
      id: "doc-2",
      score: 0.8,
      source: { message: "fixture error" },
      sort: [],
    },
  ],
  aggregations: [],
};

const stats: SearchFieldStatsEnvelope = {
  index: "logs-elastic-2026.05.24",
  fields: [
    {
      path: "status",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
      docsCount: 2,
      sampleValues: ["ok", "error"],
    },
  ],
};

function installInvokeMock(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((command: string) => {
    if (command in overrides) {
      const value = overrides[command];
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(value);
    }
    switch (command) {
      case "list_search_catalog_summary":
        return Promise.resolve(catalog);
      case "get_search_index_mapping":
        return Promise.resolve(mapping);
      case "get_search_index_settings":
        return Promise.resolve(settings);
      case "list_search_index_templates":
        return Promise.resolve(templates);
      case "sample_search_documents":
        return Promise.resolve(samples);
      case "get_search_index_field_stats":
        return Promise.resolve(stats);
      default:
        return Promise.reject(new Error(`unexpected ${command}`));
    }
  });
}

function commandCount(command: string) {
  return invokeMock.mock.calls.filter(([name]) => name === command).length;
}

describe("SearchIndexDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installInvokeMock();
  });

  it("loads only catalog summary on entry and renders product/distro overview", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    expect(
      await screen.findByText(/Elasticsearch fixture/),
    ).toBeInTheDocument();
    expect(screen.getByText("8.12.2")).toBeInTheDocument();
    expect(screen.getAllByText("elasticsearch").length).toBeGreaterThan(0);
    expect(screen.getByText("composableIndexTemplate")).toBeInTheDocument();

    expect(commandCount("list_search_catalog_summary")).toBe(1);
    expect(commandCount("get_search_index_mapping")).toBe(0);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("list_search_index_templates")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
    expect(commandCount("get_search_index_field_stats")).toBe(0);
  });

  it("loads large mapping only after the Mapping tab is requested", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));

    expect(await screen.findByText("60 fields")).toBeInTheDocument();
    expect(screen.getByText("@timestamp")).toBeInTheDocument();
    expect(screen.getByText("field_59")).toBeInTheDocument();
    expect(commandCount("get_search_index_mapping")).toBe(1);
    expect(commandCount("get_search_index_settings")).toBe(0);
  });

  it("loads settings, matching templates, samples, and field stats through separate actions", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);

    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));
    expect(await screen.findByText("default")).toBeInTheDocument();
    expect(screen.getAllByText("standard").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /templates/i }));
    expect(
      await screen.findByText("logs-elastic-template"),
    ).toBeInTheDocument();
    expect(screen.queryByText("metrics-template")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /samples/i }));
    expect(await screen.findByText("2 hits")).toBeInTheDocument();
    expect(screen.getByText("doc-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /field stats/i }));
    expect(await screen.findByText("status")).toBeInTheDocument();
    expect(screen.getByText("2 samples")).toBeInTheDocument();

    expect(commandCount("get_search_index_settings")).toBe(1);
    expect(commandCount("list_search_index_templates")).toBe(1);
    expect(commandCount("sample_search_documents")).toBe(1);
    expect(commandCount("get_search_index_field_stats")).toBe(1);
  });

  it("surfaces hidden/system and error states without fetching other detail tabs", async () => {
    installInvokeMock({
      get_search_index_mapping: new Error("mapping unavailable"),
    });
    render(
      <SearchIndexDetailPanel connectionId="search-1" index=".kibana_8.12.2" />,
    );

    expect(await screen.findByText("system")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "mapping unavailable",
      ),
    );
    expect(commandCount("get_search_index_mapping")).toBe(1);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
  });
});
