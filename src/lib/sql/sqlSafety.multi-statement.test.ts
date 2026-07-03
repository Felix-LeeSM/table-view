// Issue #1118 — multi-statement defense for `analyzeStatement`.
// `analyzeStatement` documents a single-statement contract; callers used to
// enforce it purely by convention (split-then-analyze). These cases pin the
// in-classifier defense: a joined batch is split with the literal/comment-
// aware `splitSqlStatements` and the worst-severity classification wins, so a
// trailing destructive statement can never pass as `info` on the leading
// keyword alone — while single-statement input stays bit-identical.
import { describe, it, expect } from "vitest";
import { analyzeStatement } from "./sqlSafety";

describe("sqlSafety.analyzeStatement — multi-statement defense (#1118)", () => {
  it("classifies a trailing DROP as danger even behind a leading SELECT", () => {
    const a = analyzeStatement("SELECT 1; DROP TABLE x");
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("ddl-drop");
    expect(a.reasons).toEqual(["DROP TABLE"]);
  });

  it("returns the worst severity across three statements", () => {
    const a = analyzeStatement(
      "SELECT 1; UPDATE users SET a = 1 WHERE id = 1; DROP TABLE users",
    );
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("ddl-drop");
  });

  it("keeps a semicolon inside a string literal as one statement (no misplit)", () => {
    // A naive `.split(";")` would fragment `'a;b'` into a bogus
    // `b')` token; the literal-aware splitter keeps it whole → info.
    const a = analyzeStatement("INSERT INTO t VALUES ('a;b')");
    expect(a.severity).toBe("info");
    expect(a.kind).toBe("dml-insert");
  });

  it("detects a destructive statement after a literal-semicolon statement", () => {
    const a = analyzeStatement(
      "INSERT INTO t VALUES ('a;b'); DROP TABLE users",
    );
    expect(a.severity).toBe("danger");
    expect(a.kind).toBe("ddl-drop");
  });

  it("ignores a semicolon inside a line comment (comment-only tail stays info)", () => {
    const a = analyzeStatement("SELECT 1 -- drop; nothing\n;");
    expect(a.severity).toBe("info");
  });

  // Fast-path invariance — single-statement input must not change shape.
  it("[fast-path] single SELECT unchanged", () => {
    const a = analyzeStatement("SELECT * FROM users");
    expect(a).toEqual({ kind: "select", severity: "info", reasons: [] });
  });

  it("[fast-path] single DROP unchanged", () => {
    const a = analyzeStatement("DROP TABLE users");
    expect(a).toEqual({
      kind: "ddl-drop",
      severity: "danger",
      reasons: ["DROP TABLE"],
    });
  });

  it("[fast-path] trailing semicolon does not trigger the split branch", () => {
    const a = analyzeStatement("DROP TABLE users;");
    expect(a).toEqual({
      kind: "ddl-drop",
      severity: "danger",
      reasons: ["DROP TABLE"],
    });
  });

  it("[fast-path] MSSQL BEGIN/END procedural body stays routine-call/warn", () => {
    // The MSSQL procedural early-return fires on the whole blob before the
    // split branch, so internal `;` inside BEGIN…END does not fragment it.
    const a = analyzeStatement("BEGIN SELECT 1; END", { dialect: "mssql" });
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
  });
});
