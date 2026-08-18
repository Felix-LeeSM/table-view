// Purpose: #2435 — on the four primitives it named, the focus ring dropped
// from 3px at 50% alpha to 1px at 60%; the borderless overlay buttons took the
// alpha half of that decision and stayed 2px. Rings elsewhere in the app were
// left alone and are not what this measures.
// A thinner band paints less area, so its colour has to carry more of the
// signal; the alpha bump is the payment, not decoration. Asserting that the
// token contains some class name would pass on a ring nobody can see, so this
// measures the colour instead, over every palette the app can render against.
//
// The shipped alphas are read out of `focusRing.ts`, so editing a token moves
// what gets measured rather than leaving this file green on a stale value.
// `REPLACED_ALPHA` below is deliberately not read from there: it is the
// historical bound being compared against, and it has to stay put when the
// token moves.
//
// Sweep population: every `[data-theme][data-mode]` block in `src/themes.css`
// plus the two `:where(:root[data-mode="…"])` fallbacks in `src/index.css` —
// the same population `DataGridTable.selection-contrast.test.tsx` measures.
// `assertSweepIsComplete` anchors it on `THEME_CATALOG`, which is not CSS and
// so cannot break in the same edit as the regex.
//
// What this cannot answer: whether 1px of painted band is enough *area*. Area
// is WCAG SC 2.4.13, contrast is SC 1.4.11, and jsdom paints no pixels. 3:1 is
// out of reach here at any alpha for the palettes whose `--tv-ring` sits close
// to their `--tv-background`, so the assertion is a direction — the shipped
// alpha reads better than the one it replaced, in every palette — and not a
// WCAG threshold this repo could hit by picking a different alpha.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSweepIsComplete,
  composite,
  contrastRatio,
  declarations,
  themeBlocks,
  toRgb,
} from "@/test-utils/themePalettes";
import { FOCUS_RING, FOCUS_RING_BORDERLESS } from "./focusRing";

const SRC_ROOT = resolve(process.cwd(), "src");

/**
 * The ring shapes #2435 removed. Either one back in a file `sourceFiles` walks
 * is the failure — a shared constant nobody is obliged to import does not stop
 * the next `npx shadcn add` from pasting the upstream 3px string into one more
 * component.
 *
 * What that walk does not reach: `*.test.ts(x)`, `*.d.ts`, and every file under
 * `src/` that is not `.ts` or `.tsx` — CSS included. Dropping test files is
 * what lets this file name the shapes at all; `focusRing.ts` deliberately does
 * not.
 *
 * Tailwind v4 draws a different line — it scans `src/` for class candidates and
 * skips neither test files nor comments — and two things follow. Either name
 * written out verbatim anywhere in this file would regenerate the very rules
 * this change deletes, so the shapes below are patterns and the backslashes
 * stop the scanner from reading a whole candidate; the prose here describes
 * them rather than quoting them for the same reason. And the test-file
 * exclusion above is a real gap, not a free one: a removed shape written
 * verbatim in any other test file rebuilds the deleted rule in the shipped
 * stylesheet while this sweep stays green.
 */
const REPLACED = [/ring-\[3px\]/, /ring-ring\/50/];

/**
 * Alpha the four primitives #2435 named shipped with before it, kept as the
 * comparison bound. Not every ring in the app was on this value.
 */
const REPLACED_ALPHA = 0.5;

/** `focus-visible:ring-ring/60` → `0.6`. Throws rather than defaulting. */
function ringAlpha(token: string): number {
  const m = token.match(/focus-visible:ring-ring\/(\d+)\b/);
  if (!m) throw new Error(`no focus-visible:ring-ring/<alpha> in: ${token}`);
  return Number(m[1]) / 100;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

interface Palette {
  /** `slate light`, `(fallback) dark`, … — only used in failure messages. */
  name: string;
  resolve: (token: string) => string | undefined;
}

function palettes(): Palette[] {
  const themes = readFileSync(resolve(SRC_ROOT, "themes.css"), "utf8");
  const index = readFileSync(resolve(SRC_ROOT, "index.css"), "utf8");
  const blocks: Palette[] = themeBlocks(themes);
  assertSweepIsComplete(blocks.map((b) => b.name));

  const out = [...blocks];
  for (const mode of ["light", "dark"] as const) {
    const block = index.match(
      new RegExp(`:where\\(:root\\[data-mode="${mode}"\\]\\)\\s*\\{([^}]*)\\}`),
    );
    if (!block) throw new Error(`no ${mode} fallback block in src/index.css`);
    const tokens = declarations(block[1]!);
    out.push({ name: `(fallback) ${mode}`, resolve: (t) => tokens.get(t) });
  }
  return out;
}

/**
 * Contrast of the ring band, composited at `alpha`, against the surface behind
 * it. An unresolved token throws instead of being skipped — a silent skip is
 * how a sweep reports "no failures" on a palette it never measured.
 */
function bandRatio(p: Palette, alpha: number): number {
  const ring = p.resolve("ring");
  const background = p.resolve("background");
  if (!ring) throw new Error(`${p.name}: no --tv-ring`);
  if (!background) throw new Error(`${p.name}: no --tv-background`);
  const bg = toRgb(background);
  return contrastRatio(composite(toRgb(ring), alpha, bg), bg);
}

describe("focus ring (#2435)", () => {
  const all = palettes();

  it("keeps the ring shapes it replaced out of src/", () => {
    const offenders = sourceFiles(SRC_ROOT).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return REPLACED.filter((re) => re.test(text)).map(
        (re) => `${file.slice(SRC_ROOT.length - "src".length)}: ${re.source}`,
      );
    });
    expect(offenders).toEqual([]);
  });

  // Reason: the two tokens differ on width by design (a borderless control has
  // no border for `border-ring` to recolour, so its ring is the whole
  // indicator). Letting the colour drift apart as well is the divergence this
  // module exists to stop.
  it("paints both tokens in the same ring colour", () => {
    expect(ringAlpha(FOCUS_RING_BORDERLESS)).toBe(ringAlpha(FOCUS_RING));
  });

  it("reads better than the alpha it replaced, in every theme and mode", () => {
    const shipped = ringAlpha(FOCUS_RING);
    const regressions = all
      .map((p) => ({
        name: p.name,
        now: bandRatio(p, shipped),
        before: bandRatio(p, REPLACED_ALPHA),
      }))
      .filter((r) => r.now <= r.before)
      .map((r) => `${r.name}: ${r.now.toFixed(3)} <= ${r.before.toFixed(3)}`);
    expect(regressions).toEqual([]);
  });
});
