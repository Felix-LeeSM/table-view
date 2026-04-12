import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "./sqlUtils";

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
