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
