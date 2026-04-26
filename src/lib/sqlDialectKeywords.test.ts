import { describe, it, expect } from "vitest";
import {
  getKeywordsForDialect,
  COMMON_SQL_KEYWORDS,
} from "./sqlDialectKeywords";

describe("getKeywordsForDialect (Sprint 139)", () => {
  // AC-S139-03: PG dialect surfaces RETURNING + ILIKE on top of the common set.
  it("PG dialect includes RETURNING + ILIKE + SERIAL + JSONB", () => {
    const kws = getKeywordsForDialect("postgresql");
    expect(kws).toContain("RETURNING");
    expect(kws).toContain("ILIKE");
    expect(kws).toContain("SERIAL");
    expect(kws).toContain("JSONB");
    // ANSI / common keywords are always present.
    expect(kws).toContain("SELECT");
    expect(kws).toContain("FROM");
  });

  // AC-S139-03: MySQL dialect includes AUTO_INCREMENT + REPLACE INTO and
  // DOES NOT leak Postgres-only RETURNING / ILIKE.
  it("MySQL dialect includes AUTO_INCREMENT + REPLACE INTO, excludes RETURNING + ILIKE", () => {
    const kws = getKeywordsForDialect("mysql");
    expect(kws).toContain("AUTO_INCREMENT");
    expect(kws).toContain("REPLACE INTO");
    expect(kws).toContain("DUAL");
    expect(kws).not.toContain("RETURNING");
    expect(kws).not.toContain("ILIKE");
    expect(kws).not.toContain("PRAGMA");
  });

  // AC-S139-03: SQLite dialect includes PRAGMA + WITHOUT ROWID and excludes
  // ILIKE (Postgres-only) plus AUTO_INCREMENT (MySQL-only).
  it("SQLite dialect includes PRAGMA + WITHOUT ROWID + IIF, excludes ILIKE + AUTO_INCREMENT", () => {
    const kws = getKeywordsForDialect("sqlite");
    expect(kws).toContain("PRAGMA");
    expect(kws).toContain("WITHOUT ROWID");
    expect(kws).toContain("IIF");
    expect(kws).toContain("AUTOINCREMENT");
    expect(kws).not.toContain("ILIKE");
    expect(kws).not.toContain("AUTO_INCREMENT");
    expect(kws).not.toContain("RETURNING");
  });

  // AC-S139-03: MongoDB / Redis non-SQL paradigms return an empty list. The
  // SqlQueryEditor never mounts for these, but the helper stays defensive.
  it("MongoDB returns an empty keyword list", () => {
    expect(getKeywordsForDialect("mongodb")).toEqual([]);
  });

  it("Redis returns an empty keyword list", () => {
    expect(getKeywordsForDialect("redis")).toEqual([]);
  });

  // Deleted connection (db_type undefined) falls back to the common ANSI set.
  it("undefined db_type returns the common ANSI keyword set", () => {
    const kws = getKeywordsForDialect(undefined);
    expect(kws).toEqual(COMMON_SQL_KEYWORDS);
  });

  // Each dialect's full set is at least as large as the common set.
  it("PG / MySQL / SQLite all contain the COMMON_SQL_KEYWORDS set", () => {
    for (const dbType of ["postgresql", "mysql", "sqlite"] as const) {
      const kws = getKeywordsForDialect(dbType);
      for (const common of COMMON_SQL_KEYWORDS) {
        expect(kws).toContain(common);
      }
    }
  });

  // Cross-dialect contamination guard: PG's RETURNING never leaks into
  // MySQL or SQLite; MySQL's AUTO_INCREMENT never leaks into PG or SQLite;
  // SQLite's PRAGMA never leaks into PG or MySQL.
  it("does not cross-contaminate between PG / MySQL / SQLite", () => {
    const pg = getKeywordsForDialect("postgresql");
    const mysql = getKeywordsForDialect("mysql");
    const sqlite = getKeywordsForDialect("sqlite");

    // PG-only
    expect(mysql).not.toContain("RETURNING");
    expect(sqlite).not.toContain("RETURNING");
    expect(mysql).not.toContain("JSONB");
    expect(sqlite).not.toContain("JSONB");

    // MySQL-only
    expect(pg).not.toContain("AUTO_INCREMENT");
    expect(sqlite).not.toContain("AUTO_INCREMENT");
    expect(pg).not.toContain("DUAL");

    // SQLite-only
    expect(pg).not.toContain("PRAGMA");
    expect(mysql).not.toContain("PRAGMA");
    expect(pg).not.toContain("WITHOUT ROWID");
    expect(mysql).not.toContain("WITHOUT ROWID");
  });
});
