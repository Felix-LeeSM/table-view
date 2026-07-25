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

// Issue #1071 (PR #1795 review B4) — deferred-payload fail-open.
//
// `analyzeStatement` branches on the LEADING keyword, so a destructive
// statement that does not start at offset 0 was never seen: a T-SQL
// `IF <predicate> <statement>` head matched no branch and fell through to the
// `other`/info fail-open bucket, and an MSSQL batch led by `DECLARE` returned
// the procedural warn *before* the #1118 multi-statement split ran.
//
// The concrete asymmetry that surfaced this: the MSSQL column DEFAULT swap
// emits its `DROP CONSTRAINT` through dynamic SQL (T-SQL cannot name a
// constraint by variable), and `useDdlPreviewExecution` classified those
// statements as info — no confirmation dialog — while the PostgreSQL
// `ALTER TABLE … DROP CONSTRAINT` for the same user action is `danger`/confirm.
// Same destructive intent, two safety levels, decided by which engine the
// connection happens to be.
//
// Fail-open is the documented fallback for *unrecognised* statements; it is not
// a licence to skip a statement the roster does recognise but that sits behind
// a control-flow head or inside a dynamic-SQL variable assignment. (2026-07-25)
describe("Issue #1071 — deferred destructive payloads fail safe, not open", () => {
  it("[AC-1071-B4-01] IF-guarded DROP TABLE → danger (was other/info)", () => {
    const a = analyzeStatement("IF @c IS NOT NULL DROP TABLE users");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-1071-B4-02] dynamic-SQL assignment carrying DROP CONSTRAINT → danger", () => {
    // Statement 3 of the MSSQL DEFAULT swap, exactly as
    // `src-tauri/src/db/mssql/ddl.rs` emits it and
    // `useDdlPreviewExecution` splits it.
    const a = analyzeStatement(
      "SET @drop_default_0 = N'ALTER TABLE [dbo].[users] DROP CONSTRAINT ' + QUOTENAME(@default_name_0)",
    );
    expect(a.kind).toBe("ddl-alter-drop");
    expect(a.severity).toBe("danger");
    // Parity check: the PostgreSQL statement for the same user action.
    expect(
      analyzeStatement("ALTER TABLE users DROP CONSTRAINT users_status_df")
        .severity,
    ).toBe("danger");
  });

  it("[AC-1071-B4-03] MSSQL batch led by DECLARE no longer stops at the procedural warn", () => {
    const a = analyzeStatement("DECLARE @x INT; DROP TABLE users", {
      dialect: "mssql",
    });
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("ddl-drop");
    // Same batch without the MSSQL dialect already reached danger — that gap
    // between dialects is the defect.
    expect(analyzeStatement("DECLARE @x INT; DROP TABLE users").severity).toBe(
      "danger",
    );
  });

  it("[AC-1071-B4-04] IF-guarded EXEC of an opaque variable stays warn, not info", () => {
    const a = analyzeStatement("IF @sql IS NOT NULL EXEC(@sql)");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
  });

  // Non-regression: the rescan is scoped to control-flow heads and T-SQL local
  // variable assignments. A destructive-looking string in an ordinary DML/DQL
  // statement is data, not a deferred payload, and must not escalate.
  it("[AC-1071-B4-05] SQL-shaped text in a normal UPDATE literal does not escalate", () => {
    const a = analyzeStatement(
      "UPDATE users SET note = 'DROP TABLE users' WHERE id = 1",
    );
    expect(a.kind).toBe("dml-update");
    expect(a.severity).toBe("warn");
  });

  it("[AC-1071-B4-06] SELECT of a destructive-looking literal stays info", () => {
    const a = analyzeStatement("SELECT 'DROP TABLE users' AS t");
    expect(a.severity).toBe("info");
  });

  it("[AC-1071-B4-07] benign local variable assignment stays config-write / info", () => {
    const a = analyzeStatement("SET @x = 1");
    expect(a.kind).toBe("config-write");
    expect(a.severity).toBe("info");
  });

  it("[AC-1071-B4-08] a lone MSSQL DECLARE keeps the procedural warn", () => {
    const a = analyzeStatement("DECLARE @x INT", { dialect: "mssql" });
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([
      "T-SQL procedural scripting unsupported in Safe Mode",
    ]);
  });
});
