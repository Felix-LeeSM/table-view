import type { DatabaseType } from "@/types/connection";
import {
  COMMON_SQL_KEYWORDS,
  getSqlKeywordsForDatabaseType,
} from "./sqlDialectProfile";

export { COMMON_SQL_KEYWORDS };

/**
 * Backwards-compatible keyword helper. The canonical keyword vocabulary now
 * lives on `SqlDialectProfile`; this wrapper preserves the older import path
 * used by tests and legacy completion modules.
 */
export function getKeywordsForDialect(
  dbType: DatabaseType | undefined,
): readonly string[] {
  return getSqlKeywordsForDatabaseType(dbType);
}
