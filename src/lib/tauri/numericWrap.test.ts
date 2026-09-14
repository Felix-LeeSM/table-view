// wrapNumericCells unit tests (ADR 0026). Verifies that the wrapper
// branches only on column.dataType, leaves in-scope number columns
// untouched, and is idempotent.

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { QueryColumn } from "@/types/query";
import { wrapNumericCells } from "./numericWrap";

function col(name: string, dataType: string): QueryColumn {
  // category is irrelevant to the wrap decision (dataType is the single
  // source of truth) — pinned to "int" to keep the fixture simple.
  return { name, dataType: dataType, category: "int" };
}

function cellAt(
  result: { rows: unknown[][] },
  row: number,
  col: number,
): unknown {
  const r = result.rows[row];
  if (!r) throw new Error(`row ${row} missing`);
  return r[col];
}

describe("wrapNumericCells (Sprint 261 / ADR 0026)", () => {
  it("wraps bigint column string cells as BigInt with full precision", () => {
    const result = {
      columns: [col("id", "bigint")],
      rows: [["9223372036854775807"], ["1"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(typeof cellAt(wrapped, 0, 0)).toBe("bigint");
    expect(cellAt(wrapped, 0, 0)).toBe(9223372036854775807n);
    expect(cellAt(wrapped, 1, 0)).toBe(1n);
  });

  it("wraps int8 alias as BigInt (Pg::type_info().to_string() == 'INT8')", () => {
    const result = {
      columns: [col("id", "INT8")],
      rows: [["42"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(typeof cellAt(wrapped, 0, 0)).toBe("bigint");
    expect(cellAt(wrapped, 0, 0)).toBe(42n);
  });

  it("wraps numeric / decimal column strings as Decimal preserving precision", () => {
    const result = {
      columns: [col("amount", "numeric(38, 18)"), col("price", "decimal")],
      rows: [["123456789.123456789012345678", "0.10"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBeInstanceOf(Decimal);
    expect((cellAt(wrapped, 0, 0) as Decimal).toString()).toBe(
      "123456789.123456789012345678",
    );
    expect(cellAt(wrapped, 0, 1)).toBeInstanceOf(Decimal);
    expect((cellAt(wrapped, 0, 1) as Decimal).toString()).toBe("0.1");
  });

  it("wraps Mongo Int64 / Decimal128 column strings", () => {
    const result = {
      columns: [col("count", "Int64"), col("amount", "Decimal128")],
      rows: [["9223372036854775807", "1.5"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(9223372036854775807n);
    expect(cellAt(wrapped, 0, 1)).toBeInstanceOf(Decimal);
  });

  it("leaves int4 / integer cells as raw numbers (safe within ±2^53-1)", () => {
    const result = {
      columns: [col("id", "int4"), col("count", "integer")],
      rows: [[42, 100]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(42);
    expect(cellAt(wrapped, 0, 1)).toBe(100);
  });

  it("leaves real / double precision cells as raw numbers (IEEE 754 = JS Number)", () => {
    const result = {
      columns: [col("ratio", "real"), col("value", "double precision")],
      rows: [[1.5, 2.25]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(1.5);
    expect(cellAt(wrapped, 0, 1)).toBe(2.25);
  });

  it("leaves text column strings untouched", () => {
    const result = {
      columns: [col("name", "text")],
      rows: [["alice"], ["bob"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe("alice");
    expect(cellAt(wrapped, 1, 0)).toBe("bob");
  });

  it("passes null cells through even on precision-sensitive columns", () => {
    const result = {
      columns: [col("id", "bigint"), col("amount", "numeric")],
      rows: [[null, null]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBeNull();
    expect(cellAt(wrapped, 0, 1)).toBeNull();
  });

  it("is idempotent — already-wrapped BigInt / Decimal cells stay untouched", () => {
    const result = {
      columns: [col("id", "bigint"), col("amount", "numeric")],
      rows: [[9223372036854775807n, new Decimal("0.10")]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(9223372036854775807n);
    expect(cellAt(wrapped, 0, 1)).toBeInstanceOf(Decimal);
    expect((cellAt(wrapped, 0, 1) as Decimal).toString()).toBe("0.1");
  });

  it("leaves malformed precision-sensitive tokens as the raw string", () => {
    // Malformed tokens that make the BigInt constructor throw (decimals,
    // non-numeric) fall back to the raw string so the whole response
    // does not break.
    const result = {
      columns: [col("id", "bigint")],
      rows: [["not-a-number"], ["1.5"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe("not-a-number");
    expect(cellAt(wrapped, 1, 0)).toBe("1.5");
  });

  it("wraps SQLite integer-family declared types as BigInt (issue #1082)", () => {
    // SQLite stores INTEGER affinity columns as i64 regardless of the
    // declared type, so the backend sends integer cells as wire strings.
    // Free-form queries report data_type as the storage class "INTEGER",
    // table preview reports the PRAGMA declared type
    // (BIGINT/SMALLINT/TINYINT/INT) — both must promote to BigInt.
    const result = {
      columns: [
        col("a", "INTEGER"),
        col("b", "INT"),
        col("c", "BIGINT"),
        col("d", "SMALLINT"),
        col("e", "TINYINT"),
      ],
      rows: [
        [
          "9223372036854775807",
          "9007199254740993",
          "42",
          "9007199254740993",
          "9007199254740993",
        ],
      ],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(9223372036854775807n);
    expect(cellAt(wrapped, 0, 1)).toBe(9007199254740993n);
    expect(cellAt(wrapped, 0, 2)).toBe(42n);
    expect(cellAt(wrapped, 0, 3)).toBe(9007199254740993n);
    expect(cellAt(wrapped, 0, 4)).toBe(9007199254740993n);
  });

  it("wraps MySQL uppercase BIGINT declared type as BigInt (issue #1082)", () => {
    // MySQL execute_query reports the column data_type via
    // sqlx type_info().name() (uppercase "BIGINT"). wrapperFor must
    // promote case-insensitively.
    const result = {
      columns: [col("id", "BIGINT")],
      rows: [["9223372036854775807"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(9223372036854775807n);
  });

  it("wraps MySQL BIGINT UNSIGNED and SQLite exotic integer decltypes as BigInt (issue #1082 review)", () => {
    // MySQL reports unsigned as "BIGINT UNSIGNED" (sqlx column.rs L180);
    // SQLite affinity accepts any declared type containing "INT" — e.g.
    // "UNSIGNED BIG INT" / "INT8" / "INT2". All must promote.
    const result = {
      columns: [
        col("a", "BIGINT UNSIGNED"),
        col("b", "UNSIGNED BIG INT"),
        col("c", "INT8"),
        col("d", "int2"),
      ],
      rows: [
        [
          "18446744073709551615",
          "9223372036854775807",
          "9007199254740993",
          "42",
        ],
      ],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(18446744073709551615n);
    expect(cellAt(wrapped, 0, 1)).toBe(9223372036854775807n);
    expect(cellAt(wrapped, 0, 2)).toBe(9007199254740993n);
    expect(cellAt(wrapped, 0, 3)).toBe(42n);
  });

  it("leaves small-integer number cells untouched on int-family columns (issue #1082)", () => {
    // MySQL/PG INT, SMALLINT and friends fit in ≤32bit, so the backend
    // sends them as raw Numbers. Even though wrapperFor classifies the
    // int-family as bigint candidates, promotion only happens on string
    // cells — Number cells stay as-is (prevents sort/filter/edit regressions).
    const result = {
      columns: [col("a", "int"), col("b", "smallint")],
      rows: [[42, 7]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe(42);
    expect(cellAt(wrapped, 0, 1)).toBe(7);
  });

  it("fast-path returns the same reference when no precision-sensitive columns are present", () => {
    const result = {
      columns: [col("name", "text"), col("ratio", "real")],
      rows: [["alice", 1.5]],
    };
    const wrapped = wrapNumericCells(result);
    expect(wrapped).toBe(result);
  });
});
