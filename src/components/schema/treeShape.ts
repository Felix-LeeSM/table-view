import type { DatabaseType } from "@/types/connection";

/**
 * Sprint 135 — DBMS-shape-aware sidebar tree depth.
 *
 * The relational sidebar tree (`SchemaTree`) renders one of three shapes
 * depending on whether the underlying DBMS exposes a real `schema` layer
 * between database and table:
 *
 *   - `"with-schema"` — PostgreSQL (and future MSSQL): `database → schema
 *     → table`. The schema row is interactive (expand / collapse,
 *     refresh) and tables are nested two levels deep.
 *   - `"no-schema"`   — MySQL / MariaDB: the schema row is suppressed
 *     because MySQL conflates "schema" with "database". Categories
 *     (Tables / Views / …) and their items render directly under the
 *     sidebar root, but each schema returned by the backend is still
 *     auto-expanded so existing data flows (`loadTables` etc.) work
 *     unchanged.
 *   - `"flat"`        — SQLite: the file *is* the database, so neither a
 *     schema row nor category headers are needed. We render the table
 *     list directly under the sidebar root (1-level).
 *
 * MongoDB / Redis don't reach this path — `pickSidebar` routes them to
 * `DocumentDatabaseTree` / `UnsupportedShellNotice`. They are excluded
 * from the union so a future regression that mounts SchemaTree against
 * a non-relational connection surfaces here.
 */
export type RdbTreeShape = "with-schema" | "no-schema" | "flat";

/** Subset of `DatabaseType` that legitimately mounts `SchemaTree`. */
export type RelationalDatabaseType = "postgresql" | "mysql" | "sqlite";

/**
 * Resolve the tree shape for a given relational `DatabaseType`. Falls
 * back to `"with-schema"` for unknown values rather than throwing —
 * `SchemaTree` is only mounted under the `rdb` paradigm so an unknown
 * value here implies a future relational backend that hasn't been
 * mapped yet, and the safest default is the most explicit shape (PG).
 *
 * Non-relational `db_type`s (`mongodb`, `redis`) are routed elsewhere by
 * `pickSidebar`; passing one in is a programming error and falls
 * through to the `"with-schema"` default for safety.
 */
export function resolveRdbTreeShape(dbType: DatabaseType): RdbTreeShape {
  switch (dbType) {
    case "postgresql":
      return "with-schema";
    case "mysql":
      return "no-schema";
    case "sqlite":
      return "flat";
    case "mongodb":
    case "redis":
      // Non-relational paradigms route to a different sidebar — but
      // until S138 introduces a stricter type-narrowing at the
      // `RdbSidebar` boundary, defaulting to `"with-schema"` keeps the
      // existing PG behaviour without throwing if a Mongo/Redis
      // connection somehow reached SchemaTree.
      return "with-schema";
  }
}
