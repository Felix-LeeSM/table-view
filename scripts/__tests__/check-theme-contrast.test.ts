import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AA_THRESHOLD,
  contrastRatio,
  parseHex,
  parseThemes,
  check,
  entryKey,
} from "../check-theme-contrast";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_CSS = resolve(here, "..", "..", "src", "themes.css");
const ALLOWLIST_JSON = resolve(here, "..", "theme-contrast-allowlist.json");

const realCss = readFileSync(THEMES_CSS, "utf8");
const realAllowlist = JSON.parse(readFileSync(ALLOWLIST_JSON, "utf8"));

describe("parseHex", () => {
  it("parses 6-digit hex", () => {
    expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHex("#000000")).toEqual([0, 0, 0]);
    expect(parseHex("#7c3aed")).toEqual([124, 58, 237]);
  });

  it("parses 3-digit hex via expansion", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#abc")).toEqual([170, 187, 204]);
  });

  it("returns null for invalid input", () => {
    expect(parseHex("rgb(0,0,0)")).toBeNull();
    expect(parseHex("#xyz")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("returns 21:1 for black on white", () => {
    const r = contrastRatio("#000000", "#ffffff");
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(21, 1);
  });

  it("returns 1:1 for identical colors", () => {
    expect(contrastRatio("#888888", "#888888")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    const a = contrastRatio("#0f172a", "#ffffff");
    const b = contrastRatio("#ffffff", "#0f172a");
    expect(a).toBeCloseTo(b!, 5);
  });

  it("returns null when either side is unparseable", () => {
    expect(contrastRatio("rgb(0,0,0)", "#fff")).toBeNull();
  });
});

describe("parseThemes", () => {
  it("captures 72 themes × 2 modes = 144 blocks from real themes.css", () => {
    const blocks = parseThemes(realCss);
    expect(blocks.length).toBe(144);
    expect(new Set(blocks.map((b) => b.theme)).size).toBe(72);
  });

  it("extracts --tv-* tokens for each block", () => {
    const blocks = parseThemes(realCss);
    const slateLight = blocks.find(
      (b) => b.theme === "slate" && b.mode === "light",
    );
    expect(slateLight).toBeDefined();
    expect(slateLight!.tokens.background).toBe("#ffffff");
    expect(slateLight!.tokens.foreground).toBe("#0f172a");
    expect(slateLight!.tokens.primary).toBe("#4f46e5");
  });
});

describe("check", () => {
  it("real themes.css with current allowlist has 0 new violations and 0 stale entries", () => {
    const result = check(realCss, realAllowlist.entries);
    expect(result.newViolations).toEqual([]);
    expect(result.staleAllowlist).toEqual([]);
    expect(result.themes).toBe(72);
    expect(result.blocks).toBe(144);
    expect(result.allowlistedViolations.length).toBe(
      realAllowlist.entries.length,
    );
  });

  it("flags a NEW violation when allowlist is empty", () => {
    const css = `[data-theme="bad"][data-mode="light"] {
      --tv-background:#ffffff; --tv-foreground:#bbbbbb;
      --tv-primary:#aaaaaa; --tv-primary-foreground:#bbbbbb;
    }`;
    const result = check(css, []);
    expect(result.newViolations.length).toBeGreaterThan(0);
    expect(
      result.newViolations.some(
        (v) => v.theme === "bad" && v.pair === "body text",
      ),
    ).toBe(true);
  });

  it("absorbs a violation when matching allowlist entry exists", () => {
    const css = `[data-theme="bad"][data-mode="light"] {
      --tv-background:#ffffff; --tv-foreground:#bbbbbb;
    }`;
    const result = check(css, [
      { theme: "bad", mode: "light", pair: "body text" },
    ]);
    expect(result.newViolations).toEqual([]);
    expect(result.allowlistedViolations.length).toBe(1);
    expect(result.staleAllowlist).toEqual([]);
  });

  it("reports stale allowlist when violation no longer present", () => {
    const css = `[data-theme="ok"][data-mode="light"] {
      --tv-background:#ffffff; --tv-foreground:#000000;
    }`;
    const result = check(css, [
      { theme: "ok", mode: "light", pair: "body text" },
    ]);
    expect(result.staleAllowlist.length).toBe(1);
    expect(result.staleAllowlist[0]).toMatchObject({
      theme: "ok",
      mode: "light",
      pair: "body text",
    });
  });

  it("ignores undefined pairs (token missing for theme)", () => {
    // No card-foreground/card defined here.
    const css = `[data-theme="x"][data-mode="light"] {
      --tv-background:#ffffff; --tv-foreground:#000000;
    }`;
    const result = check(css, []);
    expect(result.newViolations).toEqual([]);
    expect(result.pairsChecked).toBe(1);
  });

  it("AA_THRESHOLD is 4.5 (WCAG AA normal text)", () => {
    expect(AA_THRESHOLD).toBe(4.5);
  });
});

describe("entryKey", () => {
  it("composes theme/mode/pair", () => {
    expect(entryKey({ theme: "slate", mode: "dark", pair: "body text" })).toBe(
      "slate/dark/body text",
    );
  });
});
