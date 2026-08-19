// #2432 — read the shipped selection policy out of `src/index.css` so the DOM
// tests that depend on it cannot drift from the stylesheet.
//
// Retyping the selector into each test would leave those tests green after the
// CSS moved, which is the one failure they exist to catch. jsdom applies no
// stylesheets, so matching elements against the shipped selector is as close
// to the real cascade as a unit test gets here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The selector `src/index.css` re-enables text selection on. Throws rather
 * than returning a default: a missing rule means the policy is gone, and a
 * silent fallback would report that as a pass.
 */
export function selectableSelector(): string {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8")
    // Comments first — one of them quotes a `{ … }` block.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const match = css.match(/([^{}]*)\{[^{}]*user-select:\s*text;[^{}]*\}/);
  if (!match) throw new Error("no `user-select: text` rule in src/index.css");
  return match[1]!.trim();
}
