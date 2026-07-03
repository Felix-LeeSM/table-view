import { describe, it, expect } from "vitest";
import {
  parseSingleTableSelect,
  analyzeResultEditability,
  resolveDefaultSchema,
} from "./queryAnalyzer";
import type { ColumnInfo } from "@/types/schema";
import type { QueryColumn } from "@/types/query";

function col(
  name: string,
  dataType: string,
  is_primary_key = false,
): ColumnInfo {
  return {
    name,
    data_type: dataType,
    nullable: !is_primary_key,
    default_value: null,
    is_primary_key,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

function qcol(name: string, dataType = "text"): QueryColumn {
  return { name, dataType, category: "unknown" };
}

describe("parseSingleTableSelect", () => {
  it("parses a bare SELECT * FROM table", () => {
    expect(parseSingleTableSelect("SELECT * FROM users")).toEqual({
      schema: null,
      table: "users",
    });
  });

  it("parses schema-qualified table", () => {
    expect(parseSingleTableSelect("SELECT id FROM public.users")).toEqual({
      schema: "public",
      table: "users",
    });
  });

  it("handles double-quoted identifiers", () => {
    expect(
      parseSingleTableSelect('SELECT * FROM "MySchema"."Order Items"'),
    ).toEqual({ schema: "MySchema", table: "Order Items" });
  });

  it("ignores trailing semicolons", () => {
    expect(parseSingleTableSelect("SELECT * FROM users;")).toEqual({
      schema: null,
      table: "users",
    });
  });

  it("strips leading line and block comments", () => {
    expect(
      parseSingleTableSelect("-- header\n/* note */ SELECT * FROM users"),
    ).toEqual({ schema: null, table: "users" });
  });

  it("accepts WHERE / ORDER BY / LIMIT clauses", () => {
    expect(
      parseSingleTableSelect(
        "SELECT id, name FROM public.users WHERE id > 0 ORDER BY id LIMIT 100",
      ),
    ).toEqual({ schema: "public", table: "users" });
  });

  it("returns null for JOIN", () => {
    expect(
      parseSingleTableSelect(
        "SELECT * FROM users u JOIN orders o ON u.id = o.uid",
      ),
    ).toBeNull();
  });

  it("returns null for comma-separated multi-source", () => {
    expect(parseSingleTableSelect("SELECT * FROM users, orders")).toBeNull();
  });

  it("returns null for subquery in FROM", () => {
    expect(parseSingleTableSelect("SELECT * FROM (SELECT 1) sub")).toBeNull();
  });

  it("returns null for CTE / WITH", () => {
    expect(
      parseSingleTableSelect("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    ).toBeNull();
  });

  it("returns null for UNION", () => {
    expect(
      parseSingleTableSelect(
        "SELECT * FROM users UNION SELECT * FROM customers",
      ),
    ).toBeNull();
  });

  it("returns null for non-SELECT", () => {
    expect(parseSingleTableSelect("INSERT INTO users VALUES (1)")).toBeNull();
    expect(parseSingleTableSelect("UPDATE users SET x = 1")).toBeNull();
    expect(parseSingleTableSelect("DELETE FROM users")).toBeNull();
  });

  it("returns null for empty / whitespace-only / comment-only input", () => {
    expect(parseSingleTableSelect("")).toBeNull();
    expect(parseSingleTableSelect("   \n\t  ")).toBeNull();
    expect(parseSingleTableSelect("-- just a comment")).toBeNull();
  });

  it("ignores subqueries appearing in the column list", () => {
    // (SELECT 1) is in the projection, not the FROM — still single-table.
    expect(
      parseSingleTableSelect("SELECT (SELECT 1) AS one, id FROM users"),
    ).toEqual({ schema: null, table: "users" });
  });

  it("returns null for CROSS JOIN / NATURAL JOIN", () => {
    expect(
      parseSingleTableSelect("SELECT * FROM users CROSS JOIN orders"),
    ).toBeNull();
    expect(
      parseSingleTableSelect("SELECT * FROM users NATURAL JOIN orders"),
    ).toBeNull();
  });

  // Purpose: comment-aware editability — a JOIN/UNION that lives inside a
  // SQL comment must NOT disqualify a single-table SELECT. The pre-fix
  // analyser only stripped LEADING comments, so a trailing/inline `-- JOIN`
  // or `/* UNION */` matched the raw JOIN/UNION regex and flipped the result
  // to read-only. User report (2026-07-03), issue #1226.
  describe("comment-processed keywords (#1226)", () => {
    // Reason: issue #1226 symptom #2 — a trailing line comment naming JOIN
    // must be ignored, keeping the query editable (2026-07-03).
    it("treats a trailing -- line comment with JOIN as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users -- JOIN orders o\n"),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a standalone comment line naming JOIN after the
    // FROM clause is still a comment, not a real join (2026-07-03).
    it("treats a following comment line with JOIN as single-table", () => {
      expect(
        parseSingleTableSelect(
          "SELECT id FROM public.users\n-- JOIN orders o ON u.id = o.uid",
        ),
      ).toEqual({ schema: "public", table: "users" });
    });

    // Reason: issue #1226 — block comments naming JOIN must be ignored, and
    // stripping one must not fuse the neighbouring identifiers (2026-07-03).
    it("treats a /* JOIN */ block comment as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users /* JOIN orders */"),
      ).toEqual({ schema: null, table: "users" });
      expect(
        parseSingleTableSelect("SELECT * FROM users/**/WHERE id > 0"),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a commented-out UNION must not disqualify the
    // query (the set-operation check ran on the comment-inclusive text too)
    // (2026-07-03).
    it("treats a commented-out UNION as single-table", () => {
      expect(
        parseSingleTableSelect(
          "SELECT * FROM users\n-- UNION SELECT * FROM admins",
        ),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a real block-comment-separated JOIN (comments act
    // as whitespace in SQL) must STILL be read-only; comment removal must not
    // fuse `users`+`JOIN` into an unmatched `usersJOIN` (2026-07-03).
    it("still returns null for a real JOIN separated only by a block comment", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users/**/JOIN orders o ON 1=1"),
      ).toBeNull();
    });

    // Reason: issue #1226 safety — comment stripping must be literal-aware.
    // A naive regex strip would treat the `--` inside the string literal as a
    // comment start and delete the trailing `UNION SELECT ...`, flipping a
    // genuinely multi-source query to falsely-editable (data-integrity risk)
    // (2026-07-03).
    it("keeps a UNION read-only even when a string literal contains --", () => {
      expect(
        parseSingleTableSelect(
          "SELECT * FROM users WHERE note = '-- ' UNION SELECT * FROM admins",
        ),
      ).toBeNull();
    });

    // Reason: issue #1226 — a JOIN token inside a WHERE string literal is not
    // a join; baseline confirms it stays editable and the fix preserves it
    // (the literal sits past the WHERE boundary) (2026-07-03).
    it("treats a WHERE string literal containing JOIN as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users WHERE note = 'JOIN'"),
      ).toEqual({ schema: null, table: "users" });
    });
  });
});

describe("analyzeResultEditability", () => {
  const TABLE_COLS = [col("id", "integer", true), col("name", "text")];

  it("returns editable when SELECT, PK present, and result includes PK", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM public.users",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("public");
      expect(result.table).toBe("users");
      expect(result.pkColumns).toEqual(["id"]);
    }
  });

  it("falls back to default schema when query has none", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM users",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("public");
    }
  });

  it("rejects non-single-table SELECT with a clear reason", () => {
    const result = analyzeResultEditability(
      "SELECT * FROM users JOIN orders ON users.id = orders.uid",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/single-table/i);
    }
  });

  it("rejects when table has no primary key", () => {
    const noPk = [col("a", "text"), col("b", "text")];
    const result = analyzeResultEditability(
      "SELECT * FROM things",
      [qcol("a"), qcol("b")],
      noPk,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/no primary key/i);
    }
  });

  it("rejects when result is missing PK columns", () => {
    const result = analyzeResultEditability(
      "SELECT name FROM users", // id missing
      [qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/missing primary-key/i);
      expect(result.reason).toMatch(/id/);
    }
  });

  it("returns 'loading' state when tableColumns is null", () => {
    const result = analyzeResultEditability(
      "SELECT * FROM users",
      [qcol("id"), qcol("name")],
      null,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/loading/i);
    }
  });
});

// Purpose: default-schema resolution for editable single-table SELECTs must
// follow each DBMS convention, not assume PostgreSQL "public" — issue #1066.
describe("resolveDefaultSchema", () => {
  // Reason: bug #1066 — mssql defaulted to "public" so `SELECT * FROM mytable`
  // never matched the cached "dbo" columns, breaking edit judgment (2026-07-03).
  it("maps mssql to dbo", () => {
    expect(resolveDefaultSchema("mssql", "master", "sa")).toBe("dbo");
  });

  // Reason: bug #1066 — Oracle's default schema is the connecting user, stored
  // upper-case in the catalog (2026-07-03).
  it("maps oracle to the upper-cased connecting user", () => {
    expect(resolveDefaultSchema("oracle", "FREEPDB1", "system")).toBe("SYSTEM");
  });

  // Reason: bug #1066 — MySQL/MariaDB have no schema layer; schema == database,
  // so an unqualified table lives in the active database (2026-07-03).
  it("maps mysql and mariadb to the active database", () => {
    expect(resolveDefaultSchema("mysql", "shop", "root")).toBe("shop");
    expect(resolveDefaultSchema("mariadb", "shop", "root")).toBe("shop");
  });

  // Reason: pre-#1066 behavior for pg/sqlite/duckdb must be preserved (2026-07-03).
  it("keeps postgresql on public and sqlite/duckdb on main", () => {
    expect(resolveDefaultSchema("postgresql", "postgres", "postgres")).toBe(
      "public",
    );
    expect(resolveDefaultSchema("sqlite", "", "")).toBe("main");
    expect(resolveDefaultSchema("duckdb", "", "")).toBe("main");
  });
});

// Purpose: end-to-end regression — an unqualified single-table SELECT on
// mssql/oracle must resolve to the DBMS default schema in the edit plan, so the
// result grid matches cached PK metadata instead of a phantom "public" table.
// Issue #1066 (bug, area:frontend, P1).
describe("analyzeResultEditability — per-DBMS default schema (#1066)", () => {
  const TABLE_COLS = [col("id", "integer", true), col("name", "text")];

  // Reason: bug #1066 — before the fix this returned schema "public",
  // producing a wrong editability match on SQL Server (2026-07-03).
  it("resolves an unqualified mssql table to dbo", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM mytable",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
      resolveDefaultSchema("mssql", "master", "sa"),
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("dbo");
    }
  });

  // Reason: bug #1066 — Oracle default schema = connecting user (2026-07-03).
  it("resolves an unqualified oracle table to the connecting user", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM mytable",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
      resolveDefaultSchema("oracle", "FREEPDB1", "system"),
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("SYSTEM");
    }
  });
});
