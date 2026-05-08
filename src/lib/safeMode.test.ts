// Sprint 245 (ADR 0022 Phase 1) — `decideSafeModeAction` matrix tests.
// Sprint 244's "production+strict|off = read-only" policy was reverted;
// the new matrix is destructive-only with a non-production strict mode
// destructive-dialog flow (M.1).
//
// Original Sprint 189 (`AC-189-06a-*`) coverage of the read / safe-write
// pass-through is preserved + extended; Sprint 244's `[AC-244-01..08]`
// read-only assertions were removed because they no longer match the
// policy. The 8 representative matrix cases below (`L1..L8`) cover every
// branch of `decideSafeModeAction`. Block-action verbatim copy used to
// be asserted here; under Phase 1 the policy never returns `block`, so
// only `confirm` reasons are pinned.
//
// date 2026-05-08 (Sprint 245 — ADR 0022 Phase 1).
import { describe, it, expect } from "vitest";
import { decideSafeModeAction } from "./safeMode";
import type { StatementAnalysis } from "./sql/sqlSafety";

const DROP: StatementAnalysis = {
  kind: "ddl-drop",
  severity: "danger",
  reasons: ["DROP TABLE"],
};
const SELECT_ANALYSIS: StatementAnalysis = {
  kind: "select",
  severity: "safe",
  reasons: [],
};
const UPDATE_WHERE: StatementAnalysis = {
  kind: "update",
  severity: "safe",
  reasons: [],
};
const INSERT: StatementAnalysis = {
  kind: "insert",
  severity: "safe",
  reasons: [],
};
const CREATE: StatementAnalysis = {
  kind: "ddl-other",
  severity: "safe",
  reasons: [],
};
const TRUNCATE: StatementAnalysis = {
  kind: "ddl-truncate",
  severity: "danger",
  reasons: ["TRUNCATE"],
};
const DELETE_NO_WHERE: StatementAnalysis = {
  kind: "delete",
  severity: "danger",
  reasons: ["DELETE without WHERE clause"],
};

describe("decideSafeModeAction — Sprint 245 destructive-only matrix", () => {
  // ── L1: non-prod + strict + destructive → confirm (M.1 NEW flow) ──
  it("[AC-245-L1] non-production + strict + destructive (DROP TABLE) → confirm with strict-mode reason", () => {
    expect(decideSafeModeAction("strict", "development", DROP)).toEqual({
      action: "confirm",
      reason:
        "DROP TABLE (Safe Mode strict — destructive statement in non-production)",
    });
    // Same shape on staging / local / testing.
    expect(decideSafeModeAction("strict", "staging", TRUNCATE)).toEqual({
      action: "confirm",
      reason:
        "TRUNCATE (Safe Mode strict — destructive statement in non-production)",
    });
  });

  // ── L2: non-prod + strict + safe write → allow ──
  it("[AC-245-L2] non-production + strict + safe write (UPDATE WHERE / INSERT / CREATE) → allow", () => {
    expect(decideSafeModeAction("strict", "development", UPDATE_WHERE)).toEqual(
      { action: "allow" },
    );
    expect(decideSafeModeAction("strict", "staging", INSERT)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("strict", "local", CREATE)).toEqual({
      action: "allow",
    });
  });

  // ── L3: non-prod + strict + read → allow ──
  it("[AC-245-L3] non-production + strict + read (SELECT) → allow", () => {
    expect(
      decideSafeModeAction("strict", "development", SELECT_ANALYSIS),
    ).toEqual({ action: "allow" });
  });

  // ── L4: non-prod + warn + * → allow (3 statement classes) ──
  it("[AC-245-L4] non-production + warn + (destructive | safe write | read) → allow", () => {
    expect(decideSafeModeAction("warn", "development", DROP)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("warn", "development", UPDATE_WHERE)).toEqual({
      action: "allow",
    });
    expect(
      decideSafeModeAction("warn", "development", SELECT_ANALYSIS),
    ).toEqual({ action: "allow" });
    // null environment is treated as non-production / allow (defensive
    // — Mongo aggregate path can fire before the connection store has
    // hydrated).
    expect(decideSafeModeAction("warn", null, DROP)).toEqual({
      action: "allow",
    });
  });

  // ── L5: non-prod + off + * → allow ──
  it("[AC-245-L5] non-production + off + (destructive | safe write | read) → allow", () => {
    expect(decideSafeModeAction("off", "development", DROP)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("off", "development", INSERT)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("off", "development", SELECT_ANALYSIS)).toEqual(
      { action: "allow" },
    );
  });

  // ── L6: production + (strict|warn|off) + destructive → confirm ──
  it("[AC-245-L6] production + strict + destructive → confirm with bare analyzer reason (Phase 1 type-to-confirm)", () => {
    // Phase 1 dialog still uses type-to-confirm; the longer override-
    // hint text would force users to type the override instructions.
    // Phase 2 (Sprint 246) will redesign the dialog to surface the
    // override hint outside the typed string.
    expect(decideSafeModeAction("strict", "production", DROP)).toEqual({
      action: "confirm",
      reason: "DROP TABLE",
    });
  });

  it("[AC-245-L6] production + warn + destructive → confirm with bare analyzer reason (preserves Sprint 244 warn-tier dialog text)", () => {
    expect(decideSafeModeAction("warn", "production", DELETE_NO_WHERE)).toEqual(
      {
        action: "confirm",
        reason: "DELETE without WHERE clause",
      },
    );
  });

  it("[AC-245-L6] production + off + destructive → confirm with prod-auto copy", () => {
    // prod-auto copy preserved from Sprint 190 / 244 so off remains
    // distinguishable from warn on production (downstream UI guidance
    // points at the connection environment tag instead of the toolbar).
    expect(decideSafeModeAction("off", "production", DROP)).toEqual({
      action: "confirm",
      reason:
        "DROP TABLE (production environment forces Safe Mode — change connection environment tag to override)",
    });
  });

  // ── L7: production + (strict|warn|off) + safe write → allow ──
  it("[AC-245-L7] production + (strict | warn | off) + safe write → allow", () => {
    // The headline regression fix for ADR 0022: prod+strict+INSERT and
    // prod+strict+UPDATE WHERE no longer block. Safe writes flow
    // through; Cmd+Z (Phase 5) is the safety net.
    expect(decideSafeModeAction("strict", "production", INSERT)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("strict", "production", UPDATE_WHERE)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("warn", "production", INSERT)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("off", "production", UPDATE_WHERE)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("strict", "production", CREATE)).toEqual({
      action: "allow",
    });
  });

  // ── L8: production + (strict|warn|off) + read → allow ──
  it("[AC-245-L8] production + (strict | warn | off) + read → allow", () => {
    expect(
      decideSafeModeAction("strict", "production", SELECT_ANALYSIS),
    ).toEqual({ action: "allow" });
    expect(decideSafeModeAction("warn", "production", SELECT_ANALYSIS)).toEqual(
      { action: "allow" },
    );
    expect(decideSafeModeAction("off", "production", SELECT_ANALYSIS)).toEqual({
      action: "allow",
    });
  });

  // ── Defensive: empty `reasons` array on a danger analysis ──
  it("danger with empty reasons → confirm uses fallback text", () => {
    // Defensive: danger severity should always carry at least one
    // reason string, but if the analyzer ever returns an empty array we
    // still surface a meaningful confirm message rather than `undefined`.
    const danger: StatementAnalysis = {
      kind: "ddl-drop",
      severity: "danger",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", danger)).toEqual({
      action: "confirm",
      reason: "Dangerous statement",
    });
  });
});
