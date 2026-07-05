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
 * MongoDB/Redis/Valkey/Search route elsewhere via `pickSidebar` and are deliberately
 * excluded from the union.
 */
export type RdbTreeShape = "with-schema" | "no-schema" | "flat";

/**
 * Resolve the tree shape for a given relational `DatabaseType`. Falls
 * back to `with-schema` (PG) on unmapped values rather than throwing —
 * Mongo/Redis route elsewhere, and a future relational backend should
 * paint as the most explicit shape until it's mapped explicitly.
 */
/**
 * Full per-DBMS tree profile: the {@link RdbTreeShape} plus the derived
 * behavior flags SchemaTree used to re-derive by re-branching on `dbType`
 * (#1363). Centralizing them here keeps the shape and its behavior flags from
 * drifting apart. Flags:
 *
 *   - `autoLoadsAuxiliaryCatalog` — eager-load views/functions for expanded
 *     schemas on mount. True for the narrow-catalog engines (MySQL/MariaDB
 *     `no-schema`, plus MSSQL/Oracle which are `with-schema` but still eager);
 *     PostgreSQL (potentially hundreds of schemas) stays lazy.
 *   - `isFileAnalyticsSource` — DuckDB: registered files render as pseudo-schema
 *     source rows and are cleared/reloaded on refresh.
 *   - `hasImplicitSingleSchema` — SQLite: one implicit `main` schema you can
 *     create tables in directly from the flat root (DuckDB is flat too but uses
 *     file sources, so it is *not* flagged here).
 */
export interface RdbTreeProfile {
  shape: RdbTreeShape;
  autoLoadsAuxiliaryCatalog: boolean;
  isFileAnalyticsSource: boolean;
  hasImplicitSingleSchema: boolean;
}

const NON_RELATIONAL_PROFILE: RdbTreeProfile = {
  // Non-relational types never reach the RDB sidebar (they route via
  // `pickSidebar`), so this is a defensive fallback, not a real mapping.
  // Callers that branch on the shape for non-tree behavior (e.g. QuickOpen
  // offering schema results only for `with-schema`) must NOT treat this arm
  // as "these DBs have SQL schemas" — it just avoids throwing on a type that
  // won't hit an RDB tree. Keep such callers keyed off `paradigm`/store
  // population, not this fallback.
  shape: "with-schema",
  autoLoadsAuxiliaryCatalog: false,
  isFileAnalyticsSource: false,
  hasImplicitSingleSchema: false,
};

export function resolveRdbTreeProfile(dbType: DatabaseType): RdbTreeProfile {
  switch (dbType) {
    case "postgresql":
      return {
        shape: "with-schema",
        autoLoadsAuxiliaryCatalog: false,
        isFileAnalyticsSource: false,
        hasImplicitSingleSchema: false,
      };
    case "mssql":
    case "oracle":
      return {
        shape: "with-schema",
        autoLoadsAuxiliaryCatalog: true,
        isFileAnalyticsSource: false,
        hasImplicitSingleSchema: false,
      };
    case "mysql":
    case "mariadb":
      return {
        shape: "no-schema",
        autoLoadsAuxiliaryCatalog: true,
        isFileAnalyticsSource: false,
        hasImplicitSingleSchema: false,
      };
    case "sqlite":
      return {
        shape: "flat",
        autoLoadsAuxiliaryCatalog: false,
        isFileAnalyticsSource: false,
        hasImplicitSingleSchema: true,
      };
    case "duckdb":
      return {
        shape: "flat",
        autoLoadsAuxiliaryCatalog: false,
        isFileAnalyticsSource: true,
        hasImplicitSingleSchema: false,
      };
    case "mongodb":
    case "redis":
    case "valkey":
    case "elasticsearch":
    case "opensearch":
      return NON_RELATIONAL_PROFILE;
  }
}

export function resolveRdbTreeShape(dbType: DatabaseType): RdbTreeShape {
  return resolveRdbTreeProfile(dbType).shape;
}
