// 2026-05-16 — cascade inversion that pinned every theme to slate.
//
// Cause:
//   Commit `1d8e230`'s fix for the empty theme on first boot added
//   `:root[data-mode="light"] { --tv-* }` / `:root[data-mode="dark"] { --tv-* }`
//   blocks to index.css as a base fallback. The intent was "a fallback with
//   lower specificity than the theme blocks" — the author computed the
//   specificity of `:root[data-mode]` as (0,1,1) and judged it weaker than
//   `[data-theme="X"][data-mode="Y"]` (0,2,0).
//
//   Actual specificity:
//     `:root[data-mode="X"]`          → (0, 2, 0)   ← :root is a pseudo-class
//     `[data-theme="X"][data-mode="Y"]` → (0, 2, 0)
//   **Equal**. With equal specificity, cascade order decides. index.css had
//   `@import "./themes.css"` at line 9 and the fallback blocks at line 99+,
//   so **the fallback overrode every per-theme override in themes.css**.
//   Result: slate colors were forced whatever data-theme was.
//
// Fix: wrap the fallback in `:where(:root[data-mode="X"])`, which makes its
//   specificity (0, 0, 0). Every [data-theme] override is (0,2,0), so it
//   always wins the cascade, and the fallback applies only when data-theme
//   itself is missing / unknown (keeping the original theme-agnostic
//   baseline intent).
//
// Why text assertions: same as themes.test.ts — jsdom's CSS engine does not
//   resolve the custom-property cascade reliably, so the cascade result
//   cannot be checked with `getComputedStyle`. The definition itself is the
//   contract, so the definition text is checked.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

describe("index.css — Wave 9.5 theme fallback cascade (회귀 3, 2026-05-16)", () => {
  it("loads index.css contents (sanity)", () => {
    expect(indexCss.length).toBeGreaterThan(500);
  });

  // Regression guard — a raw `:root[data-mode="X"] {` block has specificity
  // (0,2,0), a tie with the per-theme overrides in themes.css. Cascade order
  // then lets it override them → never use the raw form.
  it("does NOT define raw `:root[data-mode='light'] { --tv-* }` block (cascade trap)", () => {
    // Fail if `:root[data-mode="light"] {` appears as a single-line block
    // opener. Inside `:where(:root[data-mode="light"])` it is OK.
    expect(indexCss).not.toMatch(/^:root\[data-mode="light"\]\s*\{/m);
  });

  it("does NOT define raw `:root[data-mode='dark'] { --tv-* }` block (cascade trap)", () => {
    expect(indexCss).not.toMatch(/^:root\[data-mode="dark"\]\s*\{/m);
  });

  // Positive — the fallback sits inside `:where()`, so its specificity is 0.
  // The `[data-theme="X"][data-mode="Y"]` overrides in themes.css
  // (specificity 0,2,0) always win the cascade.
  it("wraps the light-mode fallback in :where() to neutralize specificity", () => {
    expect(indexCss).toMatch(/:where\(:root\[data-mode="light"\]\)/);
  });

  it("wraps the dark-mode fallback in :where() to neutralize specificity", () => {
    expect(indexCss).toMatch(/:where\(:root\[data-mode="dark"\]\)/);
  });

  // The fallback's meaning (a theme-agnostic baseline) itself must be
  // preserved — sanity-check that the slate primary color is defined for both
  // light and dark.
  it("preserves the slate light-mode `--tv-primary` baseline value (#4f46e5)", () => {
    expect(indexCss).toMatch(/--tv-primary:\s*#4f46e5/);
  });

  it("preserves the slate dark-mode `--tv-primary` baseline value (#818cf8)", () => {
    expect(indexCss).toMatch(/--tv-primary:\s*#818cf8/);
  });
});
