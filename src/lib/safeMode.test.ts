// AC-189-06a — `decideSafeModeAction` pure decision-matrix tests. Migrated
// from `useSafeModeGate.test.ts` where the same matrix was asserted via
// `renderHook` + store mutations; pure unit coverage is cheaper and the
// hook test now only asserts wiring (store reads → pure call). Block
// reason text is asserted verbatim so downstream UIs (queryState.error,
// commitError.message) don't silently drift. date 2026-05-02.
import { describe, it, expect } from "vitest";
import { decideSafeModeAction } from "./safeMode";
import type { StatementAnalysis } from "./sql/sqlSafety";

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

  it("[AC-190-01-1] production × off + danger → block (prod-auto, Sprint 190)", () => {
    // Sprint 190 (FB-1b) — Hard auto. The toolbar "off" toggle is a no-op
    // on production connections; the gate now treats off-on-production as
    // strict-equivalent block, with a different override hint pointing at
    // the connection environment tag instead of the toolbar. Verbatim copy
    // is asserted because downstream UIs (queryState.error, commitError.
    // message) must not silently drift. Was AC-189-06a-5 (allow). date
    // 2026-05-02.
    expect(decideSafeModeAction("off", "production", DANGER)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: DROP TABLE (production environment forces Safe Mode — change connection environment tag to override)",
    });
  });

  it("[AC-190-01-2] production × off + safe → allow (prod-auto only fires on danger)", () => {
    // Negative case: Hard auto must not block safe statements just because
    // the connection is production. SELECT / read-only flows on a
    // production-tagged connection still proceed. date 2026-05-02.
    expect(decideSafeModeAction("off", "production", SAFE)).toEqual({
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

  // Sprint 244 — read-only policy on production+strict/off. The user
  // reported (2026-05-08) that raw `UPDATE ... WHERE id = 1` and
  // `INSERT INTO ...` still ran under strict because the analyzer marks
  // them severity=safe (mass-mutation risk only). Strict on production
  // means "no writes at all" — same policy as the DataGrid's
  // `useSafeModeReadOnly` gate. Block on kind, not on severity, when
  // mode is strict/off.
  it("[AC-244-01] production × strict + UPDATE WHERE pk (safe-severity) → block", () => {
    const update: StatementAnalysis = {
      kind: "update",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", update)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: UPDATE statement (toggle Safe Mode off in toolbar to override)",
    });
  });

  it("[AC-244-02] production × strict + INSERT (safe-severity) → block", () => {
    const insert: StatementAnalysis = {
      kind: "insert",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", insert)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: INSERT statement (toggle Safe Mode off in toolbar to override)",
    });
  });

  it("[AC-244-03] production × strict + DELETE WHERE pk (safe-severity) → block", () => {
    const del: StatementAnalysis = {
      kind: "delete",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", del)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: DELETE statement (toggle Safe Mode off in toolbar to override)",
    });
  });

  it("[AC-244-04] production × strict + CREATE TABLE (ddl-other safe) → block", () => {
    const create: StatementAnalysis = {
      kind: "ddl-other",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", create)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: DDL-OTHER statement (toggle Safe Mode off in toolbar to override)",
    });
  });

  it("[AC-244-05] production × off + INSERT (safe-severity) → block (prod-auto)", () => {
    // off collapses to strict on production — the toolbar can't bypass
    // the read-only policy either; the override hint points at the
    // connection environment tag.
    const insert: StatementAnalysis = {
      kind: "insert",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("off", "production", insert)).toEqual({
      action: "block",
      reason:
        "Safe Mode blocked: INSERT statement (production environment forces Safe Mode — change connection environment tag to override)",
    });
  });

  it("[AC-244-06] production × warn + INSERT (safe-severity) → allow (warn keeps existing severity-driven policy)", () => {
    // warn deliberately stays friction-free for write-with-WHERE / INSERT;
    // only analyzer-flagged danger (DELETE without WHERE, $out, etc.)
    // raises a confirm. The Sprint 244 read-only tightening is strict-
    // only — warn users opted out.
    const insert: StatementAnalysis = {
      kind: "insert",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("warn", "production", insert)).toEqual({
      action: "allow",
    });
  });

  it("[AC-244-07] production × strict + Mongo read pipeline (mongo-other safe) → allow", () => {
    // Mongo read aggregates aren't SQL writes and aren't danger, so
    // strict still allows them. Mongo writes ($out/$merge/delete-all)
    // are caught via severity=danger by the analyzer, so they fall into
    // the existing danger branch.
    const mongoRead: StatementAnalysis = {
      kind: "mongo-other",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "production", mongoRead)).toEqual({
      action: "allow",
    });
  });

  it("[AC-244-08] non-production + strict + INSERT → allow (non-prod bypass)", () => {
    // Sprint 244 read-only policy applies only on production. Staging /
    // dev / local are unaffected so dev workflows aren't disrupted.
    const insert: StatementAnalysis = {
      kind: "insert",
      severity: "safe",
      reasons: [],
    };
    expect(decideSafeModeAction("strict", "staging", insert)).toEqual({
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
