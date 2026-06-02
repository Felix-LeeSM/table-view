import { describe, expect, it } from "vitest";
import { MySQL, PostgreSQL, SQLite, StandardSQL } from "@codemirror/lang-sql";
import {
  COMMON_SQL_FUNCTIONS,
  COMMON_SQL_KEYWORDS,
  SQL_DIALECT_PROFILES,
  SQL_SHELL_PROFILES,
  codeMirrorDialectForDatabaseType,
  getSqlDialectProfileForDatabaseType,
  getSqlFunctionsForDatabaseType,
  getSqlKeywordsForDatabaseType,
  sqlDialectIdForDatabaseType,
} from "./sqlDialectProfile";

describe("sqlDialectProfile", () => {
  it("maps database types to dialect profile ids", () => {
    expect(sqlDialectIdForDatabaseType("postgresql")).toBe("postgresql");
    expect(sqlDialectIdForDatabaseType("mysql")).toBe("mysql");
    expect(sqlDialectIdForDatabaseType("mariadb")).toBe("mariadb");
    expect(sqlDialectIdForDatabaseType("sqlite")).toBe("sqlite");
    expect(sqlDialectIdForDatabaseType("duckdb")).toBe("duckdb");
    expect(sqlDialectIdForDatabaseType("mongodb")).toBeNull();
    expect(sqlDialectIdForDatabaseType(undefined)).toBeNull();
  });

  it("keeps CodeMirror dialect mapping inside the profile", () => {
    expect(codeMirrorDialectForDatabaseType("postgresql")).toBe(PostgreSQL);
    expect(codeMirrorDialectForDatabaseType("mysql")).toBe(MySQL);
    expect(codeMirrorDialectForDatabaseType("mariadb")).toBe(MySQL);
    expect(codeMirrorDialectForDatabaseType("sqlite")).toBe(SQLite);
    expect(codeMirrorDialectForDatabaseType("duckdb")).toBe(StandardSQL);
    expect(codeMirrorDialectForDatabaseType("mssql")).toBe(StandardSQL);
    expect(codeMirrorDialectForDatabaseType(undefined)).toBe(StandardSQL);
  });

  it("models capability differences without provider-level dbType branching", () => {
    expect(SQL_DIALECT_PROFILES.postgresql.capabilities.returning).toBe(true);
    expect(SQL_DIALECT_PROFILES.postgresql.capabilities.ilike).toBe(true);
    expect(SQL_DIALECT_PROFILES.mysql.capabilities.returning).toBe(false);
    expect(SQL_DIALECT_PROFILES.mysql.capabilities.limitOffsetComma).toBe(true);
    expect(SQL_DIALECT_PROFILES.mariadb.capabilities.returning).toBe(true);
    expect(SQL_DIALECT_PROFILES.mariadb.capabilities.ilike).toBe(false);
    expect(SQL_DIALECT_PROFILES.sqlite.capabilities.onConflict).toBe(true);
  });

  it("keeps DuckDB as its own SQL dialect placeholder instead of aliasing SQLite", () => {
    const duckdb = getSqlDialectProfileForDatabaseType("duckdb");

    expect(duckdb).toMatchObject({
      id: "duckdb",
      family: "duckdb",
      defaultShell: "none",
      identifierQuote: '"',
    });
    expect(duckdb?.codeMirrorDialect).toBe(StandardSQL);
    expect(duckdb?.capabilities.schemas).toBe(true);
    expect(duckdb?.vocabulary.keywords).toContain("DESCRIBE");
    expect(duckdb?.vocabulary.keywords).toContain("SUMMARIZE");
    expect(duckdb?.vocabulary.keywords).not.toContain("ATTACH");
    expect(duckdb?.vocabulary.keywords).not.toContain("DETACH");
    expect(duckdb?.vocabulary.keywords).not.toContain("COPY");
    expect(duckdb?.vocabulary.keywords).not.toContain("PRAGMA");
  });

  it("shares the MySQL family while keeping MariaDB a distinct dialect id", () => {
    const mysql = getSqlDialectProfileForDatabaseType("mysql");
    const mariadb = getSqlDialectProfileForDatabaseType("mariadb");

    expect(mysql?.id).toBe("mysql");
    expect(mariadb?.id).toBe("mariadb");
    expect(mysql?.family).toBe("mysql");
    expect(mariadb?.family).toBe("mysql");
    expect(mariadb?.codeMirrorDialect).toBe(mysql?.codeMirrorDialect);
    expect(mysql?.capabilities.returning).toBe(false);
    expect(mariadb?.capabilities.returning).toBe(true);
    expect(mysql?.vocabulary.keywords).not.toContain("RETURNING");
    expect(mariadb?.vocabulary.keywords).toContain("RETURNING");
  });

  it("keeps RETURNING as the only current MariaDB SQL profile delta over MySQL", () => {
    const mysql = getSqlDialectProfileForDatabaseType("mysql");
    const mariadb = getSqlDialectProfileForDatabaseType("mariadb");

    if (!mysql || !mariadb) {
      throw new Error("MySQL-family SQL profiles must exist");
    }

    expect(mariadb.defaultShell).toBe(mysql.defaultShell);
    expect(mariadb.identifierQuote).toBe(mysql.identifierQuote);
    expect(mariadb.codeMirrorDialect).toBe(mysql.codeMirrorDialect);
    expect(mariadb.capabilities).toEqual({
      ...mysql.capabilities,
      returning: true,
    });
    expect(mariadb.vocabulary.functions).toEqual(mysql.vocabulary.functions);
    expect(mariadb.vocabulary.types).toEqual(mysql.vocabulary.types);
    expect(mariadb.vocabulary.operators).toEqual(mysql.vocabulary.operators);
    expect(
      mariadb.vocabulary.keywords.filter(
        (keyword) => !mysql.vocabulary.keywords.includes(keyword),
      ),
    ).toEqual(["RETURNING"]);
    expect(
      mysql.vocabulary.keywords.filter(
        (keyword) => !mariadb.vocabulary.keywords.includes(keyword),
      ),
    ).toEqual([]);
  });

  it("keeps psql/mysql/sqlite shell commands out of SQL dialect vocabulary", () => {
    expect(SQL_SHELL_PROFILES.psql.commands).toContain("\\dt");
    expect(SQL_SHELL_PROFILES["mysql-client"].commands).toContain("\\G");
    expect(SQL_SHELL_PROFILES["sqlite-cli"].commands).toContain(".tables");

    for (const profile of Object.values(SQL_DIALECT_PROFILES)) {
      expect(profile.vocabulary.keywords).not.toContain("\\dt");
      expect(profile.vocabulary.keywords).not.toContain("\\G");
      expect(profile.vocabulary.keywords).not.toContain(".tables");
    }
  });

  it("preserves legacy keyword and function surfaces", () => {
    expect(getSqlKeywordsForDatabaseType(undefined)).toEqual(
      COMMON_SQL_KEYWORDS,
    );
    expect(getSqlKeywordsForDatabaseType("mongodb")).toEqual([]);
    expect(getSqlFunctionsForDatabaseType("mysql")).toContain("JSON_EXTRACT");
    expect(getSqlFunctionsForDatabaseType("mysql")).not.toContain("DATE_TRUNC");
    expect(getSqlFunctionsForDatabaseType(undefined)).toContain("DATE_TRUNC");

    for (const fn of COMMON_SQL_FUNCTIONS) {
      expect(getSqlFunctionsForDatabaseType("sqlite")).toContain(fn);
    }
  });
});
