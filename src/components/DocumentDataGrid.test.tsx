import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";
import { COLLECTION_READONLY_BANNER_TEXT } from "@lib/strings/document";

// Canned results used by the mocked store. Shaped to mirror the backend's
// flattening: `rows` carry sentinels, `raw_documents` keep the nested
// values for Quick Look.
function buildResult(
  overrides: Partial<DocumentQueryResult> = {},
): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId" },
      { name: "name", data_type: "string" },
      { name: "meta", data_type: "document" },
      { name: "tags", data_type: "array" },
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
      { name: "_id", data_type: "ObjectId" },
      { name: "name", data_type: "string" },
      { name: "meta", data_type: "document" },
      { name: "tags", data_type: "array" },
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

vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() => Promise.resolve([])),
  listMongoCollections: vi.fn(() => Promise.resolve([])),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: (...args: [string, string, string, unknown?]) =>
    findMock(...args),
  insertDocument: (...args: unknown[]) => insertDocumentMock(...args),
  updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
  deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
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
    // the row count (e.g. "2 rows") once data is loaded; before data loads,
    // it falls back to "{schema}.{table}". Bob still renders in the body.
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders composite sentinels via isDocumentSentinel with muted italic styling", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Document sentinel ({...}) rendered with muted italic class.
    const documentSentinels = screen.getAllByText("{...}");
    expect(documentSentinels.length).toBeGreaterThanOrEqual(1);
    for (const el of documentSentinels) {
      expect(el).toHaveClass("italic");
      expect(el).toHaveClass("text-muted-foreground");
    }

    // Array sentinels: `[3 items]` + `[0 items]` both go through the
    // same helper, so both must render muted-italic.
    expect(screen.getByText("[3 items]")).toHaveClass("italic");
    expect(screen.getByText("[0 items]")).toHaveClass("text-muted-foreground");
  });

  it("selects a row with aria-selected when the row is clicked", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const rowAlice = screen.getByText("Alice").closest("tr");
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

    const rowAlice = screen.getByText("Alice").closest("tr") as HTMLElement;
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

    const rowAlice = screen.getByText("Alice").closest("tr") as HTMLElement;
    fireEvent.click(rowAlice);
    expect(rowAlice).toHaveAttribute("aria-selected", "true");

    // Advance to page 2 — selection must reset because row indices are
    // page-local and would otherwise reference the wrong document.
    fireEvent.click(screen.getByLabelText("Next page"));

    await waitFor(() => expect(screen.getByText("Carol")).toBeInTheDocument());

    const rowCarol = screen.getByText("Carol").closest("tr") as HTMLElement;
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
      const key = "conn-mongo:table_view_test:users";
      expect(useDocumentStore.getState().queryResults[key]).toBeDefined();
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

    const sentinels = screen.getAllByText("{...}");
    expect(sentinels.length).toBeGreaterThan(0);
    fireEvent.doubleClick(sentinels[0]!);

    // No input renders for the sentinel cell.
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

    await waitFor(() => {
      expect(updateDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(updateDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { ObjectId: "65abcdef0123456789abcdef" },
      { name: "Ada" },
    );
    await waitFor(() => {
      expect(findMock.mock.calls.length).toBeGreaterThan(initialFindCalls);
    });
  });

  it("toolbar Add opens the AddDocumentModal and submits via insertDocument", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    const textarea = await screen.findByLabelText("Document JSON");
    fireEvent.change(textarea, { target: { value: '{"name":"Carol"}' } });
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

  // ── Sprint 101 — collection beta/limitation banner ──────────────────────

  it("renders the collection read-only banner above the toolbar", async () => {
    renderGrid();

    // The banner mounts immediately; we don't need to wait for the fetch.
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(COLLECTION_READONLY_BANNER_TEXT);

    // Banner has no dismiss affordance — Sprint 101 requires it to persist.
    expect(screen.queryByRole("button", { name: /dismiss|close/i })).toBeNull();
  });

  it("pending-edit visual cue — edited cell receives the highlight background", async () => {
    renderGrid();

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByText("Alice"));
    const editor = await screen.findByLabelText("Editing name");
    fireEvent.change(editor, { target: { value: "Ada" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // The pending cell text becomes "Ada"; its td carries bg-highlight.
    const pendingText = await screen.findByText("Ada");
    const td = pendingText.closest("td") as HTMLElement | null;
    expect(td).not.toBeNull();
    expect(td!.className).toMatch(/bg-highlight/);
  });
});
