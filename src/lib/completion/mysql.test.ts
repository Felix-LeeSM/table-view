// AC-144-1, AC-144-4 — MySQL completion module assertions.
import { describe, it, expect } from "vitest";
import { keywords, createCompletionSource, LIMIT_HINTS } from "./mysql";

describe("mysql.keywords", () => {
  it("is a non-empty array", () => {
    expect(keywords.length).toBeGreaterThan(0);
  });

  it("contains MySQL-only AUTO_INCREMENT", () => {
    expect(keywords).toContain("AUTO_INCREMENT");
  });

  it("contains MySQL-only REPLACE INTO", () => {
    expect(keywords).toContain("REPLACE INTO");
  });

  it("does NOT contain PG-only RETURNING", () => {
    expect(keywords).not.toContain("RETURNING");
  });

  it("does NOT contain PG-only ILIKE", () => {
    expect(keywords).not.toContain("ILIKE");
  });

  it("does NOT contain SQLite-only PRAGMA", () => {
    expect(keywords).not.toContain("PRAGMA");
  });

  it("contains common SQL keywords (SELECT/FROM/WHERE)", () => {
    expect(keywords).toContain("SELECT");
    expect(keywords).toContain("FROM");
  });
});

describe("mysql.LIMIT n,m hint", () => {
  it("LIMIT_HINTS surfaces a 'LIMIT n,m' shape", () => {
    expect(LIMIT_HINTS.some((h) => h.label.includes("LIMIT"))).toBe(true);
    // At least one hint mentions the comma-form (n,m / offset,count / count,offset).
    const hasCommaForm = LIMIT_HINTS.some(
      (h) =>
        h.label.includes("n,m") ||
        h.label.includes("offset,count") ||
        h.label.includes("count,offset"),
    );
    expect(hasCommaForm).toBe(true);
  });

  it("source surfaces LIMIT n,m hint when cursor is after 'LIMIT '", () => {
    const source = createCompletionSource({ tables: [], columns: {} });
    const result = source({
      text: "SELECT * FROM users LIMIT ",
      cursor: 26,
      prefix: "",
    });
    const labels = result.candidates.map((c) => c.label);
    const hasLimitHint = labels.some(
      (l) =>
        l.includes("LIMIT") &&
        (l.includes("n,m") ||
          l.includes("offset,count") ||
          l.includes("count,offset")),
    );
    expect(hasLimitHint).toBe(true);
  });
});

describe("mysql.createCompletionSource", () => {
  it("dbType is locked to 'mysql'", () => {
    const source = createCompletionSource({ tables: [], columns: {} });
    expect(source.dbType).toBe("mysql");
  });

  it("produces candidates for FROM cursor", () => {
    const source = createCompletionSource({
      tables: ["users"],
      columns: {},
    });
    const result = source({ text: "SELECT * FROM ", cursor: 14, prefix: "" });
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toContain("users");
  });
});
