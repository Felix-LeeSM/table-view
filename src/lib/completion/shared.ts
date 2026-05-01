// AC-144-1, AC-144-2 — shared façade for the per-DBMS completion modules.
//
// Sprint 145 splits the autocomplete engine by DBMS. The truly DBMS-agnostic
// helpers (tokenizer, statement splitter, FROM-context parser, identifier
// quoting, prefix matching) live here so each per-DBMS module can import
// only what it needs without pulling in the SQL keyword sets.
//
// `sqlTokenize.ts` and `sqlUtils.ts` remain on disk as the underlying
// implementation; this file re-exports from them so `lib/completion/*` can
// be the single import surface for callers migrated in the same PR.

import {
  tokenizeSql,
  type SqlToken,
  type SqlTokenKind,
} from "@lib/sql/sqlTokenize";
import { splitSqlStatements, formatSql, uglifySql } from "@lib/sql/sqlUtils";
import type { Paradigm } from "@/types/connection";
import type { DatabaseType } from "@/types/connection";

export { tokenizeSql, splitSqlStatements, formatSql, uglifySql };
export type { SqlToken, SqlTokenKind };

// ── prefix matcher ─────────────────────────────────────────────────────────

/**
 * Case-insensitive prefix match used by every per-DBMS candidate generator.
 * Empty `prefix` matches every candidate. A `prefix` longer than the
 * candidate cannot match — short-circuit to keep the comparison O(prefix).
 */
export function prefixMatch(prefix: string, candidate: string): boolean {
  if (prefix.length === 0) return true;
  if (prefix.length > candidate.length) return false;
  return (
    candidate.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
  );
}

// ── identifier quoting ─────────────────────────────────────────────────────

/**
 * Identifier-quoting flavour. `"ansi"` and `"postgres"` and `"sqlite"` all
 * use ANSI double-quote semantics; MySQL uses backticks.
 */
export type QuoteFlavour = "ansi" | "postgres" | "mysql" | "sqlite";

/**
 * Wrap `name` in the dialect's identifier quote character and double any
 * embedded occurrence of that character per SQL standards. Used by the
 * QueryEditor's "preserve mixed-case identifiers" path so generated DDL
 * round-trips through the server intact.
 */
export function escapeIdentifier(name: string, flavour: QuoteFlavour): string {
  if (flavour === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

// ── FROM-context parser ────────────────────────────────────────────────────

/**
 * Lightweight parse result describing the table list and alias map produced
 * by walking a SQL statement's FROM / JOIN / INTO clauses. Intentionally
 * minimal — completion sources only need the table set + alias-to-table
 * mapping; richer analysis (subqueries, CTEs) is deferred.
 */
export interface FromContext {
  tables: string[];
  aliases: Record<string, string>;
}

/**
 * Walk the input `sql` and extract every table referenced in FROM / JOIN
 * clauses or in `INSERT INTO`. Captures aliases declared with `AS` or with
 * the standard implicit form (`users u`). The parser is a token-level
 * scanner — it does NOT understand subqueries, CTEs, or schema-qualified
 * names beyond surfacing the dotted form as-is. This is sufficient for the
 * completion-popup callers, which only need a set of "known table names" to
 * filter the candidate list.
 */
export function parseFromContext(sql: string): FromContext {
  const tables: string[] = [];
  const aliases: Record<string, string> = {};
  if (!sql) return { tables, aliases };

  // Tokenize and drop whitespace / comments so the cursor walks meaningful
  // tokens only. The tokeniser already classifies KEYWORDs case-insensitively.
  const tokens = tokenizeSql(sql).filter(
    (t) => t.kind !== "whitespace" && t.kind !== "comment",
  );

  const TABLE_INTRODUCERS = new Set(["FROM", "JOIN", "INTO"]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const upper = t.text.toUpperCase();
    if (t.kind !== "keyword" || !TABLE_INTRODUCERS.has(upper)) continue;

    // Walk the comma-separated table list following the introducer. Stops
    // at the next keyword (WHERE / ON / GROUP / etc.) or punctuation that
    // terminates the table list.
    let j = i + 1;
    while (j < tokens.length) {
      const tableTok = tokens[j];
      if (!tableTok) break;
      if (tableTok.kind !== "identifier") break;

      const tableName = stripIdentifierQuotes(tableTok.text);
      tables.push(tableName);

      // Look ahead for an alias: `users AS u` or `users u`.
      let k = j + 1;
      let aliasTok = tokens[k];

      if (
        aliasTok &&
        aliasTok.kind === "keyword" &&
        aliasTok.text.toUpperCase() === "AS"
      ) {
        k++;
        aliasTok = tokens[k];
      }

      if (aliasTok && aliasTok.kind === "identifier") {
        const aliasName = stripIdentifierQuotes(aliasTok.text);
        // An alias must NOT be one of our list-terminator keywords; the
        // keyword-kind guard above already handles that, so any identifier
        // immediately following the table name is treated as the alias.
        aliases[aliasName] = tableName;
        k++;
      }

      // Continue walking the comma-separated list.
      const sep = tokens[k];
      if (sep && sep.kind === "punct" && sep.text === ",") {
        j = k + 1;
        continue;
      }
      // No comma → table list ends here.
      i = k - 1;
      break;
    }
  }

  return { tables, aliases };
}

function stripIdentifierQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "`" && last === "`") ||
      (first === "[" && last === "]")
    ) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

// ── pairing error ──────────────────────────────────────────────────────────

/**
 * Thrown when a (paradigm, db_type) pair is wired to the wrong completion
 * module — e.g. an `rdb` paradigm wired to a `mongodb` db_type, or a
 * `document` paradigm wired to a `postgresql` db_type. This is also a
 * compile-time TS error at every per-DBMS module boundary because each
 * module's `dbType` field is locked to a literal `DatabaseType`. The
 * runtime guard exists for defence in depth (config corruption, future
 * server payloads outside the union, etc.).
 */
export class CompletionPairingError extends Error {
  readonly paradigm: Paradigm;
  readonly dbType: DatabaseType;

  constructor(paradigm: Paradigm, dbType: DatabaseType) {
    super(
      `CompletionPairingError: paradigm '${paradigm}' is incompatible with db_type '${dbType}'.`,
    );
    this.name = "CompletionPairingError";
    this.paradigm = paradigm;
    this.dbType = dbType;
  }
}
