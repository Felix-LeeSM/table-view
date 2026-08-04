// Purpose: #1734 (3) — the selected data row must actually be *visible*, and it
// must stay visible in every theme the app ships. The owner's report was
// "`bg-accent/20` 은 실측상 거의 안 보인다", so asserting that the row carries
// some selection class would pass on exactly the bug being fixed. This test
// measures instead.
//
// Round 1 of PR #2115 shipped `bg-primary/15`, which improved the default
// palette (1.018 -> 1.255) while making six `theme x mode` combinations WORSE
// than the fill it replaced, because a saturated-yellow `--tv-primary`
// (clickhouse, miro, binance, voltagent, renault) is nearly as bright as the
// white background it tints. Measuring only the default palette is what let
// that through, so the sweep below covers every block in `src/themes.css` plus
// the two `:where(:root[data-mode="…"])` fallbacks in `src/index.css` — 164
// palettes in total, all of them derived from the files rather than listed
// here.
//
// The selection class itself comes from the rendered DOM (the className delta
// between a selected and an unselected row), not from a literal typed here, so
// changing `DataRow` moves what gets measured.
//
// "Contrast ratio" below is the WCAG 2.x relative-luminance formula. The
// THRESHOLD is not a WCAG criterion — WCAG has no requirement for a selected
// row's fill against its own background, and 3:1 (SC 1.4.11) is unreachable for
// any tint subtle enough to keep the row's text legible. It is a separation
// floor picked between two measured bounds, both asserted below: the rejected
// `bg-accent/20` never exceeds it in any palette, and the shipped fill never
// falls to it in any palette.
//
// jsdom computes no Tailwind styles, so the class -> token -> hex chain is the
// only observable channel; whether the painted pixels please the eye is an
// E2E/visual question this cannot answer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  assertSweepIsComplete,
  composite,
  contrastRatio,
  declarations,
  toRgb,
} from "@/test-utils/themePalettes";
import type { TableData } from "@/types/schema";
import DataGridTable from "./DataGridTable";
import { SELECTED_ROW_FILL } from "./rowState";

const MOCK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1], [2]],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps() {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnOrder: [0],
    editingCell: null as { row: number; col: number } | null,
    editValue: null as string | null,
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>([0]),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "users",
    onSetEditValue: vi.fn(),
    onSetEditNull: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
  };
}

/**
 * The class the grid adds for "this row is selected", discovered by diffing a
 * selected row against an unselected one. Reading it instead of hard-coding it
 * is what keeps this test honest: change `DataRow`'s selection class and the
 * measurement below follows it rather than silently passing.
 */
function selectionClassFromDom(): string {
  const { container } = render(<DataGridTable {...makeProps()} />);
  const rows = container.querySelectorAll<HTMLElement>('[role="row"]');
  const selected = [...rows].find(
    (r) => r.getAttribute("aria-selected") === "true",
  );
  const unselected = [...rows].find(
    (r) => r.getAttribute("aria-selected") === "false",
  );
  if (!selected || !unselected)
    throw new Error("no selected/unselected row pair");
  const base = new Set(unselected.className.split(/\s+/));
  const added = selected.className
    .split(/\s+/)
    .filter((c) => c.length > 0 && !base.has(c));
  const fill = added.find((c) => c.startsWith("bg-"));
  if (!fill)
    throw new Error(`no bg-* class added by selection: ${added.join(" ")}`);
  return fill;
}

/** `bg-foreground/12` → `{ token: "foreground", alpha: 0.12 }`. */
function parseTint(cls: string): { token: string; alpha: number } {
  const m = cls.match(/^bg-([a-z-]+)(?:\/(\d+))?$/);
  if (!m) throw new Error(`unparseable tint class: ${cls}`);
  return { token: m[1]!, alpha: m[2] ? Number(m[2]) / 100 : 1 };
}

interface Palette {
  /** `slate light`, `(fallback) dark`, … — only used in failure messages. */
  name: string;
  tokens: Map<string, string>;
}

const CSS_DIR = resolve(__dirname, "../..");

/**
 * Every palette the app can render a row against.
 *
 * `src/themes.css` emits two blocks per `[data-theme][data-mode]` pair — one
 * carrying the UI tokens and a second carrying only `--tv-syntax-*`. Only the
 * first defines `--tv-background`, so requiring that token is what selects the
 * UI blocks; `assertSweepIsComplete` then proves the selection dropped nothing
 * by re-deriving the expected count from the theme names in the file.
 */
function palettes(): Palette[] {
  const themes = readFileSync(resolve(CSS_DIR, "themes.css"), "utf8");
  const index = readFileSync(resolve(CSS_DIR, "index.css"), "utf8");
  const out: Palette[] = [];

  for (const m of themes.matchAll(
    /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]*)\}/g,
  )) {
    const tokens = declarations(m[3]!);
    if (!tokens.has("background")) continue;
    out.push({ name: `${m[1]} ${m[2]}`, tokens });
  }

  for (const mode of ["light", "dark"] as const) {
    const block = index.match(
      new RegExp(`:where\\(:root\\[data-mode="${mode}"\\]\\)\\s*\\{([^}]*)\\}`),
    );
    if (!block) throw new Error(`no ${mode} fallback block in src/index.css`);
    out.push({ name: `(fallback) ${mode}`, tokens: declarations(block[1]!) });
  }

  // Round 2 of PR #2115 anchored the completeness check on a second regex over
  // the same file, and that regex was a PREFIX of the sweep's: changing the
  // selector shape sent both to zero at once, leaving `expected` = 2 and
  // `found` = 2 — green while measuring 2 palettes instead of 164. The shared
  // helper anchors on `THEME_CATALOG` instead, which is not CSS and cannot
  // break in the same edit.
  assertSweepIsComplete(
    out.filter((p) => !p.name.startsWith("(fallback) ")).map((p) => p.name),
  );
  return out;
}

/**
 * Contrast of `bg-<token>/<alpha*100>` against that palette's row background.
 * A palette missing either token throws rather than being skipped — a silent
 * skip is how a sweep reports "no failures" on a palette it never measured.
 */
function tintRatio(p: Palette, token: string, alpha: number): number {
  const background = p.tokens.get("background");
  if (!background) throw new Error(`${p.name}: no --tv-background`);
  const tint = p.tokens.get(token);
  if (!tint) throw new Error(`${p.name}: no --tv-${token}`);
  const bg = toRgb(background);
  return contrastRatio(composite(toRgb(tint), alpha, bg), bg);
}

// See the header: a separation floor, not a WCAG criterion. Both bounds that
// justify it are asserted below rather than quoted.
const MIN_RATIO = 1.15;

// What the owner rejected, kept as the discriminator for the floor above.
const REJECTED_FILL = { token: "accent", alpha: 0.2 };

describe("selected data row contrast (#1734 (3))", () => {
  const all = palettes();

  it("the DOM paints the shared selected-row fill", () => {
    expect(selectionClassFromDom()).toBe(SELECTED_ROW_FILL);
  });

  it("the selection fill clears the floor in every theme and mode", () => {
    const { token, alpha } = parseTint(selectionClassFromDom());
    const failures = all
      .map((p) => ({ name: p.name, ratio: tintRatio(p, token, alpha) }))
      .filter((r) => r.ratio <= MIN_RATIO)
      .map((r) => `${r.name}=${r.ratio.toFixed(3)}`);
    expect(failures).toEqual([]);
  });

  // Reason: without this the floor could be met by a fill no better than the
  // one the owner rejected. Pinning that `bg-accent/20` fails the SAME floor in
  // every palette is what makes the assertion above mean "visible" rather than
  // "some number". It also lands a future "just go back to accent" on red.
  it("the rejected accent fill fails that floor in every theme and mode", () => {
    const passing = all
      .map((p) => ({
        name: p.name,
        ratio: tintRatio(p, REJECTED_FILL.token, REJECTED_FILL.alpha),
      }))
      .filter((r) => r.ratio > MIN_RATIO)
      .map((r) => `${r.name}=${r.ratio.toFixed(3)}`);
    expect(passing).toEqual([]);
  });
});
