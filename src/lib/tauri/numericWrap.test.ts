// Sprint 261 (ADR 0026) — wrapNumericCells unit tests.
// 작성: 2026-05-11. wrapper 가 column.dataType 만 보고 분기하는지, 안전
// 범위 number 컬럼은 손대지 않는지, 멱등성을 갖는지 검증.

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { wrapNumericCells } from "./numericWrap";
import type { QueryColumn } from "@/types/query";

function col(name: string, dataType: string): QueryColumn {
  // category 는 wrap 결정과 무관 (dataType 만 single source of truth) —
  // 테스트 fixture 단순화를 위해 "int" 고정.
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
    // BigInt 생성자가 throw 하는 malformed token (소수점, 비숫자) 은
    // 전체 응답을 깨뜨리지 않도록 raw string 으로 폴백.
    const result = {
      columns: [col("id", "bigint")],
      rows: [["not-a-number"], ["1.5"]],
    };
    const wrapped = wrapNumericCells(result);
    expect(cellAt(wrapped, 0, 0)).toBe("not-a-number");
    expect(cellAt(wrapped, 1, 0)).toBe("1.5");
  });

  it("fast-path returns the same reference when no precision-sensitive columns are present", () => {
    const result = {
      columns: [col("name", "text"), col("count", "integer")],
      rows: [["alice", 1]],
    };
    const wrapped = wrapNumericCells(result);
    expect(wrapped).toBe(result);
  });
});
