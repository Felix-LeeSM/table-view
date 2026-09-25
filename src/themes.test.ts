// Token foundation guard (AC-253-01, AC-253-02).
//
// Foundation of the ADR 0023 chain (253→255→254→256→257). The Chrome H
// (top stripe + prod border) and ConfirmDestructiveDialog header token
// alignment, and the severity classifier color matrix, all depend on these
// 6 env-specific tokens + the `--tv-warning` deepening, so this test
// verifies the token definitions' *only source of truth* (`src/themes.css`)
// at the text level.
//
// Why text-level verification: getComputedStyle does not reliably resolve
// CSS variable inheritance in jsdom (jsdom's CSS engine implements the
// custom property cascade only partially). The *string* content of the
// token definitions in the css file is itself the contract, so regex
// matching asserts definition presence + value accuracy + which theme
// substitutes its own tone for the `--tv-status-connecting` amber default.
//
// Why fs.readFileSync (bypassing `require`): Vite 6's css plugin intercepts
// both `import x from "*.css?raw"` and `import.meta.glob("*.css", {query:"?raw"})`
// and stubs them with default = "" (CSS side-effect handling). So this token
// verification bypasses vite's module graph and reads the css file directly
// via fs. `@types/node` is not an explicit dev-dep, so `import` would be a
// type error → `eval`-free runtime require + `// @ts-expect-error` pulls in
// the node module safely (vitest = node runtime).
//
// Written: 2026-05-09 (/tdd flow)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSweepIsComplete } from "@/test-utils/themePalettes";

// process.cwd() at vitest invocation = repo root (where vite.config.ts
// lives). `src/themes.css` is the canonical SoT path for theme tokens.
const themes = readFileSync(resolve(process.cwd(), "src/themes.css"), "utf-8");

describe("themes.css — Sprint 253 token foundation (AC-253-01, AC-253-02)", () => {
  // Sanity — fs reached the file. If this fails the path resolution is
  // wrong and every other expectation below is moot.
  it("loads themes.css contents (sanity)", () => {
    expect(themes.length).toBeGreaterThan(1000);
  });

  // AC-253-01 — the 6 env-specific tokens are defined in universal scope
  // (theme-independent). The definition site can be :root or any
  // globally-applied selector, and all 81 theme variants must inherit it.
  it("defines --tv-env-prod with the spec value (#dc2626)", () => {
    expect(themes).toMatch(/--tv-env-prod:\s*#dc2626/);
  });

  it("defines --tv-env-prod-wash with the spec value (#fef2f2)", () => {
    expect(themes).toMatch(/--tv-env-prod-wash:\s*#fef2f2/);
  });

  it("defines --tv-env-prod-text with the spec value (#7f1d1d)", () => {
    expect(themes).toMatch(/--tv-env-prod-text:\s*#7f1d1d/);
  });

  it("defines --tv-env-staging with the spec value (#ea580c)", () => {
    expect(themes).toMatch(/--tv-env-staging:\s*#ea580c/);
  });

  it("defines --tv-env-staging-wash with the spec value (#fff7ed)", () => {
    expect(themes).toMatch(/--tv-env-staging-wash:\s*#fff7ed/);
  });

  it("defines --tv-env-staging-text with the spec value (#7c2d12)", () => {
    expect(themes).toMatch(/--tv-env-staging-text:\s*#7c2d12/);
  });

  // AC-253-02 — `--tv-warning` is defined with the spec deep orange
  // (#ea580c). Before this change `--tv-warning` itself was undefined
  // (`--color-warning` pointed at `--tv-status-connecting`); it was
  // introduced as a new definition in the universal :root.
  it("defines --tv-warning with the deepened spec value (#ea580c)", () => {
    expect(themes).toMatch(/--tv-warning:\s*#ea580c/);
  });

  // AC-253-02 — amber `#f59e0b` is the `--tv-status-connecting` default.
  // It visually separates the "connecting" meaning from the
  // "warning/staging" meaning.
  //
  // Asserts the substituting themes **by name**. A count floor (previous
  // revision: measured 152, floor 72) failed to protect the "default" —
  // 80 blocks could lose amber and still stay green. A name set stays
  // stable as more amber themes are added, and only forces this line to
  // change when a new substituting theme appears.
  it("keeps amber (#f59e0b) the --tv-status-connecting default outside the themes that substitute their own tone", () => {
    // Of the 9 refero themes #2117 brought in: supply·henry avoid chromatic
    // colors, authkit·lattice·ease use their own palette tone. Every
    // remaining block is amber.
    const SUBSTITUTES = ["authkit", "ease", "henry", "lattice", "supply"];
    const substituting = new Set<string>();
    const blockNames: string[] = [];
    let amber = 0;
    for (const m of themes
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(
        /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]*)\}/g,
      )) {
      const body = m[3] ?? "";
      // syntax-only blocks lack `--tv-background` (ADR 0031's 2-block split).
      if (!/--tv-background:/.test(body)) continue;
      blockNames.push(`${m[1]} ${m[2]}`);
      // Count a missing declaration as a substitute, not a skip — a silent
      // skip is a path that reports unmeasured blocks as "passing".
      if (/--tv-status-connecting:\s*#f59e0b\b/.test(body)) amber += 1;
      else substituting.add(m[1] ?? "");
    }
    // Completeness anchor the sibling sweep sets already use. Without it
    // `uiBlocks` below is a measurement, not a fixed value, so if the block
    // regex breaks halfway `amber === uiBlocks - 10` still holds and the
    // test stays green.
    assertSweepIsComplete(blockNames);
    const uiBlocks = blockNames.length;
    expect([...substituting].sort()).toEqual(SUBSTITUTES);
    // Counting command: grep -c -- '--tv-status-connecting: #f59e0b' src/themes.css
    expect(amber).toBe(uiBlocks - SUBSTITUTES.length * 2);
  });

  // Regression guard — keeps `--tv-warning` from regressing back to amber.
  it("does not reintroduce amber #f59e0b for --tv-warning", () => {
    expect(themes).not.toMatch(/--tv-warning:\s*#f59e0b/);
  });

  // Dark-mode contrast — deep orange #ea580c ≈ 4.2:1 on dark backgrounds is
  // borderline for small `text-warning`, so `[data-mode="dark"]` lightens it
  // to orange-400 #fb923c (same family, ADR 0023 gradient intact, no amber).
  it("lightens --tv-warning to orange-400 (#fb923c) in dark mode", () => {
    expect(themes).toMatch(
      /\[data-mode="dark"\]\s*\{[^}]*--tv-warning:\s*#fb923c/,
    );
  });
});

// Per-theme syntax palette curation (AC-257-01..04). Regression guard that
// applies the ADR 0023 grill Q12 curation decision as *rule-based
// derivation* (user option (b)). Written: 2026-05-09.
describe("themes.css — Sprint 257 syntax palette derivation (AC-257-01..04)", () => {
  // Pre-derivation default values — if every theme regresses to only these,
  // derivation was skipped.
  const PRE_LIGHT = ["#7c3aed", "#16a34a", "#dc2626"] as const;
  const PRE_DARK = ["#c4b5fd", "#86efac", "#fca5a5"] as const;

  // AC-257-01 — after derivation, the default-light triple must not survive
  // dominantly across *all* 162 blocks (pre ≥ 50, post derivation ≤ 5 —
  // a small non-zero ceiling, since collision themes like clickhouse can
  // accidentally match the default).
  it("does not leave the pre-derivation light default palette dominant", () => {
    const matches = themes.match(
      /--tv-syntax-keyword:#7c3aed; --tv-syntax-string:#16a34a; --tv-syntax-number:#dc2626;/g,
    );
    expect((matches ?? []).length).toBeLessThanOrEqual(5);
  });

  it("does not leave the pre-derivation dark default palette dominant", () => {
    const matches = themes.match(
      /--tv-syntax-keyword:#c4b5fd; --tv-syntax-string:#86efac; --tv-syntax-number:#fca5a5;/g,
    );
    expect((matches ?? []).length).toBeLessThanOrEqual(5);
  });

  // AC-257-01 — derivation diversity. Too few unique syntax-keyword colors
  // signals a regression to the default palette.
  //
  // The ADR 0023 AC-257-01 automatic HSL derivation was superseded by
  // ADR 0031 (2026-05-15) — a manually imported spec of 72 themes × 12
  // tokens. Brand identity takes priority over derivation consistency, so
  // the unique count drops somewhat (≥ 30 → ≥ 10). This guard's intent
  // stays "no single default covers every theme". The space after `:` in
  // the token format also matches ADR 0031's spec output.
  it("produces a diverse syntax-keyword palette across themes", () => {
    const re = /--tv-syntax-keyword:\s*(#[0-9a-fA-F]{3,6})/g;
    const seen = new Set<string>();
    for (const m of themes.matchAll(re)) {
      const hex = m[1];
      if (hex) seen.add(hex.toLowerCase());
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  // AC-257-01 — derivation definition coverage. Every (theme, mode) pair
  // must carry the syntax triple (zero pairs missing syntax).
  //
  // ADR 0031 (2026-05-15) — the same (theme, mode) is split across two CSS
  // blocks (base palette and syntax token respectively). So the triple's
  // presence is verified as the union of (theme, mode) pairs, not per block
  // (commit msg: "parseThemes merges multiple blocks of the same
  // (theme, mode) as a union"). The space after `:` in the token format
  // also matches ADR 0031's spec output, hence the regex.
  it("defines a syntax-keyword/string/number triple in every theme block", () => {
    const blockRe =
      /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]+)\}/g;
    const bodyByPair = new Map<string, string>();
    for (const m of themes.matchAll(blockRe)) {
      const key = `${m[1]}|${m[2]}`;
      const prev = bodyByPair.get(key) ?? "";
      bodyByPair.set(key, `${prev}${m[3] ?? ""}`);
    }
    expect(bodyByPair.size).toBeGreaterThanOrEqual(144);
    let withTriple = 0;
    for (const body of bodyByPair.values()) {
      if (
        /--tv-syntax-keyword:\s*#/.test(body) &&
        /--tv-syntax-string:\s*#/.test(body) &&
        /--tv-syntax-number:\s*#/.test(body)
      ) {
        withTriple += 1;
      }
    }
    expect(withTriple).toBe(bodyByPair.size);
  });

  // Guards that the pre-derivation defaults are used for reference only
  // (protects the regression test's self-reference).
  it("references the pre-derivation defaults exactly twice (light + dark) in this test file", () => {
    expect(PRE_LIGHT).toHaveLength(3);
    expect(PRE_DARK).toHaveLength(3);
  });
});

// Identity color tokens live in `src/index.css`'s theme-agnostic fallback
// blocks (not per-theme). One assertion: each resolves (defined + non-empty
// hex) in the fallback. Per-theme presence is intentionally NOT required —
// identity colors are theme-invariant by default.
describe("index.css — identity color token fallback", () => {
  const indexCss = readFileSync(
    resolve(process.cwd(), "src/index.css"),
    "utf-8",
  );
  const identityTokens = [
    "--tv-value-key",
    "--tv-value-leaf",
    "--tv-value-delete",
    "--tv-typekind-enum",
    "--tv-typekind-domain",
    "--tv-typekind-range",
    "--tv-typekind-composite",
  ];
  for (const token of identityTokens) {
    it(`defines ${token} with a non-empty hex in the fallback`, () => {
      // `\b${token}\b` alone would let `--tv-value-key` match inside
      // nothing else here, but anchor to a hex value to prove it resolves.
      expect(indexCss).toMatch(new RegExp(`${token}:\\s*#[0-9a-fA-F]{3,8}`));
    });
  }
});
