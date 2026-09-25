// Purpose: keyboard-reach guard for Document grid row selection (issue
// #1130 AC2). Pressing Space on a focused cell selects that row, and the
// row reflects it as aria-selected="true". Row aria-selected exposure
// already existed — only the Space key path is added.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DocumentQueryResult } from "@/types/document";
import DocumentDataGrid from "./DocumentDataGrid";

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
