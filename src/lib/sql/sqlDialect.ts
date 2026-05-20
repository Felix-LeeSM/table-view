import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { DatabaseType } from "@/types/connection";

/**
 * Map a `DatabaseType` to its CodeMirror `SQLDialect`.
 *
 * - `postgresql` → `PostgreSQL` (supports `RETURNING`, `ILIKE`, `$$` quoting)
 * - `mysql` / `mariadb` → `MySQL` (backtick identifier quoting, `REPLACE INTO`, `DUAL`)
 * - `sqlite`     → `SQLite`     (`AUTOINCREMENT`, `PRAGMA`, `IIF`)
 * - anything else / `undefined` → `StandardSQL` (document / kv paradigms, or
 *   a tab whose connection was deleted — silent fallback is intentional so the
 *   editor never throws on a missing connection reference).
 *
 * Drives dialect-specific keyword highlighting + autocomplete on RDB
 * query tabs. Document-paradigm tabs ignore the value — their editor
 * swaps to the JSON language extension.
 */
export function databaseTypeToSqlDialect(
  dbType: DatabaseType | undefined,
): SQLDialect {
  switch (dbType) {
    case "postgresql":
      return PostgreSQL;
    case "mysql":
    case "mariadb":
      return MySQL;
    case "sqlite":
      return SQLite;
    default:
      // MongoDB, Redis, undefined (deleted connection reference), and
      // unmapped DatabaseType variants fall back to the generic standard
      // dialect.
      return StandardSQL;
  }
}
