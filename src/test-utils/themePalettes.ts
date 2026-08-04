// Shared colour math for the theme sweeps.
//
// Three test files measure `src/themes.css` per `[data-theme][data-mode]`
// block: the ExecuteButton severity matrix, the selected-row fill, and the
// status channels below. They had two hand-copied versions of the same
// parsing and the same WCAG formula, and the copies had already drifted — one
// accepted `#[0-9a-fA-F]{3,8}` while `toRgb` expanded only `#RGB`, so a
// four-digit `#RGBA` value parsed to `[171, 205, NaN]` and every `NaN <= floor`
// comparison read as "passes". One copy is the fix; the divergence cannot come
// back.
//
// Two rules hold everything here honest, both learned from that hole:
//   - A value this math cannot handle throws. It never degrades to a number.
//   - A declaration is captured whatever its syntax, so `var(…)` /
//     `color-mix(…)` / `oklch(…)` reads as *present and unsupported* rather
//     than as absent — absent silently resolves to the `:root` value, which is
//     a different colour than the one the theme actually paints.

import { THEME_CATALOG } from "@/lib/themeCatalog";

export type Rgb = [number, number, number];

/**
 * Every `--tv-*` declaration in a CSS block body, value verbatim.
 *
 * Deliberately not filtered to hex: see the header. Callers look tokens up by
 * name, so non-colour tokens (`--tv-font-sans`, `--tv-primary-tint`) riding
 * along are harmless.
 */
export function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--tv-([a-z0-9-]+):\s*([^;}]+)/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/**
 * `#RGB` / `#RRGGBB` → channel triple.
 *
 * Throws on anything else — including the alpha forms `#RGBA` / `#RRGGBBAA`,
 * whose alpha this math has no background to composite against. A throw is the
 * point: the previous silent `NaN` turned every downstream comparison green.
 */
export function toRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`not an opaque hex colour: ${hex}`);
  const h =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over composite of `fg` at `alpha` onto opaque `bg`. */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

function toLab([r, g, b]: Rgb): Rgb {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  // D65, 2° observer.
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047);
  const y = f(0.2126 * rl + 0.7152 * gl + 0.0722 * bl);
  const z = f((0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * CIE76 ΔE — how different two colours look, not how far apart their
 * luminances are.
 *
 * Contrast ratio is the wrong tool for "are these two dots the same colour":
 * the pre-#2117 catalog's grey "cancelled" dot against its red "error" dot
 * measures 1.079:1 in `slate dark` and is obviously two colours. ΔE reads that
 * same pair at 64.8. Only a perceptual distance separates "different hue, same
 * lightness" from "identical".
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  const [la, aa, ba] = toLab(a);
  const [lb, ab, bb] = toLab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/** One `[data-theme][data-mode]` block plus the cascade it resolves through. */
export interface ThemeBlock {
  /** `henry dark`, … — used in failure messages. */
  name: string;
  /** Token value as the cascade resolves it for this theme and mode. */
  resolve: (token: string) => string | undefined;
}

/**
 * Every `[data-theme][data-mode]` block in `src/themes.css`, each carrying the
 * cascade that decides what its tokens resolve to.
 *
 * A theme block declares only what it overrides, so measuring the block alone
 * would report "not set" for the very tokens these sweeps are about. The
 * layers, lowest first: `:root`, then the top-level `[data-mode="dark"]` block
 * for dark blocks, then the theme block. The file holds two `[data-mode="dark"]`
 * blocks — one near the top carrying only `color-scheme` — so both are merged
 * rather than taking the first match. `src/index.css` declares none of these
 * tokens, only the `--color-*` aliases that read them.
 *
 * `--tv-background` is what selects the UI block: each theme and mode also
 * emits a second block carrying only `--tv-syntax-*`.
 */
export function themeBlocks(css: string): ThemeBlock[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const layer = (re: RegExp) =>
    new Map(
      [...stripped.matchAll(re)].flatMap((m) => [
        ...declarations(m[1]!).entries(),
      ]),
    );
  const root = layer(/(?:^|\n):root\s*\{([^}]*)\}/g);
  const darkBase = layer(/(?:^|\n)\[data-mode="dark"\]\s*\{([^}]*)\}/g);

  const out: ThemeBlock[] = [];
  for (const m of stripped.matchAll(
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

/**
 * The sweep is only evidence if it really covers the file. A regex that quietly
 * stops matching, or a `--tv-background` filter that drops a real theme, would
 * turn every assertion downstream green.
 *
 * The anchor is `THEME_CATALOG` — the list the theme picker renders, which is
 * not CSS and cannot break in the same edit. Names, not a count: a theme in the
 * catalog with no block in `themes.css` is unmeasured, and a block with no
 * catalog entry is unreachable from the picker. A count alone reports neither,
 * and one sweep here used to compare only `length` against `catalog * 2`.
 *
 * `extraBlocks` covers sweeps that also measure palettes from outside
 * `themes.css` (the two `src/index.css` fallbacks).
 */
export function assertSweepIsComplete(
  blockNames: string[],
  extraBlocks = 0,
): void {
  const swept = new Set(blockNames.map((n) => n.replace(/ (light|dark)$/, "")));
  const catalog = new Set<string>(THEME_CATALOG.map((t) => t.id));
  const missing = [...catalog].filter((id) => !swept.has(id));
  const extra = [...swept].filter((id) => !catalog.has(id));
  const expected = catalog.size * 2 + extraBlocks;
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    blockNames.length + extraBlocks !== expected
  ) {
    throw new Error(
      `sweep covers ${blockNames.length + extraBlocks} blocks over ${swept.size} themes; ` +
        `THEME_CATALOG lists ${catalog.size} (expected ${expected} blocks). ` +
        `Missing from src/themes.css: [${missing.join(", ")}]. ` +
        `Not in THEME_CATALOG: [${extra.join(", ")}].`,
    );
  }
}
