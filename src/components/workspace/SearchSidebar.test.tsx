import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { getAllTabsForConnection } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { SearchCatalogSummary } from "@/types/search";
import SearchSidebar from "./SearchSidebar";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function commandCount(command: string) {
  return invokeMock.mock.calls.filter(([name]) => name === command).length;
}

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
      uuid: "idx-1",
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
  aliases: [
    {
      name: "logs-elastic",
      index: "logs-elastic-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [
    {
      name: "logs-elastic-default",
      backingIndices: [".ds-logs-elastic-default-2026.05.24-000001"],
      health: "green",
      docsCount: 2,
      storeSizeBytes: 4096,
      primaryShards: 1,
      replicaShards: 1,
      hidden: false,
    },
    {
      name: ".fleet-actions",
      backingIndices: [".ds-.fleet-actions-000001"],
      health: "green",
      docsCount: 1,
      storeSizeBytes: 512,
      primaryShards: 1,
      replicaShards: 0,
      hidden: true,
    },
  ],
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
      uuid: "open-idx-1",
      health: "green",
      open: true,
      docsCount: 3,
      storeSizeBytes: 8192,
      aliases: ["logs-open-current"],
      primaryShards: 1,
      replicaShards: 1,
    },
  ],
  aliases: [
    {
      name: "logs-open-current",
      index: "logs-opensearch-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [
    {
      name: "logs-opensearch-default",
      backingIndices: [".ds-logs-opensearch-default-000001"],
      health: "green",
      docsCount: 3,
      storeSizeBytes: 8192,
      primaryShards: 1,
      replicaShards: 1,
      hidden: false,
    },
  ],
};

describe("SearchSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(catalog);
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [
        {
          id: "search-1",
          name: "Elastic fixture",
          dbType: "elasticsearch",
          host: "localhost",
          port: 9200,
          user: "",
          hasPassword: false,
          database: "",
          groupId: null,
          color: null,
          environment: null,
          paradigm: "search",
        },
      ],
      activeStatuses: { "search-1": { type: "connected" } },
      hasLoadedOnce: true,
    });
  });

  it("loads fixture-backed index, alias, and data-stream catalog without deep metadata", async () => {
    render(<SearchSidebar connectionId="search-1" />);

    expect(
      await screen.findByText(/Elasticsearch fixture/),
    ).toBeInTheDocument();
    expect(screen.getByText(/8\.12\.2 · elasticsearch/)).toBeInTheDocument();

    const tree = screen.getByRole("tree", {
      name: /elasticsearch search catalog/i,
    });
    expect(
      within(tree).getByText("logs-elastic-2026.05.24"),
    ).toBeInTheDocument();
    expect(within(tree).getByText("logs-elastic")).toBeInTheDocument();
    expect(within(tree).getByText("logs-elastic-default")).toBeInTheDocument();
    expect(screen.getByTestId("search-catalog-status")).toHaveTextContent(
      "search-native",
    );
    expect(screen.getByTestId("search-catalog-status")).toHaveTextContent(
      "2 indexes · 1 alias · 2 data streams",
    );
    expect(invokeMock).toHaveBeenCalledWith("list_search_catalog_summary", {
      connectionId: "search-1",
    });
    expect(commandCount("list_search_catalog_summary")).toBe(1);
    expect(commandCount("get_search_index_mapping")).toBe(0);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
  });

  it("renders OpenSearch live catalog as the same search-native shell without deep metadata", async () => {
    invokeMock.mockResolvedValueOnce(opensearchCatalog);
    useConnectionStore.setState({
      connections: [
        {
          id: "open-1",
          name: "OpenSearch dev",
          dbType: "opensearch",
          host: "localhost",
          port: 9200,
          user: "",
          hasPassword: false,
          database: "",
          groupId: null,
          color: null,
          environment: null,
          paradigm: "search",
        },
      ],
      activeStatuses: { "open-1": { type: "connected" } },
      hasLoadedOnce: true,
    });

    render(<SearchSidebar connectionId="open-1" />);

    expect(await screen.findByText(/OpenSearch dev/)).toBeInTheDocument();
    expect(screen.getByText(/2\.13\.0 · opensearch/)).toBeInTheDocument();
    const tree = screen.getByRole("tree", {
      name: /opensearch search catalog/i,
    });
    expect(
      within(tree).getByText("logs-opensearch-2026.05.24"),
    ).toBeInTheDocument();
    expect(within(tree).getByText("logs-open-current")).toBeInTheDocument();
    expect(
      within(tree).getByText("logs-opensearch-default"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("search-catalog-status")).toHaveTextContent(
      "1 index · 1 alias · 1 data stream",
    );
    expect(commandCount("list_search_catalog_summary")).toBe(1);
    expect(commandCount("get_search_index_mapping")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
  });

  it("keeps hidden/system entries behind an explicit toggle", async () => {
    render(<SearchSidebar connectionId="search-1" />);

    await screen.findByText("logs-elastic-2026.05.24");
    expect(screen.queryByText(".kibana_8.12.2")).not.toBeInTheDocument();
    expect(screen.queryByText(".fleet-actions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /show system/i }));

    expect(screen.getByText(".kibana_8.12.2")).toBeInTheDocument();
    expect(screen.getByText(".fleet-actions")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("filters entries locally and selected rows do not fetch mapping/settings/sample documents", async () => {
    render(<SearchSidebar connectionId="search-1" />);

    await screen.findByText("logs-elastic-2026.05.24");
    fireEvent.change(
      screen.getByRole("textbox", { name: /elasticsearch catalog filter/i }),
      { target: { value: "default" } },
    );

    expect(
      screen.queryByText("logs-elastic-2026.05.24"),
    ).not.toBeInTheDocument();
    const row = screen.getByRole("treeitem", {
      name: /logs-elastic-default/i,
    });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("opens a Search index detail tab without fetching deep metadata from the sidebar", async () => {
    render(<SearchSidebar connectionId="search-1" />);

    const rowText = await screen.findByText("logs-elastic-2026.05.24");
    const row = rowText.closest("button");
    expect(row).not.toBeNull();
    if (!row) return;
    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-selected", "true");
    const tabs = getAllTabsForConnection("search-1");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      type: "table",
      title: "logs-elastic-2026.05.24",
      database: "_search",
      schema: "_search",
      table: "logs-elastic-2026.05.24",
      paradigm: "search",
      subView: "structure",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_search_catalog_summary", {
      connectionId: "search-1",
    });
    expect(commandCount("list_search_catalog_summary")).toBe(1);
    expect(commandCount("get_search_index_mapping")).toBe(0);
    expect(commandCount("get_search_index_settings")).toBe(0);
    expect(commandCount("sample_search_documents")).toBe(0);
  });

  it("renders many-index summaries without changing the sidebar shell", async () => {
    invokeMock.mockResolvedValueOnce({
      ...catalog,
      indexes: Array.from({ length: 25 }, (_, index) => ({
        name: `logs-${String(index + 1).padStart(2, "0")}`,
        health: index % 3 === 0 ? "yellow" : "green",
        open: true,
        docsCount: index + 1,
        storeSizeBytes: 1024 * (index + 1),
        aliases: [],
        primaryShards: 1,
        replicaShards: 1,
      })),
      aliases: [],
      dataStreams: [],
    } satisfies SearchCatalogSummary);

    render(<SearchSidebar connectionId="search-1" />);

    expect(await screen.findByText("logs-01")).toBeInTheDocument();
    expect(screen.getByText("logs-25")).toBeInTheDocument();
    expect(screen.getByTestId("search-catalog-status")).toHaveTextContent(
      "25 indexes · 0 aliases · 0 data streams",
    );
  });

  it("renders empty, loading, refresh, and error states", async () => {
    invokeMock.mockResolvedValueOnce({
      ...catalog,
      indexes: [],
      aliases: [],
      dataStreams: [],
    });

    render(<SearchSidebar connectionId="search-1" />);

    expect(
      screen.getByRole("status", { name: /loading search catalog/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No indexes found.")).toBeInTheDocument();
    expect(screen.getByText("No aliases found.")).toBeInTheDocument();
    expect(screen.getByText("No data streams found.")).toBeInTheDocument();

    invokeMock.mockRejectedValueOnce(new Error("fixture catalog unavailable"));
    fireEvent.click(
      screen.getByRole("button", { name: /refresh elasticsearch catalog/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "fixture catalog unavailable",
      ),
    );
  });
});
