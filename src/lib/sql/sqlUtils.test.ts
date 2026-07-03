import { describe, it, expect } from "vitest";
import { splitSqlStatements, formatSql, uglifySql } from "./sqlUtils";

describe("splitSqlStatements", () => {
  it("splits simple statements", () => {
    const result = splitSqlStatements("SELECT 1; SELECT 2");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons in single-quoted strings", () => {
    const result = splitSqlStatements("SELECT 'hello;world'; SELECT 2");
    expect(result).toEqual(["SELECT 'hello;world'", "SELECT 2"]);
  });

  it("ignores semicolons in double-quoted identifiers", () => {
    const result = splitSqlStatements('SELECT "col;name" FROM t; SELECT 2');
    expect(result).toEqual(['SELECT "col;name" FROM t', "SELECT 2"]);
  });

  it("ignores semicolons in line comments", () => {
    const result = splitSqlStatements("SELECT 1; -- comment; here\nSELECT 2");
    expect(result).toEqual(["SELECT 1", "-- comment; here\nSELECT 2"]);
  });

  it("ignores semicolons in block comments", () => {
    const result = splitSqlStatements("SELECT 1; /* comment; here */ SELECT 2");
    expect(result).toEqual(["SELECT 1", "/* comment; here */ SELECT 2"]);
  });

  it("handles empty statements", () => {
    const result = splitSqlStatements("");
    expect(result).toEqual([]);
  });

  it("handles trailing semicolons", () => {
    const result = splitSqlStatements("SELECT 1;");
    expect(result).toEqual(["SELECT 1"]);
  });

  it("handles multiple trailing semicolons", () => {
    const result = splitSqlStatements("SELECT 1;;;");
    expect(result).toEqual(["SELECT 1"]);
  });

  it("handles only whitespace between statements", () => {
    const result = splitSqlStatements("SELECT 1;   ; SELECT 2");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("handles escaped single quotes", () => {
    const result = splitSqlStatements("SELECT 'it''s; ok'; SELECT 2");
    expect(result).toEqual(["SELECT 'it''s; ok'", "SELECT 2"]);
  });

  it("handles complex multi-line SQL", () => {
    const sql = `SELECT *
FROM users
WHERE name = 'test;value';

DELETE FROM logs
WHERE id > 100;

INSERT INTO t (col) VALUES ('a;b')`;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("test;value");
    expect(result[1]).toContain("DELETE FROM logs");
    expect(result[2]).toContain("a;b");
  });

  it("keeps LOAD DATA isolated when splitting MySQL-family batches", () => {
    const result = splitSqlStatements(
      [
        "SELECT 1",
        "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users",
        "SELECT 'still;literal'",
      ].join(";\n"),
    );

    expect(result).toEqual([
      "SELECT 1",
      "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users",
      "SELECT 'still;literal'",
    ]);
  });

  it("ignores semicolons in MySQL backtick identifiers", () => {
    const result = splitSqlStatements(
      "SELECT * FROM `my;table` WHERE id = 1; SELECT 2",
    );
    expect(result).toEqual([
      "SELECT * FROM `my;table` WHERE id = 1",
      "SELECT 2",
    ]);
  });

  it("handles escaped backticks in MySQL identifiers", () => {
    const result = splitSqlStatements("SELECT `c``;d`; SELECT 2");
    expect(result).toEqual(["SELECT `c``;d`", "SELECT 2"]);
  });

  it("ignores semicolons in MSSQL bracket identifiers", () => {
    const result = splitSqlStatements(
      "SELECT * FROM [my;table] WHERE id = 1; SELECT 2",
    );
    expect(result).toEqual([
      "SELECT * FROM [my;table] WHERE id = 1",
      "SELECT 2",
    ]);
  });

  it("handles escaped brackets in MSSQL identifiers", () => {
    const result = splitSqlStatements("SELECT [c]];d]; SELECT 2");
    expect(result).toEqual(["SELECT [c]];d]", "SELECT 2"]);
  });
});

// Purpose: #1223 comment/split edge-case coverage — the single-statement RAW
// path bug traced to trailing `;`+comment fragments; these lock split behaviour
// across the comment, string-literal, and dollar-quote surfaces the #1118 /
// #1223 pipeline depends on (2026-07-03, user directive: bulk test 보충).
describe("splitSqlStatements — #1223 comment & literal edge cases", () => {
  it("keeps a pure trailing line comment as its own fragment", () => {
    // Reason: #1223 root case — `SELECT 1;\n-- c` split to [stmt, comment];
    // the comment fragment is what prepareRdbStatements must drop.
    expect(splitSqlStatements("SELECT 1;\n-- c")).toEqual(["SELECT 1", "-- c"]);
  });

  it("keeps a trailing line comment with no newline as its own fragment", () => {
    expect(splitSqlStatements("SELECT 1;-- c")).toEqual(["SELECT 1", "-- c"]);
  });

  it("keeps a trailing block comment as its own fragment", () => {
    expect(splitSqlStatements("SELECT 1; /* c */")).toEqual([
      "SELECT 1",
      "/* c */",
    ]);
  });

  it("returns a comment-only line input as a single comment fragment", () => {
    expect(splitSqlStatements("-- just a comment")).toEqual([
      "-- just a comment",
    ]);
  });

  it("returns a comment-only block input as a single comment fragment", () => {
    expect(splitSqlStatements("/* block */")).toEqual(["/* block */"]);
  });

  it("does not split on a semicolon inside a trailing line comment", () => {
    expect(splitSqlStatements("SELECT 1; -- c;")).toEqual([
      "SELECT 1",
      "-- c;",
    ]);
  });

  it("does not split on a semicolon inside a leading line comment", () => {
    expect(splitSqlStatements("-- c;\nSELECT 2")).toEqual(["-- c;\nSELECT 2"]);
  });

  it("keeps interleaved comments between statements", () => {
    expect(
      splitSqlStatements("SELECT 1;\n-- mid\nSELECT 2;\n/* end */"),
    ).toEqual(["SELECT 1", "-- mid\nSELECT 2", "/* end */"]);
  });

  it("ignores --, ;, and keywords inside a single-quoted string literal", () => {
    expect(splitSqlStatements("SELECT 'a -- b ; JOIN c' FROM t")).toEqual([
      "SELECT 'a -- b ; JOIN c' FROM t",
    ]);
  });

  it("ignores -- and ; inside a backtick identifier", () => {
    expect(splitSqlStatements("SELECT `weird;--col` FROM t")).toEqual([
      "SELECT `weird;--col` FROM t",
    ]);
  });

  it("does not split on a semicolon inside a mid-statement block comment", () => {
    expect(splitSqlStatements("SELECT /* a;b */ 1; SELECT 2")).toEqual([
      "SELECT /* a;b */ 1",
      "SELECT 2",
    ]);
  });

  it("drops empty statements from a bare semicolon run", () => {
    expect(splitSqlStatements(";;")).toEqual([]);
  });

  // Issue #1234 — splitSqlStatements is now PG dollar-quote aware. The
  // `$$ … ; … $$` / `$tag$ … $tag$` routine body is opaque, so inner
  // semicolons/comments/quotes never split the statement. (Flips the #1223
  // KNOWN LIMITATION baseline that pinned the old mis-split behaviour.)
  it("keeps a PG $$…$$ routine body as a single statement", () => {
    expect(
      splitSqlStatements(
        "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql",
      ),
    ).toEqual([
      "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql",
    ]);
  });

  it("keeps a $tag$…$tag$ body intact and still splits the trailing statement", () => {
    expect(
      splitSqlStatements(
        "CREATE FUNCTION g() RETURNS void AS $body$ BEGIN DELETE FROM t; END $body$ LANGUAGE plpgsql; SELECT 2",
      ),
    ).toEqual([
      "CREATE FUNCTION g() RETURNS void AS $body$ BEGIN DELETE FROM t; END $body$ LANGUAGE plpgsql",
      "SELECT 2",
    ]);
  });

  it("closes only on the matching tag — a differently-tagged $…$ inside is literal", () => {
    expect(
      splitSqlStatements("DO $$ a := $x$ inner ; text $x$ ; b := 1; $$;"),
    ).toEqual(["DO $$ a := $x$ inner ; text $x$ ; b := 1; $$"]);
  });

  it("does not treat a positional parameter ($1) as a dollar-quote opening", () => {
    expect(
      splitSqlStatements("SELECT * FROM t WHERE id = $1; SELECT $2"),
    ).toEqual(["SELECT * FROM t WHERE id = $1", "SELECT $2"]);
  });

  it("treats an unterminated dollar-quote as opaque through end of input", () => {
    expect(splitSqlStatements("CREATE FUNCTION h() AS $$ BEGIN; oops")).toEqual(
      ["CREATE FUNCTION h() AS $$ BEGIN; oops"],
    );
  });

  it("ignores quotes and comments inside a dollar-quoted body", () => {
    expect(
      splitSqlStatements("DO $$ x := 'a;b'; -- c;\n /* d;e */ y := 1; $$"),
    ).toEqual(["DO $$ x := 'a;b'; -- c;\n /* d;e */ y := 1; $$"]);
  });
});

// -- Sprint 40: SQL Formatting --

describe("formatSql", () => {
  it("formats simple SELECT query", () => {
    const result = formatSql("select id, name from users where id > 10");
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
    // Should have newlines before major keywords
    expect(result).toMatch(/SELECT[\s\S]+FROM[\s\S]+WHERE/);
  });

  it("formats query with JOIN", () => {
    const result = formatSql(
      "select u.id, o.total from users u join orders o on u.id = o.user_id where o.total > 100",
    );
    expect(result).toContain("JOIN");
    expect(result).toContain("ON");
    expect(result).toContain("WHERE");
  });

  it("formats query with subquery", () => {
    const result = formatSql(
      "select * from users where id in (select user_id from orders)",
    );
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
    expect(result).toContain("IN");
  });

  it("uppercase keywords", () => {
    const result = formatSql(
      "select id from users where name = 'test' and active = 1",
    );
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
    expect(result).toContain("AND");
  });

  it("handles already formatted SQL", () => {
    const sql = "SELECT id\nFROM users\nWHERE id > 1";
    const result = formatSql(sql);
    // Should still be valid and contain keywords
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
  });

  it("handles empty string", () => {
    expect(formatSql("")).toBe("");
    expect(formatSql("   ")).toBe("");
  });
});

// -- Sprint 53: SQL Uglify --

describe("uglifySql", () => {
  it("collapses multi-line SQL to single line", () => {
    const sql = "SELECT id\nFROM users\nWHERE id > 1";
    const result = uglifySql(sql);
    expect(result).toBe("SELECT id FROM users WHERE id > 1");
  });

  it("collapses multiple spaces to single space", () => {
    const result = uglifySql("SELECT   id   FROM   users");
    expect(result).toBe("SELECT id FROM users");
  });

  it("removes tabs", () => {
    const result = uglifySql("SELECT\tid\tFROM\tusers");
    expect(result).toBe("SELECT id FROM users");
  });

  it("removes carriage returns", () => {
    const result = uglifySql("SELECT id\r\nFROM users");
    expect(result).toBe("SELECT id FROM users");
  });

  it("preserves string literals with spaces", () => {
    const result = uglifySql("SELECT 'hello   world' FROM users");
    expect(result).toBe("SELECT 'hello   world' FROM users");
  });

  it("preserves string literals with newlines", () => {
    const result = uglifySql("SELECT 'line1\nline2' FROM users");
    expect(result).toBe("SELECT 'line1\nline2' FROM users");
  });

  it("handles empty string", () => {
    expect(uglifySql("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(uglifySql("   \n\t  ")).toBe("");
  });

  it("trims leading and trailing whitespace", () => {
    const result = uglifySql("  SELECT id FROM users  ");
    expect(result).toBe("SELECT id FROM users");
  });

  it("handles already single-line SQL", () => {
    const result = uglifySql("SELECT id FROM users WHERE id > 1");
    expect(result).toBe("SELECT id FROM users WHERE id > 1");
  });

  it("handles complex formatted SQL", () => {
    const formatted = formatSql(
      "select u.id, o.total from users u join orders o on u.id = o.user_id",
    );
    const uglified = uglifySql(formatted);
    // Result should be single-line
    expect(uglified).not.toContain("\n");
    // Should still contain the essential keywords
    expect(uglified).toContain("SELECT");
    expect(uglified).toContain("FROM");
    expect(uglified).toContain("JOIN");
  });
});
