#!/usr/bin/env node
/**
 * scripts/generate-syntax-palette.ts
 *
 * Sprint 257 (ADR 0023, AC-257-01..04) — derive per-theme syntax palette
 * from each block's `--tv-primary`. The default `#7c3aed` / `#16a34a` /
 * `#dc2626` (light) and `#c4b5fd` / `#86efac` / `#fca5a5` (dark) palette
 * was theme-agnostic; this script replaces both with HSL-derived values
 * keyed off the brand primary.
 *
 * Rules (mirrors master spec §Sprint 257 + grill Q12 residual hint):
 *   - keyword = complement of primary hue, but rotated AWAY from the
 *     green (string) and red-orange (number) zones to avoid token
 *     ambiguity. Falls through to violet (270°) on conflict.
 *   - string = green (140°) by default; teal (178°) if primary itself
 *     sits in the green zone (100°-170°) so the syntax green is not the
 *     brand green (clickhouse-yellow / supabase / spotify case).
 *   - number = red-orange (12°) by default; amber (45°) or pink (340°)
 *     if primary is in the red/orange zone (≤50° or ≥330°) so the
 *     syntax number is distinguishable from the brand red (tesla /
 *     ferrari case) or brand orange (clickhouse yellow).
 *
 * Mode-specific tone:
 *   - light: S 60-70 / L 38-45 (saturated mid)
 *   - dark : S 60-75 / L 70-78 (pastel-ish, contrast against dark bg)
 *
 * Run via `pnpm tsx scripts/generate-syntax-palette.ts` — overwrites the
 * 144 syntax-token lines in `src/themes.css` in place. The block-by-block
 * structure (single-line `--tv-syntax-keyword:…; --tv-syntax-string:…;
 * --tv-syntax-number:…;`) is preserved so `git diff` stays per-theme.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_PATH = resolve(__dirname, "..", "src", "themes.css");

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    case b:
      h = (r - g) / d + 4;
      break;
  }
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => {
    const n = Math.round((v + m) * 255);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  };
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

const STRING_DEFAULT_H = 140; // green
const STRING_FALLBACK_H = 178; // teal
const NUMBER_DEFAULT_H = 12; // red-orange
const NUMBER_AMBER_H = 45;
const NUMBER_PINK_H = 340;
const KEYWORD_FALLBACK_H = 270; // violet — used when complement collides

function inGreenZone(h: number): boolean {
  return h >= 100 && h <= 175;
}

function inRedOrangeZone(h: number): boolean {
  return h <= 50 || h >= 330;
}

interface SyntaxTriple {
  keyword: string;
  string: string;
  number: string;
}

function deriveSyntax(
  primaryHex: string,
  mode: "light" | "dark",
): SyntaxTriple {
  const rgb = parseHex(primaryHex);
  if (!rgb) {
    // Fallback to defaults if the primary couldn't parse.
    return mode === "light"
      ? { keyword: "#7c3aed", string: "#16a34a", number: "#dc2626" }
      : { keyword: "#c4b5fd", string: "#86efac", number: "#fca5a5" };
  }
  const [pH] = rgbToHsl(...rgb);

  // keyword = complement, but avoid string + number zones.
  let kH = (pH + 180) % 360;
  if (inGreenZone(kH) || inRedOrangeZone(kH)) kH = KEYWORD_FALLBACK_H;
  // Keep keyword distinct from primary hue by at least 60° even after
  // fallback (e.g. violet primary → use teal-blue 200° keyword instead).
  if (Math.abs(((kH - pH + 540) % 360) - 180) < 30) {
    kH = (pH + 100) % 360;
    if (inGreenZone(kH) || inRedOrangeZone(kH)) kH = (pH + 220) % 360;
  }

  // string = green by default; teal if primary is green-ish.
  const sH = inGreenZone(pH) ? STRING_FALLBACK_H : STRING_DEFAULT_H;

  // number = red-orange by default; amber if primary is orange/yellow,
  // pink if primary is pure red/magenta.
  let nH = NUMBER_DEFAULT_H;
  if (inRedOrangeZone(pH)) {
    if (pH >= 30 && pH <= 50)
      nH = NUMBER_PINK_H; // brand orange/yellow → pink
    else nH = NUMBER_AMBER_H; // brand red/magenta → amber
  }

  if (mode === "light") {
    return {
      keyword: hslToHex(kH, 68, 42),
      string: hslToHex(sH, 60, 35),
      number: hslToHex(nH, 70, 45),
    };
  }
  return {
    keyword: hslToHex(kH, 70, 75),
    string: hslToHex(sH, 55, 70),
    number: hslToHex(nH, 78, 73),
  };
}

interface Block {
  theme: string;
  mode: "light" | "dark";
  bodyStart: number;
  bodyEnd: number;
  primary: string | null;
  syntaxLineMatch: RegExpExecArray | null;
}

function findBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  const re =
    /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const [full, theme, mode, body] = m;
    const start = m.index;
    const end = start + full.length;
    const primaryRe = /--tv-primary\s*:\s*(#[0-9a-fA-F]{3,6})/;
    const pm = primaryRe.exec(body);
    const primary = pm ? pm[1] : null;

    const syntaxLineRe =
      /--tv-syntax-keyword\s*:\s*#[0-9a-fA-F]{3,6}\s*;\s*--tv-syntax-string\s*:\s*#[0-9a-fA-F]{3,6}\s*;\s*--tv-syntax-number\s*:\s*#[0-9a-fA-F]{3,6}\s*;/;
    const syntaxLineMatch = syntaxLineRe.exec(body);
    blocks.push({
      theme,
      mode: mode as "light" | "dark",
      bodyStart: start,
      bodyEnd: end,
      primary,
      syntaxLineMatch,
    });
  }
  return blocks;
}

function rewriteThemesCss(css: string): {
  out: string;
  changed: number;
  skipped: number;
} {
  const blocks = findBlocks(css);
  // Build a list of (replacement-start-offset, replacement-end, newText)
  // by iterating the file with awareness of where each block's body sits.
  // We rebuild from the end backwards so offsets stay valid.
  const replacements: { start: number; end: number; text: string }[] = [];
  let changed = 0;
  let skipped = 0;
  // We need absolute offsets of the syntax-line within the file. Re-find
  // each block body so we can map the relative match back to absolute.
  const bodyRe =
    /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(css)) !== null) {
    const [full, theme, mode, body] = m;
    const block = blocks.find((b) => b.theme === theme && b.mode === mode);
    if (!block || !block.primary || !block.syntaxLineMatch) {
      skipped += 1;
      continue;
    }
    const triple = deriveSyntax(block.primary, block.mode);
    const newLine = `--tv-syntax-keyword:${triple.keyword}; --tv-syntax-string:${triple.string}; --tv-syntax-number:${triple.number};`;
    const bodyOffset = m.index + full.indexOf(body);
    const start = bodyOffset + block.syntaxLineMatch.index;
    const end = start + block.syntaxLineMatch[0].length;
    replacements.push({ start, end, text: newLine });
    changed += 1;
  }
  // Apply from the end so indices are stable.
  replacements.sort((a, b) => b.start - a.start);
  let out = css;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return { out, changed, skipped };
}

function main() {
  const css = readFileSync(THEMES_PATH, "utf8");
  const { out, changed, skipped } = rewriteThemesCss(css);
  writeFileSync(THEMES_PATH, out, "utf8");
  console.log(
    `[generate-syntax-palette] rewrote ${changed} blocks (${skipped} skipped). file=${THEMES_PATH}`,
  );
}

main();
