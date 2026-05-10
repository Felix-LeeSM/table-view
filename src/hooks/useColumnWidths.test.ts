// Sprint 258 — column widths 훅 동작 lock.
// AC-258-03: 컨테이너 fit 폐기 (default rem * rootFontSize).
// AC-258-04: drag-resize 단일 column commit.
// 작성일 2026-05-10, 갱신 2026-05-11 (sprint-258 (c) 산식 단순화).

import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { ColumnCategory } from "@/lib/columnCategory";

import { useColumnWidths } from "./useColumnWidths";

type Col = { name: string; category: ColumnCategory };

function setRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

describe("useColumnWidths — initial mount", () => {
  it("computes default rem * rootFontSize per column (no container fit)", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols));

    // bool 4rem * 16 = 64px, text 15rem * 16 = 240px. container 폭 무관.
    expect(result.current.widths).toEqual({ active: 64, label: 240 });
  });
});

describe("useColumnWidths — drag-resize (AC-258-04)", () => {
  it("setWidth changes only the targeted column, leaves others intact", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols));

    act(() => {
      result.current.setWidth("active", 200);
    });

    expect(result.current.widths.active).toBe(200);
    expect(result.current.widths.label).toBe(240); // 변경 안 됨
  });
});

describe("useColumnWidths — reset (AC-258-08)", () => {
  it("reset() re-runs default-rem formula and discards drag results", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() => useColumnWidths(cols));

    act(() => {
      result.current.setWidth("active", 999);
      result.current.setWidth("label", 1);
    });
    expect(result.current.widths.active).toBe(999);

    act(() => {
      result.current.reset();
    });

    expect(result.current.widths).toEqual({ active: 64, label: 240 });
  });
});
