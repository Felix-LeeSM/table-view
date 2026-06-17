import type { DatabaseType } from "@/types/connection";

/**
 * sprint-379 — Sidebar 의 "Collapse all *" / "Expand all *" 류 affordance 가
 * DB type 별 적절한 객체 이름을 노출하기 위한 단일 매핑.
 *
 * sprint-380 (mysql-sidebar-naming) 이 같은 함수 import 가능. 새 DB type 추가
 * 시 본 매핑에 한 줄 추가만 하면 sidebar 라벨이 자동 갱신된다.
 */
export interface SidebarObjectLabel {
  /** "schema" 처럼 단수 명사. */
  single: string;
  /** "schemas" 처럼 복수 명사. */
  plural: string;
}

const SIDEBAR_OBJECT_LABELS: Record<DatabaseType, SidebarObjectLabel> = {
  // PostgreSQL / MSSQL / Oracle → 사용자에게 보이는 최상위 트리 노드는 schema.
  postgresql: { single: "schema", plural: "schemas" },
  // MySQL / MariaDB 는 database/schema 구분이 무의미하므로 "table"
  // 단위로 묶어 표현. 사용자 캡처에서 "Collapse all tables" 직접 언급.
  mysql: { single: "table", plural: "tables" },
  mariadb: { single: "table", plural: "tables" },
  // SQLite 는 schema 개념 없음 — 최상위 노드는 table.
  sqlite: { single: "table", plural: "tables" },
  // DuckDB stays RDB/file-backed here; top-level browsing remains table-like.
  duckdb: { single: "table", plural: "tables" },
  mssql: { single: "schema", plural: "schemas" },
  oracle: { single: "schema", plural: "schemas" },
  // MongoDB 는 database > collection 구조이지만 sidebar 의 "전부" 단위는
  // collection. Database binding 은 query tab-local TabDbChip 이 맡는다.
  mongodb: { single: "collection", plural: "collections" },
  // Redis/Valkey 는 active KV profiles; toolbar DbSwitcher 는 numeric DB index,
  // sidebar collapse/expand 단위는 key.
  redis: { single: "key", plural: "keys" },
  valkey: { single: "key", plural: "keys" },
  // Search engines browse index/catalog objects outside the RDB tree.
  elasticsearch: { single: "index", plural: "indexes" },
  opensearch: { single: "index", plural: "indexes" },
};

/**
 * DB type → sidebar 의 "모든 *" 단위 객체 이름 (단수/복수).
 *
 * 예: `getSidebarObjectLabel("postgresql").plural === "schemas"`. 호출부는
 * `Collapse all ${plural}` / `Expand all ${plural}` 처럼 합성하여 button
 * label / aria-label / title 에 사용한다.
 */
export function getSidebarObjectLabel(
  dbType: DatabaseType,
): SidebarObjectLabel {
  return SIDEBAR_OBJECT_LABELS[dbType];
}
