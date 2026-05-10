// Sprint 238 / 258 — DataGrid cell layout 정책 lock.
// AC-258-03: column 별 default rem * rootFontSize → px (컨테이너 fit 폐기).
// 작성일 2026-05-10, 갱신 2026-05-11 (sprint-258 (c) 산식 단순화).

import { describe, it, expect } from "vitest";

import {
  computeInitialWidths,
  getDefaultRem,
  getTextAlign,
  type ColumnCategory,
} from "./columnCategory";

describe("getDefaultRem", () => {
  // AC-238-03 의 rem 테이블 + sprint-258 uuid 추가 (18rem — 36자 고정).
  it.each<[ColumnCategory, number]>([
    ["bool", 4],
    ["int", 6],
    ["binary", 6],
    ["float", 7.5],
    ["enum", 7.5],
    ["datetime", 11],
    ["unknown", 12.5],
    ["text", 15],
    ["object", 15],
    ["uuid", 18],
  ])("returns %s rem for %s category", (category, rem) => {
    expect(getDefaultRem(category)).toBe(rem);
  });
});

describe("computeInitialWidths (AC-258-03 — default rem * rootFontSize)", () => {
  it("returns default rem * rootFontSize per column (no container fit)", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];
    const widths = computeInitialWidths(cols, 16);
    // bool 4rem = 64px, text 15rem = 240px. container 폭과 무관.
    expect(widths).toEqual({ active: 64, label: 240 });
  });

  it("uses provided rootFontSize for accessibility/zoom", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
    ];
    // 18px 기준 font: bool 4rem = 72px.
    expect(computeInitialWidths(cols, 18)).toEqual({ active: 72 });
  });

  it("returns empty for zero columns", () => {
    expect(computeInitialWidths([], 16)).toEqual({});
  });
});

describe("getTextAlign", () => {
  // AC-238-08: int/float 우편향, bool 가운데, 그 외 좌편향.
  it.each<[ColumnCategory, "left" | "center" | "right"]>([
    ["int", "right"],
    ["float", "right"],
    ["bool", "center"],
    ["text", "left"],
    ["binary", "left"],
    ["datetime", "left"],
    ["object", "left"],
    ["enum", "left"],
    ["uuid", "left"],
    ["unknown", "left"],
  ])("aligns %s as %s", (category, align) => {
    expect(getTextAlign(category)).toBe(align);
  });
});
