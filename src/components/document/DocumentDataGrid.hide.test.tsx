// Mongo DataGrid hide column.
//
// Reason: locks the `useHiddenColumns` + `HeaderRow.onHideColumn` wire-up
// at grid level — (a) a hidden column disappears from both header and
// rows, (b) the badge + Show all expose and restore it, and (c) nothing is
// read from or written to the `hidden-columns:document:<db>:<coll>`
// localStorage key.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DocumentQueryResult } from "@/types/document";
import DocumentDataGrid from "./DocumentDataGrid";

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "unknown" },
      { name: "name", dataType: "string", category: "unknown" },
      { name: "email", dataType: "string", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "alice@example.com"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob", "bob@example.com"],
    ],
    rawDocuments: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        email: "alice@example.com",
      },
      {
        _id: { $oid: "65abcdef0123456789abcde0" },
        name: "Bob",
        email: "bob@example.com",
      },
    ],
    totalCount: 2,
    executionTimeMs: 2,
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

function getHeader(columnName: string) {
  return screen.getByTitle(`Sort by ${columnName}`);
}

function queryHeader(columnName: string) {
  return screen.queryByTitle(`Sort by ${columnName}`);
}

function rightClickHeader(columnName: string) {
  const header = getHeader(columnName);
  fireEvent.contextMenu(header);
  return header;
}

describe("DocumentDataGrid — hide column (Sprint 317 D.1)", () => {
  it("renders no badge initially and shows all three columns", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // No hidden columns → no badge mounted.
    expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();

    // All three headers present.
    expect(getHeader("_id")).toBeInTheDocument();
    expect(getHeader("name")).toBeInTheDocument();
    expect(getHeader("email")).toBeInTheDocument();
  });

  it("Hide column removes the column from header AND row cells, surfaces a badge", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));

    // email column header should disappear from the grid.
    await waitFor(() => {
      expect(queryHeader("email")).toBeNull();
    });

    // Row cells previously holding email values are gone too.
    expect(screen.queryByText("alice@example.com")).toBeNull();
    expect(screen.queryByText("bob@example.com")).toBeNull();

    // But the remaining columns and their rows survive.
    expect(getHeader("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();

    // Badge appears.
    const badge = await screen.findByLabelText("Hidden columns badge");
    expect(badge).toHaveTextContent("1 column hidden");
  });

  it("Sprint 369: Hide column never writes hidden-columns:* localStorage (IPC SOT)", async () => {
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));

    // Badge appears — UI-level mutation is what users see.
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "1 column hidden",
      ),
    );
    expect(
      window.localStorage.getItem(
        "hidden-columns:document:table_view_test:users",
      ),
    ).toBeNull();
    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("Show all clears every hidden column and removes the badge", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Hide two columns.
    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "1 column hidden",
      ),
    );
    rightClickHeader("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "2 columns hidden",
      ),
    );

    // Show all.
    fireEvent.click(
      screen.getByRole("button", { name: "Show all hidden columns" }),
    );

    // Badge disappears, columns return.
    await waitFor(() => {
      expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
    });
    expect(getHeader("name")).toBeInTheDocument();
    expect(getHeader("email")).toBeInTheDocument();

    // localStorage entry is wiped (D-37).
    expect(
      window.localStorage.getItem(
        "hidden-columns:document:table_view_test:users",
      ),
    ).toBeNull();
  });

  // Hydration on mount is handled by the `get_datagrid_prefs` IPC. In this
  // test's jsdom environment there is no backend (no invoke mock), so no
  // IPC response arrives and hydration is always empty. The detailed IPC
  // contract is locked by `src/hooks/useHiddenColumns.test.ts` — here only
  // the absence of the legacy LS entry is checked as an invariant.
  it("Sprint 369: legacy hidden-columns:* LS 값 무시 (LS 영속 폐기)", async () => {
    window.localStorage.setItem(
      "hidden-columns:document:table_view_test:users",
      JSON.stringify(["email"]),
    );

    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // email is no longer hydrated from LS, so its header must be visible.
    expect(queryHeader("email")).not.toBeNull();
    expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
  });
});
