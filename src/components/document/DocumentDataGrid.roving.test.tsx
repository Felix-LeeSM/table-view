// Purpose: Document grid data-cell roving tabindex + arrow-key 2D nav —
// exactly one data cell is a tab stop, and Arrow/Home/End move focus plus
// the tabIndex=0 anchor. Also guards the onFocus=state-only /
// keyboard=focus split regression (SchemaTree focus-steal).

import { useConnectionStore } from "@stores/connectionStore";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  // #1618 (D3) — supportsDocumentEditing is now fail-closed for an unknown
  // dbType, so seed the MongoDB connection this grid renders against to keep
  // cell editing enabled via the real capability.
  useConnectionStore.setState({
    connections: [{ id: "conn-mongo", dbType: "mongodb" } as any],
  });
});

// rAF flush — `useGridRoving.onKeyDown` defers `.focus()` by one frame.
function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

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

/** Gridcell div at data cell (row,col); skips nested detail / empty-state. */
function cell(grid: HTMLElement, row: number, col: number): HTMLElement {
  const el = grid.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DocumentDataGrid roving tabindex (Design-swarm #4 Phase 1)", () => {
  // Reason: initially only data cell (0,0) is a tab stop; the rest are -1
  it("initially only the first data cell is a tab stop", async () => {
    const grid = await renderGrid();
    expect(cell(grid, 0, 0)).toHaveAttribute("tabindex", "0");
    for (const [r, c] of [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ] as const) {
      expect(cell(grid, r, c)).toHaveAttribute("tabindex", "-1");
    }
  });

  // Reason: ArrowRight → focus + tabIndex move to (0,1)
  it("ArrowRight moves focus + tabIndex to the next column", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());
    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowRight" });
    await flushRaf();

    expect(cell(grid, 0, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 0, 0)).toHaveAttribute("tabindex", "-1");
    expect(cell(grid, 0, 1)).toHaveFocus();
  });

  // Reason: ArrowDown → same col, next row
  it("ArrowDown moves focus down a row keeping the column", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 1).focus());
    fireEvent.keyDown(cell(grid, 0, 1), { key: "ArrowDown" });
    await flushRaf();

    expect(cell(grid, 1, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 1, 1)).toHaveFocus();
  });

  // Reason: ArrowLeft clamps at the left edge (no wrap). ArrowUp at row 0
  // enters the header per #1127 and no longer clamps (separate case).
  it("ArrowLeft clamps at the left edge (no wrap)", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());

    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowLeft" });
    await flushRaf();
    expect(cell(grid, 0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 0, 0)).toHaveFocus();
  });

  // Reason: #1127 AC1 — the shared HeaderRow/useGridRoving extension applies
  // to the Document grid too: ArrowUp on the top row enters the matching
  // column header cell.
  it("ArrowUp from the top data row enters the header cell (#1127)", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());

    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowUp" });
    await flushRaf();
    const headers = within(grid).getAllByRole("columnheader");
    expect(headers[0]).toHaveFocus();
  });

  // Reason: Home → first col of the same row, End → last col
  it("Home/End jump to first/last column of the row", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 1, 1).focus());

    fireEvent.keyDown(cell(grid, 1, 1), { key: "End" });
    await flushRaf();
    expect(cell(grid, 1, 2)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 1, 2)).toHaveFocus();

    fireEvent.keyDown(cell(grid, 1, 2), { key: "Home" });
    await flushRaf();
    expect(cell(grid, 1, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 1, 0)).toHaveFocus();
  });

  // Reason: focus-steal regression guard — cell onFocus must only update
  // state and must not call `.focus()`. After the user clicks a cell and
  // moves to an outside input, a stale rAF must not grab focus back
  // (SchemaTree mariadb E2E regression).
  it("cell onFocus does not steal focus back on the next frame", async () => {
    const grid = await renderGrid();
    const external = document.createElement("input");
    document.body.appendChild(external);

    act(() => cell(grid, 0, 0).focus()); // onFocus → syncFocus (state only)
    act(() => external.focus()); // user moves to an outside control
    await flushRaf(); // a stale rAF must not re-focus the grid

    expect(external).toHaveFocus();
    expect(cell(grid, 0, 0)).not.toHaveFocus();
    external.remove();
  });

  // Reason: Enter starts editing on the focused cell (same path as
  // double-click, `handleStartEditCell`). The editing cell gets
  // data-editing="true" plus a value input.
  it("Enter on a focused cell starts editing", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 1).focus());
    fireEvent.keyDown(cell(grid, 0, 1), { key: "Enter" });
    await waitFor(() =>
      expect(cell(grid, 0, 1)).toHaveAttribute("data-editing", "true"),
    );
  });

  // Reason: F2 also starts editing (the spreadsheet-standard key).
  it("F2 on a focused cell starts editing", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 1, 1).focus());
    fireEvent.keyDown(cell(grid, 1, 1), { key: "F2" });
    await waitFor(() =>
      expect(cell(grid, 1, 1)).toHaveAttribute("data-editing", "true"),
    );
  });
});
