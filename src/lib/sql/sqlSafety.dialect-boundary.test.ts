import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";
import {
  mssqlBatchSeparatorSql,
  mssqlDestructiveDdlSql,
  mssqlScriptingBoundaryCases,
} from "./sqlSafety.fixtures";
import { usePreloadedSqlAst } from "./sqlSafetyTestHarness";

describe("sqlSafety.analyzeStatement — PostgreSQL and MSSQL boundary contracts", () => {
  describe("Sprint 482 — PostgreSQL parser Safe Mode kickoff (AC-482-X)", () => {
    usePreloadedSqlAst();

    it("[AC-482-X01] no-FROM SELECT stays select / info / []", () => {
      const a = analyzeStatement("SELECT 1");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-482-X02] SELECT-list function call stays select / info / []", () => {
      const a = analyzeStatement("SELECT count(*) FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  describe("Sprint 483 — PostgreSQL function-call expression Safe Mode (AC-483-X)", () => {
    usePreloadedSqlAst();

    it("[AC-483-X01] predicate function call stays select / info / []", () => {
      const a = analyzeStatement(
        "SELECT name FROM users WHERE lower(name) = 'felix'",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-483-X02] HAVING function call stays select / info / []", () => {
      const a = analyzeStatement(
        "SELECT region FROM sales GROUP BY region HAVING count(*) > 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  describe("Sprint 484 — PostgreSQL MERGE Safe Mode (AC-484-X)", () => {
    usePreloadedSqlAst();

    it("[AC-484-X01] parsed MERGE classifies as dml-merge / warn / []", () => {
      // Reason: MERGE is a conditional write surface and must not flow
      // through the read-only SELECT/other INFO paths. (2026-05-27)
      const a = analyzeStatement(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN UPDATE SET name = incoming.name",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-484-X02] unsupported MERGE fallback is warn, not info", () => {
      // Reason: unsupported MERGE shapes are still writes; fallback must
      // keep them out of INFO-tier execution. (2026-05-27)
      const a = analyzeStatement(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["MERGE — conditional write"]);
    });

    it("[AC-484-X03] EXPLAIN ANALYZE MERGE inherits MERGE warn tier", () => {
      // Reason: EXPLAIN ANALYZE can execute the inner statement, so
      // MERGE must inherit the DML classification. (2026-05-27)
      const a = analyzeStatement(
        "EXPLAIN ANALYZE MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DO NOTHING",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
    });
  });

  describe("Sprint 485 — PostgreSQL DO block Safe Mode boundary (AC-485-X)", () => {
    usePreloadedSqlAst();

    it("[AC-485-X01] DO block classifies as routine-call / warn, not info", () => {
      const a = analyzeStatement("DO $$ BEGIN RAISE NOTICE 'hi'; END $$");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["DO — procedural block execution"]);
    });

    it("[AC-485-X02] comment-prefixed DO keeps routine-call / warn", () => {
      const a = analyzeStatement(
        "-- maintenance\nDO $$ BEGIN RAISE NOTICE 'hi'; END $$",
      );
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["DO — procedural block execution"]);
    });
  });

  describe("Sprint 486 — PostgreSQL extension tolerance Safe Mode (AC-486-X)", () => {
    usePreloadedSqlAst();

    it("[AC-486-X01] extension operator SELECT stays select / info", () => {
      const a = analyzeStatement("SELECT id FROM docs WHERE title % 'table'");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-486-X02] extension type CREATE TABLE stays ddl-create / info", () => {
      const a = analyzeStatement(
        "CREATE TABLE docs (title citext, attrs hstore, embedding vector(3), geom geometry(Point, 4326))",
      );
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  describe("Issue 512 — MSSQL static Safe Mode boundary", () => {
    it("[AC-512-X01] SELECT TOP stays read-only info", () => {
      const a = analyzeStatement(
        "SELECT TOP (10) [id], [name] FROM [dbo].[users]",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(isInfoStatement(a)).toBe(true);
    });

    it("[AC-512-X02] bracketed DML preserves bounded/destructive tiers", () => {
      const update = analyzeStatement(
        "UPDATE [dbo].[users] SET [name] = N'Alice' WHERE [id] = 1",
      );
      expect(update.kind).toBe("dml-update");
      expect(update.severity).toBe("warn");

      const deleteAll = analyzeStatement("DELETE FROM [dbo].[users]");
      expect(deleteAll.kind).toBe("dml-delete");
      expect(deleteAll.severity).toBe("danger");
      expect(isDangerous(deleteAll)).toBe(true);
    });

    it("[AC-512-X03] bracketed destructive DDL still requires confirmation", () => {
      for (const sql of mssqlDestructiveDdlSql) {
        const a = analyzeStatement(sql);
        expect(a.severity).toBe("danger");
        expect(isDangerous(a)).toBe(true);
      }
    });

    it("[AC-512-X04] T-SQL scripting/admin boundaries do not fall through to info", () => {
      for (const expected of mssqlScriptingBoundaryCases) {
        const a = analyzeStatement(expected.sql);
        expect(a.kind).toBe(expected.kind);
        expect(a.severity).toBe(expected.severity);
        expect(a.reasons).toEqual(expected.reasons);
      }
    });

    it("[AC-512-X05] line-level GO inside mixed chunks stays bounded", () => {
      for (const sql of mssqlBatchSeparatorSql) {
        const a = analyzeStatement(sql);
        expect(a.kind).toBe("other");
        expect(a.severity).toBe("warn");
        expect(a.reasons).toEqual(["GO — T-SQL batch separator unsupported"]);
        expect(isInfoStatement(a)).toBe(false);
      }
    });
  });
});
