import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useWorkspaceStore,
  type QueryTab as QueryTabType,
} from "@stores/workspaceStore";
import type { ConnectionConfig } from "@/types/connection";
import type { SearchCatalogSummary, SearchIndexMapping } from "@/types/search";
import QueryTab from "./QueryTab";

const invokeMock = vi.hoisted(() => vi.fn());

vi.unmock("@lib/tauri");
vi.unmock("@/lib/tauri");

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: () => "workspace-search-1",
  };
});

function makeSearchConnection(): ConnectionConfig {
  return {
    id: "search-1",
    name: "Search",
    dbType: "elasticsearch",
    host: "localhost",
    port: 9200,
    user: "",
    database: "db1",
    groupId: null,
    color: null,
    hasPassword: false,
    paradigm: "search",
  };
}

function makeOpenSearchConnection(): ConnectionConfig {
  return {
    ...makeSearchConnection(),
    name: "OpenSearch",
    dbType: "opensearch",
  };
}

function makeSearchTab(): QueryTabType {
  return {
    type: "query",
    id: "query-search",
    title: "Search Query",
    connectionId: "search-1",
    closable: true,
    paradigm: "search",
    queryLanguage: "search-dsl",
    sql: JSON.stringify({
      index: "logs-elastic-2026.05.24",
      body: {
        query: { match_all: {} },
        aggs: {
          by_status: { terms: { field: "status.keyword" } },
        },
      },
      size: 10,
      trackTotalHits: true,
    }),
    queryState: { status: "idle" },
  };
}

function makeOpenSearchTab(): QueryTabType {
  return {
    ...makeSearchTab(),
    sql: JSON.stringify({
      index: "logs-opensearch-2026.05.24",
      body: {
        query: { match_all: {} },
        aggs: {
          by_status: { terms: { field: "status.keyword" } },
        },
      },
      size: 5,
      trackTotalHits: true,
    }),
  };
}

function makeSelectedAliasSearchTab(): QueryTabType {
  return {
    ...makeSearchTab(),
    title: "Query logs-elastic",
    searchTarget: { kind: "alias", name: "logs-elastic" },
    sql: JSON.stringify({
      query: { match_all: {} },
      aggs: {
        by_status: { terms: { field: "status.keyword" } },
      },
      from: 1,
      size: 5,
      track_total_hits: true,
    }),
  };
}

const searchCatalog = {
  identity: {
    product: "elasticsearch",
    clusterName: "elastic-dev",
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
  indexes: [
    {
      name: "logs-elastic-2026.05.24",
      health: "green",
      open: true,
      aliases: ["logs-elastic"],
    },
  ],
  aliases: [
    {
      name: "logs-elastic",
      index: "logs-elastic-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [],
} as const satisfies SearchCatalogSummary;

const searchMapping = {
  index: "logs-elastic-2026.05.24",
  fields: [
    {
      path: "status.keyword",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
    },
    {
      path: "message",
      fieldType: "text",
      searchable: true,
      aggregatable: false,
    },
  ],
  raw: {},
} as const satisfies SearchIndexMapping;

const opensearchCatalog = {
  ...searchCatalog,
  identity: {
    ...searchCatalog.identity,
    product: "opensearch",
    clusterName: "open-dev",
    version: { number: "2.13.0", distribution: "opensearch" },
    capabilities: {
      ...searchCatalog.identity.capabilities,
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
} as const satisfies SearchCatalogSummary;

const opensearchMapping = {
  ...searchMapping,
  index: "logs-opensearch-2026.05.24",
} as const satisfies SearchIndexMapping;

function LiveQueryTab() {
  const tab = useWorkspaceStore(
    (state) =>
      state.workspaces["search-1"]?.db1?.tabs.find(
        (candidate) => candidate.id === "query-search",
      ) as QueryTabType | undefined,
  );
  if (!tab) return null;
  return <QueryTab tab={tab} />;
}

describe("QueryTab search route", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [makeSearchConnection()],
      activeStatuses: {
        "search-1": { type: "connected", activeDb: "db1" },
      },
      focusedConnId: "search-1",
    });
  });

  it("dispatches Search DSL through the Tauri wrapper and renders SearchResultView", async () => {
    const tab = makeSearchTab();
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id, "search-1", "db1"));
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_history") {
        return Promise.resolve({ rows: [] });
      }
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(searchCatalog);
      }
      if (command === "get_search_index_mapping") {
        return Promise.resolve(searchMapping);
      }
      if (command === "execute_search_query") {
        return Promise.resolve({
          tookMs: 3,
          timedOut: false,
          total: { value: 2, relation: "eq" },
          hits: [
            {
              index: "logs-elastic-2026.05.24",
              id: "doc-1",
              score: 1,
              source: { message: "fixture log", status: "ok" },
              sort: [],
            },
          ],
          aggregations: [
            {
              kind: "terms",
              name: "by_status",
              buckets: [{ key: "ok", docCount: 1 }],
            },
          ],
        });
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    render(<LiveQueryTab />);
    expect(
      screen.getByRole("textbox", { name: "Search Query Editor" }),
    ).toHaveAttribute("data-paradigm", "search");
    expect(
      screen.queryByText(/Search query editor is planned/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_search_query", {
        connectionId: "search-1",
        request: {
          index: "logs-elastic-2026.05.24",
          body: {
            query: { match_all: {} },
            aggs: {
              by_status: { terms: { field: "status.keyword" } },
            },
          },
          from: undefined,
          size: 10,
          trackTotalHits: true,
        },
        queryId: expect.stringMatching(/^query-search-/),
      });
    });

    expect(await screen.findByLabelText("Search results")).toHaveTextContent(
      "2 hits",
    );
    expect(screen.getByLabelText("Search hits")).toHaveTextContent(
      "fixture log",
    );
    expect(screen.getByLabelText("Search aggregations")).toHaveTextContent(
      "by_status",
    );
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_search_catalog_summary", {
        connectionId: "search-1",
      });
      expect(invokeMock).toHaveBeenCalledWith("get_search_index_mapping", {
        connectionId: "search-1",
        index: "logs-elastic-2026.05.24",
      });
    });
  });

  it("dispatches body-only Search DSL through the selected alias target", async () => {
    const tab = makeSelectedAliasSearchTab();
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id, "search-1", "db1"));
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_history") {
        return Promise.resolve({ rows: [] });
      }
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(searchCatalog);
      }
      if (command === "get_search_index_mapping") {
        return Promise.resolve(searchMapping);
      }
      if (command === "execute_search_query") {
        return Promise.resolve({
          tookMs: 3,
          timedOut: false,
          total: { value: 1, relation: "eq" },
          hits: [
            {
              index: "logs-elastic-2026.05.24",
              id: "doc-2",
              score: 1,
              source: { message: "alias-routed log", status: "ok" },
              sort: ["doc-2"],
            },
          ],
          aggregations: [
            {
              kind: "terms",
              name: "by_status",
              buckets: [{ key: "ok", docCount: 1 }],
            },
          ],
        });
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    render(<LiveQueryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_search_query", {
        connectionId: "search-1",
        request: {
          index: "logs-elastic",
          body: {
            query: { match_all: {} },
            aggs: {
              by_status: { terms: { field: "status.keyword" } },
            },
            from: 1,
            size: 5,
            track_total_hits: true,
          },
          from: undefined,
          size: undefined,
          trackTotalHits: undefined,
        },
        queryId: expect.stringMatching(/^query-search-/),
      });
    });

    expect(await screen.findByLabelText("Search results")).toHaveTextContent(
      "1 hit",
    );
    expect(screen.getByLabelText("Search hits")).toHaveTextContent(
      "alias-routed log",
    );
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("dispatches OpenSearch Search DSL and renders hits and aggregations", async () => {
    useConnectionStore.setState({
      connections: [makeOpenSearchConnection()],
      activeStatuses: {
        "search-1": { type: "connected", activeDb: "db1" },
      },
      focusedConnId: "search-1",
    });
    const tab = makeOpenSearchTab();
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id, "search-1", "db1"));
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_history") {
        return Promise.resolve({ rows: [] });
      }
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(opensearchCatalog);
      }
      if (command === "get_search_index_mapping") {
        return Promise.resolve(opensearchMapping);
      }
      if (command === "execute_search_query") {
        return Promise.resolve({
          tookMs: 4,
          timedOut: false,
          total: { value: 1, relation: "eq" },
          hits: [
            {
              index: "logs-opensearch-2026.05.24",
              id: "open-doc-1",
              score: 1.2,
              source: { message: "OpenSearch live log", status: "ok" },
              sort: [],
            },
          ],
          aggregations: [
            {
              kind: "terms",
              name: "by_status",
              buckets: [{ key: "ok", docCount: 1 }],
            },
          ],
        });
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    render(<LiveQueryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("execute_search_query", {
        connectionId: "search-1",
        request: {
          index: "logs-opensearch-2026.05.24",
          body: {
            query: { match_all: {} },
            aggs: {
              by_status: { terms: { field: "status.keyword" } },
            },
          },
          from: undefined,
          size: 5,
          trackTotalHits: true,
        },
        queryId: expect.stringMatching(/^query-search-/),
      });
    });

    expect(await screen.findByLabelText("Search results")).toHaveTextContent(
      "1 hit",
    );
    expect(screen.getByLabelText("Search hits")).toHaveTextContent(
      "OpenSearch live log",
    );
    expect(screen.getByLabelText("Search aggregations")).toHaveTextContent(
      "by_status",
    );
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_search_catalog_summary", {
        connectionId: "search-1",
      });
      expect(invokeMock).toHaveBeenCalledWith("get_search_index_mapping", {
        connectionId: "search-1",
        index: "logs-opensearch-2026.05.24",
      });
    });
  });

  it("surfaces destructive Search target rejects through the Search-native error view", async () => {
    const tab: QueryTabType = {
      ...makeSearchTab(),
      sql: JSON.stringify({
        index: "logs-elastic-2026.05.24/_delete_by_query",
        body: { query: { match_all: {} } },
      }),
    };
    useWorkspaceStore.setState(seedWorkspace([tab], tab.id, "search-1", "db1"));
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_history") {
        return Promise.resolve({ rows: [] });
      }
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(searchCatalog);
      }
      if (command === "get_search_index_mapping") {
        return Promise.resolve(searchMapping);
      }
      if (command === "execute_search_query") {
        return Promise.reject(
          new Error(
            "Search DSL execution only accepts index or alias targets, not raw/destructive paths",
          ),
        );
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    render(<LiveQueryTab />);
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search query failed",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "raw/destructive paths",
    );
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "execute_search_query",
      ),
    ).toBe(false);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("routes Search loading and error states through the Search-native result surface", () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_history") {
        return Promise.resolve({ rows: [] });
      }
      if (command === "list_search_catalog_summary") {
        return Promise.resolve(searchCatalog);
      }
      if (command === "get_search_index_mapping") {
        return Promise.resolve(searchMapping);
      }
      if (command === "cancel_query") {
        return Promise.resolve("cancelled");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const runningTab: QueryTabType = {
      ...makeSearchTab(),
      queryState: { status: "running", queryId: "search-q-1" },
    };
    useWorkspaceStore.setState(
      seedWorkspace([runningTab], runningTab.id, "search-1", "db1"),
    );

    const { unmount } = render(<LiveQueryTab />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Search query running",
    );
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Cancel query"));
    expect(invokeMock).toHaveBeenCalledWith("cancel_query", {
      queryId: "search-q-1",
    });
    unmount();

    const errorTab: QueryTabType = {
      ...makeSearchTab(),
      queryState: { status: "error", error: "Search parser failed" },
    };
    useWorkspaceStore.setState(
      seedWorkspace([errorTab], errorTab.id, "search-1", "db1"),
    );

    render(<LiveQueryTab />);

    expect(screen.getByRole("alert")).toHaveTextContent("Search query failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Search parser failed");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});
