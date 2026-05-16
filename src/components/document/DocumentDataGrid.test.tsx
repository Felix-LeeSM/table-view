import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import DocumentDataGrid from "./DocumentDataGrid";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

// Canned results used by the mocked store. Shaped to mirror the backend's
// flattening: `rows` carry sentinels, `raw_documents` keep the nested
// values for Quick Look.
function buildResult(
  overrides: Partial<DocumentQueryResult> = {},
): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "unknown" },
      { name: "name", data_type: "string", category: "unknown" },
      { name: "meta", data_type: "document", category: "unknown" },
      { name: "tags", data_type: "array", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "{...}", "[3 items]"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob", "{...}", "[0 items]"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        meta: { verified: true },
        tags: ["admin", "beta", "gamma"],
      },
      {
        _id: { $oid: "65abcdef0123456789abcde0" },
        name: "Bob",
        meta: { verified: false },
        tags: [],
      },
    ],
    total_count: 2,
    execution_time_ms: 3,
    ...overrides,
  };
}

function buildSecondPageResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "unknown" },
      { name: "name", data_type: "string", category: "unknown" },
      { name: "meta", data_type: "document", category: "unknown" },
      { name: "tags", data_type: "array", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcde1" }, "Carol", "{...}", "[1 items]"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcde1" },
        name: "Carol",
        meta: {},
        tags: ["solo"],
      },
    ],
    total_count: 301,
    execution_time_ms: 2,
  };
}

// The mocked store drives runFind against a programmable result so each
// test can stage the data it needs without exercising the real tauri
// bridge. `findMock` is reset in `beforeEach`.
const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();

const insertDocumentMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve({ ObjectId: "65abcdef0123456789abcdef" }),
);
const updateDocumentMock = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const deleteDocumentMock = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const bulkWriteDocumentsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  () =>
    Promise.resolve({
      inserted_count: 0,
      matched_count: 0,
      modified_count: 0,
      deleted_count: 0,
      upserted_ids: [],
    }),
);

vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() => Promise.resolve([])),
  listMongoCollections: vi.fn(() => Promise.resolve([])),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: (...args: [string, string, string, unknown?]) =>
    findMock(...args),
  insertDocument: (...args: unknown[]) => insertDocumentMock(...args),
  updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
  deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
  bulkWriteDocuments: (...args: unknown[]) => bulkWriteDocumentsMock(...args),
}));

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
  insertDocumentMock.mockReset();
  insertDocumentMock.mockResolvedValue({
    ObjectId: "65abcdef0123456789abcdef",
  });
  updateDocumentMock.mockReset();
  updateDocumentMock.mockResolvedValue(undefined);
  deleteDocumentMock.mockReset();
  deleteDocumentMock.mockResolvedValue(undefined);
});

function renderGrid() {
  return render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="table_view_test"
      collection="users"
    />,
  );
}

describe("DocumentDataGrid", () => {
  it("renders the namespace header and rows after the initial fetch", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Sprint 87: the DataGridToolbar now drives the header row. It surfaces
    // the row count (e.g. "2 documents") once data is loaded; before data
    // loads, it falls back to "{schema}.{table}". Bob still renders in the
    // body. Sprint 118 (#PAR-2) — DocumentDataGrid passes the document
    // wording overrides so the row label says "documents", not "rows".
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // [AC-181-10] Sprint 181 ExportButton mounted into the toolbar.
    // 2026-05-01 — regression guard so future toolbar refactors don't drop it.
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("renders composite sentinels as inline tree toggles (Sprint 341 Option D)", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Document sentinel ({...}) — closed state shows "..." as the toggle.
    const documentToggles = screen.getAllByRole("button", {
      name: /Expand .*/,
    });
    expect(documentToggles.length).toBeGreaterThanOrEqual(1);
    // At least one of those buttons reads "...", and another reads "3 items"
    // (the array sentinel inner label).
    const labels = documentToggles.map((b) => b.textContent);
    expect(labels).toContain("...");
    expect(labels).toContain("3 items");
    // Empty-array sentinel — "[0 items]" splits into "[ 0 items ]".
    expect(labels).toContain("0 items");
  });

  it("selects a row with aria-selected when the row is clicked", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const rowAlice = screen.getByText("Alice").closest('[role="row"]');
    expect(rowAlice).not.toBeNull();
    expect(rowAlice).toHaveAttribute("aria-selected", "false");

    fireEvent.click(rowAlice as HTMLElement);
    expect(rowAlice).toHaveAttribute("aria-selected", "true");

    // Cmd+Click on the same row toggles the selection off (the shared edit
    // hook's multi-select semantics; plain click keeps the row selected).
    fireEvent.click(rowAlice as HTMLElement, { metaKey: true });
    expect(rowAlice).toHaveAttribute("aria-selected", "false");
  });

  it("does not mount QuickLookPanel when Cmd+L is pressed without a selection", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // No selection yet. Cmd+L toggles `showQuickLook` to true but the
    // mount gate requires `selectedRowIds.size > 0`, so the panel stays
    // absent.
    fireEvent.keyDown(document, { key: "l", metaKey: true });

    expect(
      screen.queryByRole("region", { name: "Document Details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tree", { name: /BSON document tree/i }),
    ).not.toBeInTheDocument();
  });

  it("mounts QuickLookPanel with BsonTreeViewer after selecting a row and pressing Cmd+L", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const rowAlice = screen
      .getByText("Alice")
      .closest('[role="row"]') as HTMLElement;
    fireEvent.click(rowAlice);

    fireEvent.keyDown(document, { key: "l", metaKey: true });

    const panel = await screen.findByRole("region", {
      name: "Document Details",
    });
    expect(panel).toBeInTheDocument();

    const tree = within(panel).getByRole("tree", {
      name: /BSON document tree/i,
    });
    expect(tree).toBeInTheDocument();
    expect(tree).toHaveTextContent("_id");
    expect(tree).toHaveTextContent("name");
    expect(tree).toHaveTextContent("meta");
    expect(tree).toHaveTextContent("tags");

    // Second Cmd+L hides the panel again (toggle behaviour).
    fireEvent.keyDown(document, { key: "l", metaKey: true });
    expect(
      screen.queryByRole("region", { name: "Document Details" }),
    ).not.toBeInTheDocument();
  });

  it("resets row selection when the user pages forward with Next", async () => {
    findMock.mockImplementation(
      async (_c: string, _db: string, _col: string, body?: unknown) => {
        const b = body as { skip?: number } | undefined;
        if (b && (b.skip ?? 0) > 0) return buildSecondPageResult();
        return buildResult({ total_count: 301 });
      },
    );

    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const rowAlice = screen
      .getByText("Alice")
      .closest('[role="row"]') as HTMLElement;
    fireEvent.click(rowAlice);
    expect(rowAlice).toHaveAttribute("aria-selected", "true");

    // Advance to page 2 — selection must reset because row indices are
    // page-local and would otherwise reference the wrong document.
    fireEvent.click(screen.getByLabelText("Next page"));

    await waitFor(() => expect(screen.getByText("Carol")).toBeInTheDocument());

    const rowCarol = screen
      .getByText("Carol")
      .closest('[role="row"]') as HTMLElement;
    expect(rowCarol).toHaveAttribute("aria-selected", "false");
  });

  it("renders the 'No documents' empty state when the result has no rows", async () => {
    findMock.mockResolvedValue(
      buildResult({ rows: [], raw_documents: [], total_count: 0 }),
    );

    renderGrid();

    await waitFor(() =>
      expect(screen.getByText("No documents")).toBeInTheDocument(),
    );

    // Pressing Cmd+L with zero rows should never mount the panel.
    fireEvent.keyDown(document, { key: "l", metaKey: true });
    expect(
      screen.queryByRole("region", { name: "Document Details" }),
    ).not.toBeInTheDocument();
  });

  it("hydrates the store with the fetched query result", async () => {
    renderGrid();

    await waitFor(() => {
      // Sprint 265 — nested `(connId, db, collection)` cache path.
      expect(
        useDocumentStore.getState().queryResults["conn-mongo"]?.[
          "table_view_test"
        ]?.["users"],
      ).toBeDefined();
    });
  });

  // ── Sprint 87 — inline edit + MQL preview + Add Document ──────────────────

  it("double-click on a scalar cell opens the inline editor and records a pending edit", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const aliceCell = screen.getByText("Alice");
    fireEvent.doubleClick(aliceCell);

    const editor = await screen.findByLabelText("Editing name");
    expect(editor).toHaveValue("Alice");

    fireEvent.change(editor, { target: { value: "Ada" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // The toolbar's pending-edit counter surfaces the accumulated diff.
    await waitFor(() => {
      expect(screen.getByText(/1 edit/)).toBeInTheDocument();
    });
  });

  it("double-click on a sentinel cell is a no-op — no editor appears", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Sprint 341 — the sentinel renders as `{` + toggle button + `}`, so
    // double-clicking the toggle (or its wrapper cell) must not start a
    // cell-level edit. The grid panel below handles inline editing.
    const toggle = screen.getAllByRole("button", { name: /Expand .*/ })[0]!;
    fireEvent.doubleClick(toggle);

    expect(screen.queryByLabelText(/Editing /)).not.toBeInTheDocument();
  });

  it("Commit button opens the MQL preview modal with the generated command lines", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Stage an edit: Alice → Ada on the `name` column.
    fireEvent.doubleClick(screen.getByText("Alice"));
    const editor = await screen.findByLabelText("Editing name");
    fireEvent.change(editor, { target: { value: "Ada" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    fireEvent.click(
      await screen.findByRole("button", { name: "Commit changes" }),
    );

    const preview = await screen.findByLabelText("MQL commands");
    expect(preview.textContent).toMatch(/db\.users\.updateOne/);
    expect(preview.textContent).toMatch(/\$set.*name.*Ada/);
  });

  it("Execute inside the MQL preview dispatches updateDocument and refetches", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByText("Alice"));
    const editor = await screen.findByLabelText("Editing name");
    fireEvent.change(editor, { target: { value: "Ada" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    fireEvent.click(
      await screen.findByRole("button", { name: "Commit changes" }),
    );

    const execute = await screen.findByRole("button", {
      name: "Execute MQL commands",
    });
    // Clear the initial fetch mock baseline; the refresh after Execute is
    // what we want to observe.
    const initialFindCalls = findMock.mock.calls.length;
    fireEvent.click(execute);

    // Sprint 326 I.1: commit path uses single bulkWrite IPC.
    await waitFor(() => {
      expect(bulkWriteDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(bulkWriteDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [
        {
          op: "updateOne",
          filter: { _id: { ObjectId: "65abcdef0123456789abcdef" } },
          update: { $set: { name: "Ada" } },
        },
      ],
    );
    await waitFor(() => {
      expect(findMock.mock.calls.length).toBeGreaterThan(initialFindCalls);
    });
  });

  it("toolbar Add opens the AddDocumentModal and submits via insertDocument", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add document" }));

    const editorContainer = await screen.findByLabelText("Document JSON");
    const cmEditor = editorContainer.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(cmEditor);
    if (!view) throw new Error("CodeMirror EditorView not found");
    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: '{"name":"Carol"}',
        },
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    await waitFor(() => {
      expect(insertDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(insertDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { name: "Carol" },
    );

    // Modal closes after a successful insert.
    await waitFor(() => {
      expect(screen.queryByLabelText("Document JSON")).not.toBeInTheDocument();
    });
  });

  // AC-196-05-1 — Sprint 196 (FB-5b). The Add Document submit path is the
  // first non-`raw` Mongo fire point: it bypasses the QueryTab editor and
  // calls `insertDocument` directly, so the global log would otherwise miss
  // it. Successful insert must surface a `source: "mongo-op"` history
  // entry with the synthesised `db.<col>.insertOne(...)` SQL line.
  // 2026-05-02.
  it("[AC-196-05-1] Add Document submit records a mongo-op history entry on success", async () => {
    const { useQueryHistoryStore } = await import("@stores/queryHistoryStore");
    useQueryHistoryStore.setState({ recentVisible: [] });

    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const editorContainer = await screen.findByLabelText("Document JSON");
    const cmEditor = editorContainer.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(cmEditor);
    if (!view) throw new Error("CodeMirror EditorView not found");
    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: '{"name":"Dana"}',
        },
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit add document" }),
    );

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().recentVisible;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.source).toBe("mongo-op");
      expect(entries[0]!.status).toBe("success");
      expect(entries[0]!.paradigm).toBe("document");
      expect(entries[0]!.collection).toBe("users");
    });
  });

  it("pending-edit visual cue — edited cell receives the highlight background", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByText("Alice"));
    const editor = await screen.findByLabelText("Editing name");
    fireEvent.change(editor, { target: { value: "Ada" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // The pending cell text becomes "Ada"; its gridcell carries bg-highlight.
    const pendingText = await screen.findByText("Ada");
    const cell = pendingText.closest('[role="gridcell"]') as HTMLElement | null;
    expect(cell).not.toBeNull();
    expect(cell!.className).toMatch(/bg-highlight/);
  });

  // Sprint 341 (2026-05-15, Option D) — nested cell toggle ↔ inline
  // detail row contract. Clicking the in-cell toggle expands the tree
  // panel beneath that row; toggling again (or another cell) collapses.
  it("nested cell toggle expands an inline tree row underneath", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Pre-state — no detail rows.
    expect(screen.queryByTestId("nested-detail-row-0")).not.toBeInTheDocument();

    // Open Alice's `meta` cell — the toggle inside `{ ... }`.
    // Two rows render — Alice (row 0) and Bob (row 1) — both have an
    // Expand meta button, so pick the first.
    const toggle = screen.getAllByRole("button", { name: /Expand meta/ })[0]!;
    fireEvent.click(toggle);
    expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();
    // The DocumentTreePanel renders the verified field as a leaf.
    expect(screen.getByTestId("tree-node-verified")).toBeInTheDocument();
    // Toggle label flipped to ✕.
    expect(toggle.textContent).toBe("✕");

    // Same toggle again closes the detail row.
    fireEvent.click(toggle);
    expect(screen.queryByTestId("nested-detail-row-0")).not.toBeInTheDocument();
  });

  it("opening a second nested cell switches the detail row to that cell", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: /Expand meta/ })[0]!);
    expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();

    // Click the tags toggle on the same row.
    fireEvent.click(screen.getAllByRole("button", { name: /Expand tags/ })[0]!);
    // Detail row still anchored on row 0 — but it's now showing the tags
    // tree, which has the [0]/[1]/[2] index leaves.
    expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-[0]")).toBeInTheDocument();
  });
});
