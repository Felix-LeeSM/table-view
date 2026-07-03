export type SqlTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "punct"
  | "whitespace"
  | "identifier";

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

const KEYWORDS = new Set<string>([
  // DML / query
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "BY",
  "LIMIT",
  "OFFSET",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "ALL",
  "DISTINCT",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "ON",
  "USING",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "WITH",
  "RECURSIVE",
  "WINDOW",
  "PARTITION",
  "OVER",
  // DML / write
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "RETURNING",
  "MERGE",
  "UPSERT",
  "CONFLICT",
  "DO",
  "NOTHING",
  // DDL
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "INDEX",
  "VIEW",
  "DATABASE",
  "SCHEMA",
  "FUNCTION",
  "TRIGGER",
  "PROCEDURE",
  "TYPE",
  "DOMAIN",
  "SEQUENCE",
  "EXTENSION",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "UNIQUE",
  "CONSTRAINT",
  "CHECK",
  "DEFAULT",
  "GENERATED",
  "ALWAYS",
  "IDENTITY",
  "SERIAL",
  "IF",
  "REPLACE",
  "CASCADE",
  "RESTRICT",
  "COLUMN",
  "RENAME",
  "TO",
  "ADD",
  // TCL
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRANSACTION",
  "SAVEPOINT",
  "RELEASE",
  // Data types (treated as keywords for colour)
  "INT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "CHARACTER",
  "VARYING",
  "BOOLEAN",
  "BOOL",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE",
  "TIME",
  "INTERVAL",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "FLOAT",
  "DOUBLE",
  "PRECISION",
  "MONEY",
  "UUID",
  "JSON",
  "JSONB",
  "BYTEA",
  "BLOB",
  "CLOB",
  "ARRAY",
  // Booleans / misc
  "TRUE",
  "FALSE",
  "CAST",
  "CONVERT",
  "COLLATE",
  "SHOW",
  "EXPLAIN",
  "ANALYZE",
  "DESCRIBE",
]);

/**
 * If `sql[start]` opens a PostgreSQL dollar-quoted string (`$$…$$` or
 * `$tag$…$tag$`), return the index just past its closing delimiter — or
 * `sql.length` when the quote is unterminated (opaque through EOF). Return
 * `null` when `start` is not a dollar-quote opening, so a positional
 * parameter (`$1`) or a lone `$` keeps its ordinary tokenization.
 *
 * The tag follows unquoted-identifier rules (leading letter/underscore, then
 * letters/digits/underscores, no `$`), which is exactly what tells a `$tag$`
 * opening apart from a `$1` parameter. Dollar-quotes do not nest: the body
 * runs verbatim to the next occurrence of the *same* delimiter, so any inner
 * `'`, `--`, block comment, `;`, or differently-tagged `$…$` is literal text.
 *
 * Shared by `tokenizeSql` and `splitSqlStatements` (sqlUtils.ts) so the tricky
 * tag-matching / positional-parameter rules have a single source of truth.
 */
export function scanDollarQuoteEnd(sql: string, start: number): number | null {
  if (sql[start] !== "$") return null;
  let j = start + 1;
  if (j < sql.length && /[A-Za-z_]/.test(sql[j]!)) {
    j++;
    while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j]!)) j++;
  }
  if (sql[j] !== "$") return null;
  const delim = sql.slice(start, j + 1);
  const close = sql.indexOf(delim, j + 1);
  return close === -1 ? sql.length : close + delim.length;
}

/**
 * Tokenize a SQL source string into a flat list of tokens suitable for
 * rendering inline. The tokenizer is deliberately simple — it recognises
 * enough structure for history/favourite previews (keywords, strings,
 * numbers, comments) and collapses everything else into identifiers or
 * punctuation. It is NOT a proper SQL parser.
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i]!;

    if (ch === "-" && sql[i + 1] === "-") {
      let j = i + 2;
      while (j < len && sql[j] !== "\n") j++;
      tokens.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < len && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      if (j < len) j += 2;
      tokens.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ kind: "string", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < len && sql[j] !== '"') j++;
      if (j < len) j++;
      tokens.push({ kind: "identifier", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // PostgreSQL dollar-quoted string ($$…$$ / $tag$…$tag$). A non-opening
    // `$` (positional param $1, lone $) returns null and falls through to the
    // punct branch below.
    if (ch === "$") {
      const end = scanDollarQuoteEnd(sql, i);
      if (end !== null) {
        tokens.push({ kind: "string", text: sql.slice(i, end) });
        i = end;
        continue;
      }
    }

    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < len && /[0-9.]/.test(sql[j]!)) j++;
      tokens.push({ kind: "number", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_]/.test(sql[j]!)) j++;
      const word = sql.slice(i, j);
      const kind: SqlTokenKind = KEYWORDS.has(word.toUpperCase())
        ? "keyword"
        : "identifier";
      tokens.push({ kind, text: word });
      i = j;
      continue;
    }

    if (/\s/.test(ch)) {
      let j = i;
      while (j < len && /\s/.test(sql[j]!)) j++;
      tokens.push({ kind: "whitespace", text: sql.slice(i, j) });
      i = j;
      continue;
    }

    tokens.push({ kind: "punct", text: ch });
    i++;
  }

  return tokens;
}
