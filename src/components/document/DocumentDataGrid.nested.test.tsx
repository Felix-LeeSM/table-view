// Sprint 341 (2026-05-15) — Option D: inline tree row.
//
// Replaces the Sprint 321/322 NestedExpandPopover regression guards with
// the equivalent contract on the inline tree:
//   - sentinel cell mounts an in-cell toggle (the `...` or `N items`
//     middle button); scalar cells do not.
//   - clicking the toggle does not propagate row selection.
//   - opening expands a master/detail row containing DocumentTreePanel.
//   - inline edit on a tree leaf records the dot-path pendingEdit, and
//     the MQL preview emits `$set: { "<col>.<path>": <value> }`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "unknown" },
      { name: "name", data_type: "string", category: "unknown" },
      { name: "meta", data_type: "document", category: "unknown" },
      { name: "tags", data_type: "array", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "{...}", "[3 items]"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        meta: { verified: true, role: "admin" },
        tags: ["alpha", "beta", "gamma"],
      },
    ],
    total_count: 1,
    execution_time_ms: 1,
  };
}

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();

vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() => Promise.resolve([])),
  listMongoCollections: vi.fn(() => Promise.resolve([])),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: (...args: [string, string, string, unknown?]) =>
    findMock(...args),
  insertDocument: vi.fn(() => Promise.resolve({})),
  updateDocument: vi.fn(() => Promise.resolve()),
  deleteDocument: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  __resetDocumentStoreForTests();
  window.localStorage.clear();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
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

describe("DocumentDataGrid — nested inline tree (Sprint 341 Option D)", () => {
  it("mounts the toggle on sentinel cells (meta and tags), not on scalar cells", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "Expand meta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand tags" }),
    ).toBeInTheDocument();

    // Scalar cells have no Expand button.
    expect(screen.queryByRole("button", { name: "Expand name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand _id" })).toBeNull();
  });

  it("clicking the toggle expands the inline tree row, second click collapses", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const toggle = screen.getByRole("button", { name: "Expand meta" });
    fireEvent.click(toggle);
    expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-verified")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-role")).toBeInTheDocument();

    fireEvent.click(toggle); // now labelled "Close meta"
    expect(screen.queryByTestId("nested-detail-row-0")).not.toBeInTheDocument();
  });

  // Sprint 342 V2 feedback (2026-05-15) — sort/filter/refetch must
  // auto-close the inline tree panel. Without this, the panel either
  // dangles where the row used to be, or silently re-attaches to a
  // DIFFERENT doc that has slid into the same rowIdx — both are
  // confusing edits-go-to-the-wrong-row bugs. We snapshot `_id` at
  // expand-time and an effect compares it against `rows[rowIdx]._id`
  // whenever the query result changes.
  it("auto-closes the inline tree when the underlying row at rowIdx changes (e.g. sort)", async () => {
    const A = buildResult();
    const B: DocumentQueryResult = {
      ...A,
      rows: [
        [{ $oid: "b0000000000000000000000a" }, "Bob", "{...}", "[2 items]"],
      ],
      raw_documents: [
        {
          _id: { $oid: "b0000000000000000000000a" },
          name: "Bob",
          meta: { verified: false },
          tags: [],
        },
      ],
    };
    // First fetch returns Alice; sort triggers a second fetch that
    // returns Bob at the same rowIdx.
    findMock.mockResolvedValueOnce(A).mockResolvedValueOnce(B);
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
    expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();

    // Click the `name` column header — primary ASC sort. Forces a
    // refetch that resolves to B (different `_id` at the same rowIdx).
    const nameHeader = screen
      .getAllByRole("columnheader")
      .find((el) => el.textContent?.includes("name"));
    expect(nameHeader).toBeDefined();
    fireEvent.click(nameHeader!);

    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.queryByTestId("nested-detail-row-0")).not.toBeInTheDocument();
  });

  it("array sentinel toggle shows [i] index leaves", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Expand tags" }));
    expect(screen.getByTestId("tree-node-[0]")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-[2]")).toBeInTheDocument();
  });

  it("toggle click does not propagate row selection", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const row = screen.getByText("Alice").closest('[role="row"]')!;
    expect(row).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
    expect(row).toHaveAttribute("aria-selected", "false");
  });

  describe("inline edit on tree leaf", () => {
    it("Enter records the pendingEdit and surfaces the edited value", async () => {
      renderGrid();
      await waitFor(() =>
        expect(screen.getByText("Alice")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
      fireEvent.click(screen.getByTestId("tree-leaf-role"));
      const input = screen.getByTestId("tree-edit-role");
      fireEvent.change(input, { target: { value: '"owner"' } });
      fireEvent.keyDown(input, { key: "Enter" });

      // After commit the leaf renders the pending value (unquoted, since
      // the panel strips outer quotes for string leaves).
      await waitFor(() => {
        expect(screen.getByTestId("tree-leaf-role").textContent).toBe("owner");
      });
      expect(
        screen.getByTestId("document-tree-pending-pill").textContent,
      ).toMatch(/1 unsaved edit/);
    });

    it("MQL preview emits `$set: { 'meta.role': ... }` after the nested edit + Commit", async () => {
      renderGrid();
      await waitFor(() =>
        expect(screen.getByText("Alice")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
      fireEvent.click(screen.getByTestId("tree-leaf-role"));
      const input = screen.getByTestId("tree-edit-role");
      fireEvent.change(input, { target: { value: '"owner"' } });
      fireEvent.keyDown(input, { key: "Enter" });

      const commitBtn = await screen.findByRole("button", {
        name: /Commit changes/i,
      });
      fireEvent.click(commitBtn);

      const preview = await screen.findByRole("dialog");
      expect(preview).toHaveTextContent(/updateOne/);
      expect(preview).toHaveTextContent(/"meta\.role"/);
      expect(preview).toHaveTextContent(/"owner"/);
    });
  });
});
