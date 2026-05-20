// Sprint 315 (2026-05-15) — Slice C.1 multi-column sort wire-up.
//
// 작성 이유: Mongo DocumentDataGrid 가 RDB DataGrid 의 sort mechanic
// (click cycle, shift+click multi-key) 을 1:1 복제해야 하고, 결과로
// `findDocuments` IPC 의 body 가 Mongo `sort` shape (`{ field: 1|-1 }`)
// 으로 흘러가는지 회귀 가드. 본 spec 은 (a) header click → primary
// ASC, (b) 같은 column click → DESC, (c) 다시 click → clear,
// (d) shift+click → secondary 추가 4 경로를 lock.

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
      { name: "age", dataType: "int32", category: "int" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", 30],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob", 25],
    ],
    rawDocuments: [
      { _id: { $oid: "65abcdef0123456789abcdef" }, name: "Alice", age: 30 },
      { _id: { $oid: "65abcdef0123456789abcde0" }, name: "Bob", age: 25 },
    ],
    totalCount: 2,
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

function lastFindBody(): { sort?: Record<string, number> } {
  const calls = findMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const lastCall = calls[calls.length - 1]!;
  return lastCall[3] as { sort?: Record<string, number> };
}

describe("DocumentDataGrid sort (Sprint 315)", () => {
  it("does not send a sort field on initial fetch (no rows clicked)", async () => {
    renderGrid();
    await waitFor(() => expect(findMock).toHaveBeenCalled());
    const body = lastFindBody();
    expect(body.sort).toBeUndefined();
  });

  it("primary click on a column header dispatches a find with sort=ASC", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const header = screen.getByRole("columnheader", { name: /name/ });
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    fireEvent.click(header, { clientX: 0, clientY: 0 });

    await waitFor(() => {
      const body = lastFindBody();
      expect(body.sort).toEqual({ name: 1 });
    });
  });

  it("second click on the same header toggles ASC → DESC", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const header = screen.getByRole("columnheader", { name: /name/ });
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    fireEvent.click(header, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(lastFindBody().sort).toEqual({ name: 1 }));

    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    fireEvent.click(header, { clientX: 0, clientY: 0 });
    await waitFor(() => expect(lastFindBody().sort).toEqual({ name: -1 }));
  });

  it("third click on the same header clears the sort", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const header = screen.getByRole("columnheader", { name: /name/ });
    for (let i = 0; i < 3; i += 1) {
      fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
      fireEvent.click(header, { clientX: 0, clientY: 0 });
    }
    await waitFor(() => {
      expect(lastFindBody().sort).toBeUndefined();
    });
  });

  it("shift+click on a second header adds a secondary sort key (insertion order priority)", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const nameHeader = screen.getByRole("columnheader", { name: /name/ });
    fireEvent.mouseDown(nameHeader, { clientX: 0, clientY: 0 });
    fireEvent.click(nameHeader, { clientX: 0, clientY: 0 });

    const ageHeader = screen.getByRole("columnheader", { name: /age/ });
    fireEvent.mouseDown(ageHeader, { clientX: 0, clientY: 0 });
    fireEvent.click(ageHeader, { clientX: 0, clientY: 0, shiftKey: true });

    await waitFor(() => {
      const body = lastFindBody();
      expect(body.sort).toEqual({ name: 1, age: 1 });
    });
  });

  it("renders ▲ indicator on the sorted column header", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const header = screen.getByRole("columnheader", { name: /name/ });
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 });
    fireEvent.click(header, { clientX: 0, clientY: 0 });

    await waitFor(() => {
      expect(header.textContent).toMatch(/▲/);
    });
  });
});
