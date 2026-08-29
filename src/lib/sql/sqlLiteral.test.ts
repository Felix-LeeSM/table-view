// Characterization tests for the canonical SQL identifier quoter (#1357).
// Locks the per-dialect quoting + escaping so the 5-way consolidation
// (completion / ddl / rawQuery / duckdb) can route through this one helper
// without changing any call site's output.
import { describe, expect, it } from "vitest";
import {
  coerceToSqlLiteral,
  escapeSqlString,
  qualifiedTableName,
  sqlIdentifier,
} from "./sqlLiteral";

describe("sqlIdentifier — canonical per-dialect quoting", () => {
  it("mysql wraps in backticks and doubles embedded backticks", () => {
    expect(sqlIdentifier("Users", "mysql")).toBe("`Users`");
    expect(sqlIdentifier("back`tick", "mysql")).toBe("`back``tick`");
  });

  it("sqlite wraps in ANSI double quotes and doubles embedded quotes", () => {
    expect(sqlIdentifier("col", "sqlite")).toBe('"col"');
    expect(sqlIdentifier('weird"name', "sqlite")).toBe('"weird""name"');
  });

  it("oracle wraps in ANSI double quotes and doubles embedded quotes", () => {
    expect(sqlIdentifier("col", "oracle")).toBe('"col"');
    expect(sqlIdentifier('weird"name', "oracle")).toBe('"weird""name"');
  });

  it("mssql wraps in brackets and doubles embedded closing brackets", () => {
    expect(sqlIdentifier("col", "mssql")).toBe("[col]");
    expect(sqlIdentifier("a]b", "mssql")).toBe("[a]]b]");
  });

  it("postgresql leaves the identifier bare by default", () => {
    expect(sqlIdentifier("Users", "postgresql")).toBe("Users");
    expect(sqlIdentifier("weird name", "postgresql")).toBe("weird name");
  });

  it("quotePostgres option ANSI-quotes postgres identifiers (#1357)", () => {
    expect(sqlIdentifier("Users", "postgresql", { quotePostgres: true })).toBe(
      '"Users"',
    );
    expect(
      sqlIdentifier('weird"name', "postgresql", { quotePostgres: true }),
    ).toBe('"weird""name"');
  });

  it("quotePostgres is a no-op for non-postgres dialects", () => {
    expect(sqlIdentifier("Users", "mysql", { quotePostgres: true })).toBe(
      "`Users`",
    );
    expect(sqlIdentifier("col", "mssql", { quotePostgres: true })).toBe(
      "[col]",
    );
  });
});

describe("qualifiedTableName", () => {
  it("postgres joins schema.table bare", () => {
    expect(qualifiedTableName("public", "users", "postgresql")).toBe(
      "public.users",
    );
  });

  it("quoting dialects quote each part", () => {
    expect(qualifiedTableName("s", "t", "mysql")).toBe("`s`.`t`");
    expect(qualifiedTableName("s", "t", "mssql")).toBe("[s].[t]");
  });

  it("empty schema drops the qualifier", () => {
    expect(qualifiedTableName("", "t", "sqlite")).toBe('"t"');
  });
});

/**
 * Decode a MySQL single-quoted string literal back into the value it carries,
 * following the default sql_mode: `\` escapes the next character and `''` is
 * one embedded quote. Throws when the literal closes before the end of the
 * input, which is precisely the breakout #2555 describes — everything after
 * that early close leaves the string and is executed as SQL.
 */
function decodeMysqlLiteral(sql: string): string {
  if (!sql.startsWith("'")) throw new Error(`not a quoted literal: ${sql}`);
  let out = "";
  for (let i = 1; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "\\") {
      const escaped = sql[i + 1];
      if (escaped === undefined) throw new Error(`dangling escape: ${sql}`);
      out += escaped;
      i += 1;
    } else if (ch === "'") {
      if (sql[i + 1] === "'") {
        out += "'";
        i += 1;
      } else if (i === sql.length - 1) {
        return out;
      } else {
        throw new Error(`literal closed early at index ${i}: ${sql}`);
      }
    } else {
      out += ch;
    }
  }
  throw new Error(`unterminated literal: ${sql}`);
}

describe("escapeSqlString — MySQL reads a backslash as an escape (#2555)", () => {
  it("mysql doubles both metacharacters in the emitted literal", () => {
    expect(escapeSqlString("C:\\", "mysql")).toBe("'C:\\\\'");
    expect(escapeSqlString("\\' WHERE 1=1 #", "mysql")).toBe(
      "'\\\\'' WHERE 1=1 #'",
    );
  });

  it.each([
    ["a trailing backslash", "C:\\"],
    ["a backslash-quote breakout", "\\' WHERE 1=1 #"],
    ["a bare quote", "O'Brien"],
    ["a doubled backslash", "a\\\\b"],
    ["no metacharacter at all", "plain"],
  ])(
    "a mysql literal carrying %s round-trips without closing early",
    (_label, value) => {
      expect(decodeMysqlLiteral(escapeSqlString(value, "mysql"))).toBe(value);
    },
  );

  it("dialects that read a backslash literally are left untouched", () => {
    for (const dialect of [
      "postgresql",
      "sqlite",
      "mssql",
      "oracle",
    ] as const) {
      expect(escapeSqlString("C:\\", dialect)).toBe("'C:\\'");
    }
    // No dialect: the caller could not name one, so keep the ANSI reading.
    // Doubling here would corrupt a stored Postgres/SQLite value.
    expect(escapeSqlString("C:\\")).toBe("'C:\\'");
  });

  it("every dialect still doubles an embedded quote", () => {
    expect(escapeSqlString("O'Brien", "postgresql")).toBe("'O''Brien'");
    expect(escapeSqlString("O'Brien", "mysql")).toBe("'O''Brien'");
  });
});

describe("coerceToSqlLiteral — dialect reaches the emitted string literal", () => {
  it("mysql grid edits double the backslash, postgres ones do not", () => {
    expect(coerceToSqlLiteral("C:\\", "text", "mysql")).toEqual({
      kind: "sql",
      sql: "'C:\\\\'",
    });
    expect(coerceToSqlLiteral("C:\\", "text", "postgresql")).toEqual({
      kind: "sql",
      sql: "'C:\\'",
    });
  });

  it("the unknown-type legacy escape path follows the same dialect rule", () => {
    expect(coerceToSqlLiteral("\\' WHERE 1=1 #", "money", "mysql")).toEqual({
      kind: "sql",
      sql: "'\\\\'' WHERE 1=1 #'",
    });
  });
});
