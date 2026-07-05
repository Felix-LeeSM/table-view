// Characterization tests for the canonical SQL identifier quoter (#1357).
// Locks the per-dialect quoting + escaping so the 5-way consolidation
// (completion / ddl / rawQuery / duckdb) can route through this one helper
// without changing any call site's output.
import { describe, it, expect } from "vitest";
import { sqlIdentifier, qualifiedTableName } from "./sqlLiteral";

describe("sqlIdentifier — canonical per-dialect quoting", () => {
  it("mysql wraps in backticks and doubles embedded backticks", () => {
    expect(sqlIdentifier("Users", "mysql")).toBe("`Users`");
    expect(sqlIdentifier("back`tick", "mysql")).toBe("`back``tick`");
  });

  it("sqlite wraps in ANSI double quotes and doubles embedded quotes", () => {
    expect(sqlIdentifier("col", "sqlite")).toBe('"col"');
    expect(sqlIdentifier('weird"name', "sqlite")).toBe('"weird""name"');
  });

  it("oracle wraps in ANSI double quotes and doubles embedded quotes", () => {
    expect(sqlIdentifier("col", "oracle")).toBe('"col"');
    expect(sqlIdentifier('weird"name', "oracle")).toBe('"weird""name"');
  });

  it("mssql wraps in brackets and doubles embedded closing brackets", () => {
    expect(sqlIdentifier("col", "mssql")).toBe("[col]");
    expect(sqlIdentifier("a]b", "mssql")).toBe("[a]]b]");
  });

  it("postgresql leaves the identifier bare by default", () => {
    expect(sqlIdentifier("Users", "postgresql")).toBe("Users");
    expect(sqlIdentifier("weird name", "postgresql")).toBe("weird name");
  });
});

describe("qualifiedTableName", () => {
  it("postgres joins schema.table bare", () => {
    expect(qualifiedTableName("public", "users", "postgresql")).toBe(
      "public.users",
    );
  });

  it("quoting dialects quote each part", () => {
    expect(qualifiedTableName("s", "t", "mysql")).toBe("`s`.`t`");
    expect(qualifiedTableName("s", "t", "mssql")).toBe("[s].[t]");
  });

  it("empty schema drops the qualifier", () => {
    expect(qualifiedTableName("", "t", "sqlite")).toBe('"t"');
  });
});
