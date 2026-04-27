// AC-144-1, AC-144-4 — PostgreSQL completion module assertions.
import { describe, it, expect } from "vitest";
import { keywords, createCompletionSource } from "./pg";

describe("pg.keywords", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it("contains PG-only RETURNING", () => {
    expect(keywords).toContain("RETURNING");
  });

  it("contains PG-only ILIKE", () => {
    expect(keywords).toContain("ILIKE");
  });

  it("contains PG-only JSONB", () => {
    expect(keywords).toContain("JSONB");
  });

  it("does NOT contain MySQL-only AUTO_INCREMENT", () => {
    expect(keywords).not.toContain("AUTO_INCREMENT");
  });

  it("does NOT contain SQLite-only PRAGMA", () => {
    expect(keywords).not.toContain("PRAGMA");
  });

  it("contains common SQL keywords (SELECT/FROM/WHERE)", () => {
    expect(keywords).toContain("SELECT");
    expect(keywords).toContain("FROM");
    expect(keywords).toContain("WHERE");
  });
});

describe("pg.createCompletionSource", () => {
  it("returns a non-null candidate generator", () => {
    const source = createCompletionSource({
      tables: ["users", "orders"],
      columns: { users: ["id", "name"], orders: ["id", "user_id"] },
    });
    expect(typeof source).toBe("function");
  });

  it("produces non-empty candidates for SELECT … FROM cursor context", () => {
    const source = createCompletionSource({
      tables: ["users", "orders"],
      columns: { users: ["id", "name"] },
    });
    const result = source({ text: "SELECT * FROM ", cursor: 14, prefix: "" });
    expect(result.candidates.length).toBeGreaterThan(0);
    // Should include at least one of our tables.
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["users"]));
  });

  it("filters candidates by prefix", () => {
    const source = createCompletionSource({
      tables: ["users", "orders", "uploads"],
      columns: {},
    });
    const result = source({ text: "SELECT * FROM u", cursor: 15, prefix: "u" });
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["users", "uploads"]));
    expect(labels).not.toContain("orders");
  });

  it("dbType is locked to 'postgresql'", () => {
    const source = createCompletionSource({ tables: [], columns: {} });
    expect(source.dbType).toBe("postgresql");
  });
});
