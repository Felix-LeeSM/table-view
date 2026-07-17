import { scanDollarQuoteEnd, skipQuotedLiteral } from "./sqlTokenize";
import type { Dialect, StatementAnalysisOptions } from "./sqlSafetyTypes";

const WHITESPACE_RE = /\s+/g;

/**
 * Issue #1450 / PR #1473 — literal-aware, dialect-gated comment stripper.
 * Replaces the old two-regex (BLOCK_COMMENT_RE / LINE_COMMENT_RE) pass. One
 * pass so string literals, quoted identifiers, and dollar-quotes are copied
 * verbatim (a comment marker inside them is NOT a comment). The dialect gates
 * three scanning rules:
 *   - Block comments depth-count ONLY for PostgreSQL — the one dialect that
 *     nests `/* /* *\/ *\/`. Every other dialect (MySQL/MariaDB/SQLite/
 *     Oracle/MSSQL) ends the comment at the FIRST close marker, exactly what
 *     the real server does. Review #1473 F1: depth-counting a non-nesting
 *     dialect fails OPEN on an unbalanced open — `/* /* *\/ DROP TABLE t` was
 *     consumed whole → "" → info, while MySQL ends the comment at the first
 *     close and executes the DROP. An unknown dialect defaults to first-close
 *     (fail-closed, restores the pre-#1473 behavior).
 *   - '#' is a line comment only for MySQL/MariaDB (dialect === "mysql");
 *     elsewhere it is an operator (PostgreSQL XOR) or a temp-table prefix
 *     (MSSQL #t).
 *   - Backslash literal escapes only for MySQL/MariaDB (review #1473 N1) —
 *     `\'` stays inside the literal there; standard SQL treats `\` as a plain
 *     character.
 */
function stripComments(sql: string, dialect?: Dialect): string {
  const hashComments = dialect === "mysql";
  const backslashEscapes = dialect === "mysql";
  const nestedBlockComments = dialect === "postgresql";
  const oracleQuotes = dialect === "oracle";
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipQuotedLiteral(sql, i, ch, backslashEscapes, oracleQuotes);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "$") {
      const end = scanDollarQuoteEnd(sql, i);
      if (end !== null) {
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    // Line comment: `--` (all dialects) or `#` (MySQL only) → one space.
    if ((ch === "-" && sql[i + 1] === "-") || (hashComments && ch === "#")) {
      i += ch === "#" ? 1 : 2;
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    // Block comment `/* … */` — depth-counted for PostgreSQL (nesting);
    // first close marker ends it for every other dialect (fail-closed).
    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (nestedBlockComments && sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function normalize(sql: string, dialect?: Dialect): string {
  return stripComments(sql, dialect).replace(WHITESPACE_RE, " ").trim();
}

export function hasMssqlBatchSeparator(sql: string): boolean {
  return /^[ \t]*GO(?:\s+\d+)?[ \t]*;?[ \t]*$/im.test(stripComments(sql));
}

export function isUnsupportedTsqlProceduralScript(upper: string): boolean {
  return (
    /^CREATE\s+(?:OR\s+ALTER\s+)?PROCEDURE\b/.test(upper) ||
    /^ALTER\s+PROCEDURE\b/.test(upper) ||
    /^DECLARE\b/.test(upper) ||
    /^BEGIN\s+(?!TRAN(?:SACTION)?\b|WORK\b)/.test(upper) ||
    /^BEGIN\s+TRY\b/.test(upper) ||
    /^WHILE\b/.test(upper)
  );
}

export function isMssqlSafetyContext(
  options?: StatementAnalysisOptions,
): boolean {
  return options?.dialect === "mssql";
}

/**
 * Issue #1450 — word-boundary `WHERE` presence that skips string literals,
 * quoted identifiers, and dollar-quotes. The old `/\bWHERE\b/i` matched a
 * `WHERE` inside a string literal (`SET note = 'ask WHERE money'`), so an
 * unbounded UPDATE/DELETE was mis-read as bounded and degraded to `warn`.
 * `stripped` is upper-cased at every callsite, so the needle is upper only.
 * `backslashEscapes` mirrors `stripComments` (MySQL/MariaDB, review #1473 N1)
 * so both scanners agree on literal boundaries.
 */
export function hasOuterWhere(
  stripped: string,
  backslashEscapes: boolean,
  oracleQuotes: boolean,
): boolean {
  let i = 0;
  const n = stripped.length;
  while (i < n) {
    const ch = stripped[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuotedLiteral(stripped, i, ch, backslashEscapes, oracleQuotes);
      continue;
    }
    if (ch === "$") {
      const end = scanDollarQuoteEnd(stripped, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if (
      stripped.startsWith("WHERE", i) &&
      !isWordChar(stripped[i - 1]) &&
      !isWordChar(stripped[i + 5])
    ) {
      return true;
    }
    i++;
  }
  return false;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}
