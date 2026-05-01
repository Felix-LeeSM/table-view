// AC-189-06a — `decideSafeModeAction` pure decision-matrix tests. Migrated
// from `useSafeModeGate.test.ts` where the same matrix was asserted via
// `renderHook` + store mutations; pure unit coverage is cheaper and the
// hook test now only asserts wiring (store reads → pure call). Block
// reason text is asserted verbatim so downstream UIs (queryState.error,
// commitError.message) don't silently drift. date 2026-05-02.
import { describe, it, expect } from "vitest";
import { decideSafeModeAction } from "./safeMode";
import type { StatementAnalysis } from "./sqlSafety";

const DANGER: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
};
const SAFE: StatementAnalysis = {
  kind: "select",
  severity: "safe",
  reasons: [],
};

describe("decideSafeModeAction", () => {
  it("[AC-189-06a-1] safe analysis → allow regardless of mode/environment", () => {
    expect(decideSafeModeAction("strict", "production", SAFE)).toEqual({
      action: "allow",
    });
  });

  it("[AC-189-06a-2] non-production environment → allow even with strict + danger", () => {
    expect(decideSafeModeAction("strict", "staging", DANGER)).toEqual({
      action: "allow",
    });
  });

  it("[AC-189-06a-3] production × strict + danger → block with canonical reason", () => {
    expect(decideSafeModeAction("strict", "production", DANGER)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: DROP TABLE (toggle Safe Mode off in toolbar to override)",
    });
  });

  it("[AC-189-06a-4] production × warn + danger → confirm with reason verbatim", () => {
    expect(decideSafeModeAction("warn", "production", DANGER)).toEqual({
      action: "confirm",
      reason: "DROP TABLE",
    });
  });

  it("[AC-189-06a-5] production × off + danger → allow", () => {
    expect(decideSafeModeAction("off", "production", DANGER)).toEqual({
      action: "allow",
    });
  });

  it("[AC-189-06a-6] null environment → treated as non-production / allow", () => {
    // Mongo aggregate path can fire before the connection store has hydrated
    // a particular id; default to safe (allow) rather than block.
    expect(decideSafeModeAction("strict", null, DANGER)).toEqual({
      action: "allow",
    });
  });

  it("[AC-189-06a-7] danger with empty reasons → block uses fallback text", () => {
    // Defensive: danger severity should always carry at least one reason
    // string, but if the analyzer ever returns an empty array we still
    // surface a meaningful block message rather than `undefined`.
    const danger: StatementAnalysis = {
      kind: "ddl-drop",
      severity: "danger",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", danger)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: Dangerous statement (toggle Safe Mode off in toolbar to override)",
    });
  });
});
