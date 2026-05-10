// Sprint 238 — AC-238-03/04/12: column widths 훅 동작 lock.
// 작성일 2026-05-10 / TDD slice #7.

import { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { ColumnCategory } from "@/lib/columnCategory";

import { useColumnWidths } from "./useColumnWidths";

type Col = { name: string; category: ColumnCategory };

// 테스트에서 jsdom 의 0-bound 한계를 우회하기 위해 mocked container
// element 를 직접 주입한다 — 실제 DOM 측정 logic 은 manual smoke 에서 확인.
function makeMockContainer(widthPx: number): HTMLElement {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width: widthPx,
    height: 0,
    top: 0,
    left: 0,
    right: widthPx,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  });
  return el;
}

function setRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

describe("useColumnWidths — initial mount", () => {
  it("computes (c) widths from container + root font-size on first render", () => {
    setRootFontSize(16);
    const container = makeMockContainer(608);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(container);
      return useColumnWidths(cols, ref);
    });

    // sum 304 < 608 → scale 2x: bool 64→128, text 240→480.
    expect(result.current.widths).toEqual({ active: 128, label: 480 });
  });
});

describe("useColumnWidths — drag-resize (AC-238-04, AC-238-11)", () => {
  it("setWidth changes only the targeted column, leaves others intact", () => {
    setRootFontSize(16);
    const container = makeMockContainer(608);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(container);
      return useColumnWidths(cols, ref);
    });

    act(() => {
      result.current.setWidth("active", 200);
    });

    expect(result.current.widths.active).toBe(200);
    expect(result.current.widths.label).toBe(480); // 변경 안 됨
  });
});

describe("useColumnWidths — reset (AC-238-12)", () => {
  it("reset() re-runs (c) formula and discards drag results", () => {
    setRootFontSize(16);
    const container = makeMockContainer(608);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(container);
      return useColumnWidths(cols, ref);
    });

    act(() => {
      result.current.setWidth("active", 999);
      result.current.setWidth("label", 1);
    });
    expect(result.current.widths.active).toBe(999);

    act(() => {
      result.current.reset();
    });

    // Drag 결과 폐기 + (c) 산식 재실행.
    expect(result.current.widths).toEqual({ active: 128, label: 480 });
  });
});
