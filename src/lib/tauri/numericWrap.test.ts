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

  it("wraps SQLite integer-family declared types as BigInt (issue #1082)", () => {
    // SQLite 는 INTEGER affinity 컬럼을 선언 타입과 무관하게 i64 로 저장하므로
    // 백엔드가 정수 셀을 wire string 으로 보낸다. free-form 쿼리는 storage class
    // "INTEGER" 로, table preview 는 PRAGMA 선언 타입 (BIGINT/SMALLINT/TINYINT/INT)
    // 으로 data_type 을 보고한다 — 양쪽 모두 BigInt 로 승격되어야 한다.
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
    // MySQL execute_query 는 컬럼 data_type 을 sqlx type_info().name() (대문자
    // "BIGINT") 으로 보고한다. wrapperFor 는 대소문자 무관하게 승격해야 한다.
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
    // MySQL/PG INT·SMALLINT 등은 ≤32bit 라 백엔드가 raw Number 로 보낸다.
    // wrapperFor 가 int-family 를 bigint 후보로 분류하더라도 실제 승격은 string
    // 셀에만 일어나므로 Number 셀은 그대로 유지된다 (정렬/필터/편집 회귀 방지).
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
