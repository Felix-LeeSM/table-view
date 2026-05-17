/**
 * 작성 2026-05-17 (sprint-379 collapse/expand all toggle).
 *
 * 사유: Sidebar header 의 "Collapse all *" / "Expand all *" 버튼이 DB type 별
 * 적절한 객체 이름을 노출해야 한다. PG/MSSQL → schemas, MySQL/SQLite → tables,
 * Mongo → collections, Redis → keys. 매핑 dictionary 는 sprint-380
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

  it("sqlite → table/tables", () => {
    expect(getSidebarObjectLabel("sqlite")).toEqual({
      single: "table",
      plural: "tables",
    });
  });

  it("mongodb → collection/collections", () => {
    expect(getSidebarObjectLabel("mongodb")).toEqual({
      single: "collection",
      plural: "collections",
    });
  });

  it("redis → key/keys", () => {
    // Redis 는 SUPPORTED_DATABASE_TYPES 에 없지만 DatabaseType variant 이므로
    // 매핑은 정의되어 있어야 한다 (URL parse 실패 메시지 등에서 사용).
    expect(getSidebarObjectLabel("redis")).toEqual({
      single: "key",
      plural: "keys",
    });
  });
});
