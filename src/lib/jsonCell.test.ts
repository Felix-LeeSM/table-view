// Sprint 238 — AC-238-07: JSON / object cell 1줄 표현 + circular/BigInt 가드.
// 작성일 2026-05-10 / TDD slice #2.

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

  it('returns "[unserializable]" for BigInt values', () => {
    expect(safeStringifyCell(BigInt("9007199254740993"))).toBe(
      '"[unserializable]"',
    );
  });

  it('returns "[unserializable]" for objects containing BigInt', () => {
    expect(safeStringifyCell({ id: BigInt(1) })).toBe('"[unserializable]"');
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
