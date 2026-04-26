import { describe, it, expect } from "vitest";
import { extractDbMutation } from "./sqlDialectMutations";

describe("extractDbMutation (sprint 132)", () => {
  // ── PG `\c` / `\connect` happy paths ──────────────────────────────────
  describe("postgres meta-connect", () => {
    it("matches `\\c admin`", () => {
      const hint = extractDbMutation("\\c admin", "postgres");
      expect(hint).toEqual({
        kind: "switch_database",
        dialect: "postgres",
        targetDb: "admin",
      });
    });

    it("matches `\\connect analytics`", () => {
      const hint = extractDbMutation("\\connect analytics", "postgres");
      expect(hint).toEqual({
        kind: "switch_database",
        dialect: "postgres",
        targetDb: "analytics",
      });
    });

    it('strips surrounding double quotes (`\\c "my db"`)', () => {
      const hint = extractDbMutation('\\c "my db"', "postgres");
      expect(hint).toEqual({
        kind: "switch_database",
        dialect: "postgres",
        targetDb: "my db",
      });
    });

    it("is case-insensitive on the meta keyword", () => {
      const hint = extractDbMutation("\\C admin", "postgres");
      expect(hint?.kind).toBe("switch_database");
      if (hint?.kind === "switch_database") {
        expect(hint.targetDb).toBe("admin");
      }
    });

    it("tolerates leading whitespace", () => {
      const hint = extractDbMutation("   \\c admin   ", "postgres");
      expect(hint?.kind).toBe("switch_database");
    });

    it("returns null when dialect is mysql even though SQL contains \\c", () => {
      const hint = extractDbMutation("\\c admin", "mysql");
      expect(hint).toBeNull();
    });
  });

  // ── PG SET search_path happy paths ───────────────────────────────────
  describe("postgres SET search_path", () => {
    it("captures the first schema from `SET search_path TO public`", () => {
      const hint = extractDbMutation("SET search_path TO public", "postgres");
      expect(hint).toEqual({
        kind: "switch_schema",
        dialect: "postgres",
        targetSchema: "public",
      });
    });

    it("captures only the first schema in a comma list", () => {
      const hint = extractDbMutation(
        "SET search_path TO analytics, public",
        "postgres",
      );
      expect(hint?.kind).toBe("switch_schema");
      if (hint?.kind === "switch_schema") {
        expect(hint.targetSchema).toBe("analytics");
      }
    });

    it("accepts `=` form (`SET search_path = analytics`)", () => {
      const hint = extractDbMutation("SET search_path = analytics", "postgres");
      expect(hint?.kind).toBe("switch_schema");
    });

    it("strips quotes around schema name", () => {
      const hint = extractDbMutation('SET search_path TO "Public"', "postgres");
      expect(hint?.kind).toBe("switch_schema");
      if (hint?.kind === "switch_schema") {
        expect(hint.targetSchema).toBe("Public");
      }
    });
  });

  // ── MySQL USE happy paths ─────────────────────────────────────────────
  describe("mysql USE", () => {
    it("matches `USE foo;`", () => {
      const hint = extractDbMutation("USE foo;", "mysql");
      expect(hint).toEqual({
        kind: "switch_database",
        dialect: "mysql",
        targetDb: "foo",
      });
    });

    it("is case-insensitive (`use FOO`)", () => {
      const hint = extractDbMutation("use FOO", "mysql");
      expect(hint?.kind).toBe("switch_database");
      if (hint?.kind === "switch_database") {
        expect(hint.targetDb).toBe("FOO");
      }
    });

    it("tolerates surrounding whitespace ` use foo `", () => {
      const hint = extractDbMutation(" use foo ", "mysql");
      expect(hint?.kind).toBe("switch_database");
    });

    it("strips backticks (`USE `my-db``)", () => {
      const hint = extractDbMutation("USE `my-db`", "mysql");
      expect(hint?.kind).toBe("switch_database");
      if (hint?.kind === "switch_database") {
        expect(hint.targetDb).toBe("my-db");
      }
    });
  });

  // ── Redis SELECT happy paths ──────────────────────────────────────────
  describe("redis SELECT", () => {
    it("matches `SELECT 0`", () => {
      const hint = extractDbMutation("SELECT 0", "redis");
      expect(hint).toEqual({ kind: "redis_select", databaseIndex: 0 });
    });

    it("matches `SELECT 15`", () => {
      const hint = extractDbMutation("SELECT 15", "redis");
      expect(hint?.kind).toBe("redis_select");
      if (hint?.kind === "redis_select") {
        expect(hint.databaseIndex).toBe(15);
      }
    });

    it("does not match `SELECT * FROM t`", () => {
      const hint = extractDbMutation("SELECT * FROM t", "redis");
      expect(hint).toBeNull();
    });
  });

  // ── Comment masking — false positive 0 ───────────────────────────────
  describe("comment masking — false positives must remain 0", () => {
    it("ignores `-- \\c admin` line comment (postgres)", () => {
      const hint = extractDbMutation("-- \\c admin", "postgres");
      expect(hint).toBeNull();
    });

    it("ignores `/* USE foo */` block comment (mysql)", () => {
      const hint = extractDbMutation("/* USE foo */", "mysql");
      expect(hint).toBeNull();
    });

    it("ignores `# USE bar` MySQL line comment", () => {
      const hint = extractDbMutation("# USE bar", "mysql");
      expect(hint).toBeNull();
    });

    it("ignores meta-command nested in a block comment ahead of SELECT 1", () => {
      const hint = extractDbMutation("/* \\c admin */ SELECT 1", "postgres");
      expect(hint).toBeNull();
    });
  });

  // ── String masking — false positive 0 ────────────────────────────────
  describe("string masking — false positives must remain 0", () => {
    it("ignores `SELECT 'use foo'` (mysql)", () => {
      const hint = extractDbMutation("SELECT 'use foo'", "mysql");
      expect(hint).toBeNull();
    });

    it("ignores `INSERT INTO t VALUES ('\\c admin')` (postgres)", () => {
      const hint = extractDbMutation(
        "INSERT INTO t VALUES ('\\c admin')",
        "postgres",
      );
      expect(hint).toBeNull();
    });

    it("ignores backtick-quoted body (`SELECT `use foo``) on mysql", () => {
      const hint = extractDbMutation("SELECT `use foo`", "mysql");
      expect(hint).toBeNull();
    });

    it("ignores embedded `-- \\c admin` inside a string literal (postgres)", () => {
      const hint = extractDbMutation(
        "SELECT 'inline -- \\c admin'",
        "postgres",
      );
      expect(hint).toBeNull();
    });
  });

  // ── Multi-statement: last match wins ─────────────────────────────────
  describe("multi-statement", () => {
    it("returns the LAST matching hint across `;`-separated statements", () => {
      const hint = extractDbMutation(
        "\\c first; SELECT 1; \\c second",
        "postgres",
      );
      expect(hint?.kind).toBe("switch_database");
      if (hint?.kind === "switch_database") {
        expect(hint.targetDb).toBe("second");
      }
    });

    it("returns null when only earlier statements match a different dialect", () => {
      // `\c admin` is a postgres pattern. With dialect=mysql, no match.
      const hint = extractDbMutation("\\c admin; SELECT 1; SELECT 2", "mysql");
      expect(hint).toBeNull();
    });
  });

  // ── Empty / non-mutation / boundary inputs ────────────────────────────
  describe("non-mutation inputs", () => {
    it("returns null for empty string", () => {
      expect(extractDbMutation("", "postgres")).toBeNull();
    });

    it("returns null for whitespace only", () => {
      expect(extractDbMutation("   \n\t  ", "postgres")).toBeNull();
    });

    it("returns null for `SELECT 1` (postgres)", () => {
      expect(extractDbMutation("SELECT 1", "postgres")).toBeNull();
    });

    it("returns null for an unrelated DDL statement", () => {
      expect(
        extractDbMutation("CREATE TABLE foo (id int);", "postgres"),
      ).toBeNull();
    });

    it("returns null for `SELECT 1; -- not a switch` (postgres)", () => {
      expect(
        extractDbMutation("SELECT 1; -- not a switch", "postgres"),
      ).toBeNull();
    });
  });
});
