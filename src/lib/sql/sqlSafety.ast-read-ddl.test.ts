import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";
import { ddlAdditiveShapeSql, miscGrammarShapeSql } from "./sqlSafety.fixtures";
import {
  expectStatementAnalysisShape,
  usePreloadedSqlAst,
} from "./sqlSafetyTestHarness";

describe("sqlSafety.analyzeStatement — AST read, DDL, and misc contracts", () => {
  // -------------------------------------------------------------------------
  // Sprint 393a (2026-05-18) — AST-based SELECT classifier callsite.
  // SELECT widening (FROM-list / JOIN family / WHERE expression widening /
  // GROUP BY / HAVING / ORDER BY / LIMIT) routes through the AST and is
  // classified as `kind:'select'` / `severity:'info'` / `reasons:[]`. The
  // sprint-393a contract pins severity NOT to escalate for read-only joins /
  // aggregations / paging — that decision is deferred to a later sprint.
  // -------------------------------------------------------------------------
  describe("Sprint 393a — AST-based SELECT widening classifier (AC-393a-X)", () => {
    usePreloadedSqlAst();

    it("[AC-393a-X01] SELECT with JOIN + WHERE → select / info / [] via AST", () => {
      const a = analyzeStatement(
        "SELECT a FROM x JOIN y ON x.id = y.x_id WHERE x.flag = 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X02] SELECT with ORDER BY + LIMIT OFFSET → select / info / []", () => {
      const a = analyzeStatement(
        "SELECT a FROM x ORDER BY a LIMIT 10 OFFSET 5",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-443-X01] SELECT with MySQL LIMIT offset,count → select / info / []", () => {
      const a = analyzeStatement("SELECT a FROM x LIMIT 10, 20");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X03] every widened SELECT clause populated → still select / info / []", () => {
      // AC-393a-F01's full-clause-chain input — exercises FROM + WHERE +
      // GROUP BY + HAVING + ORDER BY + LIMIT + OFFSET in one statement.
      const a = analyzeStatement(
        "SELECT a FROM x WHERE x.a > 1 GROUP BY a HAVING a > 0 ORDER BY a LIMIT 5 OFFSET 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X04] existing sqlSafety tests regress to zero — SELECT path stays info", () => {
      // Spot-check the pre-sprint-393a SELECT inputs route through AST
      // and stay classified the same way as the regex path did. The full
      // regression-zero guarantee is pinned by the other AC-185 / AC-254
      // cases above (which run without preload).
      expect(analyzeStatement("SELECT * FROM users").severity).toBe("info");
      expect(
        analyzeStatement("SELECT id, name FROM users WHERE id = 1").severity,
      ).toBe("info");
    });

    it("[AC-393a-X05] StatementAnalysis return shape unchanged (kind / severity / reasons only)", () => {
      const a = analyzeStatement("SELECT a FROM x JOIN y ON x.id = y.x_id");
      expectStatementAnalysisShape(a);
      expect(isInfoStatement(a)).toBe(true);
      expect(isDangerous(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 393b — AST-based SELECT widening 2 + CTE wrap classifier
  // (AC-393b-X). The classifier inherits the inner statement's
  // classification (D1/D2) when the top-level kind is `with`.
  // -------------------------------------------------------------------------
  describe("Sprint 393b — AST-based CTE wrap + IN-list classifier (AC-393b-X)", () => {
    usePreloadedSqlAst();

    it("[AC-393b-X01] WITH wrapping SELECT → select / info / []", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM t");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X02] WITH wrapping INSERT → dml-insert / info (inherits inner DML classification)", () => {
      const a = analyzeStatement(
        "WITH t AS (SELECT 1) INSERT INTO x SELECT * FROM t",
      );
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    it("[AC-393b-X03] WITH wrapping UPDATE WHERE → update / warn", () => {
      const a = analyzeStatement(
        "WITH t AS (SELECT 1) UPDATE x SET a = 1 WHERE x.id = 1",
      );
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X04] WITH wrapping UPDATE without WHERE → update / danger + reason", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) UPDATE x SET a = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("danger");
      // Per D2, the reasons list is the inner statement's reasons,
      // unchanged (verbatim). The sprint-392 "UPDATE without WHERE clause"
      // surfaces.
      expect(a.reasons).toContain("UPDATE without WHERE clause");
    });

    it("[AC-393b-X05] WITH wrapping DELETE without WHERE → delete / danger + reason", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) DELETE FROM x");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toContain("DELETE without WHERE clause");
    });

    it("[AC-393b-X06] SELECT with UNION → still select / info / []", () => {
      const a = analyzeStatement("SELECT a FROM x UNION SELECT a FROM y");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-393b-X07] DELETE with IN-list (sprint-392 deferral lifted) → delete / warn / no extra reasons", () => {
      const a = analyzeStatement("DELETE FROM x WHERE x.id IN (1, 2, 3)");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X08] existing sqlSafety regression — bare SELECT path still info", () => {
      // The existing classifier behavior for SELECT must be preserved.
      expect(analyzeStatement("SELECT * FROM users").severity).toBe("info");
      // The existing classifier behavior for DELETE WHERE → warn must
      // be preserved.
      expect(analyzeStatement("DELETE FROM x WHERE id = 1").severity).toBe(
        "warn",
      );
    });

    it("[AC-393b-X09] StatementAnalysis return shape unchanged for the new `with` path", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM t");
      expectStatementAnalysisShape(a);
      expect(isInfoStatement(a)).toBe(true);
      expect(isDangerous(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 394 (2026-05-18) — AST-based DDL additive classifier callsite.
  // Pre-condition: WASM module preloaded (the mock above produces
  // create-table / create-index / create-view / alter-table-additive
  // shapes). Every case asserts the documented (kind, severity, reasons)
  // triple. Reason strings are pinned per D2 — reviewers must reject
  // silent rewording.
  // -------------------------------------------------------------------------
  describe("Sprint 394 — AST-based DDL additive classifier (AC-394-X)", () => {
    usePreloadedSqlAst();

    it("[AC-394-X01] CREATE TABLE → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE TABLE t (a INTEGER)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X02] CREATE INDEX → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE INDEX idx ON t (a)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X03] CREATE VIEW → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE VIEW v AS SELECT a FROM t");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X04] CREATE OR REPLACE VIEW does NOT escalate severity (D1)", () => {
      // D1: OR REPLACE on a view re-points the body but does not touch
      // existing rows / schema. The classification stays `info` —
      // identical to plain CREATE VIEW.
      const a = analyzeStatement("CREATE OR REPLACE VIEW v AS SELECT a FROM t");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X05] ALTER TABLE ADD COLUMN → ddl-alter-add / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t ADD COLUMN c TEXT");
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
      // Pinned per D2 — verbatim match required.
      expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    });

    it("[AC-394-X06] ALTER TABLE ADD CONSTRAINT → ddl-alter-add / warn / pinned reason (D2)", () => {
      const a = analyzeStatement(
        "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)",
      );
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — ADD CONSTRAINT (schema 변경)"]);
    });

    it("[AC-394-X07] ALTER TABLE RENAME TO → ddl-alter-rename / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t RENAME TO t2");
      expect(a.kind).toBe("ddl-alter-rename");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — RENAME (이름 변경)"]);
    });

    it("[AC-394-X08] ALTER TABLE RENAME COLUMN → ddl-alter-rename / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t RENAME COLUMN a TO b");
      expect(a.kind).toBe("ddl-alter-rename");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — RENAME COLUMN (이름 변경)"]);
    });

    it("[AC-394-X09] CREATE FUNCTION falls back to regex (ddl-create / info — D3 fallback contract)", () => {
      // The AST parser surfaces SyntaxError for CREATE FUNCTION (out of
      // scope this sprint). The classifier falls back to the regex path
      // which classifies `^CREATE\b` as `ddl-create` / info. The regex
      // path matches the AST classification for parity.
      const a = analyzeStatement(
        "CREATE FUNCTION foo() RETURNS void AS bar LANGUAGE plpgsql",
      );
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    it("[AC-394-X10] existing sqlSafety regression — DROP TABLE still danger via AST", () => {
      // Sanity — adding the sprint-394 branches must not regress the
      // sprint-391 DDL destructive classifier.
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
    });

    it("[AC-394-X11] StatementAnalysis return shape unchanged for the new DDL additive paths", () => {
      for (const sql of ddlAdditiveShapeSql) {
        const a = analyzeStatement(sql);
        expectStatementAnalysisShape(a);
      }
    });
  });

  describe("Sprint 395 — AST-based misc grammar classifier (AC-395-X)", () => {
    usePreloadedSqlAst();

    it("[AC-395-X01] GRANT → permission-change / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("GRANT SELECT ON users TO alice");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["GRANT — 권한 변경"]);
    });

    it("[AC-395-X02] REVOKE → permission-change / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("REVOKE SELECT ON users FROM alice");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["REVOKE — 권한 변경"]);
    });

    it("[AC-395-X03] EXPLAIN SELECT → inherits inner SELECT classification (D1)", () => {
      const a = analyzeStatement("EXPLAIN SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X04] EXPLAIN DELETE (no WHERE) → inherits inner DELETE classification (D1)", () => {
      const a = analyzeStatement("EXPLAIN DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      // The sprint-392 "WHERE 없는 DELETE" string passes through verbatim.
      expect(a.reasons).toContain("DELETE without WHERE clause");
    });

    it("[AC-395-X05] EXPLAIN ANALYZE UPDATE WHERE → update / danger (sprint-392 baseline) — inherits inner", () => {
      // Sprint-392 baseline classifies bare UPDATE WHERE as `update` /
      // `danger` when AST parses but the WHERE is in `unsupported-
      // expression` territory (`x.a > 0` qualified-column comparison was
      // not in sprint-392's narrow WHERE). Sprint-393b widened that —
      // qualified-column WHERE now parses, so the analysis returns
      // `update` / `warn` (bounded). EXPLAIN inherits per D1. We assert
      // the kind + severity; reasons are empty when WHERE is present.
      const a = analyzeStatement(
        "EXPLAIN ANALYZE UPDATE users SET a = 1 WHERE id = 1",
      );
      expect(a.kind).toBe("dml-update");
      // Bounded UPDATE WHERE — sprint-393b classifies as `warn`.
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X06] SHOW → config-read / info / empty reasons (D4)", () => {
      const a = analyzeStatement("SHOW search_path");
      expect(a.kind).toBe("config-read");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X07] SET → config-write / info / empty reasons (D3)", () => {
      const a = analyzeStatement("SET timezone = 'UTC'");
      expect(a.kind).toBe("config-write");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X08] COPY FROM → data-movement / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("COPY users FROM '/tmp/u.csv'");
      expect(a.kind).toBe("data-movement");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["COPY FROM — 대량 import"]);
    });

    it("[AC-395-X09] COPY TO → data-movement / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("COPY users TO '/tmp/u.csv'");
      expect(a.kind).toBe("data-movement");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["COPY TO — 대량 export"]);
    });

    it("[AC-395-X10] COMMENT → metadata / info / empty reasons", () => {
      const a = analyzeStatement("COMMENT ON TABLE users IS 'all'");
      expect(a.kind).toBe("metadata");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X11] EXPLAIN BEGIN → AST falls back; regex EXPLAIN branch returns info", () => {
      // BEGIN is not a supported inner statement for EXPLAIN (out of
      // scope), so the AST parser returns Error(...). The classifier
      // falls back to the regex path which classifies `^EXPLAIN\b` as
      // `info` / `info` / [].
      const a = analyzeStatement("EXPLAIN BEGIN");
      expect(a.severity).toBe("info");
    });

    it("[AC-395-X12] existing regression — DROP TABLE still danger via AST", () => {
      // Sanity — adding the sprint-395 branches must not regress the
      // sprint-391 DDL destructive classifier.
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
    });

    it("[AC-395-X13] StatementAnalysis return shape unchanged for the new misc paths", () => {
      for (const sql of miscGrammarShapeSql) {
        const a = analyzeStatement(sql);
        expectStatementAnalysisShape(a);
      }
    });
  });
});
