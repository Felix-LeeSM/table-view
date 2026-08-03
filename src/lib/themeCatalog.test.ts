import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  isThemeId,
  THEME_CATALOG,
  THEME_IDS,
} from "./themeCatalog";

// Text-level read of the stylesheet, the same channel `src/themes.test.ts`
// uses: jsdom does not resolve the custom-property cascade, so the file's
// bytes are the only observable contract. `process.cwd()` at vitest
// invocation is the repo root (where vite.config.ts lives).
const themesCss = readFileSync(
  resolve(process.cwd(), "src/themes.css"),
  "utf-8",
);

/**
 * `authkit|light` -> that pair's declarations. A pair is split across two
 * blocks in `src/themes.css` (UI palette, then `--tv-syntax-*`), so the bodies
 * are unioned the way `src/themes.test.ts` does it.
 */
const cssPairs = new Map<string, string>();
for (const m of themesCss.matchAll(
  /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]*)\}/g,
)) {
  const key = `${m[1]}|${m[2]}`;
  cssPairs.set(key, `${cssPairs.get(key) ?? ""}${m[3] ?? ""}`);
}

describe("themeCatalog", () => {
  it("exposes exactly 81 themes", () => {
    expect(THEME_CATALOG).toHaveLength(81);
  });

  // A catalog entry with no stylesheet block is still selectable from the
  // picker, and then paints the `src/index.css` slate fallback instead of its
  // own palette — green in every other test here, because they only read the
  // TS module.
  //
  // `--tv-background` is what makes this measure the palette rather than the
  // selector: the syntax half of a pair carries the same selector, so merely
  // requiring the pair to exist stays green when the UI block alone is
  // deleted (verified by deleting `[data-theme="karl"][data-mode="light"]`'s
  // UI block, which that weaker form did not catch).
  //
  // The reverse direction (a block with no catalog entry) is asserted by
  // `DataGridTable.selection-contrast.test.tsx`'s `assertSweepIsComplete`.
  it("every catalog id has a light and a dark palette in themes.css", () => {
    const missing = THEME_CATALOG.flatMap((t) =>
      (["light", "dark"] as const)
        .filter(
          (mode) =>
            !/--tv-background:\s*#/.test(cssPairs.get(`${t.id}|${mode}`) ?? ""),
        )
        .map((mode) => `${t.id} ${mode}`),
    );
    expect(missing).toEqual([]);
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
