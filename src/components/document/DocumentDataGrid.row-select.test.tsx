// Purpose: Document 그리드 행 선택 키보드 도달 가드 (issue #1130 AC2). focus 된
// 셀에서 Space 로 행을 선택하면 그 행이 aria-selected="true" 로 반영된다. row
// aria-selected 노출은 이미 존재 — Space 키 경로만 추가한다. (2026-07-03)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { DocumentQueryResult } from "@/types/document";

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

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "uuid" },
      { name: "name", dataType: "string", category: "text" },
      { name: "age", dataType: "int", category: "int" },
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

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
});

async function renderGrid() {
  render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="t"
      collection="users"
    />,
  );
  const grid = await screen.findByRole("grid");
  await waitFor(() =>
    expect(grid.querySelector("[data-grid-row]")).not.toBeNull(),
  );
  return grid;
}

function cell(grid: HTMLElement, row: number, col: number): HTMLElement {
  const el = grid.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DocumentDataGrid row selection a11y (issue #1130 AC2)", () => {
  it("Space on a focused cell selects the row (aria-selected=true)", async () => {
    const grid = await renderGrid();
    const row1 = cell(grid, 1, 0).closest('[role="row"]')!;
    expect(row1).toHaveAttribute("aria-selected", "false");

    act(() => cell(grid, 1, 0).focus());
    fireEvent.keyDown(cell(grid, 1, 0), { key: " " });

    await waitFor(() =>
      expect(cell(grid, 1, 0).closest('[role="row"]')).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });
});
