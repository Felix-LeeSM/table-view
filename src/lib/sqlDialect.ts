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
 * - `mysql`      → `MySQL`      (backtick identifier quoting, `REPLACE INTO`, `DUAL`)
 * - `sqlite`     → `SQLite`     (`AUTOINCREMENT`, `PRAGMA`, `IIF`)
 * - anything else / `undefined` → `StandardSQL` (document / kv paradigms, or
 *   a tab whose connection was deleted — silent fallback is intentional so the
 *   editor never throws on a missing connection reference).
 *
 * Sprint 82 surfaces dialect-specific keyword highlighting + autocomplete
 * candidates on RDB query tabs. Document-paradigm tabs still receive this
 * value but ignore it — their editor swaps to the JSON language extension.
 */
export function databaseTypeToSqlDialect(
  dbType: DatabaseType | undefined,
): SQLDialect {
  switch (dbType) {
    case "postgresql":
      return PostgreSQL;
    case "mysql":
      return MySQL;
    case "sqlite":
      return SQLite;
    default:
      // MongoDB, Redis, undefined (deleted connection reference), or future
      // DatabaseType variants we haven't mapped yet fall back to the generic
      // standard dialect. MariaSQL / MSSQL / Oracle are out of Sprint 82 scope
      // (see docs/sprints/sprint-82/contract.md) and will map here too until a
      // future sprint explicitly wires them.
      return StandardSQL;
  }
}
