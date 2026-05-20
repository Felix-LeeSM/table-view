// Sprint 320 (2026-05-15) — Slice E.2: DocumentDataGrid schema
// accumulator wire-up.
//
// 작성 이유: schemaless collection 에서 페이지/필터/소트 가 바뀌어도
// grid 의 column 헤더가 흔들리지 않고, 새 field 가 등장하면 누적되며,
// 누락된 field 의 cell 은 NULL chip 으로 표시되는지를 회귀 가드. 또
// collection 전환시 accumulator 가 자동 reset (sprint 319 D-43) 하여
// 다른 collection 의 schema 가 leak 되지 않는지 단언.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { DocumentQueryResult } from "@/types/document";

function buildPage1(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "unknown" },
      { name: "name", dataType: "string", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob"],
    ],
    rawDocuments: [
      { _id: { $oid: "65abcdef0123456789abcdef" }, name: "Alice" },
      { _id: { $oid: "65abcdef0123456789abcde0" }, name: "Bob" },
    ],
    totalCount: 700,
    executionTimeMs: 2,
  };
}

function buildPage2(): DocumentQueryResult {
  // Different field set — backend page 2 sample surfaces `email` and
  // `score` but drops `name`. accumulator must keep `name` from page 1.
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "unknown" },
      { name: "email", dataType: "string", category: "unknown" },
      { name: "score", dataType: "int", category: "unknown" },
    ],
    rows: [[{ $oid: "65abcdef0123456789abcde1" }, "carol@example.com", 42]],
    rawDocuments: [
      {
        _id: { $oid: "65abcdef0123456789abcde1" },
        email: "carol@example.com",
        score: 42,
      },
    ],
    totalCount: 700,
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
});

function renderGrid(props?: { collection?: string }) {
  return render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="table_view_test"
      collection={props?.collection ?? "users"}
    />,
  );
}

describe("DocumentDataGrid — schema accumulator (Sprint 320 E.2)", () => {
  it("renders the columns from the first fetch alphabetically (with _id pinned)", async () => {
    findMock.mockResolvedValue(buildPage1());
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // _id always first; the rest case-insensitive alphabetical.
    expect(screen.getByTitle("Sort by _id")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();
  });

  it("accumulates new fields across pages and never drops earlier ones", async () => {
    // First fetch (any skip) → page 1; subsequent (skip > 0) → page 2.
    findMock.mockImplementation(
      async (_c: string, _db: string, _col: string, body?: unknown) => {
        const b = body as { skip?: number } | undefined;
        if (b && (b.skip ?? 0) > 0) return buildPage2();
        return buildPage1();
      },
    );

    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Next page"));

    await waitFor(() =>
      expect(screen.getByText("carol@example.com")).toBeInTheDocument(),
    );

    // After page 2 fetch: accumulated columns must include `_id`, `email`,
    // `name`, `score`.
    expect(screen.getByTitle("Sort by _id")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by email")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();
    expect(screen.getByTitle("Sort by score")).toBeInTheDocument();
  });

  it("renders 'null' chips for accumulated fields missing in the current page", async () => {
    findMock.mockImplementation(
      async (_c: string, _db: string, _col: string, body?: unknown) => {
        const b = body as { skip?: number } | undefined;
        if (b && (b.skip ?? 0) > 0) return buildPage2();
        return buildPage1();
      },
    );

    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Next page"));
    await waitFor(() =>
      expect(screen.getByText("carol@example.com")).toBeInTheDocument(),
    );

    // The single page-2 row should render `null` chips for the
    // accumulated `name` column (absent from page 2 backend columns).
    // Default null cell content is the lowercase italic "null".
    const nullCells = screen.getAllByText("null");
    expect(nullCells.length).toBeGreaterThanOrEqual(1);
  });

  it("resets the accumulator when the collection changes (no leak across collections)", async () => {
    findMock.mockResolvedValue(buildPage1());
    const { rerender } = renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByTitle("Sort by name")).toBeInTheDocument();

    // Switch to a different collection. The accumulator's auto-reset
    // (sprint 319 D-43) must wipe `name` so it doesn't leak. Use a
    // backend that only returns `_id` + `email` for the new collection.
    findMock.mockResolvedValue({
      columns: [
        { name: "_id", dataType: "ObjectId", category: "unknown" },
        { name: "email", dataType: "string", category: "unknown" },
      ],
      rows: [[{ $oid: "ff0000" }, "x@example.com"]],
      rawDocuments: [{ _id: { $oid: "ff0000" }, email: "x@example.com" }],
      totalCount: 1,
      executionTimeMs: 1,
    });

    rerender(
      <DocumentDataGrid
        connectionId="conn-mongo"
        database="table_view_test"
        collection="orders"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("x@example.com")).toBeInTheDocument(),
    );

    expect(screen.queryByTitle("Sort by name")).toBeNull();
    expect(screen.getByTitle("Sort by email")).toBeInTheDocument();
  });

  it("keeps the first-seen type for a field even when a later page disagrees", async () => {
    // Page 1 reports `score` as int; page 2 reports it as string. The
    // accumulator must keep `int` (sprint 319 D-45 first-wins).
    const page1WithScore: DocumentQueryResult = {
      ...buildPage1(),
      columns: [
        { name: "_id", dataType: "ObjectId", category: "unknown" },
        { name: "score", dataType: "int", category: "unknown" },
      ],
      rows: [[{ $oid: "65abcdef0123456789abcdef" }, 100]],
      rawDocuments: [{ _id: { $oid: "65abcdef0123456789abcdef" }, score: 100 }],
    };
    const page2WithScoreAsString: DocumentQueryResult = {
      ...buildPage2(),
      columns: [
        { name: "_id", dataType: "ObjectId", category: "unknown" },
        { name: "score", dataType: "string", category: "unknown" },
      ],
      rows: [[{ $oid: "65abcdef0123456789abcde1" }, "high"]],
      rawDocuments: [
        { _id: { $oid: "65abcdef0123456789abcde1" }, score: "high" },
      ],
    };
    findMock.mockImplementation(
      async (_c: string, _db: string, _col: string, body?: unknown) => {
        const b = body as { skip?: number } | undefined;
        if (b && (b.skip ?? 0) > 0) return page2WithScoreAsString;
        return page1WithScore;
      },
    );

    renderGrid();
    await waitFor(() => {
      // Page 1 — both score column type subtitles `int` and the
      // cell `100` render.
      expect(screen.getByText("100")).toBeInTheDocument();
    });
    const scoreHeader = screen.getByTitle("Sort by score");
    expect(scoreHeader.textContent).toContain("int");

    fireEvent.click(screen.getByLabelText("Next page"));
    await waitFor(() => expect(screen.getByText("high")).toBeInTheDocument());

    // After page 2 the column type must still be `int` (first-wins).
    expect(screen.getByTitle("Sort by score").textContent).toContain("int");
    expect(screen.getByTitle("Sort by score").textContent).not.toContain(
      "string",
    );
  });
});
