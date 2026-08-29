import type { Dialect } from "./sqlSafetyTypes";
import { scanDollarQuoteEnd, skipQuotedLiteral } from "./sqlTokenize";

/**
 * Splits a SQL string into individual statements by semicolons,
 * correctly handling semicolons inside string literals, quoted identifiers,
 * line comments (-- / #), block comments (/* *\/), and PostgreSQL dollar-quoted
 * strings ($$…$$ / $tag$…$tag$).
 *
 * Issue #2554 — `dialect` gates the three scanning rules that differ per
 * server, derived exactly as `stripComments` (sqlSafetyNormalize.ts) derives
 * them so the splitter and the classifier agree on literal/comment boundaries:
 *
 *   - `backslashEscapes` (MySQL/MariaDB): `\<any>` inside a `'` / `"` literal
 *     is an escape sequence, so `'O\'Brien; DROP TABLE users; --'` stays ONE
 *     literal. Backtick identifiers escape by doubling only.
 *   - `hashComments` (MySQL/MariaDB): `#` opens a line comment. Elsewhere it is
 *     an operator (PostgreSQL XOR) or a temp-table prefix (MSSQL `#t`).
 *   - `oracleQuotes` (Oracle, #1455 P3-4 / B2): `q'X…X'` / `nq'X…X'`
 *     alternate-quote literals are opaque, so a `;` inside one does not split.
 *
 * This splitter feeds the **execution** path (`rdbQueryExecution` /
 * `useDdlPreviewExecution`), so a fragment invented here is a statement the
 * driver actually runs: scanning MySQL text under standard-SQL rules cut
 * literal and comment bodies into standalone `DROP TABLE` statements. An
 * unresolved dialect keeps the standard-SQL reading.
 */
export function splitSqlStatements(sql: string, dialect?: Dialect): string[] {
  const backslashEscapes = dialect === "mysql";
  const hashComments = dialect === "mysql";
  const oracleQuotes = dialect === "oracle";
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // Quoted literal / identifier — `'`, `"`, MySQL backticks. Opaque, so an
    // inner `;` never splits. `skipQuotedLiteral` (sqlTokenize.ts) owns the
    // doubling, backslash-escape, and Oracle q-quote rules for all three, which
    // is what keeps this splitter from drifting away from the classifier.
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipQuotedLiteral(sql, i, ch, backslashEscapes, oracleQuotes);
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // MSSQL bracket identifier — ]] is an escaped ]. A `;` inside [...] is not
    // valid in any supported dialect (incl. Postgres array subscripts), so
    // treating bracket content as opaque only ever improves the split.
    if (ch === "[") {
      current += ch;
      i++;
      while (i < len) {
        const inner = sql[i];
        current += inner;
        if (inner === "]") {
          if (i + 1 < len && sql[i + 1] === "]") {
            i++;
            current += sql[i];
            i++;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    // PostgreSQL dollar-quoted string ($$…$$ / $tag$…$tag$). Opaque like the
    // quote handlers above so inner ;/--/'/comments never split the body. A
    // non-opening `$` (positional param $1, lone $) returns null and falls
    // through to the default char append below.
    if (ch === "$") {
      const end = scanDollarQuoteEnd(sql, i);
      if (end !== null) {
        current += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    // Line comment — `--` (every dialect) or `#` (MySQL/MariaDB only). The
    // body runs to the newline, which stays outside the comment so the next
    // line splits normally.
    if ((ch === "-" && sql[i + 1] === "-") || (hashComments && ch === "#")) {
      const start = i;
      i += ch === "#" ? 1 : 2;
      while (i < len && sql[i] !== "\n") i++;
      current += sql.slice(start, i);
      continue;
    }

    // Block comment (/* ... */)
    if (ch === "/" && i + 1 < len && sql[i + 1] === "*") {
      current += ch;
      i++;
      current += sql[i];
      i++;
      while (i < len) {
        const inner = sql[i];
        current += inner;
        if (inner === "*" && i + 1 < len && sql[i + 1] === "/") {
          i++;
          current += sql[i];
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Semicolon — statement separator
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Handle last statement (no trailing semicolon)
  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

// ---------------------------------------------------------------------------
// SQL Formatting
// ---------------------------------------------------------------------------

/** Keywords that should be uppercased. */
const KEYWORDS_TO_UPPERCASE = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "FULL",
  "ON",
  "ORDER",
  "BY",
  "GROUP",
  "HAVING",
  "INSERT",
  "INTO",
  "UPDATE",
  "DELETE",
  "SET",
  "VALUES",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "LIMIT",
  "OFFSET",
  "CREATE",
  "TABLE",
  "DROP",
  "ALTER",
  "INDEX",
  "UNION",
  "ALL",
  "DISTINCT",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ASC",
  "DESC",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "UNIQUE",
  "DEFAULT",
  "CHECK",
  "CONSTRAINT",
  "IF",
  "RETURNING",
  "WITH",
  "RECURSIVE",
]);

/** Major keywords that should start on a new line. */
const LINE_BREAK_BEFORE = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "FULL JOIN",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "VALUES",
  "SET",
  "UNION",
  "INSERT INTO",
]);

/**
 * Basic SQL formatter:
 * - Uppercases known keywords
 * - Adds a newline before major keywords
 * - Removes extra whitespace
 */
export function formatSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return "";

  // Tokenize: split into words, preserving quoted strings and operators
  const tokens: string[] = [];
  let i = 0;
  const len = trimmed.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(trimmed[i]!)) {
      i++;
      continue;
    }

    // Single-quoted string
    if (trimmed[i] === "'") {
      let str = "'";
      i++;
      while (i < len) {
        if (trimmed[i] === "'") {
          str += "'";
          i++;
          if (i < len && trimmed[i] === "'") {
            str += "'";
            i++;
          } else {
            break;
          }
        } else {
          str += trimmed[i];
          i++;
        }
      }
      tokens.push(str);
      continue;
    }

    // Double-quoted identifier
    if (trimmed[i] === '"') {
      let ident = '"';
      i++;
      while (i < len && trimmed[i] !== '"') {
        ident += trimmed[i];
        i++;
      }
      if (i < len) {
        ident += '"';
        i++;
      }
      tokens.push(ident);
      continue;
    }

    // Punctuation / operators
    if (/[(),;=<>!+\-*/]/.test(trimmed[i]!)) {
      // Multi-char operators
      if (i + 1 < len && /[=<>!]/.test(trimmed[i + 1]!)) {
        tokens.push(trimmed.substring(i, i + 2));
        i += 2;
      } else {
        tokens.push(trimmed[i]!);
        i++;
      }
      continue;
    }

    // Word token (identifier, keyword, number)
    let word = "";
    while (i < len && /[a-zA-Z0-9_.]/.test(trimmed[i]!)) {
      word += trimmed[i];
      i++;
    }
    if (word) {
      tokens.push(word);
    }
  }

  // Uppercase keywords and build output with line breaks
  const lines: string[] = [];
  let currentLine = "";

  // Look ahead to check for compound keywords like "LEFT JOIN", "ORDER BY"
  for (let t = 0; t < tokens.length; t++) {
    let token = tokens[t]!;

    // Determine compound keyword (e.g., "LEFT" + "JOIN" -> "LEFT JOIN")
    const upper = token.toUpperCase();
    let compoundKey = upper;
    if (t + 1 < tokens.length) {
      const nextUpper = tokens[t + 1]!.toUpperCase();
      const candidate = `${upper} ${nextUpper}`;
      if (LINE_BREAK_BEFORE.has(candidate)) {
        compoundKey = candidate;
      }
    }

    // Uppercase known keywords
    if (KEYWORDS_TO_UPPERCASE.has(upper)) {
      token = upper;
    }

    // Check if this token (or compound) should start a new line
    const shouldBreak = LINE_BREAK_BEFORE.has(compoundKey);

    // For compound keywords, we handle the first part and let the second part flow
    // But we need to check if it's truly a compound by peeking ahead
    const isCompoundStart =
      compoundKey !== upper && LINE_BREAK_BEFORE.has(compoundKey);

    if (shouldBreak && currentLine.trim().length > 0) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    if (currentLine.length > 0) {
      currentLine += " ";
    }
    currentLine += token;

    // If compound keyword, consume the next token too
    if (isCompoundStart) {
      t++;
      const nextToken = tokens[t];
      if (nextToken) {
        const nextUpper = nextToken.toUpperCase();
        if (KEYWORDS_TO_UPPERCASE.has(nextUpper)) {
          currentLine += ` ${nextUpper}`;
        } else {
          currentLine += ` ${nextToken}`;
        }
      }
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// SQL Uglify — collapse SQL to single line
// ---------------------------------------------------------------------------

/**
 * Collapse formatted SQL into a single line:
 * - Removes newlines, tabs, and extra whitespace
 * - Preserves string literals (content inside single quotes)
 * - Trims leading/trailing whitespace
 */
export function uglifySql(sql: string): string {
  let inString = false;
  let result = "";
  let lastChar = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && lastChar !== "\\") {
      inString = !inString;
      result += ch;
    } else if (inString) {
      result += ch;
    } else if (ch === "\n" || ch === "\r" || ch === "\t") {
      // Collapse whitespace: only add a space if the last char isn't already a space
      if (lastChar !== " ") {
        result += " ";
      }
    } else if (ch === " " && lastChar === " ") {
      // skip consecutive spaces
    } else {
      result += ch;
    }
    lastChar = result[result.length - 1] ?? "";
  }
  return result.trim();
}
