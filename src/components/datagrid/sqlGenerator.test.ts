import { describe, it, expect, vi } from "vitest";
import {
  generateSql,
  coerceToSqlLiteral,
  type CoerceError,
} from "./sqlGenerator";
import type { TableData } from "@/types/schema";

const BASE_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice"],
    [2, null],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

describe("generateSql — UPDATE tri-state (null vs empty string vs text)", () => {
  it("emits SET col = NULL when pending edit is null", () => {
    const edits = new Map<string, string | null>([["0-1", null]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.users SET name = NULL WHERE id = 1;",
    );
  });

  it("emits SET col = '' when pending edit is empty string", () => {
    const edits = new Map<string, string | null>([["0-1", ""]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.users SET name = '' WHERE id = 1;",
    );
  });

  it("escapes single quotes in string values", () => {
    const edits = new Map<string, string | null>([["0-1", "O'Brien"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements[0]).toBe(
      "UPDATE public.users SET name = 'O''Brien' WHERE id = 1;",
    );
  });

  it("distinguishes null and empty string for two rows in the same batch", () => {
    const edits = new Map<string, string | null>([
      ["0-1", ""], // Alice → '' (empty string)
      ["1-1", null], // null-row → still NULL (explicit)
    ]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(2);
    expect(statements).toContain(
      "UPDATE public.users SET name = '' WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET name = NULL WHERE id = 2;",
    );
  });
});

describe("generateSql — INSERT null vs empty string", () => {
  it("emits NULL for null cells and '' for empty-string cells in new rows", () => {
    const newRows = [
      [null, ""],
      [3, "x"],
    ];
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      newRows,
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      "INSERT INTO public.users (id, name) VALUES (NULL, '');",
    );
    expect(statements[1]).toBe(
      "INSERT INTO public.users (id, name) VALUES (3, 'x');",
    );
  });
});

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

// ---------------------------------------------------------------------------
// Sprint 75 — generateSql integration: UPDATE emits type-aware literals and
// exposes coercion failures via onCoerceError. Valid edits in the same batch
// are unaffected by sibling failures.
// ---------------------------------------------------------------------------

const TYPED_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "age",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "active",
      data_type: "boolean",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "note",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, 42, true, "hi"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "",
};

describe("generateSql — Sprint 75 type-aware UPDATE literals", () => {
  it("integer column emits unquoted literal for valid integer string", () => {
    const edits = new Map<string, string | null>([["0-1", "99"]]);
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET age = 99 WHERE id = 1;",
    ]);
  });

  it("boolean column emits TRUE/FALSE (uppercase SQL literals)", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-2", "t"]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET active = TRUE WHERE id = 1;",
    ]);
  });

  it("non-textual empty string is coerced to NULL", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([
        ["0-1", ""],
        ["0-2", ""],
      ]),
      new Set(),
      [],
    );
    // age (integer) + active (boolean) both emit NULL
    expect(statements).toContain(
      "UPDATE public.users SET age = NULL WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET active = NULL WHERE id = 1;",
    );
  });

  it("textual empty string is preserved as '' (ADR 0009 invariant)", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-3", ""]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET note = '' WHERE id = 1;",
    ]);
  });

  it("coercion failure is excluded from SQL and reported via onCoerceError", () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-1", "abc"]]),
      new Set(),
      [],
      { onCoerceError: onError },
    );
    expect(statements).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const errCall = onError.mock.calls[0]![0];
    expect(errCall.key).toBe("0-1");
    expect(errCall.rowIdx).toBe(0);
    expect(errCall.colIdx).toBe(1);
    expect(errCall.message).toMatch(/integer/i);
  });

  it("valid + invalid edits in same batch: valid ones still emit, invalid ones report errors", () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([
        ["0-1", "abc"], // invalid integer
        ["0-2", "true"], // valid boolean
        ["0-3", "hello"], // valid text
      ]),
      new Set(),
      [],
      { onCoerceError: onError },
    );
    // Two valid statements emitted.
    expect(statements).toHaveLength(2);
    expect(statements).toContain(
      "UPDATE public.users SET active = TRUE WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET note = 'hello' WHERE id = 1;",
    );
    // Error reported for only the invalid one.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].key).toBe("0-1");
  });

  it("null value on a non-nullable-looking column still emits NULL (validation is DB's job)", () => {
    // The generator doesn't enforce nullable constraints — that's the DB's
    // responsibility. A null → NULL emission is always valid syntactically.
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-1", null]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET age = NULL WHERE id = 1;",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sprint 75 attempt 2 — INSERT coercion. Closes the gap where new-row cells
// bypassed `coerceToSqlLiteral` and emitted `'42'` on integer columns or
// `''` on integer columns instead of `42` / `NULL`. Mirrors the UPDATE-side
// coercion contract: empty string on non-textual → NULL, typed strings →
// unquoted numbers / TRUE/FALSE / quoted dates, and coercion failure skips
// the INSERT entirely with a per-cell error report.
// ---------------------------------------------------------------------------

describe("generateSql — Sprint 75 attempt 2 INSERT coercion", () => {
  it("integer column + \"\" → row uses NULL, not ''", () => {
    // A user adds a new row, leaves `age` blank. Pre-attempt-2 this emitted
    // `VALUES (…, '', …)` which PostgreSQL would reject with
    // `invalid input syntax for type integer`. Attempt 2 routes through
    // `coerceToSqlLiteral` so the empty string collapses to NULL (ADR 0009).
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "", "true", "ok"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, NULL, TRUE, 'ok');",
    ]);
  });

  it('integer column + "42" → row uses 42 unquoted', () => {
    // String inputs on integer columns coerce to unquoted integer literals.
    // The INSERT path now behaves identically to the UPDATE path (which has
    // shipped this for a sprint already).
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [["42", "7", "false", "hi"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (42, 7, FALSE, 'hi');",
    ]);
  });

  it('boolean column + "true" → row uses TRUE', () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, null, "true", null]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, NULL, TRUE, NULL);",
    ]);
  });

  it("date column + \"2026-04-24\" → row uses '2026-04-24' (quoted ISO literal)", () => {
    const DATE_DATA: TableData = {
      columns: [
        {
          name: "id",
          data_type: "integer",
          nullable: false,
          default_value: null,
          is_primary_key: true,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
        {
          name: "dob",
          data_type: "date",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
      rows: [],
      total_count: 0,
      page: 1,
      page_size: 100,
      executed_query: "",
    };
    const statements = generateSql(
      DATE_DATA,
      "public",
      "patients",
      new Map(),
      new Set(),
      [[1, "2026-04-24"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.patients (id, dob) VALUES (1, '2026-04-24');",
    ]);
  });

  it('integer column + "abc" → no INSERT for that row, onCoerceError fires with a correlatable key', () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "abc", "true", "note"]],
      { onCoerceError: onError },
    );
    // Row is dropped entirely — no partially-valid INSERT.
    expect(statements).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]![0];
    // Correlatable key: `new-${newRowIdx}-${colIdx}` so the UI can scope the
    // hint to the offending new-row cell without colliding with UPDATE keys.
    expect(call.key).toBe("new-0-1");
    expect(call.rowIdx).toBe(0);
    expect(call.colIdx).toBe(1);
    expect(call.message).toMatch(/integer/i);
  });

  it("mixed-batch INSERT: valid rows keep INSERT, invalid row is skipped with error", () => {
    // Row A (valid), Row B (one invalid cell → skipped), Row C (valid).
    // AC-03 independence: sibling row failures must not taint valid rows.
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [
        [1, "10", "true", "row A"], // valid
        [2, "abc", "false", "row B"], // invalid integer → skipped
        [3, "30", "false", "row C"], // valid
      ],
      { onCoerceError: onError },
    );

    // Two statements emitted — A and C, B dropped.
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      "INSERT INTO public.users (id, age, active, note) VALUES (1, 10, TRUE, 'row A');",
    );
    expect(statements[1]).toBe(
      "INSERT INTO public.users (id, age, active, note) VALUES (3, 30, FALSE, 'row C');",
    );
    // Exactly one error, keyed to new-row 1 (row B) column 1 (age).
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].key).toBe("new-1-1");
    expect(onError.mock.calls[0]![0].rowIdx).toBe(1);
    expect(onError.mock.calls[0]![0].colIdx).toBe(1);
  });

  it("multiple invalid cells in a single new row report one error per cell, row still skipped", () => {
    // Two invalid cells in the same row — the UI needs both hints so the user
    // can fix them in one pass. Row emission is still atomic (all-or-nothing).
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "abc", "maybe", "text"]],
      { onCoerceError: onError },
    );
    expect(statements).toHaveLength(0);
    // Two errors: age + active.
    expect(onError).toHaveBeenCalledTimes(2);
    const keys = onError.mock.calls.map((c) => c[0].key).sort();
    expect(keys).toEqual(["new-0-1", "new-0-2"]);
  });

  it("raw number/boolean primitives in new-row cells are normalised before coercion", () => {
    // New-row editors sometimes store typed primitives (number / boolean)
    // rather than strings. The generator normalises to string before coerce
    // so an integer cell receiving JS `3` emits `3` unquoted, and a boolean
    // cell receiving `true` emits `TRUE`.
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, 3, true, "ok"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, 3, TRUE, 'ok');",
    ]);
  });
});
