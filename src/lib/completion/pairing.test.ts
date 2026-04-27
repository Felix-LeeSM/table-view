// AC-144-3 — pairing resolver: throws CompletionPairingError on mispair.
import { describe, it, expect } from "vitest";
import { selectCompletionModule, CompletionPairingError } from "./pairing";

describe("selectCompletionModule (paradigm × db_type)", () => {
  it("returns pg module for ('rdb', 'postgresql')", () => {
    const mod = selectCompletionModule("rdb", "postgresql");
    expect(mod.dbType).toBe("postgresql");
    expect(mod.keywords).toContain("RETURNING");
  });

  it("returns mysql module for ('rdb', 'mysql')", () => {
    const mod = selectCompletionModule("rdb", "mysql");
    expect(mod.dbType).toBe("mysql");
    expect(mod.keywords).toContain("AUTO_INCREMENT");
  });

  it("returns sqlite module for ('rdb', 'sqlite')", () => {
    const mod = selectCompletionModule("rdb", "sqlite");
    expect(mod.dbType).toBe("sqlite");
    expect(mod.keywords).toContain("PRAGMA");
  });

  it("returns mongo module for ('document', 'mongodb')", () => {
    const mod = selectCompletionModule("document", "mongodb");
    expect(mod.dbType).toBe("mongodb");
  });

  it("throws CompletionPairingError for ('rdb', 'mongodb')", () => {
    expect(() => selectCompletionModule("rdb", "mongodb")).toThrow(
      CompletionPairingError,
    );
  });

  it("throws CompletionPairingError for ('document', 'postgresql')", () => {
    expect(() => selectCompletionModule("document", "postgresql")).toThrow(
      CompletionPairingError,
    );
  });

  it("throws CompletionPairingError for ('rdb', 'redis')", () => {
    expect(() => selectCompletionModule("rdb", "redis")).toThrow(
      CompletionPairingError,
    );
  });

  it("CompletionPairingError message names both paradigm and db_type", () => {
    try {
      selectCompletionModule("rdb", "mongodb");
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CompletionPairingError);
      const err = e as CompletionPairingError;
      expect(err.message).toContain("rdb");
      expect(err.message).toContain("mongodb");
    }
  });
});
