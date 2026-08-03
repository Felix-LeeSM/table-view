// Purpose: #1734 (3) — the selected data row must actually be *visible*. The
// owner's report was "`bg-accent/20` 은 실측상 거의 안 보인다", so asserting that
// the row carries some selection class would pass on exactly the bug being
// fixed. This test measures instead.
//
// It takes the selection class from the rendered DOM (the className delta
// between a selected and an unselected row — no literal is hand-copied here),
// reads the matching `--tv-*` token out of `src/index.css`, composites the
// tint over the row background at its Tailwind alpha, and asserts the WCAG
// contrast ratio in BOTH default modes.
//
// Scope: the `:where(:root[data-mode="…"])` fallbacks in `src/index.css`, i.e.
// the default palette. `src/themes.css` reskins `--tv-primary` across 72 theme
// pairs and a luminance ratio is the wrong yardstick for some of them (a
// saturated yellow primary is nearly as bright as white), so per-theme
// verification stays with the E2E/visual pass rather than being faked here.
//
// jsdom computes no Tailwind styles, so the class → token → hex chain is the
// only observable channel; E2E owns the pixels.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableData } from "@/types/schema";
import DataGridTable from "./DataGridTable";

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

/** `bg-primary/15` → `{ token: "primary", alpha: 0.15 }`. */
function parseTint(cls: string): { token: string; alpha: number } {
  const m = cls.match(/^bg-([a-z-]+)(?:\/(\d+))?$/);
  if (!m) throw new Error(`unparseable tint class: ${cls}`);
  return { token: m[1]!, alpha: m[2] ? Number(m[2]) / 100 : 1 };
}

/** `--tv-<name>` inside the `:where(:root[data-mode="<mode>"])` fallback block. */
function readToken(css: string, mode: "light" | "dark", name: string): string {
  const block = css.match(
    new RegExp(`:where\\(:root\\[data-mode="${mode}"\\]\\)\\s*\\{([^}]*)\\}`),
  );
  if (!block) throw new Error(`no ${mode} fallback block in src/index.css`);
  const hex = block[1]!.match(
    new RegExp(`--tv-${name}:\\s*(#[0-9a-fA-F]{3,6})`),
  );
  if (!hex) throw new Error(`no --tv-${name} in the ${mode} block`);
  return hex[1]!;
}

function toRgb(hex: string): [number, number, number] {
  const h =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Source-over composite of `fg` at `alpha` onto opaque `bg`. */
function composite(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] {
  return fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

// The owner-rejected `bg-accent/20` measures 1.018 (light) / 1.015 (dark).
// 1.10 sits an order of magnitude above that floor and below the 1.25 the
// shipped `bg-primary/15` reaches, so the guard fails on a revert without
// pinning the exact shipped value.
const MIN_RATIO = 1.1;

describe("selected data row contrast (#1734 (3))", () => {
  const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

  it.each(["light", "dark"] as const)(
    "the selection fill is measurably distinct from the row background (%s)",
    (mode) => {
      const { token, alpha } = parseTint(selectionClassFromDom());
      const background = toRgb(readToken(css, mode, "background"));
      const tint = toRgb(readToken(css, mode, token));
      const ratio = contrast(composite(tint, alpha, background), background);
      expect(ratio).toBeGreaterThan(MIN_RATIO);
    },
  );

  // Reason: the token this moved off is still in the palette and still used for
  // hover. Pin why it cannot carry selection so a future "just go back to
  // accent" lands on a red test instead of an invisible row. (#1734 (3))
  it.each(["light", "dark"] as const)(
    "the accent token cannot carry selection at any alpha (%s)",
    (mode) => {
      const background = toRgb(readToken(css, mode, "background"));
      const accent = toRgb(readToken(css, mode, "accent"));
      // Fully opaque accent — the strongest that token can possibly paint.
      expect(contrast(accent, background)).toBeLessThan(MIN_RATIO);
    },
  );
});
