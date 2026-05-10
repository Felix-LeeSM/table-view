// Sprint 238 — DataGrid cell layout 정책 lock.
// AC-238-03: category 별 default rem 폭 lookup.
// 작성일 2026-05-10 / TDD slice #1 trace bullet.

import { describe, it, expect } from "vitest";

import {
  computeInitialWidths,
  getDefaultRem,
  getTextAlign,
  type ColumnCategory,
} from "./columnCategory";

describe("getDefaultRem", () => {
  // AC-238-03 의 rem 테이블: bool 4 / int·binary 6 / float·enum 7.5 /
  // datetime 11 / unknown 12.5 / text·object 15.
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
  ])("returns %s rem for %s category", (category, rem) => {
    expect(getDefaultRem(category)).toBe(rem);
  });
});

describe("computeInitialWidths (AC-238-03 (c) 산식)", () => {
  // Trace bullet — 1개 column, container 폭이 정확히 default 와 같음.
  it("returns default px when one column equals container width", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
    ];
    // bool default = 4rem * 16px = 64px.
    const widths = computeInitialWidths(cols, 64, 16);
    expect(widths).toEqual({ active: 64 });
  });

  it("scales each column proportionally when sum < container", () => {
    // bool 4rem + text 15rem = 19rem * 16 = 304px. container 608px → scale 2x.
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];
    const widths = computeInitialWidths(cols, 608, 16);
    expect(widths.active).toBe(128); // 64 * 2
    expect(widths.label).toBe(480); // 240 * 2
    expect((widths.active ?? 0) + (widths.label ?? 0)).toBe(608); // container 정확히 채움
  });

  it("returns defaults (no scaling) when sum ≥ container — horizontal scroll", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
      { name: "label", category: "text" },
    ];
    // sum 304 px > container 200 → default 유지 (사용자가 scroll).
    const widths = computeInitialWidths(cols, 200, 16);
    expect(widths.active).toBe(64);
    expect(widths.label).toBe(240);
  });

  it("respects custom rootFontSize (accessibility/zoom)", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
    ];
    // 18px 기준 font: bool 4rem = 72px.
    expect(computeInitialWidths(cols, 72, 18)).toEqual({ active: 72 });
  });

  it("returns empty for zero columns (분모 0 회피)", () => {
    expect(computeInitialWidths([], 1000, 16)).toEqual({});
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
    ["unknown", "left"],
  ])("aligns %s as %s", (category, align) => {
    expect(getTextAlign(category)).toBe(align);
  });
});
