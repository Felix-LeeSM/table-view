// Issue #1442 — SQL 탭 editable 결과 그리드 가상화 회귀 가드.
// QueryResultTable.virtualization.test.tsx / DataGridTable.virtualization.
// test.tsx 와 동형. jsdom viewport 패치 사유는 그쪽 헤더 참고.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, fireEvent } from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

const VIEWPORT_HEIGHT = 600;

function makeResult(rowCount: number): QueryResult {
  return {
    columns: [
      { name: "id", dataType: "integer", category: "int" },
      { name: "name", dataType: "text", category: "text" },
    ],
    rows: Array.from({ length: rowCount }, (_, i) => [i, `name-${i}`]),
    totalCount: rowCount,
    executionTimeMs: 1,
    queryType: "select",
  };
}

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

// jsdom 은 layout 이 없어 scrollTop 세팅과 element.scrollTo 가 no-op 이다.
// 컨테이너 인스턴스에 직접 배선해 (1) 사용자 스크롤 = scrollTop 세팅 + scroll
// event, (2) virtualizer 의 scrollToIndex → element.scrollTo 호출을 둘 다
// 관측 가능하게 한다 (#1477 review B1/B2 회귀 가드).
function wireScrollable(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0,
  });
  container.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    (container as unknown as { scrollTop: number }).scrollTop = top;
    fireEvent.scroll(container);
  }) as typeof container.scrollTo;
}

function scrollContainerTo(container: HTMLElement, top: number) {
  (container as unknown as { scrollTop: number }).scrollTop = top;
  fireEvent.scroll(container);
}

function firstBodyRowIndex(): number {
  return Number(screen.getAllByRole("row")[1]!.getAttribute("aria-rowindex"));
}

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("EditableQueryResultGrid virtualization (#1442)", () => {
  beforeEach(() => {
    setupTauriMock({
      executeQuery: vi.fn(async () => ({})),
      executeQueryBatch: vi.fn(async () => []),
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: VIEWPORT_HEIGHT,
        width: 800,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("renders a bounded row window when rows exceed the threshold (1000)", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThanOrEqual(101);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("keeps aria-rowcount at 1 (header) + total rows while virtualized", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
  });

  it("first virtual row carries aria-rowindex=2 (header is row 1)", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("threshold boundary — exactly 200 rows renders every body row", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(200)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(201);
    expect(rows[200]).toHaveAttribute("aria-rowindex", "201");
  });

  it("threshold boundary — 201 rows enters the virtualized branch", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(201)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThan(202);
    expect(rows.length).toBeGreaterThan(1);
  });

  // #1477 review B1 — 편집 input 이 가상 window 밖 unmount 후 remount 될 때
  // focus 를 다시 훔치면 안 된다 (DataGridTable 의 effect-keyed focus 계약).
  it("B1 — remounting the editing row does not steal focus back to the input", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const grid = screen.getByRole("grid");
    wireScrollable(grid);

    const cell = grid.querySelector('[data-grid-row="0"][data-grid-col="1"]')!;
    fireEvent.doubleClick(cell);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    // 편집 시작 시에는 focus 가 input 으로 간다 (edit-start effect).
    expect(input).toHaveFocus();

    // 편집 행을 window 밖으로 — input unmount, focus 는 body 로 떨어진다.
    scrollContainerTo(grid, 12800);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    // 복귀 — 편집 상태(값)는 복원되지만 focus 를 다시 훔치지 않는다.
    scrollContainerTo(grid, 0);
    const restored = screen.getByRole<HTMLInputElement>("textbox");
    expect(restored).toHaveValue("name-0");
    expect(restored).not.toHaveFocus();
  });

  // #1477 review B2 — commit 후 재조회(onAfterCommit)는 같은 SQL 로 result
  // identity 만 바뀐다. 스크롤을 보존해야 한다 (DataGridTable #1369 동일).
  it("B2 — same-SQL refetch (new result identity) preserves scroll position", () => {
    const sql = "SELECT * FROM users";
    const { rerender } = render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
        sql={sql}
      />,
    );
    const grid = screen.getByRole("grid");
    wireScrollable(grid);
    scrollContainerTo(grid, 12800);
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    rerender(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
        sql={sql}
      />,
    );
    expect(firstBodyRowIndex()).toBeGreaterThan(2);
  });

  it("B2 — a different executed SQL resets scroll to the top", () => {
    const { rerender } = render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
        sql="SELECT * FROM users"
      />,
    );
    const grid = screen.getByRole("grid");
    wireScrollable(grid);
    scrollContainerTo(grid, 12800);
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    rerender(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
        sql="SELECT * FROM users WHERE id > 1"
      />,
    );
    expect(firstBodyRowIndex()).toBe(2);
  });
});
