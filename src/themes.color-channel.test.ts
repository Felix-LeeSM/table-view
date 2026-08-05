// Purpose: #2117 — a state the UI encodes in colour and nothing else must stay
// readable in every theme the catalog ships.
//
// The catalog gained nine themes, two of them deliberately monochrome. A
// monochrome palette has a handful of tones to spend, so two semantic tokens
// land on the same value easily: `supply dark` shipped
// `--tv-status-connected: #ffffff` next to `--tv-destructive: #ffffff`, which
// made the query log's "succeeded" dot and its "failed" dot the same pixels.
// Those dots are the same shape and carry no label — only a `title` tooltip,
// which needs a hover — so the colour was the whole signal and the state became
// unreadable.
//
// What is measured, and what is not:
//   - ENFORCED here: sites where two different *states* are told apart by
//     colour alone. Collapse there means a state is read as another state.
//   - NOT enforced: sites where a collapse costs emphasis rather than identity
//     (`text-success` reading as body text, the slow-query nudge reading as
//     ordinary muted text). Those are the monochrome themes doing what they
//     were picked for. They are listed with their measurements in
//     `docs/product/known-limitations.md`.
//
// The metric is CIE76 ΔE, not contrast ratio, and the reason is in
// `src/test-utils/themePalettes.ts` — the catalog's own grey-vs-red dot pair
// measures 1.079:1, which no contrast floor can separate from "identical".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSweepIsComplete,
  colorDistance,
  themeBlocks,
  toRgb,
} from "@/test-utils/themePalettes";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Sites where colour is the only channel separating two states.
 *
 * `classes` are the Tailwind classes the site actually paints, and they are
 * resolved to `--tv-*` tokens through `src/index.css` rather than being paired
 * with tokens here — the alias layer is what the browser follows, and
 * `bg-success` reading `--tv-status-connected` (not `--tv-success`) is exactly
 * the indirection that hid the original collapse.
 *
 * `anchors` are the literals that must still be present in the source. Rename a
 * class at the site and this file goes red instead of quietly measuring the
 * classes the site no longer uses.
 */
const COLOR_ONLY_SITES = [
  {
    what: "query status dot — succeeded / cancelled / failed",
    why: "same `h-2 w-2 rounded-full` span, no label, `title` needs a hover",
    files: [
      "src/components/query/QueryLog.tsx",
      "src/components/query/QueryHistoryPanel.tsx",
    ],
    classes: ["bg-success", "bg-muted-foreground", "bg-destructive"],
    anchors: ["rounded-full"],
  },
] as const;

/** `--color-success: var(--tv-status-connected)` → `success` → `status-connected`. */
function aliasMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read("src/index.css").matchAll(
    /--color-([a-z0-9-]+):\s*var\(--tv-([a-z0-9-]+)\)/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

function tokenOf(cls: string, alias: Map<string, string>): string {
  const name = cls.replace(/^(?:bg|text|border|ring|fill|stroke)-/, "");
  const token = alias.get(name);
  if (!token)
    throw new Error(`no --color-${name} alias in src/index.css for "${cls}"`);
  return token;
}

// A separation floor, not a WCAG criterion — WCAG says nothing about two dots
// that are never adjacent. It is picked between two measured bounds, both
// asserted below: the catalog's own tightest pair clears it, and the two values
// this PR shipped and removed fail it. The higher of those two is the one that
// binds — `supply light` paired `#101010` against `#000000`, which is not an
// equal pair and is still one colour to the eye at 8px.
const MIN_CHANNEL_DISTANCE = 15;

/** What `supply` shipped in #2117, kept as the floor's discriminator. */
const REJECTED_PAIRS = [
  { name: "supply dark", a: "#ffffff", b: "#ffffff" },
  { name: "supply light", a: "#101010", b: "#000000" },
] as const;

describe("colour-only status channels across every theme (#2117)", () => {
  const blocks = themeBlocks(read("src/themes.css"));
  const alias = aliasMap();

  it("sweeps every theme and mode block in src/themes.css", () => {
    expect(() => {
      assertSweepIsComplete(blocks.map((b) => b.name));
    }).not.toThrow();
    // Feeding it a short list is what makes the line above mean "the sweep is
    // complete" instead of "the helper ran".
    expect(() => {
      assertSweepIsComplete(blocks.slice(1).map((b) => b.name));
    }).toThrow(/sweep covers/);
  });

  // Reason: every measurement below reads this list. Emptying `COLOR_ONLY_SITES`
  // registers zero `it.each` cases, and dropping `"bg-destructive"` from
  // `classes` stops measuring the succeeded-vs-failed pair this file exists for
  // — both silently green. Pinned by name rather than derived from the list,
  // for the reason `src/components/ui/ExecuteButton.test.tsx:344-349` gives: a
  // bar computed from the thing it checks moves with the edit that breaks it.
  it("still measures the pair this file exists for", () => {
    expect(COLOR_ONLY_SITES).toHaveLength(1);
    expect(COLOR_ONLY_SITES[0]!.classes).toEqual([
      "bg-success",
      "bg-muted-foreground",
      "bg-destructive",
    ]);
    expect(COLOR_ONLY_SITES[0]!.anchors).toEqual(["rounded-full"]);
    expect(COLOR_ONLY_SITES[0]!.files).toEqual([
      "src/components/query/QueryLog.tsx",
      "src/components/query/QueryHistoryPanel.tsx",
    ]);
  });

  it.each(COLOR_ONLY_SITES)(
    "$what keeps its states distinguishable in every theme and mode",
    ({ files, classes, anchors }) => {
      // The site list is only evidence while it still describes the source.
      for (const file of files) {
        const src = read(file);
        for (const literal of [...classes, ...anchors]) {
          expect(src, `${file} no longer contains "${literal}"`).toContain(
            literal,
          );
        }
      }

      const tokens = classes.map((c) => tokenOf(c, alias));
      const failures: string[] = [];
      for (const block of blocks) {
        for (let i = 0; i < tokens.length; i++) {
          for (let j = i + 1; j < tokens.length; j++) {
            const a = block.resolve(tokens[i]!);
            const b = block.resolve(tokens[j]!);
            // Unresolved is a failure, not a skip: a silent skip is how a sweep
            // reports "no failures" on a pair it never measured.
            if (!a || !b) {
              failures.push(
                `${block.name} ${tokens[i]}/${tokens[j]}=unresolved`,
              );
              continue;
            }
            const d = colorDistance(toRgb(a), toRgb(b));
            if (d < MIN_CHANNEL_DISTANCE)
              failures.push(
                `${block.name} --tv-${tokens[i]}(${a}) vs --tv-${tokens[j]}(${b})=${d.toFixed(2)}`,
              );
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  // Reason: without this the floor could be met by any number at all. Pinning
  // that the two removed `supply` values fail the SAME floor is what makes the
  // sweep above mean "tellable apart" rather than "some number", and it lands a
  // future "monochrome everything, it is only a dot" on red.
  it("the values removed from supply fail that floor", () => {
    const passing = REJECTED_PAIRS.map((p) => ({
      name: p.name,
      d: colorDistance(toRgb(p.a), toRgb(p.b)),
    }))
      .filter((r) => r.d >= MIN_CHANNEL_DISTANCE)
      .map((r) => `${r.name}=${r.d.toFixed(2)}`);
    expect(passing).toEqual([]);
  });
});
