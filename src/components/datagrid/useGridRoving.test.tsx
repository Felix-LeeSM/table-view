// Purpose: useGridRoving 훅 단위 테스트 (Design-swarm #4 Phase 2). 실제
// react-virtual 없이 손으로 만든 container DOM 으로 결정적으로 검증한다.
// 커버: (1) 보이는 row 방향키 이동은 scrollRowIntoView 를 부르지 않는다,
// (2) virtualization sync — off-DOM row 로 이동 시 scrollRowIntoView 로
// row 를 render 시킨 뒤 focus 가 새 cell 에 안착, (3) edge clamp. (2026-07-01)

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useGridRoving } from "./useGridRoving";

// rAF 를 N 프레임 flush. onKeyDown → focusCell 이 `.focus()` 를 프레임 단위로
// defer 하고, virtualization miss 시 최대 MAX_FOCUS_FRAMES 재시도한다.
async function flushRaf(frames = 8) {
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

/** data cell div (row, col). tabindex 는 -1 로 시작 (roving 이 갱신). */
function makeCell(row: number, col: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-grid-row", String(row));
  el.setAttribute("data-grid-col", String(col));
  el.tabIndex = -1;
  return el;
}

describe("useGridRoving (Design-swarm #4 Phase 2)", () => {
  // Reason: 모든 cell 이 DOM 에 있는 non-virtualized 경로에선 ArrowDown 이
  // 바로 다음 row cell 로 focus 를 옮기고 scroll 콜백을 부르지 않는다. (2026-07-01)
  it("visible-row nav moves focus without calling scrollRowIntoView", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cell00 = makeCell(0, 0);
    const cell10 = makeCell(1, 0);
    container.append(cell00, cell10);
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const scrollSpy = vi.fn();
    const { result } = renderHook(() =>
      useGridRoving(2, 1, containerRef, { scrollRowIntoView: scrollSpy }),
    );

    // (0,0) 이 focus 를 쥔 상태에서 ArrowDown.
    cell00.focus();
    act(() => result.current.syncFocus(0, 0));
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        target: cell00,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    expect(cell10).toHaveFocus();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(result.current.cellTabIndex(1, 0)).toBe(0);
    container.remove();
  });

  // Reason: virtualization sync — target row 가 처음엔 DOM 에 없다. hook 이
  // 첫 프레임 miss 를 감지해 scrollRowIntoView(R) 를 부르고, 그 콜백이 row R
  // cell 을 append (virtualizer render 시뮬레이션) 하면 재시도가 focus 를
  // 새 cell 에 안착시킨다. Phase 2 의 핵심 문제. (2026-07-01)
  it("virtualization sync scrolls an off-DOM row in, then focuses it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // 초기엔 rows 0–1 만 DOM 에 있다 (virtual window).
    const cell00 = makeCell(0, 0);
    const cell10 = makeCell(1, 0);
    container.append(cell00, cell10);
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    // scrollRowIntoView(R): virtualizer 가 row R 을 render 한 것처럼 cell 을
    // container 에 append.
    const scrollSpy = vi.fn((row: number) => {
      if (!container.querySelector(`[data-grid-row="${row}"]`)) {
        container.appendChild(makeCell(row, 0));
      }
    });

    const { result } = renderHook(() =>
      useGridRoving(50, 1, containerRef, { scrollRowIntoView: scrollSpy }),
    );

    // (1,0) 에서 시작, off-window row 로 점프 (End 는 col 이동이라 row 로
    // 가야 함 → ArrowDown 을 여러 번 대신 focusedRef 를 row 40 근처로 옮기고
    // ArrowDown 한 번). 여기선 syncFocus 로 anchor 를 row 40 에 두고 ArrowDown.
    act(() => result.current.syncFocus(40, 0));
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        target: cell10, // [data-grid-row] 를 가진 cell → 가드 통과
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    // row 41 은 초기 DOM 에 없었다 → scroll 콜백이 41 로 불려야 한다.
    expect(scrollSpy).toHaveBeenCalledWith(41);
    const target = container.querySelector<HTMLElement>(
      `[data-grid-row="41"][data-grid-col="0"]`,
    );
    expect(target).not.toBeNull();
    expect(target).toHaveFocus();
    container.remove();
  });

  // Reason: PageDown 은 한 페이지(PAGE_ROWS=10) 아래로 점프한다. AC1 의
  // Page 키 요구. row 0..12 가 DOM 에 있는 non-virtualized 경로에서 row 10 으로
  // focus + tabIndex 이동. (issue #1130)
  it("PageDown jumps down one page (PAGE_ROWS) of rows", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cells: HTMLElement[] = [];
    for (let r = 0; r <= 12; r++) {
      const c = makeCell(r, 0);
      cells.push(c);
      container.append(c);
    }
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const { result } = renderHook(() => useGridRoving(50, 1, containerRef));

    cells[0]!.focus();
    act(() => result.current.syncFocus(0, 0));
    act(() => {
      result.current.onKeyDown({
        key: "PageDown",
        target: cells[0],
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    expect(result.current.cellTabIndex(10, 0)).toBe(0);
    expect(cells[10]).toHaveFocus();
    container.remove();
  });

  // Reason: PageUp 은 한 페이지 위로 점프하며 top 에서 clamp (no wrap). (issue #1130)
  it("PageUp jumps up one page and clamps at row 0", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cells: HTMLElement[] = [];
    for (let r = 0; r <= 12; r++) {
      const c = makeCell(r, 0);
      cells.push(c);
      container.append(c);
    }
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const { result } = renderHook(() => useGridRoving(50, 1, containerRef));

    cells[5]!.focus();
    act(() => result.current.syncFocus(5, 0));
    act(() => {
      result.current.onKeyDown({
        key: "PageUp",
        target: cells[5],
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    // 5 - 10 → clamp 0.
    expect(result.current.cellTabIndex(0, 0)).toBe(0);
    expect(cells[0]).toHaveFocus();
    container.remove();
  });

  // Reason: #1127 AC1 — 최상단 row 에서 ArrowUp → 대응 컬럼 header 셀 진입.
  // header 는 role="columnheader" 형제로 container 에 있고, N번째 columnheader =
  // visual col N. body roving anchor 는 (0,col) 그대로 유지된다. (2026-07-05)
  it("ArrowUp at row 0 focuses the header cell of the current col (#1127)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const h0 = document.createElement("div");
    h0.setAttribute("role", "columnheader");
    h0.tabIndex = -1;
    const h1 = document.createElement("div");
    h1.setAttribute("role", "columnheader");
    h1.tabIndex = -1;
    const cell00 = makeCell(0, 0);
    const cell01 = makeCell(0, 1);
    container.append(h0, h1, cell00, cell01);
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const { result } = renderHook(() => useGridRoving(3, 2, containerRef));

    cell01.focus();
    act(() => result.current.syncFocus(0, 1));
    act(() => {
      result.current.onKeyDown({
        key: "ArrowUp",
        target: cell01,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    expect(h1).toHaveFocus();
    // body anchor 유지: (0,1) 여전히 tab stop.
    expect(result.current.cellTabIndex(0, 1)).toBe(0);
    container.remove();
  });

  // Reason: #1127 AC2 — Ctrl+Home = 첫 셀(0,0), Ctrl+End = 마지막 셀
  // (last row, last col) 점프. 수식어 없는 Home/End 는 col 만 이동(기존). (2026-07-05)
  it("Ctrl+Home jumps to (0,0), Ctrl+End to the last cell (#1127)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cells: Record<string, HTMLElement> = {};
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c <= 1; c++) {
        const el = makeCell(r, c);
        cells[`${r},${c}`] = el;
        container.append(el);
      }
    }
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const { result } = renderHook(() => useGridRoving(3, 2, containerRef));

    cells["1,0"]!.focus();
    act(() => result.current.syncFocus(1, 0));
    act(() => {
      result.current.onKeyDown({
        key: "End",
        ctrlKey: true,
        target: cells["1,0"],
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();
    expect(cells["2,1"]).toHaveFocus();
    expect(result.current.cellTabIndex(2, 1)).toBe(0);

    act(() => {
      result.current.onKeyDown({
        key: "Home",
        ctrlKey: true,
        target: cells["2,1"],
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();
    expect(cells["0,0"]).toHaveFocus();
    expect(result.current.cellTabIndex(0, 0)).toBe(0);
    container.remove();
  });

  // Reason: #1127 AC2 — 가상화 경로에서 PageDown 이 off-window row 로 점프해도
  // scrollRowIntoView 로 스크롤-인 후 focus 가 유지된다 (page 단위 + 가상화). (2026-07-05)
  it("PageDown to an off-window row scrolls it in then focuses (virtualized) (#1127)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.append(makeCell(0, 0), makeCell(5, 0));
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const scrollSpy = vi.fn((row: number) => {
      if (!container.querySelector(`[data-grid-row="${row}"]`)) {
        container.appendChild(makeCell(row, 0));
      }
    });

    const { result } = renderHook(() =>
      useGridRoving(50, 1, containerRef, { scrollRowIntoView: scrollSpy }),
    );

    act(() => result.current.syncFocus(5, 0));
    act(() => {
      result.current.onKeyDown({
        key: "PageDown",
        target: container.querySelector('[data-grid-row="5"]'),
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    // 5 + PAGE_ROWS(10) = 15, off-DOM → scroll 콜백으로 render 후 focus.
    expect(scrollSpy).toHaveBeenCalledWith(15);
    const target = container.querySelector<HTMLElement>(
      `[data-grid-row="15"][data-grid-col="0"]`,
    );
    expect(target).toHaveFocus();
    container.remove();
  });

  // Reason: ArrowUp at row 0 은 clamp (no wrap), (0,0) 이 tab stop 유지. (2026-07-01)
  it("ArrowUp at row 0 clamps and keeps (0,0) the tab stop", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cell00 = makeCell(0, 0);
    container.append(cell00);
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    const { result } = renderHook(() => useGridRoving(3, 1, containerRef));

    cell00.focus();
    act(() => result.current.syncFocus(0, 0));
    act(() => {
      result.current.onKeyDown({
        key: "ArrowUp",
        target: cell00,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    expect(result.current.cellTabIndex(0, 0)).toBe(0);
    expect(cell00).toHaveFocus();
    container.remove();
  });
});
