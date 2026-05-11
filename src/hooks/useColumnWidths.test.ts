// Sprint 258 — column widths 훅 동작 lock.
// AC-258-03: 컨테이너 fit 폐기 (default rem * rootFontSize).
// AC-258-04: drag-resize 단일 column commit.
// 작성일 2026-05-10, 갱신 2026-05-11 (sprint-258 (c) 산식 단순화).
// Sprint 259 (2026-05-11) — localStorage persistence 동작 추가.

import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { ColumnCategory } from "@/lib/columnCategory";

import { useColumnWidths } from "./useColumnWidths";

type Col = { name: string; category: ColumnCategory };

function setRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`;
}

beforeEach(() => {
  window.localStorage.clear();
});

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

describe("useColumnWidths — localStorage persistence (Sprint 259)", () => {
  it("persistenceKey 가 없으면 localStorage I/O 없음", () => {
    setRootFontSize(16);
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() => useColumnWidths(cols));
    act(() => {
      result.current.setWidth("active", 200);
    });

    // localStorage 에 아무 키도 안 들어감.
    expect(window.localStorage.length).toBe(0);
  });

  it("setWidth 시 column-widths:<key> 로 저장한다", () => {
    setRootFontSize(16);
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );
    act(() => {
      result.current.setWidth("active", 200);
    });

    const stored = JSON.parse(
      window.localStorage.getItem("column-widths:rdb:public:users") ?? "{}",
    );
    expect(stored.active).toBe(200);
    expect(stored.label).toBe(240);
  });

  it("mount 시 column-widths:<key> 에서 load 한다", () => {
    setRootFontSize(16);
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ active: 333, label: 444 }),
    );
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );

    expect(result.current.widths.active).toBe(333);
    expect(result.current.widths.label).toBe(444);
  });

  it("저장된 widths 가 unknown column 만 갖고 있어도 default 로 fallback", () => {
    setRootFontSize(16);
    // 스키마 변경 후 stale entry 가 남아있는 시나리오.
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ removed_col: 999 }),
    );
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );

    // active 는 default (64), removed_col 은 무시.
    expect(result.current.widths).toEqual({ active: 64 });
  });

  it("reset() 은 localStorage entry 도 삭제한다", () => {
    setRootFontSize(16);
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ active: 333 }),
    );
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );
    expect(result.current.widths.active).toBe(333);

    act(() => {
      result.current.reset();
    });

    expect(result.current.widths.active).toBe(64);
    expect(
      window.localStorage.getItem("column-widths:rdb:public:users"),
    ).toBeNull();
  });

  it("invalid 또는 부정수 entry 는 무시하고 default", () => {
    setRootFontSize(16);
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      JSON.stringify({ active: -5, label: "junk" }),
    );
    const cols: Col[] = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );
    expect(result.current.widths).toEqual({ active: 64, label: 240 });
  });

  it("malformed JSON 은 무시하고 default", () => {
    setRootFontSize(16);
    window.localStorage.setItem(
      "column-widths:rdb:public:users",
      "{ not valid JSON",
    );
    const cols: Col[] = [{ name: "active", category: "bool" }];

    const { result } = renderHook(() =>
      useColumnWidths(cols, "rdb:public:users"),
    );
    expect(result.current.widths).toEqual({ active: 64 });
  });
});
