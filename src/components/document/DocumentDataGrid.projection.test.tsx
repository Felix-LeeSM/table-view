// Sprint 325 (2026-05-15) — Slice H: DocumentDataGrid wire-up 통합.
//
// 작성 이유: ProjectionDialog 의 Apply 가 (a) `findDocuments` body 의
// `projection` 으로 흘러가고 (b) Clear / 빈 projection 은 body 에서
// 제거되는지를 회귀 가드. dialog 자체 동작은 ProjectionDialog.test.tsx
// 가 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "unknown" },
      { name: "name", data_type: "string", category: "unknown" },
      { name: "age", data_type: "int32", category: "unknown" },
    ],
    rows: [[{ $oid: "65abcdef0123456789abcdef" }, "Alice", 30]],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        age: 30,
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
