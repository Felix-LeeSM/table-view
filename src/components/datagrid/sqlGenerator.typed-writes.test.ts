import { describe, it, expect, vi } from "vitest";
import { generateSql, type CoerceError } from "./sqlGenerator";
import { BASE_DATA, TYPED_DATA } from "./sqlGenerator.fixtures";
import type { TableData } from "@/types/schema";

// ---------------------------------------------------------------------------
// Sprint 75 — generateSql integration: UPDATE emits type-aware literals and
// exposes coercion failures via onCoerceError. Valid edits in the same batch
// are unaffected by sibling failures.
// ---------------------------------------------------------------------------

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

  // Sprint 306 (2026-05-14) — BigInt freeze 회귀 가드. normalizeNewRowCell
  // 의 typeof === "object" 분기가 raw JSON.stringify 였을 때 nested BigInt
  // 입력에서 throw. 또한 buildWhereClause 가 Decimal 을 만나면 [object
  // Object] 로 떨어졌던 sprint-305 회귀.
  it("nested BigInt 가 들어있는 new-row object 도 throw 없이 INSERT", () => {
    const DATA: TableData = {
      ...BASE_DATA,
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
          name: "payload",
          data_type: "jsonb",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
    };
    expect(() =>
      generateSql(DATA, "public", "items", new Map(), new Set(), [
        [99, { big: BigInt("9223372036854775807") }],
      ]),
    ).not.toThrow();
  });

  it("DELETE/UPDATE WHERE 가 BigInt pk 를 toString 으로 직렬화", () => {
    const BIG_DATA: TableData = {
      ...BASE_DATA,
      rows: [[BigInt("9223372036854775807"), "Big"]],
    };
    const statements = generateSql(
      BIG_DATA,
      "public",
      "users",
      new Map(),
      new Set(["row-key-0"]),
      [],
    );
    expect(statements[0]).toBe(
      "DELETE FROM public.users WHERE id = 9223372036854775807;",
    );
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
