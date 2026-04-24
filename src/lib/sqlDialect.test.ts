import { describe, it, expect } from "vitest";
import { MySQL, PostgreSQL, SQLite, StandardSQL } from "@codemirror/lang-sql";
import { databaseTypeToSqlDialect } from "./sqlDialect";
import type { DatabaseType } from "@/types/connection";

describe("databaseTypeToSqlDialect", () => {
  // AC-01: Postgres resolution
  it("maps postgresql to the PostgreSQL dialect", () => {
    expect(databaseTypeToSqlDialect("postgresql")).toBe(PostgreSQL);
  });

  // AC-02: MySQL resolution
  it("maps mysql to the MySQL dialect", () => {
    expect(databaseTypeToSqlDialect("mysql")).toBe(MySQL);
  });

  // AC-03: SQLite resolution
  it("maps sqlite to the SQLite dialect", () => {
    expect(databaseTypeToSqlDialect("sqlite")).toBe(SQLite);
  });

  // AC-07: Fallback for document / kv / deleted-connection references
  it("falls back to StandardSQL for mongodb", () => {
    expect(databaseTypeToSqlDialect("mongodb")).toBe(StandardSQL);
  });

  it("falls back to StandardSQL for redis", () => {
    expect(databaseTypeToSqlDialect("redis")).toBe(StandardSQL);
  });

  it("falls back to StandardSQL for undefined (deleted connection)", () => {
    expect(databaseTypeToSqlDialect(undefined)).toBe(StandardSQL);
  });

  it("falls back to StandardSQL for unknown / future dialects", () => {
    // Cast through unknown so the test survives future DatabaseType widening
    // without TypeScript errors. The runtime switch's `default` branch is
    // what we're exercising here.
    const future = "oracle" as unknown as DatabaseType;
    expect(databaseTypeToSqlDialect(future)).toBe(StandardSQL);
  });

  // Dialect identity — dialect quoting chars differ per provider.
  // PostgreSQL inherits its identifier quote (`"`) from StandardSQL, so the
  // spec itself leaves the field unset — asserting referential identity is
  // all we need at this layer (quoting behaviour is covered by
  // useSqlAutocomplete tests).
  it("PostgreSQL dialect matches CodeMirror's exported PostgreSQL constant", () => {
    expect(databaseTypeToSqlDialect("postgresql")).toBe(PostgreSQL);
  });

  it("MySQL uses backtick for identifierQuotes", () => {
    const d = databaseTypeToSqlDialect("mysql");
    expect(d.spec.identifierQuotes).toBe("`");
  });

  it("SQLite accepts both backtick and double-quote identifier quotes", () => {
    const d = databaseTypeToSqlDialect("sqlite");
    // SQLite defines `` `" `` per the CodeMirror source.
    expect(d.spec.identifierQuotes).toContain("`");
    expect(d.spec.identifierQuotes).toContain('"');
  });
});
