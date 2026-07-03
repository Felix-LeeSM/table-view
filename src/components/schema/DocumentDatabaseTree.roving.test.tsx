import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import DocumentDatabaseTree from "./DocumentDatabaseTree";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { CollectionInfo } from "@/types/document";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for the two-level
 * Mongo database/collection sidebar (#1129). Guards that only one treeitem is
 * ever in the tab order and that arrow keys drive focus + expand/collapse.
 */

function collectionFixture(name: string, database: string): CollectionInfo {
  return {
    name,
    database,
    collection_type: "collection",
    document_count: 1,
    read_only: false,
    options: {},
    id_index: null,
  };
}

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() =>
      Promise.resolve([{ name: "alpha" }, { name: "beta" }]),
    ),
    listMongoCollections: vi.fn((_conn: string, db: string) =>
      Promise.resolve([
        collectionFixture("things", db),
        collectionFixture("stuff", db),
      ]),
    ),
    inferCollectionFields: vi.fn(() => Promise.resolve([])),
    findDocuments: vi.fn(() =>
      Promise.resolve({
        columns: [],
        rows: [],
        raw_documents: [],
        total_count: 0,
        execution_time_ms: 0,
      }),
    ),
  });
  __resetDocumentStoreForTests();
  useWorkspaceStore.setState({ workspaces: {} });
  useConnectionStore.setState({ activeStatuses: {}, connections: [] });
});

async function renderTree() {
  render(<DocumentDatabaseTree connectionId="conn-mongo" />);
  await waitFor(() =>
    expect(screen.getByLabelText("alpha database")).toBeInTheDocument(),
  );
  return screen.getByRole("tree");
}

describe("DocumentDatabaseTree roving tabindex", () => {
  it("puts exactly one treeitem in the tab order initially (first database)", async () => {
    const tree = await renderTree();
    const items = within(tree).getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-label", "alpha database");
  });

  it("ArrowDown moves focus + tabIndex to the next database", async () => {
    const tree = await renderTree();
    const alpha = screen.getByLabelText("alpha database");
    act(() => alpha.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    const beta = screen.getByLabelText("beta database");
    expect(beta).toHaveAttribute("tabindex", "0");
    expect(alpha).toHaveAttribute("tabindex", "-1");
    expect(beta).toHaveFocus();
  });

  it("ArrowRight expands a collapsed database, ArrowLeft collapses it", async () => {
    const tree = await renderTree();
    const alpha = screen.getByLabelText("alpha database");
    act(() => alpha.focus());
    expect(alpha).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByLabelText("things collection")).toBeInTheDocument(),
    );
    expect(alpha).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    await flushRaf();
    expect(alpha).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByLabelText("things collection"),
    ).not.toBeInTheDocument();
  });

  it("ArrowDown steps into the first collection of an expanded database", async () => {
    const tree = await renderTree();
    const alpha = screen.getByLabelText("alpha database");
    act(() => alpha.focus());
    fireEvent.click(alpha); // expand + load collections
    await waitFor(() =>
      expect(screen.getByLabelText("things collection")).toBeInTheDocument(),
    );
    act(() => alpha.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    expect(screen.getByLabelText("things collection")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByLabelText("things collection")).toHaveFocus();
  });

  it("exposes aria-setsize/aria-posinset on database rows", async () => {
    await renderTree();
    const alpha = screen.getByLabelText("alpha database");
    const beta = screen.getByLabelText("beta database");
    expect(alpha).toHaveAttribute("aria-setsize", "2");
    expect(alpha).toHaveAttribute("aria-posinset", "1");
    expect(beta).toHaveAttribute("aria-posinset", "2");
  });
});
