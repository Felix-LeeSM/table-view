// AC-144-2 — shared module smoke tests (prefixMatch, identifier-quote, FROM-context parser).
import { describe, it, expect } from "vitest";
import {
  prefixMatch,
  escapeIdentifier,
  parseFromContext,
  splitSqlStatements,
  tokenizeSql,
  CompletionPairingError,
} from "./shared";

describe("shared.prefixMatch", () => {
  it("matches case-insensitive prefix", () => {
    expect(prefixMatch("SEL", "SELECT")).toBe(true);
    expect(prefixMatch("sel", "SELECT")).toBe(true);
    expect(prefixMatch("Sel", "select")).toBe(true);
  });

  it("returns false for non-prefix", () => {
    expect(prefixMatch("LECT", "SELECT")).toBe(false);
    expect(prefixMatch("XYZ", "SELECT")).toBe(false);
  });

  it("empty prefix matches anything", () => {
    expect(prefixMatch("", "SELECT")).toBe(true);
    expect(prefixMatch("", "")).toBe(true);
  });

  it("longer prefix than candidate fails", () => {
    expect(prefixMatch("SELECTED", "SELECT")).toBe(false);
  });
});

describe("shared.escapeIdentifier", () => {
  it("wraps with double quotes for ansi/postgres/sqlite", () => {
    expect(escapeIdentifier("My Table", "ansi")).toBe('"My Table"');
    expect(escapeIdentifier("Users", "postgres")).toBe('"Users"');
    expect(escapeIdentifier("col", "sqlite")).toBe('"col"');
  });

  it("wraps with backticks for mysql", () => {
    expect(escapeIdentifier("Users", "mysql")).toBe("`Users`");
  });

  it("doubles embedded quote characters", () => {
    expect(escapeIdentifier('weird"name', "postgres")).toBe('"weird""name"');
    expect(escapeIdentifier("back`tick", "mysql")).toBe("`back``tick`");
  });
});

describe("shared.parseFromContext", () => {
  it("returns table list after FROM", () => {
    const ctx = parseFromContext("SELECT * FROM users WHERE 1=1");
    expect(ctx.tables).toContain("users");
  });

  it("collects multiple comma-separated tables", () => {
    const ctx = parseFromContext("SELECT * FROM users, orders WHERE 1=1");
    expect(ctx.tables).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("captures aliases via AS", () => {
    const ctx = parseFromContext("SELECT * FROM users AS u WHERE 1=1");
    expect(ctx.aliases["u"]).toBe("users");
  });

  it("captures aliases without AS", () => {
    const ctx = parseFromContext("SELECT * FROM users u WHERE 1=1");
    expect(ctx.aliases["u"]).toBe("users");
  });

  it("returns empty tables when no FROM", () => {
    const ctx = parseFromContext("SELECT 1");
    expect(ctx.tables).toEqual([]);
  });

  it("handles INSERT INTO", () => {
    const ctx = parseFromContext("INSERT INTO users (a) VALUES (1)");
    expect(ctx.tables).toContain("users");
  });

  it("handles JOIN clauses", () => {
    const ctx = parseFromContext(
      "SELECT * FROM users u JOIN orders o ON u.id = o.user_id",
    );
    expect(ctx.tables).toEqual(expect.arrayContaining(["users", "orders"]));
    expect(ctx.aliases["u"]).toBe("users");
    expect(ctx.aliases["o"]).toBe("orders");
  });

  it("tolerates empty input", () => {
    const ctx = parseFromContext("");
    expect(ctx.tables).toEqual([]);
    expect(ctx.aliases).toEqual({});
  });
});

describe("shared re-exports", () => {
  it("re-exports tokenizeSql", () => {
    const tokens = tokenizeSql("SELECT 1");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]?.kind).toBe("keyword");
  });

  it("re-exports splitSqlStatements", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});

describe("shared.CompletionPairingError", () => {
  it("is an Error subclass with a name", () => {
    const e = new CompletionPairingError("rdb", "mongodb");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CompletionPairingError");
    expect(e.message).toMatch(/rdb/);
    expect(e.message).toMatch(/mongodb/);
  });
});
