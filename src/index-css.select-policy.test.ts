// #2432 — text selection is off by default and the exceptions are a list, not
// a habit.
//
// What this measures is the property the owner actually chose: a screen added
// next month follows the policy without doing anything, because the policy is
// one root rule plus one exception rule rather than a `select-none` class per
// call-site. That property dies the moment a second place starts deciding
// selection, so the sweep below walks every stylesheet under `src/` and fails
// on any `user-select` outside those two rules — a passing run is the whole
// claim, not a sample of it.
//
// Read out of the CSS text rather than measured on a rendered element:
// jsdom applies no stylesheets, so `getComputedStyle` reports the initial
// value here no matter what the file says. `index-css.theme-cascade.test.ts`
// and `components/ui/focusRing.test.ts` take the same route for the same
// reason.
//
// What it cannot answer: whether a real WebKit honours the cascade the way
// the file intends. Nothing in jsdom can — `DataGridTable.select-policy`
// covers the other half, that the selector this file pins is the one the grid
// actually renders.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(process.cwd(), "src");

/** Selection off. A root selector, so everything inherits it by default. */
const OFF_SELECTOR = ":root";

/**
 * Selection back on. Text that did not come from the app — database values
 * and errors, generated statements — plus the fields the user types into.
 */
const ON_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="gridcell"], [role="alert"], pre, code';

function cssFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(full, acc);
    else if (entry.name.endsWith(".css")) acc.push(full);
  }
  return acc;
}

/**
 * Flat (selector, declarations) pairs. Comments come out first: `index.css`
 * carries a comment quoting a `{ --tv-* }` block, which a brace-counting pass
 * would otherwise read as a rule of its own.
 */
function rules(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, " "),
    body: m[2]!,
  }));
}

/** Every rule under `src/` that says anything about `user-select`. */
function declaringRules() {
  return cssFiles(SRC_ROOT).flatMap((file) =>
    rules(readFileSync(file, "utf8"))
      .filter((r) => r.body.includes("user-select"))
      .map((r) => ({ file: file.slice(SRC_ROOT.length - "src".length), ...r })),
  );
}

describe("selection policy (#2432)", () => {
  it("[select-policy] no stylesheet under src/ decides selection outside the policy block", () => {
    expect(declaringRules().map((r) => `${r.file}: ${r.selector}`)).toEqual([
      `src/index.css: ${OFF_SELECTOR}`,
      `src/index.css: ${ON_SELECTOR}`,
    ]);
  });

  it("[select-policy] the root turns selection off and only the exception list turns it back on", () => {
    const found = new Map(declaringRules().map((r) => [r.selector, r.body]));

    // The `-webkit-` half is not decoration: unprefixed `user-select` only
    // landed in Safari 17, and this app runs inside the host WebKit.
    for (const [selector, value] of [
      [OFF_SELECTOR, "none"],
      [ON_SELECTOR, "text"],
    ] as const) {
      const body = found.get(selector);
      expect(body, `no rule for ${selector}`).toBeDefined();
      expect(body).toContain(`-webkit-user-select: ${value};`);
      expect(body).toContain(`user-select: ${value};`);
    }
  });
});
