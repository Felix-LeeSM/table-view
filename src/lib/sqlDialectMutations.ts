/**
 * Sprint 132 — raw-query DB-change detection.
 *
 * `extractDbMutation(sql, dialect)` walks the input once to mask comments
 * and string literals, splits on top-level `;`, then matches each
 * dialect-specific "switch DB / schema / index" pattern. Returns the LAST
 * matching hint (sprint contract specifies last-match-wins for multi-statement
 * input). Returns `null` when no statement matches the requested dialect.
 *
 * The masking pass replaces the *content* of comments / strings with spaces
 * so character offsets remain valid for downstream consumers and so a literal
 * like `SELECT 'use foo'` cannot trip the `use foo` regex. Comment + string
 * delimiters themselves are preserved so the per-statement regex still anchors
 * cleanly on whitespace boundaries.
 *
 * Out of scope (sprint 132): full SQL parser, multi-match extraction, and
 * dialect inference (caller passes the dialect).
 */
export type DbMutationHint =
  | { kind: "switch_database"; dialect: "postgres" | "mysql"; targetDb: string }
  | { kind: "switch_schema"; dialect: "postgres"; targetSchema: string }
  | { kind: "redis_select"; databaseIndex: number };

export type SqlMutationDialect = "postgres" | "mysql" | "redis";

/**
 * Mask comments and string literals in `sql` so subsequent regex scanning
 * cannot match tokens inside them. Returns a new string of the same length
 * where comment/string *contents* are replaced with spaces. Delimiters
 * (`--`, `/* *\/`, `#`, `'`, `"`, `` ` ``) are preserved so the masked
 * string still parses cleanly with anchored regexes.
 *
 * The MySQL `#` line comment is only masked when `dialect === "mysql"` —
 * Postgres treats `#` as an operator character so masking it there would
 * silently drop tokens.
 */
function maskCommentsAndStrings(
  sql: string,
  dialect: SqlMutationDialect,
): string {
  const out: string[] = new Array(sql.length);
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // Line comment: -- ... EOL
    if (ch === "-" && next === "-") {
      out[i] = ch;
      out[i + 1] = next;
      let j = i + 2;
      while (j < sql.length && sql[j] !== "\n") {
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    // MySQL line comment: # ... EOL (only when dialect is mysql)
    if (ch === "#" && dialect === "mysql") {
      out[i] = ch;
      let j = i + 1;
      while (j < sql.length && sql[j] !== "\n") {
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    // Block comment: /* ... */
    if (ch === "/" && next === "*") {
      out[i] = ch;
      out[i + 1] = next;
      let j = i + 2;
      while (j < sql.length) {
        if (sql[j] === "*" && sql[j + 1] === "/") {
          out[j] = " "; // mask the closing star...
          out[j + 1] = " "; // ...and slash so they can't combine with adjacent ops
          j += 2;
          break;
        }
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    // Single-quoted string: '...' (with '' as escaped single quote)
    if (ch === "'") {
      out[i] = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          // Escaped quote inside the string — mask both as space and continue.
          out[j] = " ";
          out[j + 1] = " ";
          j += 2;
          continue;
        }
        if (sql[j] === "\\" && j + 1 < sql.length) {
          // Backslash escape (MySQL/SQLite-flavored). Mask both chars
          // so an embedded `\c admin` cannot become a real meta-command
          // after masking.
          out[j] = " ";
          out[j + 1] = " ";
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          out[j] = "'";
          j++;
          break;
        }
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    // Double-quoted identifier/string: "..."
    if (ch === '"') {
      out[i] = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          out[j] = " ";
          out[j + 1] = " ";
          j += 2;
          continue;
        }
        if (sql[j] === "\\" && j + 1 < sql.length) {
          out[j] = " ";
          out[j + 1] = " ";
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          out[j] = '"';
          j++;
          break;
        }
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    // Backtick-quoted MySQL identifier: `...`
    if (ch === "`") {
      out[i] = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "`") {
          out[j] = "`";
          j++;
          break;
        }
        out[j] = " ";
        j++;
      }
      i = j;
      continue;
    }

    out[i] = ch;
    i++;
  }
  return out.join("");
}

/**
 * Split `masked` on top-level `;`. The masking pass already guaranteed that
 * any `;` inside a comment/string was replaced with a space — so a naive
 * `split(";")` on the masked string is sound. The returned slices are
 * extracted from the *original* SQL so the regex sees the real content
 * (only comment/string contents have been blanked); both arrays have the
 * same shape.
 */
function splitTopLevel(
  raw: string,
  masked: string,
): { raw: string; masked: string }[] {
  const out: { raw: string; masked: string }[] = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ";") {
      out.push({
        raw: raw.slice(start, i),
        masked: masked.slice(start, i),
      });
      start = i + 1;
    }
  }
  if (start < masked.length) {
    out.push({
      raw: raw.slice(start),
      masked: masked.slice(start),
    });
  }
  return out;
}

/**
 * Strip surrounding `"`/`` ` `` quotes from a captured identifier. Backticks
 * and double quotes are the two delimiters we accept for `\c "my db"` and
 * MySQL `` USE `my-db` ``. Single quotes are intentionally not stripped —
 * they would already have been masked by the comment/string pass, so a single
 * quote reaching this point is anomalous.
 */
function stripIdentifierQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "`" && last === "`")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// ── Per-dialect regex patterns (anchored, case-insensitive) ──────────────
// All patterns operate on the masked statement text trimmed of leading
// whitespace. Anchoring with `^` keeps `INSERT ... USE_THIS_FUNC()` style
// false positives at zero — only the leading token can trigger a match.

// PG `\c <db>` or `\connect <db>`. Captures either a quoted identifier or a
// bareword (\w plus `-`). The trailing `\s*$` anchors against the end of
// the statement so trailing junk fails the match.
const PG_META_CONNECT = /^\s*\\c(?:onnect)?\s+("[^"]+"|[\w-]+)\s*$/i;

// PG `SET search_path TO ...` (or `=`). The captured group includes any
// further schemas / quoting; we extract the first comma-separated token
// from the capture downstream.
const PG_SET_SEARCH_PATH =
  /^\s*set\s+search_path\s+(?:to|=)\s+([\w\-,\s"']+);?\s*$/i;

// MySQL `USE <db>`. Accepts unquoted, double-quoted, or backtick-quoted
// identifiers; the strip helper unwraps the delimiter.
const MYSQL_USE = /^\s*use\s+("[^"]+"|`[^`]+`|[\w-]+)\s*;?\s*$/i;

// Redis `SELECT <n>`. Bounded to digits so `SELECT * FROM t` cannot match.
const REDIS_SELECT = /^\s*select\s+(\d+)\s*$/i;

/**
 * Re-extract capture group `groupIndex` from `raw` using the offsets the
 * match produced against the masked string. The masked and raw strings
 * have identical lengths (mask preserves positions), so the masked match's
 * absolute offset of the captured group is also valid in the raw text.
 *
 * We compute the capture's absolute offset by locating it inside the
 * matched-substring (`match[0]`) — `indexOf` is sufficient because we mask
 * with single spaces, so the masked capture is unique within `match[0]`
 * for these dialect patterns.
 */
function sliceCapture(
  raw: string,
  match: RegExpExecArray,
  groupIndex: number,
): string {
  const captured = match[groupIndex];
  if (captured === undefined) return "";
  const matchedText = match[0];
  const inMatchOffset = matchedText.indexOf(captured);
  if (inMatchOffset < 0) return captured;
  const start = match.index + inMatchOffset;
  return raw.slice(start, start + captured.length);
}

/**
 * Extract a DB-mutation hint from `sql` for the given dialect. Returns the
 * LAST matching hint across multi-statement input (sprint contract — the
 * frontend hook only acts on the most recent state change).
 *
 * Returns `null` when:
 *   - input is empty / whitespace-only
 *   - no statement matches a pattern relevant to `dialect`
 *   - the only matches belong to a dialect the caller did not request
 *
 * Match precedence within a statement (each statement is examined once):
 *   1. PG meta `\c` / `\connect`
 *   2. PG `SET search_path`
 *   3. MySQL `USE`
 *   4. Redis `SELECT n`
 * The `dialect` argument gates which patterns are considered, so a
 * `dialect === "postgres"` caller will never receive a `mysql` hint even
 * if the statement happens to look like `USE foo`.
 */
export function extractDbMutation(
  sql: string,
  dialect: SqlMutationDialect,
): DbMutationHint | null {
  if (!sql) return null;

  const masked = maskCommentsAndStrings(sql, dialect);
  const statements = splitTopLevel(sql, masked);
  let last: DbMutationHint | null = null;

  for (const stmt of statements) {
    // Skip statements that are entirely whitespace after masking.
    if (!stmt.masked.trim()) continue;

    if (dialect === "postgres") {
      const meta = PG_META_CONNECT.exec(stmt.masked);
      if (meta && meta.index !== undefined) {
        // Pull the captured slice from the *raw* statement so quoted
        // identifiers retain their content (the masked version blanked it).
        const raw = sliceCapture(stmt.raw, meta, 1);
        last = {
          kind: "switch_database",
          dialect: "postgres",
          targetDb: stripIdentifierQuotes(raw),
        };
        continue;
      }
      const sp = PG_SET_SEARCH_PATH.exec(stmt.masked);
      if (sp) {
        const rawCap = sliceCapture(stmt.raw, sp, 1);
        // Pick the first comma-separated schema. Trim quotes/whitespace so
        // `SET search_path TO "Public", other` resolves to `Public`.
        const first = rawCap.split(",")[0]?.trim() ?? "";
        const cleaned = first.replace(/^["']|["']$/g, "").trim();
        if (cleaned) {
          last = {
            kind: "switch_schema",
            dialect: "postgres",
            targetSchema: cleaned,
          };
        }
        continue;
      }
    } else if (dialect === "mysql") {
      const useMatch = MYSQL_USE.exec(stmt.masked);
      if (useMatch) {
        const raw = sliceCapture(stmt.raw, useMatch, 1);
        last = {
          kind: "switch_database",
          dialect: "mysql",
          targetDb: stripIdentifierQuotes(raw),
        };
        continue;
      }
    } else if (dialect === "redis") {
      const sel = REDIS_SELECT.exec(stmt.masked);
      if (sel && sel[1]) {
        // Digits are not affected by masking, so the masked capture is fine.
        const idx = Number.parseInt(sel[1], 10);
        if (Number.isFinite(idx) && idx >= 0) {
          last = { kind: "redis_select", databaseIndex: idx };
        }
        continue;
      }
    }
  }

  return last;
}
