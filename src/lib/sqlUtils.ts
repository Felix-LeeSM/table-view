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
