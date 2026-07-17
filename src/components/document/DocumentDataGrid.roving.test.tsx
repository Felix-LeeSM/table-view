// Purpose: Document grid data-cell roving tabindex + 방향키 2D nav (Design-swarm
// follow-up #4 Phase 1) — 정확히 한 data cell 만 tab stop 이고, Arrow/Home/End 가
// focus + tabIndex=0 anchor 를 옮긴다. onFocus=state-only / keyboard=focus split
// 회귀 (SchemaTree focus-steal) 도 가드. (2026-07-01)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { useConnectionStore } from "@stores/connectionStore";
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
  // #1618 (D3) — supportsDocumentEditing is now fail-closed for an unknown
  // dbType, so seed the MongoDB connection this grid renders against to keep
  // cell editing enabled via the real capability.
  useConnectionStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [{ id: "conn-mongo", dbType: "mongodb" } as any],
  });
});

// rAF flush — useGridRoving.onKeyDown 이 `.focus()` 를 한 프레임 defer 한다.
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

/** data cell (row,col) 의 gridcell div — nested detail / empty-state 제외. */
function cell(grid: HTMLElement, row: number, col: number): HTMLElement {
  const el = grid.querySelector<HTMLElement>(
    `[data-grid-row="${row}"][data-grid-col="${col}"]`,
  );
  if (!el) throw new Error(`no data cell (${row},${col})`);
  return el;
}

describe("DocumentDataGrid roving tabindex (Design-swarm #4 Phase 1)", () => {
  // Reason: 초기엔 첫 data cell (0,0) 만 tab stop, 나머지는 -1 (2026-07-01)
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

  // Reason: ArrowRight → (0,1) focus + tabIndex 이동 (2026-07-01)
  it("ArrowRight moves focus + tabIndex to the next column", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());
    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowRight" });
    await flushRaf();

    expect(cell(grid, 0, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 0, 0)).toHaveAttribute("tabindex", "-1");
    expect(cell(grid, 0, 1)).toHaveFocus();
  });

  // Reason: ArrowDown → 같은 col, 다음 row (2026-07-01)
  it("ArrowDown moves focus down a row keeping the column", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 1).focus());
    fireEvent.keyDown(cell(grid, 0, 1), { key: "ArrowDown" });
    await flushRaf();

    expect(cell(grid, 1, 1)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 1, 1)).toHaveFocus();
  });

  // Reason: ArrowLeft 는 left edge 에서 clamp (no wrap). ArrowUp at row 0 은
  // #1127 로 header 진입으로 바뀌어 더 이상 clamp 하지 않는다 (별도 케이스). (2026-07-05)
  it("ArrowLeft clamps at the left edge (no wrap)", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());

    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowLeft" });
    await flushRaf();
    expect(cell(grid, 0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(grid, 0, 0)).toHaveFocus();
  });

  // Reason: #1127 AC1 — 공유 HeaderRow/useGridRoving 확장이 Document 그리드에도
  // 동일 적용된다: 최상단 row 에서 ArrowUp → 대응 컬럼 header 셀 진입. (2026-07-05)
  it("ArrowUp from the top data row enters the header cell (#1127)", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 0).focus());

    fireEvent.keyDown(cell(grid, 0, 0), { key: "ArrowUp" });
    await flushRaf();
    const headers = within(grid).getAllByRole("columnheader");
    expect(headers[0]).toHaveFocus();
  });

  // Reason: Home → 같은 row 첫 col, End → 마지막 col (2026-07-01)
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

  // Reason: focus-steal 회귀 가드 — cell onFocus 는 state 만 갱신하고 `.focus()`
  // 를 부르지 않아야 한다. 사용자가 cell 클릭 후 외부 input 으로 이동하면 stale
  // rAF 가 focus 를 도로 낚아채선 안 된다 (SchemaTree mariadb E2E 회귀). (2026-07-01)
  it("cell onFocus does not steal focus back on the next frame", async () => {
    const grid = await renderGrid();
    const external = document.createElement("input");
    document.body.appendChild(external);

    act(() => cell(grid, 0, 0).focus()); // onFocus → syncFocus (state only)
    act(() => external.focus()); // 사용자가 외부 컨트롤로 이동
    await flushRaf(); // stale rAF 가 grid 를 re-focus 하면 안 됨

    expect(external).toHaveFocus();
    expect(cell(grid, 0, 0)).not.toHaveFocus();
    external.remove();
  });

  // Reason: Phase 3 — Enter 로 focus 된 cell 편집 진입 (double-click 과 동일
  // 경로 handleStartEditCell). 편집 셀에 data-editing="true" + 값 input 등장. (2026-07-01)
  it("Enter on a focused cell starts editing", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 0, 1).focus());
    fireEvent.keyDown(cell(grid, 0, 1), { key: "Enter" });
    await waitFor(() =>
      expect(cell(grid, 0, 1)).toHaveAttribute("data-editing", "true"),
    );
  });

  // Reason: Phase 3 — F2 도 편집 진입 (스프레드시트 표준 키). (2026-07-01)
  it("F2 on a focused cell starts editing", async () => {
    const grid = await renderGrid();
    act(() => cell(grid, 1, 1).focus());
    fireEvent.keyDown(cell(grid, 1, 1), { key: "F2" });
    await waitFor(() =>
      expect(cell(grid, 1, 1)).toHaveAttribute("data-editing", "true"),
    );
  });
});
