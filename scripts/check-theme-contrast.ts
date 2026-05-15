#!/usr/bin/env node
/**
 * scripts/check-theme-contrast.ts
 *
 * Sprint 113 (#A11Y-4): Validate that every theme/mode in src/themes.css
 * meets WCAG AA contrast (4.5:1) on the principal foreground/background
 * token pairs.
 *
 * Known brand-color compromises (e.g. white text on Stripe purple) are
 * tracked in `scripts/theme-contrast-allowlist.json`. The script fails
 * (exit 1) when:
 *   - a *new* violation is detected (theme/mode/pair not in allowlist), or
 *   - an allowlist entry is now passing (stale — should be removed).
 *
 * Run via `pnpm contrast:check`.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const AA_THRESHOLD = 4.5;

interface Pair {
  fg: string;
  bg: string;
  label: string;
  /**
   * ADR 0031 (2026-05-15) — `critical: true` 인 pair 의 AA 미달은
   * allowlist 진입 부적격 (반드시 토큰 값 fix). syntax 의미 구분에
   * 결정적인 6 토큰 (keyword/string/number/function/type/error) 이 여기
   * 속한다. 다른 syntax 토큰 (comment/operator/property/punct/atom/
   * builtin) 과 base UI pair 는 brand identity 우선시 allowlist 진입
   * 허용 (사유 명시 필요).
   */
  critical?: boolean;
}

export const PAIRS: ReadonlyArray<Pair> = [
  { fg: "foreground", bg: "background", label: "body text" },
  { fg: "card-foreground", bg: "card", label: "card text" },
  { fg: "popover-foreground", bg: "popover", label: "popover text" },
  { fg: "primary-foreground", bg: "primary", label: "primary button" },
  { fg: "secondary-foreground", bg: "secondary", label: "secondary panel" },
  { fg: "accent-foreground", bg: "accent", label: "accent surface" },
  // ADR 0031 — syntax 12 토큰 × `background`. critical 6 / 부수 6.
  {
    fg: "syntax-keyword",
    bg: "background",
    label: "syntax-keyword",
    critical: true,
  },
  {
    fg: "syntax-string",
    bg: "background",
    label: "syntax-string",
    critical: true,
  },
  {
    fg: "syntax-number",
    bg: "background",
    label: "syntax-number",
    critical: true,
  },
  {
    fg: "syntax-function",
    bg: "background",
    label: "syntax-function",
    critical: true,
  },
  { fg: "syntax-type", bg: "background", label: "syntax-type", critical: true },
  {
    fg: "syntax-error",
    bg: "background",
    label: "syntax-error",
    critical: true,
  },
  { fg: "syntax-comment", bg: "background", label: "syntax-comment" },
  { fg: "syntax-operator", bg: "background", label: "syntax-operator" },
  { fg: "syntax-property", bg: "background", label: "syntax-property" },
  { fg: "syntax-punct", bg: "background", label: "syntax-punct" },
  { fg: "syntax-atom", bg: "background", label: "syntax-atom" },
  { fg: "syntax-builtin", bg: "background", label: "syntax-builtin" },
];

export interface ThemeBlock {
  theme: string;
  mode: "light" | "dark";
  tokens: Record<string, string>;
}

export interface AllowlistEntry {
  theme: string;
  mode: "light" | "dark";
  pair: string;
  reason?: string;
}

export interface Violation {
  theme: string;
  mode: "light" | "dark";
  pair: string;
  fg: string;
  bg: string;
  ratio: number;
  /** ADR 0031 — critical pair 의 미달은 allowlist 진입 부적격. */
  critical?: boolean;
}

export interface CheckResult {
  themes: number;
  blocks: number;
  pairsChecked: number;
  newViolations: Violation[];
  allowlistedViolations: Violation[];
  staleAllowlist: AllowlistEntry[];
}

export function parseHex(hex: string): [number, number, number] | null {
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

export function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return null;
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function parseThemes(css: string): ThemeBlock[] {
  // ADR 0031 (2026-05-15) — 같은 selector 의 다중 블록을 (theme, mode)
  // 키로 merge. themes.css 는 base 토큰 블록 + syntax 토큰 블록을 같은
  // selector 로 따로 정의하므로 union 으로 합쳐야 base bg 와 syntax fg 가
  // 한 블록 안에서 pair check 가능하다.
  const map = new Map<string, ThemeBlock>();
  const re =
    /\[data-theme="([^"]+)"\]\[data-mode="(light|dark)"\]\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const [, theme, mode, body] = m;
    const key = `${theme}/${mode}`;
    let block = map.get(key);
    if (!block) {
      block = { theme, mode: mode as "light" | "dark", tokens: {} };
      map.set(key, block);
    }
    const tokenRe = /--tv-([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let t: RegExpExecArray | null;
    while ((t = tokenRe.exec(body)) !== null) {
      block.tokens[t[1].trim()] = t[2].trim();
    }
  }
  return [...map.values()];
}

export function entryKey(e: {
  theme: string;
  mode: string;
  pair: string;
}): string {
  return `${e.theme}/${e.mode}/${e.pair}`;
}

export function check(css: string, allowlist: AllowlistEntry[]): CheckResult {
  const blocks = parseThemes(css);
  const allowSet = new Set(allowlist.map(entryKey));
  const usedAllowKeys = new Set<string>();

  const violations: Violation[] = [];
  let pairsChecked = 0;

  for (const block of blocks) {
    for (const pair of PAIRS) {
      const fg = block.tokens[pair.fg];
      const bg = block.tokens[pair.bg];
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio === null) continue;
      pairsChecked += 1;
      if (ratio < AA_THRESHOLD) {
        violations.push({
          theme: block.theme,
          mode: block.mode,
          pair: pair.label,
          fg,
          bg,
          ratio,
          critical: pair.critical === true,
        });
      }
    }
  }

  // ADR 0031 — critical pair 미달은 allowlist 진입 부적격. allowlist 에
  // entry 가 있어도 newViolations 로 분류해 항상 차단.
  const newViolations: Violation[] = [];
  const allowlistedViolations: Violation[] = [];
  for (const v of violations) {
    const key = entryKey(v);
    if (v.critical) {
      newViolations.push(v);
      if (allowSet.has(key)) usedAllowKeys.add(key);
    } else if (allowSet.has(key)) {
      usedAllowKeys.add(key);
      allowlistedViolations.push(v);
    } else {
      newViolations.push(v);
    }
  }
  const staleAllowlist = allowlist.filter(
    (e) => !usedAllowKeys.has(entryKey(e)),
  );

  return {
    themes: new Set(blocks.map((b) => b.theme)).size,
    blocks: blocks.length,
    pairsChecked,
    newViolations,
    allowlistedViolations,
    staleAllowlist,
  };
}

function loadAllowlist(path: string): AllowlistEntry[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw?.entries)) return [];
  return raw.entries as AllowlistEntry[];
}

function runCli(): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const themesPath = resolve(here, "..", "src", "themes.css");
  const allowPath = resolve(here, "theme-contrast-allowlist.json");

  const css = readFileSync(themesPath, "utf8");
  const allowlist = loadAllowlist(allowPath);
  const result = check(css, allowlist);

  if (result.blocks === 0) {
    console.error(`No theme blocks parsed from ${themesPath}`);
    return 1;
  }

  let exitCode = 0;

  if (result.newViolations.length > 0) {
    exitCode = 1;
    console.error(
      `WCAG AA contrast FAILED: ${result.newViolations.length} new violation(s) below ${AA_THRESHOLD}:1`,
    );
    console.error("");
    for (const v of result.newViolations) {
      const tag = v.critical ? "[CRIT]" : "[NEW] ";
      console.error(
        `  ${tag} ${v.theme}/${v.mode} — ${v.pair}: ${v.fg} on ${v.bg} = ${v.ratio.toFixed(2)}:1`,
      );
    }
    console.error("");
    console.error(
      `Fix the contrast or add the entry to scripts/theme-contrast-allowlist.json with a justification.`,
    );
    console.error(
      `[CRIT] = critical syntax pair (keyword/string/number/function/type/error) — allowlist 진입 부적격, 토큰 값 fix 필수 (ADR 0031).`,
    );
  }

  if (result.staleAllowlist.length > 0) {
    exitCode = 1;
    console.error(
      `${result.staleAllowlist.length} allowlist entr${
        result.staleAllowlist.length === 1 ? "y is" : "ies are"
      } now passing — remove from scripts/theme-contrast-allowlist.json:`,
    );
    for (const e of result.staleAllowlist) {
      console.error(`  [STALE] ${entryKey(e)}`);
    }
  }

  if (exitCode === 0) {
    console.log(
      `WCAG AA contrast: ${result.themes} themes / ${result.blocks} theme-modes / ${result.pairsChecked} pairs — 0 new violations (${result.allowlistedViolations.length} allowlisted)`,
    );
  }

  return exitCode;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");

if (isMain) {
  process.exit(runCli());
}
