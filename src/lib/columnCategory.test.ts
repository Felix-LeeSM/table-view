// Locks the DataGrid cell layout policy.
// AC-258-03: per-column default rem * rootFontSize → px (no container fit).
// Written 2026-05-10, updated 2026-05-11 (formula simplified).

import { describe, expect, it } from "vitest";

import {
  type ColumnCategory,
  computeInitialWidths,
  getDefaultRem,
  getTextAlign,
} from "./columnCategory";

describe("getDefaultRem", () => {
  // The AC-238-03 rem table, plus uuid (18rem — a fixed 36 characters).
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
    // bool 4rem = 64px, text 15rem = 240px, regardless of container width.
    expect(widths).toEqual({ active: 64, label: 240 });
  });

  it("uses provided rootFontSize for accessibility/zoom", () => {
    const cols: Array<{ name: string; category: ColumnCategory }> = [
      { name: "active", category: "bool" },
    ];
    // With an 18px root font: bool 4rem = 72px.
    expect(computeInitialWidths(cols, 18)).toEqual({ active: 72 });
  });

  it("returns empty for zero columns", () => {
    expect(computeInitialWidths([], 16)).toEqual({});
  });
});

describe("getTextAlign", () => {
  // AC-238-08: int/float align right, bool centered, the rest left.
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
