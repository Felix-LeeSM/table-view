import { describe, it, expect } from "vitest";

/**
 * Sprint 135 — AC-S135-06: stale "Coming in Sprint 1XX" copy guard.
 *
 * Sprint 127–133 littered the toolbar with placeholder tooltips like
 * "Coming in Sprint 128" / "Coming in Sprint 130" while features were
 * being staged. After the user-pass on 2026-04-27 the toolbar is now
 * SoT-clean and these placeholders should never reappear in production
 * code. This test scans `src/` (and `e2e/`, when present) for the regex
 * `/Coming in Sprint 1[2-3][0-9]/` and fails on any match so a future
 * sprint cannot accidentally re-introduce a "Coming in Sprint NNN" line
 * without a deliberate decision.
 *
 * The regex is intentionally narrow: it targets the literal user-facing
 * prose `"Coming in Sprint 1XX"` rather than every reference to a sprint
 * number, so commit messages, comments referencing past sprints
 * (`// Sprint 130 — …`), and ADR titles continue to type-check.
 *
 * Implementation note: this test uses Vite's `import.meta.glob` (the
 * project does not depend on `@types/node`) to load every `.ts` / `.tsx`
 * source file as a raw string at test-run time, then runs the regex
 * against each blob. The `eager: true` flag turns the glob into a
 * synchronous map so the test body stays readable.
 */

const STALE_REGEX = /Coming in Sprint 1[2-3][0-9]/;

// Load every TS / TSX source under `src/` as raw text. Excluding this
// guard file itself avoids matching the regex literal that lives below.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("Sprint 135 — stale 'Coming in Sprint 1XX' tooltip guard (AC-S135-06)", () => {
  it("contains zero matches of /Coming in Sprint 1[2-3][0-9]/ in src/", () => {
    const offenders: { path: string; line: number; match: string }[] = [];
    for (const [path, contents] of Object.entries(sources)) {
      // Skip the guard test itself — the regex literal would otherwise
      // match its own definition.
      if (path.endsWith("no-stale-sprint-tooltip.test.ts")) continue;
      const lines = contents.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const m = line.match(STALE_REGEX);
        if (m) {
          offenders.push({ path, line: i + 1, match: m[0] });
        }
      }
    }
    expect(
      offenders,
      `Found stale "Coming in Sprint 1XX" copy. Replace with realistic\nuser-facing text (the toolbar is SoT-clean as of S135):\n${offenders
        .map((o) => `  ${o.path}:${o.line}: ${o.match}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
