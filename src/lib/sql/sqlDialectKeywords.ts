import type { DatabaseType } from "@/types/connection";
import { assertNever } from "@/lib/paradigm";

/**
 * Sprint 139 — Per-dialect SQL keyword sets.
 *
 * The SQL editor previously surfaced a paradigm-blind keyword list, which
 * meant Postgres-only keywords (`RETURNING`, `ILIKE`) showed up in MySQL
 * tabs and vice versa. This module returns the keywords appropriate for a
 * single `DatabaseType` so `useSqlAutocomplete` can swap the candidate set
 * whenever the active connection's `db_type` changes.
 *
 * Non-RDB DatabaseTypes (`mongodb`, `redis`) return an empty list because
 * `SqlQueryEditor` is only mounted for RDB-paradigm tabs. The empty branch
 * is kept defensively so any future code path that walks the helper for a
 * non-SQL connection type lands on a deterministic empty result instead of
 * an exception.
 */

/**
 * ANSI / common SQL keywords shared across PG / MySQL / SQLite. Surfaced as
 * autocomplete candidates regardless of dialect.
 */
export const COMMON_SQL_KEYWORDS: readonly string[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "OUTER JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "AS",
  "DISTINCT",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "DROP",
  "ALTER",
  "ADD",
  "COLUMN",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "DEFAULT",
  "CHECK",
  "CONSTRAINT",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "WITH",
  "RECURSIVE",
];

/** PostgreSQL-only keywords. */
const POSTGRES_KEYWORDS: readonly string[] = [
  "RETURNING",
  "ILIKE",
  "SERIAL",
  "BIGSERIAL",
  "JSONB",
  "EXCLUDED",
  "ON CONFLICT",
  "MATERIALIZED VIEW",
];

/** MySQL-only keywords. */
const MYSQL_KEYWORDS: readonly string[] = [
  "AUTO_INCREMENT",
  "REPLACE INTO",
  "DUAL",
  "ENGINE",
  "DUPLICATE KEY UPDATE",
];

/** SQLite-only keywords. */
const SQLITE_KEYWORDS: readonly string[] = [
  "PRAGMA",
  "WITHOUT ROWID",
  "IIF",
  "GLOB",
  "AUTOINCREMENT",
];

/**
 * Returns the keyword list appropriate for the given DatabaseType.
 *
 * RDB dialects return their dialect-specific keywords concatenated with the
 * common ANSI set. Non-RDB types return an empty array — the SQL editor is
 * never mounted for them, but the helper stays defensive.
 *
 * @param dbType DatabaseType of the active connection (or `undefined` when
 *               the connection has been deleted mid-session).
 */
export function getKeywordsForDialect(
  dbType: DatabaseType | undefined,
): readonly string[] {
  if (dbType === undefined) {
    // Deleted-connection or schema-less SQL fallback. Keep the common
    // keyword set so users still get reasonable suggestions.
    return COMMON_SQL_KEYWORDS;
  }
  switch (dbType) {
    case "postgresql":
      return [...POSTGRES_KEYWORDS, ...COMMON_SQL_KEYWORDS];
    case "mysql":
      return [...MYSQL_KEYWORDS, ...COMMON_SQL_KEYWORDS];
    case "sqlite":
      return [...SQLITE_KEYWORDS, ...COMMON_SQL_KEYWORDS];
    case "mongodb":
    case "redis":
      // SqlQueryEditor is never mounted for these paradigms. Defensive
      // empty list keeps any future caller deterministic.
      return [];
    default:
      return assertNever(dbType);
  }
}
