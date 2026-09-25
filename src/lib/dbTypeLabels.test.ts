/**
 * Written 2026-05-17 (collapse/expand all toggle).
 *
 * Reason: the Sidebar header's "Collapse all *" / "Expand all *" button must
 * show the right object name per DB type. PG/MSSQL/Oracle → schemas,
 * MySQL/MariaDB/SQLite → tables, Mongo → collections, Redis/Valkey → keys.
 * The mapping dictionary is isolated as a *single module* + *pure function*
 * so other surfaces can share it.
 */

import { describe, expect, it } from "vitest";
import { getSidebarObjectLabel } from "./dbTypeLabels";

describe("getSidebarObjectLabel", () => {
  it("postgresql → schema/schemas", () => {
    expect(getSidebarObjectLabel("postgresql")).toEqual({
      single: "schema",
      plural: "schemas",
    });
  });

  it("mysql → table/tables", () => {
    expect(getSidebarObjectLabel("mysql")).toEqual({
      single: "table",
      plural: "tables",
    });
  });

  it("mariadb → table/tables", () => {
    expect(getSidebarObjectLabel("mariadb")).toEqual({
      single: "table",
      plural: "tables",
    });
  });

  it("sqlite → table/tables", () => {
    expect(getSidebarObjectLabel("sqlite")).toEqual({
      single: "table",
      plural: "tables",
    });
  });

  it("duckdb → table/tables", () => {
    expect(getSidebarObjectLabel("duckdb")).toEqual({
      single: "table",
      plural: "tables",
    });
  });

  it("mssql → schema/schemas", () => {
    expect(getSidebarObjectLabel("mssql")).toEqual({
      single: "schema",
      plural: "schemas",
    });
  });

  it("oracle → schema/schemas", () => {
    expect(getSidebarObjectLabel("oracle")).toEqual({
      single: "schema",
      plural: "schemas",
    });
  });

  it("mongodb → collection/collections", () => {
    expect(getSidebarObjectLabel("mongodb")).toEqual({
      single: "collection",
      plural: "collections",
    });
  });

  it("redis → key/keys", () => {
    // Redis is a supported connection profile and must keep its own
    // non-RDBMS sidebar label.
    expect(getSidebarObjectLabel("redis")).toEqual({
      single: "key",
      plural: "keys",
    });
  });

  it("valkey → key/keys", () => {
    expect(getSidebarObjectLabel("valkey")).toEqual({
      single: "key",
      plural: "keys",
    });
  });
});
