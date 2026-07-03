import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { getAllTabsForConnection } from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { SearchCatalogSummary } from "@/types/search";
import SearchSidebar from "./SearchSidebar";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for the search catalog
 * sidebar, plus the APG fix for the treeitem-with-nested-buttons violation
 * (#1129): the treeitem row is the single tab stop; its inline "open query"
 * action is not in the tab order and the title is no longer a nested button.
 */

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
      name: "idx-a",
      health: "green",
      open: true,
      docsCount: 1,
      storeSizeBytes: 1024,
      aliases: [],
      primaryShards: 1,
      replicaShards: 1,
    },
    {
      name: "idx-b",
      health: "green",
      open: true,
      docsCount: 1,
      storeSizeBytes: 1024,
      aliases: [],
      primaryShards: 1,
      replicaShards: 1,
    },
  ],
  aliases: [{ name: "alias-a", index: "backing-x", writeIndex: true }],
  dataStreams: [
    {
      name: "stream-a",
      backingIndices: [".ds-stream-a-000001"],
      health: "green",
      docsCount: 1,
      storeSizeBytes: 1024,
      primaryShards: 1,
      replicaShards: 1,
      hidden: false,
    },
  ],
};

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("SearchSidebar roving tabindex", () => {
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

  async function renderTree() {
    render(<SearchSidebar connectionId="search-1" />);
    await screen.findByText("idx-a");
    return screen.getByRole("tree", { name: /elasticsearch search catalog/i });
  }

  it("puts exactly one treeitem in the tab order initially (first index)", async () => {
    const tree = await renderTree();
    const items = within(tree).getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveTextContent("idx-a");
  });

  it("ArrowDown moves focus across rows, spanning sections", async () => {
    const tree = await renderTree();
    const idxA = within(tree).getByRole("treeitem", { name: /idx-a/i });
    act(() => idxA.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();
    expect(
      within(tree).getByRole("treeitem", { name: /idx-b/i }),
    ).toHaveFocus();

    fireEvent.keyDown(tree, { key: "ArrowDown" }); // into the aliases section
    await flushRaf();
    expect(
      within(tree).getByRole("treeitem", { name: /alias-a/i }),
    ).toHaveFocus();

    fireEvent.keyDown(tree, { key: "End" }); // last data stream
    await flushRaf();
    expect(
      within(tree).getByRole("treeitem", { name: /stream-a/i }),
    ).toHaveFocus();
  });

  it("resolves the nested-button APG violation", async () => {
    const tree = await renderTree();
    const tabbable = within(tree)
      .getAllByRole("treeitem")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);

    // The title is no longer a nested <button> inside the treeitem.
    const title = within(tree).getByText("idx-a");
    expect(title.closest("button")).toBeNull();

    // The inline "open query" action stays operable but is out of the tab
    // order (the treeitem is the single tab stop).
    const queryButton = within(tree).getByRole("button", {
      name: /open search query for idx-a/i,
    });
    expect(queryButton).toHaveAttribute("tabindex", "-1");
  });

  it("opens the query editor from the keyboard via Shift+Enter (WCAG 2.1.1)", async () => {
    const tree = await renderTree();
    const idxA = within(tree).getByRole("treeitem", { name: /idx-a/i });
    act(() => idxA.focus());

    fireEvent.keyDown(idxA, { key: "Enter", shiftKey: true });

    const queryTabs = getAllTabsForConnection("search-1").filter(
      (tab) => tab.type === "query",
    );
    expect(queryTabs).toHaveLength(1);
    expect(queryTabs[0]).toMatchObject({
      type: "query",
      searchTarget: { kind: "index", name: "idx-a" },
    });
  });

  it("exposes aria-setsize/aria-posinset per section", async () => {
    const tree = await renderTree();
    const idxA = within(tree).getByRole("treeitem", { name: /idx-a/i });
    const idxB = within(tree).getByRole("treeitem", { name: /idx-b/i });
    expect(idxA).toHaveAttribute("aria-setsize", "2");
    expect(idxA).toHaveAttribute("aria-posinset", "1");
    expect(idxB).toHaveAttribute("aria-posinset", "2");
    const aliasA = within(tree).getByRole("treeitem", { name: /alias-a/i });
    expect(aliasA).toHaveAttribute("aria-setsize", "1");
    expect(aliasA).toHaveAttribute("aria-posinset", "1");
  });

  it("keeps click-to-select working through the roving wiring", async () => {
    const tree = await renderTree();
    const idxB = within(tree).getByRole("treeitem", { name: /idx-b/i });
    fireEvent.click(idxB);
    expect(idxB).toHaveAttribute("aria-selected", "true");
  });
});
