// Sprint 245 (ADR 0022 Phase 1) — `decideSafeModeAction` matrix tests.
// Sprint 244's "production+strict|off = read-only" policy was reverted;
// the new matrix is destructive-only with a non-production strict mode
// destructive-dialog flow (M.1).
//
// Original Sprint 189 (`AC-189-06a-*`) coverage of the read / safe-write
// pass-through is preserved + extended; Sprint 244's `[AC-244-01..08]`
// read-only assertions were removed because they no longer match the
// policy. The 8 representative matrix cases below (`L1..L8`) cover every
// branch of `decideSafeModeAction`.
//
// date 2026-05-08 (Sprint 245 — ADR 0022 Phase 1).
//
// Sprint 254 (2026-05-09) — `Severity` union 3-tier split. 기존 `"safe"` 로
// 분류된 SELECT / INSERT / UPDATE WHERE / CREATE 는 각각 INFO / WARN /
// WARN / WARN 으로 매핑. 매트릭스 *결과* 회귀 0 — INFO 는 allow, WARN 는 raw
// editor WARN dialog 가 QueryTab-level 에서 처리하므로 `decideSafeModeAction`
// 은 여전히 allow 반환. DANGER 는 기존 confirm 분기 그대로.
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
  severity: "info",
  reasons: [],
};
const UPDATE_WHERE: StatementAnalysis = {
  kind: "update",
  severity: "warn",
  reasons: [],
};
const INSERT: StatementAnalysis = {
  kind: "insert",
  severity: "warn",
  reasons: [],
};
const CREATE: StatementAnalysis = {
  kind: "ddl-other",
  severity: "warn",
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

describe("decideSafeModeAction — Sprint 245 destructive-only matrix (Sprint 254 union)", () => {
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

  // ── L2: non-prod + strict + warn write → allow ──
  it("[AC-245-L2] non-production + strict + WARN write (UPDATE WHERE / INSERT / CREATE) → allow", () => {
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

  // ── L3: non-prod + strict + INFO read → allow ──
  it("[AC-245-L3] non-production + strict + INFO (SELECT) → allow", () => {
    expect(
      decideSafeModeAction("strict", "development", SELECT_ANALYSIS),
    ).toEqual({ action: "allow" });
  });

  // ── L4: non-prod + warn + * → allow (3 statement classes) ──
  it("[AC-245-L4] non-production + warn + (destructive | warn write | info read) → allow", () => {
    expect(decideSafeModeAction("warn", "development", DROP)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("warn", "development", UPDATE_WHERE)).toEqual({
      action: "allow",
    });
    expect(
      decideSafeModeAction("warn", "development", SELECT_ANALYSIS),
    ).toEqual({ action: "allow" });
    // null environment is treated as non-production / allow.
    expect(decideSafeModeAction("warn", null, DROP)).toEqual({
      action: "allow",
    });
  });

  // ── L5: non-prod + off + * → allow ──
  it("[AC-245-L5] non-production + off + (destructive | warn write | info read) → allow", () => {
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
  it("[AC-245-L6] production + strict + destructive → confirm with bare analyzer reason", () => {
    expect(decideSafeModeAction("strict", "production", DROP)).toEqual({
      action: "confirm",
      reason: "DROP TABLE",
    });
  });

  it("[AC-245-L6] production + warn + destructive → confirm with bare analyzer reason", () => {
    expect(decideSafeModeAction("warn", "production", DELETE_NO_WHERE)).toEqual(
      {
        action: "confirm",
        reason: "DELETE without WHERE clause",
      },
    );
  });

  it("[AC-245-L6] production + off + destructive → confirm with prod-auto copy", () => {
    expect(decideSafeModeAction("off", "production", DROP)).toEqual({
      action: "confirm",
      reason:
        "DROP TABLE (production environment forces Safe Mode — change connection environment tag to override)",
    });
  });

  // ── L7: production + (strict|warn|off) + WARN write → allow ──
  it("[AC-245-L7] production + (strict | warn | off) + WARN write → allow", () => {
    // Sprint 254 — UPDATE_WHERE / INSERT / CREATE 는 이제 severity:"warn".
    // SafeMode 매트릭스 결과는 회귀 0 — WARN tier 의 raw editor 표시 처리는
    // QueryTab-level (`pendingRdbWarn`) 의 책임이고, `decideSafeModeAction`
    // 은 여전히 allow 반환. ADR 0022 의 "safe writes 는 production 에서도
    // 통과" invariant 가 그대로 유지된다.
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

  // ── L8: production + (strict|warn|off) + INFO read → allow ──
  it("[AC-245-L8] production + (strict | warn | off) + INFO read → allow", () => {
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

  // ── Sprint 254 — explicit INFO/WARN tier coverage ──
  it("[AC-254-05a] INFO tier (severity 'info') → allow regardless of mode/env", () => {
    expect(
      decideSafeModeAction("strict", "production", SELECT_ANALYSIS),
    ).toEqual({
      action: "allow",
    });
    expect(
      decideSafeModeAction("strict", "development", SELECT_ANALYSIS),
    ).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("warn", null, SELECT_ANALYSIS)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("off", "production", SELECT_ANALYSIS)).toEqual({
      action: "allow",
    });
  });

  it("[AC-254-05b] WARN tier (severity 'warn') → allow regardless of mode/env (raw editor preview is QueryTab-level)", () => {
    expect(decideSafeModeAction("strict", "production", INSERT)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("warn", "production", UPDATE_WHERE)).toEqual({
      action: "allow",
    });
    expect(decideSafeModeAction("off", "development", CREATE)).toEqual({
      action: "allow",
    });
  });

  // ── Defensive: empty `reasons` array on a danger analysis ──
  it("danger with empty reasons → confirm uses fallback text", () => {
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
