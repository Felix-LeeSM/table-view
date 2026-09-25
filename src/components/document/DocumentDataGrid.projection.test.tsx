// DocumentDataGrid projection wire-up integration.
//
// Reason: regression guard that ProjectionDialog's Apply (a) flows into
// the `projection` of the `findDocuments` body, and (b) Clear / an empty
// projection is dropped from the body. ProjectionDialog.test.tsx guards
// the dialog's own behaviour.

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
      { name: "age", dataType: "int32", category: "unknown" },
    ],
    rows: [[{ $oid: "65abcdef0123456789abcdef" }, "Alice", 30]],
    rawDocuments: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        age: 30,
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

describe("DocumentDataGrid — Slice H projection wire-up (Sprint 325)", () => {
  it("opens the projection dialog from the toolbar trigger", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Field projection"));
    expect(screen.getByText(/Field projection/i)).toBeInTheDocument();
  });

  it("Apply with `{ name: 1 }` re-fetches with projection in the find body", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    findMock.mockClear();
    fireEvent.click(screen.getByLabelText("Field projection"));
    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    await waitFor(() => {
      expect(findMock).toHaveBeenCalled();
      const body = findMock.mock.calls[findMock.mock.calls.length - 1]?.[3] as
        | { projection?: Record<string, unknown> }
        | undefined;
      expect(body?.projection).toEqual({ name: 1 });
    });
  });

  it("Clear removes the projection from the find body", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Apply first
    fireEvent.click(screen.getByLabelText("Field projection"));
    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    await waitFor(() => {
      const body = findMock.mock.calls[findMock.mock.calls.length - 1]?.[3] as
        | { projection?: Record<string, unknown> }
        | undefined;
      expect(body?.projection).toEqual({ name: 1 });
    });

    findMock.mockClear();
    // Reopen and Clear
    fireEvent.click(screen.getByLabelText("Field projection"));
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));

    await waitFor(() => {
      expect(findMock).toHaveBeenCalled();
      const body = findMock.mock.calls[findMock.mock.calls.length - 1]?.[3] as
        | { projection?: Record<string, unknown> }
        | undefined;
      expect(body?.projection).toBeUndefined();
    });
  });
});
