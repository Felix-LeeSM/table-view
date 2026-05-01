// AC-144-1, AC-144-2, AC-144-4 — MySQL completion module.
//
// Owns the MySQL-specific keyword set, the `LIMIT n,m` hint candidate, and
// a candidate-generator factory. PG-only RETURNING / ILIKE are deliberately
// absent; SQLite-only PRAGMA / WITHOUT ROWID likewise.

import { prefixMatch, parseFromContext, type FromContext } from "./shared";
import { COMMON_SQL_KEYWORDS } from "@lib/sql/sqlDialectKeywords";
import type {
  CompletionCursor,
  CompletionCandidate,
  CompletionResult,
} from "./pg";

/** MySQL-only keywords, layered on top of `COMMON_SQL_KEYWORDS`. */
const MYSQL_ONLY: readonly string[] = [
  "AUTO_INCREMENT",
  "REPLACE INTO",
  "DUAL",
  "ENGINE",
  "DUPLICATE KEY UPDATE",
];

export const keywords: readonly string[] = [
  ...MYSQL_ONLY,
  ...COMMON_SQL_KEYWORDS,
];

/**
 * MySQL `LIMIT` accepts a two-argument form (`LIMIT offset, count`) that PG
 * and SQLite reject. The completion popup surfaces these as documentation
 * hints when the cursor sits immediately after the `LIMIT ` keyword so users
 * who don't know the comma syntax discover it.
 */
export const LIMIT_HINTS: readonly CompletionCandidate[] = [
  { label: "LIMIT n,m", type: "hint" },
  { label: "LIMIT offset,count", type: "hint" },
  { label: "LIMIT count,offset", type: "hint" },
];

export interface MysqlCompletionContext {
  tables: readonly string[];
  columns: Readonly<Record<string, readonly string[]>>;
}

export interface MysqlCompletionSource {
  (cursor: CompletionCursor): CompletionResult;
  readonly dbType: "mysql";
}

/**
 * True when the text up to the cursor ends in a freshly-typed `LIMIT `
 * keyword (case-insensitive, optional trailing whitespace required so we
 * don't fire on `LIMIT5`).
 */
function cursorIsAfterLimit(text: string, cursor: number): boolean {
  const upTo = text.slice(0, cursor);
  return /\blimit\s+$/i.test(upTo);
}

export function createCompletionSource(
  ctx: MysqlCompletionContext,
): MysqlCompletionSource {
  const fn = (cursor: CompletionCursor): CompletionResult => {
    const fromContext: FromContext = parseFromContext(cursor.text);
    const candidates: CompletionCandidate[] = [];

    if (cursorIsAfterLimit(cursor.text, cursor.cursor)) {
      // LIMIT n,m hint takes priority — the user is mid-LIMIT clause and
      // wants the syntax hint front-and-centre.
      for (const hint of LIMIT_HINTS) {
        candidates.push(hint);
      }
    }

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
  Object.defineProperty(fn, "dbType", { value: "mysql", enumerable: true });
  return fn as MysqlCompletionSource;
}
