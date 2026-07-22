import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const opensearchCatalog: SearchCatalogSummary = {
  identity: {
    product: "opensearch",
    clusterName: "OpenSearch dev",
    clusterUuid: "fixture-opensearch",
    version: {
      number: "2.13.0",
      distribution: "opensearch",
      lucene: "9.10.0",
    },
    capabilities: {
      search: true,
      aggregations: true,
      aliases: true,
      mappings: true,
      legacyIndexTemplates: true,
      composableIndexTemplates: true,
      deleteByQuery: false,
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
      docsCount: 3,
      storeSizeBytes: 8192,
      aliases: ["logs-opensearch"],
      primaryShards: 1,
      replicaShards: 1,
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

const systemMapping: SearchIndexMapping = {
  index: ".kibana_8.12.2",
  fields: [
    {
      path: "system_field",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
    },
  ],
  raw: { properties: { system_field: { type: "keyword" } } },
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

const opensearchTemplates: SearchIndexTemplateInfo[] = [
  {
    name: "logs-opensearch-template",
    endpoint: "composableIndexTemplate",
    indexPatterns: ["logs-opensearch-*"],
    priority: 90,
    raw: { index_patterns: ["logs-opensearch-*"] },
  },
  {
    name: "logs-opensearch-legacy",
    endpoint: "legacyIndexTemplate",
    indexPatterns: ["logs-opensearch-*"],
    raw: { template: "logs-opensearch-*" },
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

const opensearchSamples: SearchResultEnvelope = {
  tookMs: 3,
  timedOut: false,
  total: { value: 1, relation: "eq" },
  hits: [
    {
      index: "logs-opensearch-2026.05.24",
      id: "open-doc-1",
      score: 1.2,
      source: { message: "OpenSearch live sample", status: "ok" },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
    expect(
      screen.getByText(/Delete-by-query runs live against this index/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview delete-by-query plan/i }),
    ).toBeEnabled();

    expect(commandCount("list_search_catalog_summary")).toBe(1);
    expect(commandCount("get_search_index_mapping")).toBe(0);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("list_search_index_templates")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
    expect(commandCount("get_search_index_field_stats")).toBe(0);
  });

  // Issue #1718 (Stage 1, Part of #1717) — a search index tab carries
  // `subView: "structure"`, so the global soft-refresh (Cmd+R) broadcasts
  // `refresh-structure`. The detail panel must reload its catalog summary on
  // that event; before this change it ignored refresh entirely.
  it("[#1718] reloads the catalog on a refresh-structure event", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);
    expect(commandCount("list_search_catalog_summary")).toBe(1);

    act(() => {
      window.dispatchEvent(new CustomEvent("refresh-structure"));
    });

    await waitFor(() =>
      expect(commandCount("list_search_catalog_summary")).toBe(2),
    );
  });

  // a11y: WAI-ARIA tabpanel wiring — active section tab ↔ its content panel.
  it("wires the active section tab to its content panel", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);

    const overviewTab = screen.getByRole("tab", { selected: true });
    const panel = screen.getByRole("tabpanel");
    expect(overviewTab).toHaveAttribute("id", "tab-search-detail-overview");
    expect(panel).toHaveAttribute("aria-labelledby", overviewTab.id);
    expect(overviewTab).toHaveAttribute("aria-controls", panel.id);

    // Switch to Mapping — the mounted panel re-labels to the Mapping tab.
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));
    await screen.findByText("60 fields");
    const mappingTab = screen.getByRole("tab", { selected: true });
    const mappingPanel = screen.getByRole("tabpanel");
    expect(mappingTab).toHaveAttribute("id", "tab-search-detail-mapping");
    expect(mappingPanel).toHaveAttribute("aria-labelledby", mappingTab.id);
    expect(mappingTab).toHaveAttribute("aria-controls", mappingPanel.id);
  });

  // #1131 — the six detail tabs form one roving tab stop navigated with the
  // arrow keys (previously each was a separate tab stop with no arrow nav).
  it("roves the detail tabs with arrow keys and Home/End", async () => {
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);

    const tablist = screen.getByRole("tablist");
    // Exactly one tab stop on entry.
    const stops = () =>
      screen
        .getAllByRole("tab")
        .filter((t) => t.getAttribute("tabindex") === "0");
    expect(stops()).toHaveLength(1);
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      "tab-search-detail-overview",
    );

    // ArrowRight → Mapping, activation follows focus.
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      "tab-search-detail-mapping",
    );
    expect(stops()).toHaveLength(1);

    // ArrowLeft wraps Overview → Stats (last tab).
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      "tab-search-detail-stats",
    );

    // Home returns to the first tab.
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      "tab-search-detail-overview",
    );
  });

  it("opens a delete-by-query plan from the index header", async () => {
    installInvokeMock({
      plan_search_delete_by_query: {
        operation: "deleteByQuery",
        target: "logs-elastic-2026.05.24",
        previewOnly: true,
        requiresConfirmation: true,
        warnings: [
          "Delete-by-query permanently removes every matched document and cannot be undone",
        ],
        estimatedDocumentCount: 7,
      },
    });
    render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);
    fireEvent.click(
      screen.getByRole("button", { name: /preview delete-by-query plan/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /generate plan/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("plan_search_delete_by_query", {
        connectionId: "search-1",
        request: {
          indexPattern: "logs-elastic-2026.05.24",
          body: { query: { match_all: {} } },
          previewOnly: true,
          safety: {
            acknowledgedRisk: false,
            allowWildcard: false,
          },
        },
      }),
    );
    expect(
      await screen.findByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("Estimated documents7");
    expect(
      screen.getByLabelText("Delete-by-query preview plan"),
    ).toHaveTextContent("Live (Safe Mode confirmation)");
  });

  it("states delete-by-query is unsupported when the Search connection lacks capability", async () => {
    installInvokeMock({
      list_search_catalog_summary: opensearchCatalog,
    });
    render(
      <SearchIndexDetailPanel
        connectionId="open-1"
        index="logs-opensearch-2026.05.24"
      />,
    );

    expect(await screen.findByText(/OpenSearch dev/)).toBeInTheDocument();
    expect(
      screen.getByText(/Delete-by-query is unsupported by this connection/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview delete-by-query plan/i }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /preview delete-by-query plan/i }),
    );

    expect(commandCount("plan_search_delete_by_query")).toBe(0);
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

    fireEvent.click(screen.getByRole("tab", { name: /overview/i }));
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));
    expect(commandCount("get_search_index_mapping")).toBe(1);
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
    expect(invokeMock).toHaveBeenCalledWith("sample_search_documents", {
      connectionId: "search-1",
      index: "logs-elastic-2026.05.24",
      limit: 5,
    });

    fireEvent.click(screen.getByRole("tab", { name: /field stats/i }));
    expect(await screen.findByText("status")).toBeInTheDocument();
    expect(screen.getByText("2 samples")).toBeInTheDocument();

    expect(commandCount("get_search_index_settings")).toBe(1);
    expect(commandCount("list_search_index_templates")).toBe(1);
    expect(commandCount("sample_search_documents")).toBe(1);
    expect(commandCount("get_search_index_field_stats")).toBe(1);
  });

  it("loads OpenSearch index details, samples, templates, and field paths lazily", async () => {
    installInvokeMock({
      list_search_catalog_summary: opensearchCatalog,
      list_search_index_templates: opensearchTemplates,
      sample_search_documents: opensearchSamples,
    });
    render(
      <SearchIndexDetailPanel
        connectionId="open-1"
        index="logs-opensearch-2026.05.24"
      />,
    );

    expect(await screen.findByText(/OpenSearch dev/)).toBeInTheDocument();
    expect(screen.getByText("2.13.0")).toBeInTheDocument();
    expect(screen.getAllByText("opensearch").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));
    expect(await screen.findByText("60 fields")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /templates/i }));
    expect(
      await screen.findByText("logs-opensearch-template"),
    ).toBeInTheDocument();
    expect(screen.getByText("logs-opensearch-legacy")).toBeInTheDocument();
    expect(screen.getByText("legacyIndexTemplate")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /samples/i }));
    expect(await screen.findByText("1 hits")).toBeInTheDocument();
    expect(screen.getByLabelText("Search hits")).toHaveTextContent(
      "OpenSearch live sample",
    );

    fireEvent.click(screen.getByRole("tab", { name: /field stats/i }));
    expect(await screen.findByText("status")).toBeInTheDocument();

    expect(commandCount("sample_search_documents")).toBe(1);
  });

  it("ignores stale detail responses after the selected index changes", async () => {
    const staleMapping = deferred<SearchIndexMapping>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(catalog);
      }
      if (command === "get_search_index_mapping") {
        return commandCount("get_search_index_mapping") === 1
          ? staleMapping.promise
          : Promise.resolve(systemMapping);
      }
      return Promise.reject(new Error(`unexpected ${command}`));
    });

    const { rerender } = render(
      <SearchIndexDetailPanel
        connectionId="search-1"
        index="logs-elastic-2026.05.24"
      />,
    );

    await screen.findByText(/Elasticsearch fixture/);
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));
    expect(commandCount("get_search_index_mapping")).toBe(1);

    rerender(
      <SearchIndexDetailPanel connectionId="search-1" index=".kibana_8.12.2" />,
    );
    await screen.findByText("system");
    await act(async () => {
      staleMapping.resolve(mapping);
    });

    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));

    expect(await screen.findByText("system_field")).toBeInTheDocument();
    expect(screen.queryByText("@timestamp")).not.toBeInTheDocument();
    expect(commandCount("get_search_index_mapping")).toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("get_search_index_mapping", {
      connectionId: "search-1",
      index: ".kibana_8.12.2",
    });
  });

  it("scopes detail errors to their selected tab", async () => {
    installInvokeMock({
      get_search_index_mapping: new Error(
        "mapping unavailable from https://elastic:secret@example.test:9200/.kibana_8.12.2/_mapping?token=abc123",
      ),
    });
    render(
      <SearchIndexDetailPanel connectionId="search-1" index=".kibana_8.12.2" />,
    );

    expect(await screen.findByText("system")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));

    const mappingAlert = await screen.findByRole("alert");
    expect(mappingAlert).toHaveTextContent("Search mapping failed");
    expect(mappingAlert).toHaveTextContent("mapping unavailable");
    expect(mappingAlert).not.toHaveTextContent("elastic:secret");
    expect(mappingAlert).not.toHaveTextContent("token=abc123");
    expect(mappingAlert).not.toHaveTextContent("https://");
    expect(commandCount("get_search_index_mapping")).toBe(1);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));
    expect(await screen.findByText("default")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(commandCount("get_search_index_settings")).toBe(1);

    fireEvent.click(screen.getByRole("tab", { name: /mapping/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Search mapping failed",
    );
  });
});
