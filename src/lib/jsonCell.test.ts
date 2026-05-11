// Sprint 238 — AC-238-07: JSON / object cell 1줄 표현 + circular/BigInt 가드.
// 작성일 2026-05-10 / TDD slice #2.
// Sprint 261 (ADR 0026) 2026-05-11 — BigInt / Decimal 셀이 digit string 으로
// 직렬화되도록 replacer 보강. "unserializable" 컨트랙트는 circular reference /
// undefined / Symbol 에만 유지.

import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";

import { safeStringifyCell } from "./jsonCell";

describe("safeStringifyCell", () => {
  it("serializes a flat object as compact JSON", () => {
    expect(safeStringifyCell({ a: 1 })).toBe('{"a":1}');
  });

  it("serializes nested objects deeply (no [Object object] leak)", () => {
    expect(safeStringifyCell({ a: { b: { c: 1 } } })).toBe(
      '{"a":{"b":{"c":1}}}',
    );
  });

  it("serializes arrays as JSON arrays", () => {
    expect(safeStringifyCell([1, "two", null])).toBe('[1,"two",null]');
  });

  it("serializes null as JSON null literal", () => {
    expect(safeStringifyCell(null)).toBe("null");
  });

  it('returns "[unserializable]" for circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(safeStringifyCell(obj)).toBe('"[unserializable]"');
  });

  // Sprint 261 (ADR 0026) — BigInt cells now serialize as a quoted digit
  // string so CSV / JSON exports and history snapshots preserve precision.
  it("serializes BigInt as a quoted digit string", () => {
    expect(safeStringifyCell(BigInt("9007199254740993"))).toBe(
      '"9007199254740993"',
    );
  });

  it("serializes BigInt inside an object as a quoted digit string", () => {
    expect(safeStringifyCell({ id: BigInt("9223372036854775807") })).toBe(
      '{"id":"9223372036854775807"}',
    );
  });

  // Sprint 261 (ADR 0026) — Decimal cells round-trip via `.toString()`.
  it("serializes Decimal as a quoted base-10 string", () => {
    expect(safeStringifyCell(new Decimal("123456789.12345678901234"))).toBe(
      '"123456789.12345678901234"',
    );
  });

  it("serializes Decimal inside an object as a quoted string", () => {
    expect(safeStringifyCell({ amount: new Decimal("0.10") })).toBe(
      '{"amount":"0.1"}',
    );
  });

  it('returns "[unserializable]" for top-level undefined (JSON.stringify returns undefined)', () => {
    expect(safeStringifyCell(undefined)).toBe('"[unserializable]"');
  });

  it('returns "[unserializable]" for top-level Symbol', () => {
    expect(safeStringifyCell(Symbol("x"))).toBe('"[unserializable]"');
  });

  it("drops Symbol values (native JSON.stringify behaviour)", () => {
    // Symbol 은 JSON.stringify 가 throw 하지 않고 undefined 로 처리.
    // top-level Symbol → undefined; object 내 Symbol property → 무시.
    expect(safeStringifyCell({ a: 1, b: Symbol("x") })).toBe('{"a":1}');
  });
});
