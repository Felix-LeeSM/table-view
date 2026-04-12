/**
 * Splits a SQL string into individual statements by semicolons,
 * correctly handling semicolons inside string literals, quoted identifiers,
 * line comments (--), and block comments (/* *\/).
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // Single-quoted string literal
    if (ch === "'") {
      current += ch;
      i++;
      while (i < len) {
        const inner = sql[i];
        current += inner;
        if (inner === "'") {
          // Escaped single quote ('') — consume both and continue
          if (i + 1 < len && sql[i + 1] === "'") {
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

    // Double-quoted identifier
    if (ch === '"') {
      current += ch;
      i++;
      while (i < len) {
        const inner = sql[i];
        current += inner;
        if (inner === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Line comment (--)
    if (ch === "-" && i + 1 < len && sql[i + 1] === "-") {
      current += ch;
      i++;
      current += sql[i];
      i++;
      while (i < len && sql[i] !== "\n") {
        current += sql[i];
        i++;
      }
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
// SQL Formatting (Sprint 40)
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
          currentLine += " " + nextUpper;
        } else {
          currentLine += " " + nextToken;
        }
      }
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n");
}
