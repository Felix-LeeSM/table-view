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
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { DocumentQueryResult } from "@/types/document";

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "unknown" },
      { name: "name", dataType: "string", category: "unknown" },
      { name: "meta", dataType: "document", category: "unknown" },
      { name: "tags", dataType: "array", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "{...}", "[3 items]"],
    ],
    rawDocuments: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        meta: { verified: true, role: "admin" },
        tags: ["alpha", "beta", "gamma"],
      },
    ],
    totalCount: 1,
    executionTimeMs: 1,
  };
}

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();
beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() => Promise.resolve([])),
    listMongoCollections: vi.fn(() => Promise.resolve([])),
    inferCollectionFields: vi.fn(() => Promise.resolve([])),
    findDocuments: (...args: [string, string, string, unknown?]) =>
      findMock(...args),
    insertDocument: vi.fn(() => Promise.resolve({})),
    updateDocument: vi.fn(() => Promise.resolve()),
    deleteDocument: vi.fn(() => Promise.resolve()),
  });
});

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
      rawDocuments: [
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

  // -----------------------------------------------------------------
  // Sprint 344 Slice F (2026-05-15) — end-to-end `+ key` add through
  // the Mongo grid: open the inline tree on an object cell, click the
  // `+ key` affordance, type a key/value pair, Enter, and assert that
  // (a) the ghost row appears with a NEW badge in the panel, and
  // (b) the MQL preview line emits `$set: { "<col>.<newkey>": <v> }`.
  //
  // Locks Slice E's central assumption: the panel's
  // `onCommitEdit("role", v)` for `meta` (col idx 2) materialises a
  // pendingEdit at key `"0-2:role"` (NOT `"0-2:meta.role"`), and the
  // mqlGenerator joins `col.name` with the per-cell path at emit time
  // to produce the `"meta.role"` dotted field.
  // -----------------------------------------------------------------
  describe("inline `+ key` add on tree object (AC-344-F-01)", () => {
    it("AC-344-F-01: `+ key` add on `meta` shows a NEW ghost row + MQL preview emits `$set: { 'meta.role': 'owner' }`", async () => {
      renderGrid();
      await waitFor(() =>
        expect(screen.getByText("Alice")).toBeInTheDocument(),
      );

      // Open the inline tree on the `meta` object cell.
      fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
      expect(screen.getByTestId("nested-detail-row-0")).toBeInTheDocument();

      // Click `+ key` on the root of the cell's tree (Slice B affordance).
      // The fixture's `meta` is `{ verified: true, role: "admin" }` — the
      // existing `role` would collide, so this test uses a non-colliding
      // key. The grid mounts the tree against a fresh `meta` whose
      // pre-existing keys are `verified` and `role` — we add a brand-new
      // key `team` here.
      fireEvent.click(screen.getByTestId("tree-add-key-__root"));

      // Type the key + value. Outer-quoted value → Slice D coerces to
      // string; bare value would coerce to a number/bool/null. Mongo
      // grid forwards the typed value through `tagBsonWrapper`-or-string
      // — string `"owner"` stays a plain pendingEdit string.
      const keyInput = screen.getByTestId("tree-add-key-input-__root");
      const valueInput = screen.getByTestId("tree-add-value-input-__root");
      fireEvent.change(keyInput, { target: { value: "team" } });
      fireEvent.change(valueInput, { target: { value: '"owner"' } });
      fireEvent.keyDown(valueInput, { key: "Enter" });

      // (a) Ghost row appears with NEW badge — Slice A's ghost render.
      await waitFor(() => {
        expect(screen.getByTestId("tree-node-team")).toBeInTheDocument();
      });
      const ghostRow = screen.getByTestId("tree-node-team");
      expect(ghostRow).toHaveTextContent("NEW");
      // Pending pill increments to "1 unsaved edit".
      expect(
        screen.getByTestId("document-tree-pending-pill").textContent,
      ).toMatch(/1 unsaved edit/);

      // (b) Commit → MQL preview emits the $set with the joined path.
      const commitBtn = await screen.findByRole("button", {
        name: /Commit changes/i,
      });
      fireEvent.click(commitBtn);
      const preview = await screen.findByRole("dialog");
      expect(preview).toHaveTextContent(/updateOne/);
      expect(preview).toHaveTextContent(/"meta\.team"/);
      expect(preview).toHaveTextContent(/"owner"/);
    });

    // AC-344-F-04 (2026-05-15) — root-level `_id` add is rejected by
    // the Mongo grid's `forbiddenRootKeys` prop. Verifies the wire-up
    // by mounting the Mongo grid (not the panel alone) and confirming
    // (a) the inline rejection UX surfaces, (b) the pending pill does
    // not increment, and (c) no Commit button appears (no pending
    // edits were recorded). The same prop is omitted for the RDB grid
    // (see DataGrid.lifecycle.test.tsx) so DocumentTreePanel stays
    // paradigm-agnostic.
    it("AC-344-F-04: Mongo grid rejects `_id` root add via forbiddenRootKeys", async () => {
      renderGrid();
      await waitFor(() =>
        expect(screen.getByText("Alice")).toBeInTheDocument(),
      );

      // The root document cell isn't a tree panel — but the inline tree
      // panel mounts on the `meta` object cell. For the Mongo guard,
      // root-level means the **document root** of the panel's view —
      // i.e. the root of `meta`'s tree. Open `meta` and try to add
      // `_id` at its root.
      fireEvent.click(screen.getByRole("button", { name: "Expand meta" }));
      fireEvent.click(screen.getByTestId("tree-add-key-__root"));

      const keyInput = screen.getByTestId("tree-add-key-input-__root");
      const valueInput = screen.getByTestId("tree-add-value-input-__root");
      fireEvent.change(keyInput, { target: { value: "_id" } });
      fireEvent.change(valueInput, { target: { value: '"x"' } });
      fireEvent.keyDown(valueInput, { key: "Enter" });

      // Rejection: aria-invalid + inline message; no pending pill, no
      // Commit button. The inputs stay open so the user can correct
      // the key.
      expect(keyInput).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText(/cannot be added to the document root/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("document-tree-pending-pill"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Commit changes/i }),
      ).not.toBeInTheDocument();
    });
  });
});
