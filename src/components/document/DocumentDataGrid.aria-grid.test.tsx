// Sprint 260 (2026-05-11) — AC-260-03: DocumentDataGrid 의 ARIA grid roles
// integrity 가드. RDB DataGridTable.aria-grid.test.tsx 와 같은 형태.
//
// 검증 항목:
// - outer `<div role="grid">` 의 aria-rowcount / aria-colcount
// - header row 의 aria-rowindex={1}
// - body row 의 aria-rowindex 가 2 부터 연속
// - 각 cell `<div role="gridcell">` 의 aria-colindex 가 visual order 와 일치
//
// Document grid 는 column reorder 없음 → visual order == data order.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

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

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "uuid" },
      { name: "name", data_type: "string", category: "text" },
      { name: "tags", data_type: "array", category: "object" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "[3 items]"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob", "[0 items]"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        tags: ["a", "b", "c"],
      },
      { _id: { $oid: "65abcdef0123456789abcde0" }, name: "Bob", tags: [] },
    ],
    total_count: 2,
    execution_time_ms: 1,
  };
}

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
});

async function renderAndAwait() {
  render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="t"
      collection="users"
    />,
  );
  await waitFor(() => expect(screen.queryByRole("grid")).not.toBeNull());
}

describe("DocumentDataGrid ARIA grid roles (Sprint 260 AC-260-03)", () => {
  it("outer role=grid 가 aria-rowcount (1 + rows) + aria-colcount (cols) 를 노출", async () => {
    await renderAndAwait();
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "3"); // 1 header + 2 rows
    expect(grid).toHaveAttribute("aria-colcount", "3");
  });

  it("header row 가 aria-rowindex=1, body row 들이 2 부터 연속", async () => {
    await renderAndAwait();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    expect(rows[2]).toHaveAttribute("aria-rowindex", "3");
  });

  it("header columnheader 의 aria-colindex 가 visual order 1..N", async () => {
    await renderAndAwait();
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveAttribute("aria-colindex", "1");
    expect(headers[1]).toHaveAttribute("aria-colindex", "2");
    expect(headers[2]).toHaveAttribute("aria-colindex", "3");
    expect(headers[0]).toHaveTextContent("_id");
    expect(headers[1]).toHaveTextContent("name");
    expect(headers[2]).toHaveTextContent("tags");
  });

  it("body gridcell 들의 aria-colindex 가 visual order 1..N", async () => {
    await renderAndAwait();
    const rows = screen.getAllByRole("row");
    const firstBodyRow = rows[1]!;
    const cells = within(firstBodyRow).getAllByRole("gridcell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[1]).toHaveAttribute("aria-colindex", "2");
    expect(cells[2]).toHaveAttribute("aria-colindex", "3");
  });

  // Sprint 261 (2026-05-11) — bug fix: horizontal overflow 시 row 박스가
  // parent width 에서 끊겨 hover:bg-muted / border-b 가 잘리던 문제. 모든
  // row 가 min-width: max-content 으로 grid tracks 합만큼 늘어나야 한다.
  it("모든 row 가 min-width: max-content (horizontal overflow bg 회귀 가드)", async () => {
    await renderAndAwait();
    const rows = screen.getAllByRole("row");
    for (const r of rows) {
      expect((r as HTMLElement).style.minWidth).toBe("max-content");
    }
  });

  it("empty-state row 이 단일 role=gridcell + aria-colindex=1 노출", async () => {
    findMock.mockResolvedValue({
      ...buildResult(),
      rows: [],
      raw_documents: [],
      total_count: 0,
    });
    render(
      <DocumentDataGrid
        connectionId="conn-mongo"
        database="t"
        collection="users"
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("No documents")).not.toBeNull(),
    );

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2); // header + empty-state row
    const emptyRow = rows[1]!;
    const cells = within(emptyRow).getAllByRole("gridcell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[0]).toHaveTextContent("No documents");
  });
});
