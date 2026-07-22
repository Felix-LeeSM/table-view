import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";
import {
  expectStatementAnalysisShape,
  usePreloadedSqlAst,
} from "./sqlSafetyTestHarness";

describe("sqlSafety.analyzeStatement — AST destructive and write contracts", () => {
  // -------------------------------------------------------------------------
  // Sprint 391 (2026-05-17) — AST-based DDL destructive classifier callsite.
  // 본 블록은 *WASM 모듈을 명시적으로 preload* 한 뒤 `analyzeStatement` 가
  // `parseSqlPreloaded` 경로를 거치는 것을 가정한다. 모든 case 의 반환 shape
  // (`kind` / `severity` / `reasons`) 는 정규식 fallback 과 *동일* — 호출자
  // 영향 0 임을 입증.
  // -------------------------------------------------------------------------
  describe("Sprint 391 — AST-based DDL destructive classifier (AC-391-X)", () => {
    usePreloadedSqlAst();

    it("[AC-391-X01] DROP TABLE users → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02] DROP TABLE IF EXISTS users CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE IF EXISTS users CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02b] DROP SCHEMA public CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP SCHEMA public CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SCHEMA"]);
    });

    it("[AC-391-X02c] DROP SEQUENCE my_seq → ddl-drop / danger via AST (new variant)", () => {
      // Pre-sprint-391 regex did NOT match SEQUENCE — it fell through to
      // the `^DROP\b/^ALTER\b/^CREATE\b` catch-all (`ddl-other` / WARN).
      // The AST path correctly classifies it as `ddl-drop` / DANGER.
      // This is the *only* case where AST vs regex differ; sqlSafety
      // test suite previously had no SEQUENCE coverage so no regression.
      const a = analyzeStatement("DROP SEQUENCE my_seq");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SEQUENCE"]);
    });

    it("[AC-391-X02d] DROP TYPE my_enum CASCADE → ddl-drop / danger via AST (new variant)", () => {
      const a = analyzeStatement("DROP TYPE my_enum CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TYPE"]);
    });

    it("[AC-391-X03] TRUNCATE TABLE events → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE TABLE events");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X04] TRUNCATE users RESTART IDENTITY CASCADE → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE users RESTART IDENTITY CASCADE");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X05] ALTER TABLE users DROP COLUMN email → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP COLUMN"]);
    });

    it("[AC-391-X06] ALTER TABLE users DROP CONSTRAINT pk CASCADE → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement(
        "ALTER TABLE users DROP CONSTRAINT pk CASCADE",
      );
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP CONSTRAINT"]);
    });

    it("[AC-391-X06b] ALTER TABLE users DROP INDEX idx → ddl-alter-drop / danger via AST (MySQL-style)", () => {
      // Pre-sprint-391 regex matched COLUMN/CONSTRAINT only — `DROP INDEX`
      // on ALTER TABLE fell through to `ddl-other` / WARN. AST correctly
      // classifies it as `ddl-alter-drop` / DANGER. Existing sqlSafety
      // tests do not cover this so no regression.
      const a = analyzeStatement("ALTER TABLE users DROP INDEX idx");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP INDEX"]);
    });

    it("[AC-391-X07] SELECT regression — AST path classifies SELECT as info (sprint-393a)", () => {
      // Sprint-393a — SELECT routes through the AST. The widened shape
      // (FROM list, etc.) maps to `kind:'select'` / `severity:'info'` —
      // same result as the pre-sprint-393a regex path.
      const a = analyzeStatement("SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-391-X07b] DELETE regression — DML still routes through regex (AST scope is DDL only)", () => {
      // Sprint-391 AST does NOT cover DML. The DELETE branch fires
      // before the DDL preload-AST branch, so this case is unaffected.
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
    });

    it("[AC-391-X08] AST callsite preserves the `StatementAnalysis` shape contract (kind / severity / reasons keys)", () => {
      const a = analyzeStatement("DROP TABLE users CASCADE");
      // Shape is exactly the same as the regex-era output — caller
      // narrowing (`a.kind === "ddl-drop"`) continues to work.
      expectStatementAnalysisShape(a);
      expect(isDangerous(a)).toBe(true);
      expect(isInfoStatement(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 392 (2026-05-18) — AST-based DML write triad classifier callsite.
  // Mirrors the sprint-391 block: preload the WASM module so
  // `parseSqlPreloaded` resolves to a real AST shape (the mock above
  // implements an inline mini-parser), then assert every DML case routes
  // through the AST without changing the return shape contract.
  // -------------------------------------------------------------------------
  describe("Sprint 392 — AST-based DML write triad classifier (AC-392-X)", () => {
    usePreloadedSqlAst();

    it("[AC-403-01c] INSERT INTO users VALUES (1) → dml-insert / info via AST", () => {
      const a = analyzeStatement("INSERT INTO users VALUES (1)");
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-02b] UPDATE WHERE → dml-update / warn via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-02c] UPDATE without WHERE → dml-update / danger + reason via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a'");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
    });

    it("[AC-403-03b] DELETE WHERE → dml-delete / warn via AST", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-03c] DELETE without WHERE → dml-delete / danger + reason via AST", () => {
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    });

    it("[AC-403-01d] INSERT … ON CONFLICT DO UPDATE → dml-insert / info via AST", () => {
      const a = analyzeStatement(
        "INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'",
      );
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    // #1624 — the DML shape-contract re-verification (former AC-392-X08) is
    // dropped: the `StatementAnalysis` shape is path-invariant and pinned once
    // per preloaded-AST file by AC-391-X08 above. UPDATE WHERE → warn (AST) is
    // pinned by AC-403-02b; isDangerous/isInfoStatement are severity-derived,
    // path-independent helpers already covered in the regex suite.

    it("[AC-439-X02] CALL AST path → routine-call / warn", () => {
      const a = analyzeStatement("CALL refresh_user_stats()");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    });

    it("[AC-448-X02] CALL user-variable AST path → routine-call / warn", () => {
      const a = analyzeStatement("CALL refresh_user_stats(@user_id)");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    });
  });

  describe("Issue 451 — MariaDB RETURNING Safe Mode decision", () => {
    usePreloadedSqlAst();

    it("[AC-451-S01] INSERT ... RETURNING remains additive info-tier", () => {
      const a = analyzeStatement(
        "INSERT INTO users (id) VALUES (1) RETURNING id",
      );

      expect(a).toEqual({
        kind: "dml-insert",
        severity: "info",
        reasons: [],
      });
    });

    it("[AC-451-S02] bounded DELETE ... RETURNING remains warn-tier", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1 RETURNING id");

      expect(a).toEqual({
        kind: "dml-delete",
        severity: "warn",
        reasons: [],
      });
    });

    it("[AC-451-S03] WHERE-less DELETE ... RETURNING remains danger-tier", () => {
      const a = analyzeStatement("DELETE FROM users RETURNING id");

      expect(a).toEqual({
        kind: "dml-delete",
        severity: "danger",
        reasons: ["DELETE without WHERE clause"],
      });
    });

    it("[AC-451-S04] UPDATE ... RETURNING follows the normal WHERE gate", () => {
      const bounded = analyzeStatement(
        "UPDATE users SET active = false WHERE id = 1 RETURNING id",
      );
      const unbounded = analyzeStatement(
        "UPDATE users SET active = false RETURNING id",
      );

      expect(bounded).toEqual({
        kind: "dml-update",
        severity: "warn",
        reasons: [],
      });
      expect(unbounded).toEqual({
        kind: "dml-update",
        severity: "danger",
        reasons: ["UPDATE without WHERE clause"],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1119 — writable-CTE body classification. The mocked parser here is
  // deliberately widened to emit a write op inside `ctes[]` (the real grammar
  // restricts CTE bodies to SELECT today — see the real-parser canary in
  // sqlWasmArtifact.test.ts). These prove the AST mapper analyzes CTE bodies
  // defensively: a destructive body inside a WITH clause is classified by its
  // worst part, not silently dropped as the wrapping SELECT's `info`.
  // -------------------------------------------------------------------------
  describe("Issue #1119 — AST-path writable CTE body analysis", () => {
    usePreloadedSqlAst();

    it("[AC-1119-01] WITH d AS (DELETE FROM users RETURNING id) SELECT * → danger (WHERE-less write in CTE body)", () => {
      const a = analyzeStatement(
        "WITH d AS (DELETE FROM users RETURNING id) SELECT * FROM d",
      );
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
      expect(isDangerous(a)).toBe(true);
    });

    it("[AC-1119-02] WITH d AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * → warn (bounded write in CTE body)", () => {
      const a = analyzeStatement(
        "WITH d AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM d",
      );
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(isInfoStatement(a)).toBe(false);
    });

    it("[AC-1119-03] WITH u AS (UPDATE users SET active = false RETURNING id) SELECT * → danger (WHERE-less update in CTE body)", () => {
      const a = analyzeStatement(
        "WITH u AS (UPDATE users SET active = false RETURNING id) SELECT * FROM u",
      );
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
    });

    it("[AC-1119-04] read-only WITH t AS (SELECT 1) SELECT * → info (no regression for normal CTE)", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM t");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(isInfoStatement(a)).toBe(true);
    });
  });
});
