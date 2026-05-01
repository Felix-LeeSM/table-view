// AC-144-1, AC-144-2, AC-144-4 — SQLite completion module.
//
// Owns the SQLite-specific keyword set + a candidate-generator factory.
// PG-only RETURNING / ILIKE and MySQL-only AUTO_INCREMENT are absent so
// cross-dialect contamination cannot happen.

import { prefixMatch, parseFromContext, type FromContext } from "./shared";
import { COMMON_SQL_KEYWORDS } from "@lib/sql/sqlDialectKeywords";
import type {
  CompletionCursor,
  CompletionCandidate,
  CompletionResult,
} from "./pg";

const SQLITE_ONLY: readonly string[] = [
  "PRAGMA",
  "WITHOUT ROWID",
  "IIF",
  "GLOB",
  "AUTOINCREMENT",
];

export const keywords: readonly string[] = [
  ...SQLITE_ONLY,
  ...COMMON_SQL_KEYWORDS,
];

export interface SqliteCompletionContext {
  tables: readonly string[];
  columns: Readonly<Record<string, readonly string[]>>;
}

export interface SqliteCompletionSource {
  (cursor: CompletionCursor): CompletionResult;
  readonly dbType: "sqlite";
}

export function createCompletionSource(
  ctx: SqliteCompletionContext,
): SqliteCompletionSource {
  const fn = (cursor: CompletionCursor): CompletionResult => {
    const fromContext: FromContext = parseFromContext(cursor.text);
    const candidates: CompletionCandidate[] = [];

    for (const table of ctx.tables) {
      if (prefixMatch(cursor.prefix, table)) {
        candidates.push({ label: table, type: "table" });
      }
    }

    for (const kw of keywords) {
      if (prefixMatch(cursor.prefix, kw)) {
        candidates.push({ label: kw, type: "keyword" });
      }
    }

    for (const table of fromContext.tables) {
      const cols = ctx.columns[table];
      if (!cols) continue;
      for (const col of cols) {
        if (prefixMatch(cursor.prefix, col)) {
          candidates.push({ label: col, type: "column" });
        }
      }
    }

    return { candidates, fromContext };
  };
  Object.defineProperty(fn, "dbType", { value: "sqlite", enumerable: true });
  return fn as SqliteCompletionSource;
}
