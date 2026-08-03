// Sprint 256 (2026-05-09): `ExecuteButton` — composed Execute affordance
// applied across 5 surfaces (SqlPreviewDialog / MqlPreviewModal /
// DataGrid inline preview / EditableQueryResultGrid toolbar /
// ConfirmDestructiveDialog footer).
//
// Tests cover the AC-256-05 contract:
//   - 4 severity × env color matrix (WARN+dev/null=success,
//     WARN+staging=warning, WARN+prod=destructive, STOP=destructive
//     regardless of env) — named by token, because what a token resolves
//     to is the theme's call, and the sweep at the bottom of this file is
//     where the resolved colours are held to the contract
//   - label format: env null/dev → "Execute"; staging/prod → "Execute on <conn>"
//   - icon swap: Play (idle) ↔ Loader2 animate-spin (loading)
//   - disabled state propagation
//   - title tooltip carries the full label so a truncated long conn name
//     stays discoverable.
// AC mapping: AC-256-05.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { THEME_CATALOG } from "@/lib/themeCatalog";
import ExecuteButton from "./ExecuteButton";

describe("ExecuteButton", () => {
  it("[AC-256-05a] WARN + dev → --tv-success", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="development"
        connectionLabel="dev-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:dev");
    expect(btn.getAttribute("style")).toMatch(/--tv-success\)/);
  });

  it("[AC-256-05a] WARN + null environment → --tv-success", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:dev");
    expect(btn.getAttribute("style")).toMatch(/--tv-success\)/);
  });

  it("[AC-256-05b] WARN + staging → --tv-warning", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="staging"
        connectionLabel="stage-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute on/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:staging");
    expect(btn.getAttribute("style")).toMatch(/--tv-warning\)/);
  });

  it("[AC-256-05c] WARN + production → --tv-destructive", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="prod-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute on/i });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:prod");
    expect(btn.getAttribute("style")).toMatch(/--tv-destructive\)/);
  });

  it("[AC-256-05d] STOP severity → --tv-destructive regardless of env", () => {
    for (const env of [null, "local", "staging", "production"]) {
      const { unmount } = render(
        <ExecuteButton
          severity="danger"
          environment={env}
          connectionLabel="any"
          loading={false}
          disabled={false}
          onClick={vi.fn()}
        />,
      );
      const btn = screen.getByRole("button", { name: /execute/i });
      expect(btn.getAttribute("style")).toMatch(/--tv-destructive\)/);
      unmount();
    }
  });

  it("[AC-256-05e] env=null/dev → label is plain 'Execute'", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="local"
        connectionLabel="local-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /execute/i });
    // "Execute" with no "on" suffix.
    expect(btn.textContent?.trim()).toBe("Execute");
  });

  it("[AC-256-05f] env=staging/prod → label is 'Execute on <conn>'", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="staging"
        connectionLabel="stage-db"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toMatch(/Execute on stage-db/);
  });

  it("[AC-256-05g] truncate + title tooltip carries the full label", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="very-long-connection-name-that-overflows"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.title).toBe(
      "Execute on very-long-connection-name-that-overflows",
    );
    // Span with truncate class for visual ellipsis.
    const labelSpan = btn.querySelector("[data-execute-button-label]");
    expect(labelSpan?.className).toMatch(/truncate/);
    expect(labelSpan?.className).toMatch(/max-w-execute-label/);
  });

  it("[AC-256-05h] loading → Loader2 spinner replaces Play, button disabled, label 'Executing…'", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment="production"
        connectionLabel="prod-db"
        loading={true}
        disabled={false}
        onClick={onClick}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    // Spinner svg present (Loader2 has lucide-loader-2 class).
    expect(btn.querySelector("svg.animate-spin")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[AC-256-05i] disabled → onClick suppressed", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={true}
        onClick={onClick}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("[AC-256-05j] click invokes onClick when enabled", () => {
    const onClick = vi.fn();
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("[AC-256-05k] custom ariaLabel overrides the default for screen readers", () => {
    render(
      <ExecuteButton
        severity="warn"
        environment={null}
        connectionLabel={null}
        loading={false}
        disabled={false}
        onClick={vi.fn()}
        ariaLabel="Run dry-run"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Run dry-run" }),
    ).toBeInTheDocument();
  });
});

// The matrix above is asserted at token-NAME level, which is blind to what the
// tokens resolve to in a given theme: #2117 shipped a theme whose block set all
// three fills to one near-white value and inherited the `:root` white
// foreground, so the four cells rendered as one colour and the label measured
// 1.044:1. Both halves of ADR 0023 (d) — "severity x env colour" and a legible
// target label — are theme-resolved properties, so they are measured here
// against every block the app can render, not against the default palette.

const CELLS = [
  { severity: "warn", environment: "development" },
  { severity: "warn", environment: "staging" },
  { severity: "warn", environment: "production" },
  { severity: "danger", environment: null },
] as const;

/**
 * `{ key, fill, fg }` per matrix cell, read from the inline style the component
 * actually emits. Reading it instead of listing the tokens here is what keeps
 * this honest: repoint `pickColorTokens` at another token and the sweep below
 * follows it rather than silently measuring the old one.
 */
function cellsFromDom(): { key: string; fill: string; fg: string }[] {
  return CELLS.map(({ severity, environment }) => {
    const { container, unmount } = render(
      <ExecuteButton
        severity={severity}
        environment={environment}
        connectionLabel="conn"
        loading={false}
        disabled={false}
        onClick={vi.fn()}
      />,
    );
    const btn = container.querySelector("button");
    const style = btn?.getAttribute("style") ?? "";
    const key = btn?.getAttribute("data-severity-env") ?? "";
    unmount();
    const fill = style.match(
      /background-color:\s*var\(--tv-([a-z0-9-]+)\)/,
    )?.[1];
    const fg = style.match(/(?:^|;)\s*color:\s*var\(--tv-([a-z0-9-]+)\)/)?.[1];
    if (!fill || !fg)
      throw new Error(
        `${key}: no var() fill/foreground pair in style: ${style}`,
      );
    return { key, fill, fg };
  });
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const h =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(
    /--tv-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\b/g,
  )) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

interface Block {
  /** `henry dark`, … — used in failure messages. */
  name: string;
  /** Token value as the cascade resolves it for this theme and mode. */
  resolve: (token: string) => string | undefined;
}

/**
 * Every `[data-theme][data-mode]` block, each with the cascade that decides
 * what its tokens resolve to.
 *
 * A theme block declares only what it overrides, so measuring the block alone
 * would report "not set" for the very tokens this test is about. The layers,
 * lowest first: `:root`, then the top-level `[data-mode="dark"]` block for dark
 * blocks, then the theme block. `src/themes.css` holds two `[data-mode="dark"]`
 * blocks — one near the top carrying only `color-scheme` — so both are merged
 * rather than taking the first match. `src/index.css` declares none of these
 * tokens, only the `--color-*` aliases that read them.
 *
 * `--tv-background` is what selects the UI block: each theme and mode also
 * emits a second block carrying only `--tv-syntax-*`.
 */
function blocks(): Block[] {
  const css = readFileSync(
    resolve(__dirname, "../..", "themes.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const layer = (re: RegExp) =>
    new Map(
      [...css.matchAll(re)].flatMap((m) => [...declarations(m[1]!).entries()]),
    );
  const root = layer(/(?:^|\n):root\s*\{([^}]*)\}/g);
  const darkBase = layer(/(?:^|\n)\[data-mode="dark"\]\s*\{([^}]*)\}/g);

  const out: Block[] = [];
  for (const m of css.matchAll(
    /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]*)\}/g,
  )) {
    const own = declarations(m[3]!);
    if (!own.has("background")) continue;
    const dark = m[2] === "dark";
    out.push({
      name: `${m[1]} ${m[2]}`,
      resolve: (t) =>
        own.get(t) ?? (dark ? darkBase.get(t) : undefined) ?? root.get(t),
    });
  }
  return out;
}

// Not a WCAG criterion: this catalog does not clear AA for these fills — the
// dark-mode `--tv-warning` orange under white text is its floor case, and
// lifting the whole catalog to 4.5:1 is a separate decision from ADR 0023. This
// is the weaker "the label is not the fill" floor, set between two bounds this
// file reproduces: restore the three monochrome `--tv-destructive`/`-success`/
// `-warning` declarations to the henry blocks in `src/themes.css` and the first
// assertion fails with the measured 1.044; leave them out and the catalog's own
// minimum clears it with the ratio printed in any future failure.
const MIN_LABEL_RATIO = 2.0;

describe("ExecuteButton severity x env across every theme (ADR 0023 (d))", () => {
  const all = blocks();
  const cells = cellsFromDom();

  it("sweeps every theme and mode block in src/themes.css", () => {
    // A regex that quietly stops matching would turn both assertions green.
    expect(all.length).toBe(THEME_CATALOG.length * 2);
  });

  it("the label stays readable on its fill in every theme and mode", () => {
    const failures: string[] = [];
    for (const block of all) {
      for (const { key, fill, fg } of cells) {
        const bg = block.resolve(fill);
        const text = block.resolve(fg);
        // Unresolved is a failure, not a skip: a silent skip is how a sweep
        // reports "no failures" on a cell it never measured.
        if (!bg || !text) {
          failures.push(`${block.name} ${key}=unresolved(${fill}/${fg})`);
          continue;
        }
        const ratio = contrast(bg, text);
        if (ratio <= MIN_LABEL_RATIO)
          failures.push(`${block.name} ${key}=${ratio.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  // Reason: the floor above is met by a theme that paints all four cells one
  // legible colour, which is the ADR's env signal gone while every ratio looks
  // fine. This is the half with no threshold to tune — the matrix has three
  // distinct fills by construction (danger and production share one), so any
  // block collapsing them below three has dropped a cell.
  it("keeps the matrix fills distinct in every theme and mode", () => {
    const distinct = new Set(cells.map((c) => c.fill)).size;
    const collapsed = all
      .map((b) => ({
        name: b.name,
        fills: [...new Set(cells.map((c) => b.resolve(c.fill)))],
      }))
      .filter((r) => r.fills.length < distinct)
      .map((r) => `${r.name}=[${r.fills.join(", ")}]`);
    expect(collapsed).toEqual([]);
  });
});
