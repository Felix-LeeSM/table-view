// Issue #1117 — Safe Mode classifier coverage sweep.
//
// Three families of gaps closed here:
//  1. Session integrity switches (FK/constraint/trigger enforcement OFF) —
//     escalated from config-write/info to config-write/warn. Same risk as a
//     bounded write (arms a later destructive step), so same warning tier.
//  2. Opaque/deferred-execution + external-mount statements — PREPARE / ATTACH
//     / DETACH — were fail-open other/info; now warn (parity with EXECUTE and
//     USE respectively).
//  3. Known-safe utility/session statements (transaction control, maintenance,
//     benign PRAGMA) — explicitly registered as `known-safe`/info so
//     "classified as safe" is distinguishable from "unrecognised → fail-open
//     info". This list is the precondition for any future fallback re-eval.
import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";

describe("Issue #1117 — session integrity switches → config-write / warn", () => {
  it("[AC-1117-01a] SET FOREIGN_KEY_CHECKS=0 (MySQL) → warn", () => {
    const a = analyzeStatement("SET FOREIGN_KEY_CHECKS=0");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([
      "세션 무결성 검사 비활성화 — 후속 파괴 작업 발판",
    ]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-1117-01b] SET SESSION UNIQUE_CHECKS = 0 → warn", () => {
    const a = analyzeStatement("SET SESSION UNIQUE_CHECKS = 0");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
  });

  it("[AC-1117-01c] SET GLOBAL FOREIGN_KEY_CHECKS = 0 → warn", () => {
    const a = analyzeStatement("SET GLOBAL FOREIGN_KEY_CHECKS = 0");
    expect(a.severity).toBe("warn");
  });

  it("[AC-1117-01d] SET session_replication_role = replica (Postgres) → warn", () => {
    const a = analyzeStatement("SET session_replication_role = replica");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
  });

  it("[AC-1117-01e] PRAGMA foreign_keys = OFF (SQLite) → warn", () => {
    const a = analyzeStatement("PRAGMA foreign_keys = OFF");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
  });

  it("[AC-1117-01f] PRAGMA ignore_check_constraints = ON → warn", () => {
    const a = analyzeStatement("PRAGMA ignore_check_constraints = ON");
    expect(a.severity).toBe("warn");
  });

  // ── consistency guards: re-enabling / ordinary SET stays benign ──────────
  it("[AC-1117-01g] SET FOREIGN_KEY_CHECKS=1 (re-enable) stays config-write / info", () => {
    const a = analyzeStatement("SET FOREIGN_KEY_CHECKS=1");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("info");
  });

  it("[AC-1117-01h] ordinary SET (timezone) stays config-write / info", () => {
    const a = analyzeStatement("SET time_zone = '+00:00'");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("info");
  });

  it("[AC-1117-01i] PRAGMA foreign_keys = ON (re-enable) stays known-safe / info", () => {
    const a = analyzeStatement("PRAGMA foreign_keys = ON");
    expect(a.severity).toBe("info");
  });
});

describe("Issue #1117 — PREPARE / ATTACH / DETACH → warn (was fail-open info)", () => {
  it("[AC-1117-02a] PREPARE stmt FROM '...' → routine-call / warn", () => {
    const a = analyzeStatement("PREPARE stmt FROM 'DELETE FROM users'");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["PREPARE — dynamic statement definition"]);
    expect(isInfoStatement(a)).toBe(false);
  });

  it("[AC-1117-02b] ATTACH DATABASE (SQLite) → config-write / warn", () => {
    const a = analyzeStatement("ATTACH DATABASE 'other.db' AS other");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["ATTACH — 외부 DB 파일 마운트"]);
  });

  it("[AC-1117-02c] DETACH DATABASE → config-write / warn", () => {
    const a = analyzeStatement("DETACH DATABASE other");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["DETACH — 외부 DB 파일 해제"]);
  });
});

describe("Issue #1117 — known-safe utility/session statements → known-safe / info", () => {
  const cases: [string, string][] = [
    ["BEGIN", "BEGIN"],
    ["START TRANSACTION", "START TRANSACTION"],
    ["COMMIT", "COMMIT"],
    ["ROLLBACK", "ROLLBACK"],
    ["SAVEPOINT sp1", "SAVEPOINT"],
    ["RELEASE SAVEPOINT sp1", "RELEASE"],
    ["VACUUM", "VACUUM"],
    ["ANALYZE users", "ANALYZE"],
    ["REINDEX users", "REINDEX"],
    ["CHECKPOINT", "CHECKPOINT"],
    ["PRAGMA table_info(users)", "benign PRAGMA read"],
  ];
  for (const [sql, label] of cases) {
    it(`[AC-1117-03] ${label} → known-safe / info`, () => {
      const a = analyzeStatement(sql);
      expect(a.kind).toBe("known-safe");
      expect(a.severity).toBe("info");
      expect(isInfoStatement(a)).toBe(true);
    });
  }

  it("[AC-1117-03z] genuinely unrecognised statement stays other / info (fail-open kept distinct from known-safe)", () => {
    const a = analyzeStatement("FLARGLE zzz");
    expect(a.kind).toBe("other");
    expect(a.severity).toBe("info");
  });
});
