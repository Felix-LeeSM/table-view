import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME_ID,
  isThemeId,
  THEME_CATALOG,
  THEME_IDS,
} from "./themeCatalog";

describe("themeCatalog", () => {
  it("exposes exactly 72 themes", () => {
    expect(THEME_CATALOG).toHaveLength(72);
  });

  it("has unique ids across the catalog", () => {
    const ids = THEME_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the default theme id in the catalog", () => {
    const found = THEME_CATALOG.some((t) => t.id === DEFAULT_THEME_ID);
    expect(found).toBe(true);
  });

  it("every catalog entry has non-empty name, vibe, and swatch", () => {
    for (const entry of THEME_CATALOG) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.vibe.length).toBeGreaterThan(0);
      expect(entry.swatch).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("THEME_IDS is in sync with THEME_CATALOG order", () => {
    expect(THEME_IDS).toEqual(THEME_CATALOG.map((t) => t.id));
  });

  describe("isThemeId", () => {
    it("returns true for known theme ids", () => {
      expect(isThemeId("slate")).toBe(true);
      expect(isThemeId("github")).toBe(true);
      expect(isThemeId("linear")).toBe(true);
    });

    it("returns false for unknown ids and non-string values", () => {
      expect(isThemeId("not-a-theme")).toBe(false);
      expect(isThemeId("")).toBe(false);
      expect(isThemeId(null)).toBe(false);
      expect(isThemeId(undefined)).toBe(false);
      expect(isThemeId(42)).toBe(false);
      expect(isThemeId({ id: "slate" })).toBe(false);
    });
  });
});
