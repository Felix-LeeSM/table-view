import type { DatabaseType } from "@/types/connection";

/**
 * Single mapping that lets the Sidebar's "Collapse all *" / "Expand all *"
 * style affordances show the right object name per DB type.
 *
 * Other surfaces can import the same function. Adding a DB type takes only
 * one line in this mapping, and the sidebar labels update automatically.
 */
export interface SidebarObjectLabel {
  /** Singular noun, such as "schema". */
  single: string;
  /** Plural noun, such as "schemas". */
  plural: string;
}

const SIDEBAR_OBJECT_LABELS: Record<DatabaseType, SidebarObjectLabel> = {
  // PostgreSQL / MSSQL / Oracle → users see schemas as the top-level tree node.
  postgresql: { single: "schema", plural: "schemas" },
  // MySQL / MariaDB have no meaningful database/schema distinction, so the
  // unit is "table". A user screenshot named "Collapse all tables" directly.
  mysql: { single: "table", plural: "tables" },
  mariadb: { single: "table", plural: "tables" },
  // SQLite has no schema concept — the top-level node is the table.
  sqlite: { single: "table", plural: "tables" },
  // DuckDB stays RDB/file-backed here; top-level browsing remains table-like.
  duckdb: { single: "table", plural: "tables" },
  mssql: { single: "schema", plural: "schemas" },
  oracle: { single: "schema", plural: "schemas" },
  // MongoDB is structured as database > collection, but the sidebar's "all"
  // unit is the collection. The query tab-local TabDbChip owns database
  // binding.
  mongodb: { single: "collection", plural: "collections" },
  // Redis/Valkey are active KV profiles; the toolbar DbSwitcher picks the
  // numeric DB index, and the sidebar collapse/expand unit is the key.
  redis: { single: "key", plural: "keys" },
  valkey: { single: "key", plural: "keys" },
  // Search engines browse index/catalog objects outside the RDB tree.
  elasticsearch: { single: "index", plural: "indexes" },
  opensearch: { single: "index", plural: "indexes" },
};

/**
 * DB type → object name (singular/plural) of the sidebar's "all *" unit.
 *
 * Example: `getSidebarObjectLabel("postgresql").plural === "schemas"`.
 * Callers build labels such as `Collapse all ${plural}` /
 * `Expand all ${plural}` (through i18n) for the button's aria-label / title.
 */
export function getSidebarObjectLabel(
  dbType: DatabaseType,
): SidebarObjectLabel {
  return SIDEBAR_OBJECT_LABELS[dbType];
}
