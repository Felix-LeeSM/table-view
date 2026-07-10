// Issue #1442 — SQL 탭 read-only 결과 그리드 가상화 회귀 가드.
// DataGridTable.virtualization.test.tsx 와 동형: jsdom 은 모든 요소의
// offsetWidth/offsetHeight 를 0 으로 보고해 @tanstack/react-virtual 이
// viewport 없음으로 판단하므로, prototype 패치로 viewport 를 세워
// getVirtualItems() 가 안정적인 window 를 반환하게 한다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryResultTable } from "./QueryResultTable";
import type { QueryResult } from "@/types/query";

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

// jsdom 은 layout 이 없어 scrollTop 세팅과 element.scrollTo 가 no-op 이다.
// 컨테이너 인스턴스에 직접 배선해 (1) 사용자 스크롤 = scrollTop 세팅 + scroll
// event, (2) virtualizer 의 scrollToIndex → element.scrollTo 호출을 둘 다
// 관측 가능하게 한다 (#1477 review B2 회귀 가드).
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

describe("QueryResultTable virtualization (#1442)", () => {
  beforeEach(() => {
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
    render(<QueryResultTable result={makeResult(1000)} />);
    const rows = screen.getAllByRole("row");
    // 1 header + virtual window (≈ 19 visible + 24 overscan) ≤ 101.
    expect(rows.length).toBeLessThanOrEqual(101);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("keeps aria-rowcount at 1 (header) + total rows while virtualized", () => {
    render(<QueryResultTable result={makeResult(1000)} />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
  });

  it("first virtual row carries aria-rowindex=2 (header is row 1)", () => {
    render(<QueryResultTable result={makeResult(1000)} />);
    const rows = screen.getAllByRole("row");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("threshold boundary — exactly 200 rows renders every body row", () => {
    render(<QueryResultTable result={makeResult(200)} />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(201);
    expect(rows[200]).toHaveAttribute("aria-rowindex", "201");
  });

  it("threshold boundary — 201 rows enters the virtualized branch", () => {
    render(<QueryResultTable result={makeResult(201)} />);
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThan(202);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("truncated (row-cap hit) result still renders a bounded window", () => {
    // 캡 도달 결과 = 정확히 캡 크기의 rows + truncated 플래그. 배너는
    // QueryResultGrid.rowcap-banner.test.tsx 가 가드하고, 여기서는 잘린
    // 대용량 결과도 DOM 폭증 없이 그려지는지 경계를 고정한다.
    const result = { ...makeResult(1000), truncated: true };
    render(<QueryResultTable result={result} />);
    expect(screen.getAllByRole("row").length).toBeLessThanOrEqual(101);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
  });

  // #1477 review B2 — 같은 SQL 재조회(새 result identity)는 스크롤을 보존하고,
  // 다른 SQL 이 실행됐을 때만 top 으로 리셋한다 (DataGridTable #1369 동일).
  it("B2 — same-SQL refetch (new result identity) preserves scroll position", () => {
    const sql = "SELECT * FROM t";
    const { rerender } = render(
      <QueryResultTable result={makeResult(1000)} sql={sql} />,
    );
    const grid = screen.getByRole("grid");
    wireScrollable(grid);
    scrollContainerTo(grid, 12800);
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    rerender(<QueryResultTable result={makeResult(1000)} sql={sql} />);
    expect(firstBodyRowIndex()).toBeGreaterThan(2);
  });

  it("B2 — a different executed SQL resets scroll to the top", () => {
    const { rerender } = render(
      <QueryResultTable result={makeResult(1000)} sql="SELECT * FROM t" />,
    );
    const grid = screen.getByRole("grid");
    wireScrollable(grid);
    scrollContainerTo(grid, 12800);
    expect(firstBodyRowIndex()).toBeGreaterThan(2);

    rerender(
      <QueryResultTable result={makeResult(1000)} sql="SELECT * FROM t2" />,
    );
    expect(firstBodyRowIndex()).toBe(2);
  });
});
