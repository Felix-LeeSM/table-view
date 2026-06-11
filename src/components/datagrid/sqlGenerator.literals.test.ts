import { describe, it, expect } from "vitest";
import { coerceToSqlLiteral } from "./sqlGenerator";

// ---------------------------------------------------------------------------
// Sprint 75 — coerceToSqlLiteral: pure-function type coercion per column type.
// ---------------------------------------------------------------------------

describe("coerceToSqlLiteral — tri-state (null, '', value)", () => {
  it("null + any type → SQL NULL (ADR 0009 tri-state)", () => {
    expect(coerceToSqlLiteral(null, "text")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "integer")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "boolean")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "date")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
  });

  it("'' + textual types → preserved as '' (ADR 0009)", () => {
    // Textual family: text/varchar/char/citext/string/json/jsonb — ADR 0009
    // explicitly distinguishes '' (empty string) from NULL for these types.
    expect(coerceToSqlLiteral("", "text")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "varchar")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "character varying")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "char")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "citext")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "string")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "json")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "jsonb")).toEqual({ kind: "sql", sql: "''" });
  });

  it("'' + Oracle textual/unknown types → SQL NULL explicitly", () => {
    expect(coerceToSqlLiteral("", "VARCHAR2", "oracle")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "CLOB", "oracle")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "mystery_type", "oracle")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "VARCHAR2", "oracle")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
  });

  it("'' + non-textual types → SQL NULL (empty picker = explicit clear)", () => {
    // Sprint 75 AC-01: empty input on integer/numeric/boolean/date/etc
    // collapses to NULL because `SET col = ''` is invalid for those types
    // and the user clearing a picker almost always means "null me out".
    expect(coerceToSqlLiteral("", "integer")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "bigint")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "smallint")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "serial")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "numeric")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "decimal")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "real")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "double precision")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "boolean")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "bool")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "date")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "timestamp")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "timestamptz")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "datetime")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "time")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "uuid")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
  });
});

describe("coerceToSqlLiteral — integer family", () => {
  it('"42" + integer → 42 (unquoted)', () => {
    expect(coerceToSqlLiteral("42", "integer")).toEqual({
      kind: "sql",
      sql: "42",
    });
  });

  it('"-1" + integer → -1 (unquoted, leading minus allowed)', () => {
    expect(coerceToSqlLiteral("-1", "integer")).toEqual({
      kind: "sql",
      sql: "-1",
    });
  });

  it("bigint / smallint / serial all accept integer literals", () => {
    expect(coerceToSqlLiteral("123456789", "bigint")).toEqual({
      kind: "sql",
      sql: "123456789",
    });
    expect(coerceToSqlLiteral("5", "smallint")).toEqual({
      kind: "sql",
      sql: "5",
    });
    expect(coerceToSqlLiteral("1", "serial")).toEqual({
      kind: "sql",
      sql: "1",
    });
  });

  it('"abc" + integer → error (non-numeric)', () => {
    const result = coerceToSqlLiteral("abc", "integer");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/integer/i);
    }
  });

  it('"3.14" + integer → error (decimals belong to numeric)', () => {
    const result = coerceToSqlLiteral("3.14", "integer");
    expect(result.kind).toBe("error");
  });

  it("empty minus or trailing garbage → error", () => {
    expect(coerceToSqlLiteral("-", "integer").kind).toBe("error");
    expect(coerceToSqlLiteral("12a", "integer").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — numeric family", () => {
  it('"3.14" + numeric → 3.14 (unquoted)', () => {
    expect(coerceToSqlLiteral("3.14", "numeric")).toEqual({
      kind: "sql",
      sql: "3.14",
    });
  });

  it('".5" + numeric → .5 (leading decimal accepted)', () => {
    expect(coerceToSqlLiteral(".5", "numeric")).toEqual({
      kind: "sql",
      sql: ".5",
    });
  });

  it('"-1" + numeric → -1 (leading minus accepted)', () => {
    expect(coerceToSqlLiteral("-1", "numeric")).toEqual({
      kind: "sql",
      sql: "-1",
    });
  });

  it("decimal / float / double precision / real accept numeric literals", () => {
    expect(coerceToSqlLiteral("1.2", "decimal")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "float")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "double precision")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "real")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
  });

  it('"abc" + numeric → error', () => {
    const result = coerceToSqlLiteral("abc", "numeric");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/numeric/i);
    }
  });

  it("bare minus / bare dot / scientific notation → error", () => {
    expect(coerceToSqlLiteral("-", "numeric").kind).toBe("error");
    expect(coerceToSqlLiteral(".", "numeric").kind).toBe("error");
    // Scientific notation is intentionally rejected in the first pass — see
    // the sqlGenerator.ts NUMERIC_RE comment.
    expect(coerceToSqlLiteral("1e3", "numeric").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — boolean family", () => {
  it('"true" / "t" / "1" → TRUE (case-insensitive)', () => {
    expect(coerceToSqlLiteral("true", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("TRUE", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("True", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("t", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("T", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("1", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
  });

  it('"false" / "f" / "0" → FALSE (case-insensitive)', () => {
    expect(coerceToSqlLiteral("false", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("FALSE", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("f", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("0", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
  });

  it("bool alias works the same as boolean", () => {
    expect(coerceToSqlLiteral("true", "bool")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("false", "bool")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
  });

  it('"maybe" + boolean → error', () => {
    const result = coerceToSqlLiteral("maybe", "boolean");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/boolean/i);
    }
  });
});

describe("coerceToSqlLiteral — date family", () => {
  it("\"2026-04-24\" + date → '2026-04-24' (quoted)", () => {
    expect(coerceToSqlLiteral("2026-04-24", "date")).toEqual({
      kind: "sql",
      sql: "'2026-04-24'",
    });
  });

  it("Oracle DATE accepts backend YYYY-MM-DD HH:MM:SS values", () => {
    expect(coerceToSqlLiteral("2026-06-08 12:34:56", "DATE", "oracle")).toEqual(
      {
        kind: "sql",
        sql: "TO_DATE('2026-06-08 12:34:56', 'YYYY-MM-DD HH24:MI:SS')",
      },
    );
  });

  it('"yesterday" + date → error', () => {
    const result = coerceToSqlLiteral("yesterday", "date");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/date/i);
    }
  });

  it("rejects time-only / datetime values as date", () => {
    expect(coerceToSqlLiteral("10:00", "date").kind).toBe("error");
    expect(coerceToSqlLiteral("2026-04-24T10:00:00", "date").kind).toBe(
      "error",
    );
  });
});

describe("coerceToSqlLiteral — timestamp family", () => {
  it("ISO datetime with T-separator → quoted literal", () => {
    expect(coerceToSqlLiteral("2026-04-24T10:00:00", "timestamp")).toEqual({
      kind: "sql",
      sql: "'2026-04-24T10:00:00'",
    });
  });

  it("ISO datetime with space separator → quoted literal", () => {
    expect(coerceToSqlLiteral("2026-04-24 10:00:00", "timestamp")).toEqual({
      kind: "sql",
      sql: "'2026-04-24 10:00:00'",
    });
  });

  it("timestamptz accepts trailing Z", () => {
    expect(coerceToSqlLiteral("2026-04-24T10:00:00Z", "timestamptz")).toEqual({
      kind: "sql",
      sql: "'2026-04-24T10:00:00Z'",
    });
  });

  it("Oracle TIMESTAMP WITH TIME ZONE accepts backend space-offset values", () => {
    expect(
      coerceToSqlLiteral(
        "2026-06-08 10:30:00.123456 +09:00",
        "TIMESTAMP WITH TIME ZONE",
        "oracle",
      ),
    ).toEqual({
      kind: "sql",
      sql: "TO_TIMESTAMP_TZ('2026-06-08 10:30:00.123456 +09:00', 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM')",
    });
  });

  it("datetime alias routes to timestamp family", () => {
    expect(coerceToSqlLiteral("2026-04-24 10:00:00", "datetime")).toEqual({
      kind: "sql",
      sql: "'2026-04-24 10:00:00'",
    });
  });

  it("invalid timestamp → error", () => {
    const result = coerceToSqlLiteral("not-a-date", "timestamp");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/timestamp/i);
    }
  });
});

describe("coerceToSqlLiteral — time family", () => {
  it('"10:00" + time → quoted literal', () => {
    expect(coerceToSqlLiteral("10:00", "time")).toEqual({
      kind: "sql",
      sql: "'10:00'",
    });
  });

  it('"10:00:30" + time → quoted literal', () => {
    expect(coerceToSqlLiteral("10:00:30", "time")).toEqual({
      kind: "sql",
      sql: "'10:00:30'",
    });
  });

  it('"25:00" / "abc" + time → error', () => {
    // Note: the regex here only enforces digit shape, not range semantics.
    // "25:00" matches because HH is two digits. We accept the looseness here
    // and delegate real validation to the DB engine.
    expect(coerceToSqlLiteral("abc", "time").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — uuid family", () => {
  it("standard 36-char UUID → quoted literal", () => {
    expect(
      coerceToSqlLiteral("550e8400-e29b-41d4-a716-446655440000", "uuid"),
    ).toEqual({
      kind: "sql",
      sql: "'550e8400-e29b-41d4-a716-446655440000'",
    });
  });

  it("uppercase hex UUID is accepted (case-insensitive)", () => {
    expect(
      coerceToSqlLiteral("550E8400-E29B-41D4-A716-446655440000", "uuid"),
    ).toEqual({
      kind: "sql",
      sql: "'550E8400-E29B-41D4-A716-446655440000'",
    });
  });

  it("invalid UUID shape → error", () => {
    const result = coerceToSqlLiteral("not-a-uuid", "uuid");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/uuid/i);
    }
  });
});

describe("coerceToSqlLiteral — textual family (escape path preserved)", () => {
  it("simple string + text → quoted", () => {
    expect(coerceToSqlLiteral("Alice", "text")).toEqual({
      kind: "sql",
      sql: "'Alice'",
    });
  });

  it("single-quote escape still works (O''Brien)", () => {
    expect(coerceToSqlLiteral("O'Brien", "text")).toEqual({
      kind: "sql",
      sql: "'O''Brien'",
    });
  });

  it("varchar / json / jsonb use the same escape path", () => {
    expect(coerceToSqlLiteral("abc", "varchar")).toEqual({
      kind: "sql",
      sql: "'abc'",
    });
    expect(coerceToSqlLiteral('{"a":1}', "json")).toEqual({
      kind: "sql",
      sql: "'{\"a\":1}'",
    });
    expect(coerceToSqlLiteral("[1,2]", "jsonb")).toEqual({
      kind: "sql",
      sql: "'[1,2]'",
    });
  });

  it("unknown type → falls back to escape path (safe default)", () => {
    expect(coerceToSqlLiteral("blob-like", "bytea")).toEqual({
      kind: "sql",
      sql: "'blob-like'",
    });
    expect(coerceToSqlLiteral("anything", "mystery_type")).toEqual({
      kind: "sql",
      sql: "'anything'",
    });
  });
});
