/**
 * 작성 2026-05-17 (sprint-379 collapse/expand all toggle).
 *
 * 사유: Sidebar header 의 "Collapse all *" / "Expand all *" 버튼이 DB type 별
 * 적절한 객체 이름을 노출해야 한다. PG/MSSQL/Oracle → schemas,
 * MySQL/MariaDB/SQLite → tables, Mongo → collections, Redis/Valkey → keys.
 * 매핑 dictionary 는 sprint-380
 * (mysql-sidebar-naming) 과 공유되므로 *단일 모듈* + *순수 함수* 로 격리한다.
 */

import { describe, it, expect } from "vitest";
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
    // Redis 는 supported connection profile 이면서 non-RDBMS sidebar label 을
    // 별도로 유지해야 한다.
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
