import type { SQLDialect } from "@codemirror/lang-sql";
import type { DatabaseType } from "@/types/connection";
import { codeMirrorDialectForDatabaseType } from "./sqlDialectProfile";

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
  return codeMirrorDialectForDatabaseType(dbType);
}
