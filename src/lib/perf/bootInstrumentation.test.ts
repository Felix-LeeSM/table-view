/**
 * Sprint 175 — boot-instrumentation primitive tests.
 *
 * Reason: AC-175-01-02 requires the eight named milestones to be observable
 * via `performance.getEntriesByName()` AND visible in the single-line
 * boot summary; AC-175-01-05 requires missing milestones to render as a
 * literal `<missing>` token (not silent omission). These tests pin both
 * shapes so future sprints can refactor `boot()` without losing the
 * milestone surface. (2026-04-30)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetBootSummaryLogged,
  BOOT_MILESTONES,
  findMilestoneDelta,
  logBootSummary,
  markBootMilestone,
  markT0,
  summarizeBoot,
} from "./bootInstrumentation";

describe("bootInstrumentation", () => {
  beforeEach(() => {
    // Reset performance entries between tests so the "missing milestone"
    // case starts from a clean slate. `clearMarks`/`clearMeasures` accept
    // no args = clear all.
    if (typeof performance !== "undefined") {
      performance.clearMarks?.();
      performance.clearMeasures?.();
    }
    // sprint-175 — `logBootSummary` is idempotent across a single boot
    // (auto-triggers from `markBootMilestone("app:effects-fired")` AND
    // the 5s fallback in `scheduleBootSummary`). Reset the once-guard
    // between tests so each `it` can assert the single-log invariant
    // without leakage from a sibling test that fired the terminal mark.
    _resetBootSummaryLogged();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Reason: AC-175-01-02 — every named milestone must be observable via
  // `performance.getEntriesByName(name)`. (2026-04-30)
  it("records each BOOT_MILESTONES name as a performance entry", async () => {
    markT0();
    // Yield a tick so the wall-clock advances past T0 — keeps the deltas
    // strictly positive on fast hosts where the loop below would otherwise
    // record entries within the same `performance.now()` quantum.
    await new Promise((resolve) => setTimeout(resolve, 1));
    markBootMilestone("theme:applied");
    markBootMilestone("session:initialized");
    markBootMilestone("connectionStore:imported");
    markBootMilestone("connectionStore:hydrated");
    markBootMilestone("react:render-called");
    markBootMilestone("react:first-paint");
    markBootMilestone("app:effects-fired");

    for (const name of BOOT_MILESTONES) {
      const marks = performance.getEntriesByName(name, "mark");
      expect(
        marks.length,
        `expected at least one mark entry for ${name}`,
      ).toBeGreaterThan(0);
    }

    // T0 has no measure (it's the anchor); every other milestone does.
    for (const name of BOOT_MILESTONES) {
      if (name === "T0") continue;
      const measures = performance.getEntriesByName(name, "measure");
      expect(
        measures.length,
        `expected at least one measure entry for ${name}`,
      ).toBeGreaterThan(0);
    }
  });

  // Reason: AC-175-01-02 + Sprint 1 contract Test Requirements — missing
  // milestones MUST be visible as a literal `<missing>` token, not silently
  // dropped. (2026-04-30)
  it("renders missing milestones as <missing> in the summary line", () => {
    markT0();
    markBootMilestone("theme:applied");
    // intentionally skip session:initialized, connectionStore:imported,
    // connectionStore:hydrated, react:render-called, react:first-paint,
    // app:effects-fired

    const line = summarizeBoot();
    expect(line.startsWith("[boot] ")).toBe(true);
    expect(line).toContain("T0=0");
    expect(line).toContain("theme:applied=");
    expect(line).toContain("session:initialized=<missing>");
    expect(line).toContain("connectionStore:imported=<missing>");
    expect(line).toContain("connectionStore:hydrated=<missing>");
    expect(line).toContain("react:render-called=<missing>");
    expect(line).toContain("react:first-paint=<missing>");
    expect(line).toContain("app:effects-fired=<missing>");
  });

  // Reason: contract Test Requirements — boundary case for duplicate
  // marks; the contract accepts either "first or latest wins" so long as
  // calling twice does NOT throw. (2026-04-30)
  it("does not throw when the same milestone is marked twice", () => {
    markT0();
    expect(() => {
      markBootMilestone("theme:applied");
      markBootMilestone("theme:applied");
    }).not.toThrow();

    const marks = performance.getEntriesByName("theme:applied", "mark");
    expect(marks.length).toBeGreaterThanOrEqual(1);
  });

  // Reason: AC-175-01-02 — the summary line is the only stdout/console
  // emission of the instrumentation; assert its structured shape so a
  // future regression detector can parse it without HTML scraping.
  // (2026-04-30)
  it("logBootSummary emits a single console.info line and returns it", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    markT0();
    markBootMilestone("theme:applied");

    const returned = logBootSummary();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toBe(returned);
    expect(returned).toMatch(/^\[boot\] T0=\d+/);
    // Every BOOT_MILESTONES name appears in the line (either with a value
    // or with the gap token).
    for (const name of BOOT_MILESTONES) {
      expect(returned).toContain(`${name}=`);
    }
  });

  // Reason: AC-175-01-02 — `findMilestoneDelta` is the underlying primitive
  // used by both `summarizeBoot` and any future regression detector;
  // its null contract for missing milestones is load-bearing. (2026-04-30)
  it("returns null delta for missing milestones and a number otherwise", () => {
    markT0();
    markBootMilestone("theme:applied");

    expect(findMilestoneDelta("T0")).toBe(0);
    expect(findMilestoneDelta("theme:applied")).not.toBeNull();
    expect(typeof findMilestoneDelta("theme:applied")).toBe("number");
    expect(findMilestoneDelta("react:first-paint")).toBeNull();
    expect(findMilestoneDelta("app:effects-fired")).toBeNull();
  });

  // Reason: contract Required Checks #8/#9/#10 grep for milestone literals
  // in specific files; this test asserts the canonical list IS the eight
  // milestones the contract pins, in order. A future refactor that adds /
  // removes / reorders milestones would break the baseline report's table
  // shape and is rejected here. (2026-04-30)
  it("exports the eight contractual milestone names in order", () => {
    expect(BOOT_MILESTONES).toEqual([
      "T0",
      "theme:applied",
      "session:initialized",
      "connectionStore:imported",
      "connectionStore:hydrated",
      "react:render-called",
      "react:first-paint",
      "app:effects-fired",
    ]);
  });
});
