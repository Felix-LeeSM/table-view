import type { DatabaseType } from "@/types/connection";

/**
 * DBMS-shape-aware sidebar tree depth. `SchemaTree` renders one of three
 * shapes depending on whether the DBMS exposes a real `schema` layer:
 *
 *   - `with-schema` — PostgreSQL/MSSQL/Oracle: `database → schema → table`.
 *     The schema row is interactive (expand/collapse, refresh).
 *   - `no-schema`   — MySQL/MariaDB: schema row suppressed (MySQL
 *     conflates schema with database) but categories and items still
 *     render under each backend-returned schema.
 *   - `flat`        — SQLite/DuckDB: file *is* the database, so just one
 *     level of tables under the sidebar root.
 *
 * MongoDB/Redis route elsewhere via `pickSidebar` and are deliberately
 * excluded from the union.
 */
export type RdbTreeShape = "with-schema" | "no-schema" | "flat";

/**
 * Resolve the tree shape for a given relational `DatabaseType`. Falls
 * back to `with-schema` (PG) on unmapped values rather than throwing —
 * Mongo/Redis route elsewhere, and a future relational backend should
 * paint as the most explicit shape until it's mapped explicitly.
 */
export function resolveRdbTreeShape(dbType: DatabaseType): RdbTreeShape {
  switch (dbType) {
    case "postgresql":
    case "mssql":
    case "oracle":
      return "with-schema";
    case "mysql":
    case "mariadb":
      return "no-schema";
    case "sqlite":
    case "duckdb":
      return "flat";
    case "mongodb":
    case "redis":
      return "with-schema";
  }
}
