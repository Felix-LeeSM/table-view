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

  it("MariaDB extends the MySQL keyword surface with RETURNING", () => {
    const kws = getKeywordsForDialect("mariadb");
    expect(kws).toContain("AUTO_INCREMENT");
    expect(kws).toContain("REPLACE INTO");
    expect(kws).toContain("RETURNING");
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

  it("DuckDB dialect has its own placeholder vocabulary without SQLite PRAGMA leakage", () => {
    const kws = getKeywordsForDialect("duckdb");
    expect(kws).toContain("DESCRIBE");
    expect(kws).toContain("SUMMARIZE");
    expect(kws).not.toContain("ATTACH");
    expect(kws).not.toContain("DETACH");
    expect(kws).not.toContain("COPY");
    expect(kws).not.toContain("PRAGMA");
  });

  // AC-S139-03: MongoDB / Redis non-SQL paradigms return an empty list. The
  // SqlQueryEditor never mounts for these, but the helper stays defensive.
  it("MongoDB returns an empty keyword list", () => {
    expect(getKeywordsForDialect("mongodb")).toEqual([]);
  });

  it("Redis returns an empty keyword list", () => {
    expect(getKeywordsForDialect("redis")).toEqual([]);
  });

  it("MSSQL and Oracle expose their SQL profile keyword deltas", () => {
    const mssql = getKeywordsForDialect("mssql");
    const oracle = getKeywordsForDialect("oracle");

    expect(mssql).toEqual(expect.arrayContaining(["TOP", "OUTPUT", "MERGE"]));
    expect(mssql).toEqual(
      expect.arrayContaining(["IDENTITY", "NVARCHAR", "UNIQUEIDENTIFIER"]),
    );
    expect(oracle).toEqual(
      expect.arrayContaining(["ROWNUM", "MERGE", "MINUS"]),
    );
    expect(oracle).toEqual(
      expect.arrayContaining([
        "CONNECT BY",
        "START WITH",
        "VARCHAR2",
        "NUMBER",
      ]),
    );
    expect(mssql).not.toContain("CONNECT BY");
    expect(oracle).not.toContain("UNIQUEIDENTIFIER");
  });

  // Deleted connection (dbType undefined) falls back to the common ANSI set.
  it("undefined dbType returns the common ANSI keyword set", () => {
    const kws = getKeywordsForDialect(undefined);
    expect(kws).toEqual(COMMON_SQL_KEYWORDS);
  });

  // Each dialect's full set is at least as large as the common set.
  it("PG / MySQL / SQLite all contain the COMMON_SQL_KEYWORDS set", () => {
    for (const dbType of [
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mssql",
      "oracle",
    ] as const) {
      const kws = getKeywordsForDialect(dbType);
      for (const common of COMMON_SQL_KEYWORDS) {
        expect(kws).toContain(common);
      }
    }
  });

  // Cross-dialect contamination guard: RETURNING stays out of MySQL while
  // MariaDB exposes its own delta; MySQL's AUTO_INCREMENT never leaks into PG
  // or SQLite; SQLite's PRAGMA never leaks into PG or MySQL.
  it("does not cross-contaminate between PG / MySQL / MariaDB / SQLite", () => {
    const pg = getKeywordsForDialect("postgresql");
    const mysql = getKeywordsForDialect("mysql");
    const mariadb = getKeywordsForDialect("mariadb");
    const sqlite = getKeywordsForDialect("sqlite");

    // RETURNING is PG + MariaDB, but not MySQL.
    expect(mysql).not.toContain("RETURNING");
    expect(mariadb).toContain("RETURNING");
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
