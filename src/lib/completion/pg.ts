// AC-144-1, AC-144-2, AC-144-4 — PostgreSQL completion module.
//
// Owns the PG-specific keyword set + a candidate-generator factory. The
// keyword set keeps PG-only tokens (RETURNING, ILIKE, JSONB, ON CONFLICT)
// alongside the common ANSI vocabulary; MySQL-only / SQLite-only tokens
// are absent so cross-dialect contamination cannot happen.

import { prefixMatch, parseFromContext, type FromContext } from "./shared";
import { COMMON_SQL_KEYWORDS } from "@lib/sqlDialectKeywords";

/** PG-only keywords, layered on top of `COMMON_SQL_KEYWORDS`. */
const POSTGRES_ONLY: readonly string[] = [
  "RETURNING",
  "ILIKE",
  "SERIAL",
  "BIGSERIAL",
  "JSONB",
  "EXCLUDED",
  "ON CONFLICT",
  "MATERIALIZED VIEW",
];

/** Public keyword list for the PG completion module. */
export const keywords: readonly string[] = [
  ...POSTGRES_ONLY,
  ...COMMON_SQL_KEYWORDS,
];

/** Catalog snapshot a candidate generator needs. */
export interface PgCompletionContext {
  /** Known table / view names for the active connection. */
  tables: readonly string[];
  /** Column names per table (key = table name, value = column list). */
  columns: Readonly<Record<string, readonly string[]>>;
}

/** Cursor-position descriptor passed into the candidate generator. */
export interface CompletionCursor {
  text: string;
  cursor: number;
  prefix: string;
}

export interface CompletionCandidate {
  label: string;
  type: "keyword" | "table" | "column" | "function" | "hint";
}

export interface CompletionResult {
  candidates: CompletionCandidate[];
  fromContext: FromContext;
}

/**
 * Locked-to-postgresql completion source. Each per-DBMS module's source
 * exposes a `dbType` literal so the resolver in `pairing.ts` can refuse to
 * wire it to a non-matching paradigm at compile time.
 */
export interface PgCompletionSource {
  (cursor: CompletionCursor): CompletionResult;
  readonly dbType: "postgresql";
}

/**
 * Build a PG-specific candidate generator. The generator filters the table
 * list, keyword set, and (when the cursor sits inside a known FROM table's
 * SELECT list) the column set by `cursor.prefix` and returns a single flat
 * candidate list.
 */
export function createCompletionSource(
  ctx: PgCompletionContext,
): PgCompletionSource {
  const fn = (cursor: CompletionCursor): CompletionResult => {
    const fromContext = parseFromContext(cursor.text);
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

    // Surface columns of any table referenced in the FROM context.
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
  // Lock the dbType discriminator. `as const` keeps the literal type so the
  // resolver in `pairing.ts` can branch on it without widening to `string`.
  Object.defineProperty(fn, "dbType", {
    value: "postgresql",
    enumerable: true,
  });
  return fn as PgCompletionSource;
}
