// AC-144-1, AC-144-4 — SQLite completion module assertions.
import { describe, it, expect } from "vitest";
import { keywords, createCompletionSource } from "./sqlite";

describe("sqlite.keywords", () => {
  it("is a non-empty array", () => {
    expect(keywords.length).toBeGreaterThan(0);
  });

  it("contains SQLite-only PRAGMA", () => {
    expect(keywords).toContain("PRAGMA");
  });

  it("contains SQLite-only WITHOUT ROWID", () => {
    expect(keywords).toContain("WITHOUT ROWID");
  });

  it("contains SQLite-only AUTOINCREMENT", () => {
    expect(keywords).toContain("AUTOINCREMENT");
  });

  it("does NOT contain PG-only RETURNING", () => {
    expect(keywords).not.toContain("RETURNING");
  });

  it("does NOT contain PG-only ILIKE", () => {
    expect(keywords).not.toContain("ILIKE");
  });

  it("does NOT contain MySQL-only AUTO_INCREMENT", () => {
    expect(keywords).not.toContain("AUTO_INCREMENT");
  });
});

describe("sqlite.createCompletionSource", () => {
  it("dbType is locked to 'sqlite'", () => {
    const source = createCompletionSource({ tables: [], columns: {} });
    expect(source.dbType).toBe("sqlite");
  });

  it("produces candidates for FROM cursor", () => {
    const source = createCompletionSource({
      tables: ["users"],
      columns: { users: ["id"] },
    });
    const result = source({ text: "SELECT * FROM ", cursor: 14, prefix: "" });
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});
