// Purpose: unit tests for the useGridRoving hook. Verified
// deterministically with a hand-built container DOM, no real
// react-virtual. Covers: (1) visible-row arrow nav does not call
// scrollRowIntoView, (2) virtualization sync — moving to an off-DOM row has
// scrollRowIntoView render the row, then focus lands on the new cell,
// (3) edge clamp. (2026-07-01)

import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useGridRoving } from "./useGridRoving";

// Flush rAF for N frames. onKeyDown → focusCell defers `.focus()` per frame
// and retries up to MAX_FOCUS_FRAMES on a virtualization miss.
async function flushRaf(frames = 8) {
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

/** Data cell div (row, col). tabindex starts at -1 (roving updates it). */
function makeCell(row: number, col: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-grid-row", String(row));
  el.setAttribute("data-grid-col", String(col));
  el.tabIndex = -1;
  return el;
}

describe("useGridRoving (Design-swarm #4 Phase 2)", () => {
  // Reason: on the non-virtualized path where every cell is in the DOM,
  // ArrowDown moves focus straight to the next row's cell and does not call
  // the scroll callback. (2026-07-01)
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

    // ArrowDown while (0,0) holds focus.
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

  // Reason: virtualization sync — the target row is not in the DOM at first.
  // The hook detects the first-frame miss and calls scrollRowIntoView(R);
  // once that callback appends the row R cell (simulating a virtualizer
  // render), the retry lands focus on the new cell. (2026-07-01)
  it("virtualization sync scrolls an off-DOM row in, then focuses it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // Initially only rows 0–1 are in the DOM (virtual window).
    const cell00 = makeCell(0, 0);
    const cell10 = makeCell(1, 0);
    container.append(cell00, cell10);
    const containerRef = createRef<HTMLElement>();
    (containerRef as { current: HTMLElement }).current = container;

    // scrollRowIntoView(R): appends the cell to the container as if the
    // virtualizer had rendered row R.
    const scrollSpy = vi.fn((row: number) => {
      if (!container.querySelector(`[data-grid-row="${row}"]`)) {
        container.appendChild(makeCell(row, 0));
      }
    });

    const { result } = renderHook(() =>
      useGridRoving(50, 1, containerRef, { scrollRowIntoView: scrollSpy }),
    );

    // Start at (1,0), jump to an off-window row (End moves by column, so to
    // reach a lower row we move focusedRef near row 40 and press ArrowDown
    // once instead of pressing ArrowDown many times). Here syncFocus parks
    // the anchor at row 40 and then ArrowDown.
    act(() => result.current.syncFocus(40, 0));
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        target: cell10, // cell carrying [data-grid-row] → passes the guard
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });
    await flushRaf();

    // Row 41 was not in the initial DOM → the scroll callback must fire with 41.
    expect(scrollSpy).toHaveBeenCalledWith(41);
    const target = container.querySelector<HTMLElement>(
      `[data-grid-row="41"][data-grid-col="0"]`,
    );
    expect(target).not.toBeNull();
    expect(target).toHaveFocus();
    container.remove();
  });

  // Reason: PageDown jumps down one page (PAGE_ROWS=10). AC1's Page key
  // requirement. On the non-virtualized path with rows 0..12 in the DOM,
  // focus + tabIndex move to row 10. (issue #1130)
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

  // Reason: PageUp jumps up one page and clamps at the top (no wrap). (issue #1130)
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

    // 5 - 10 → clamp to 0.
    expect(result.current.cellTabIndex(0, 0)).toBe(0);
    expect(cells[0]).toHaveFocus();
    container.remove();
  });

  // Reason: #1127 AC1 — ArrowUp from the top row enters the matching
  // column's header cell. The headers are role="columnheader" siblings of
  // the container and the N-th columnheader is visual col N. The body roving
  // anchor stays at (0,col). (2026-07-05)
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
    // Body anchor kept: (0,1) is still the tab stop.
    expect(result.current.cellTabIndex(0, 1)).toBe(0);
    container.remove();
  });

  // Reason: #1127 AC2 — Ctrl+Home jumps to the first cell (0,0), Ctrl+End to
  // the last cell (last row, last col). Bare Home/End still move by column
  // (existing behavior). (2026-07-05)
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

  // Reason: #1127 AC2 — on the virtualized path, even when PageDown jumps to
  // an off-window row, scrollRowIntoView scrolls it in and focus holds
  // (page-sized + virtualized). (2026-07-05)
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

    // 5 + PAGE_ROWS(10) = 15, off-DOM → the scroll callback renders it, then focus.
    expect(scrollSpy).toHaveBeenCalledWith(15);
    const target = container.querySelector<HTMLElement>(
      `[data-grid-row="15"][data-grid-col="0"]`,
    );
    expect(target).toHaveFocus();
    container.remove();
  });

  // Reason: ArrowUp at row 0 clamps (no wrap); (0,0) stays the tab stop. (2026-07-01)
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
