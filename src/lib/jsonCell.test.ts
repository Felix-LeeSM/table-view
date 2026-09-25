// AC-238-07: one-line rendering of JSON / object cells + circular/BigInt guard.
// Written 2026-05-10.
// ADR 0026 (2026-05-11) — the replacer now serializes BigInt / Decimal cells
// as digit strings. The "unserializable" contract remains only for circular
// references / undefined / Symbol.

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { renderCellValue, safeStringifyCell } from "./jsonCell";

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

  // ADR 0026 — BigInt cells now serialize as a quoted digit string so
  // CSV / JSON exports and history snapshots preserve precision.
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

  // ADR 0026 — Decimal cells round-trip via `.toString()`.
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
    // JSON.stringify does not throw on a Symbol; it treats it as undefined.
    // top-level Symbol → undefined; a Symbol property in an object → dropped.
    expect(safeStringifyCell({ a: 1, b: Symbol("x") })).toBe('{"a":1}');
  });

  // indent option. The DataGrid tooltip / Cell detail dialog render
  // pretty-printed multi-line JSON, so the second argument must keep the
  // native `JSON.stringify` indent meaning (without throwing on BigInt/Decimal
  // cells).
  it("honours the indent argument with BigInt-safe replacer", () => {
    expect(safeStringifyCell({ id: BigInt("123"), name: "x" }, 2)).toBe(
      ["{", '  "id": "123",', '  "name": "x"', "}"].join("\n"),
    );
  });
});

// Issue #1369 — shared cell-value renderer, extracted from DataRow.renderCell
// and DocumentGridRows.renderCellValue (identical logic before this).
describe("renderCellValue", () => {
  it("renders a Decimal via toString (before the object branch)", () => {
    expect(renderCellValue(new Decimal("0.10"))).toBe("0.1");
  });

  it("renders a BigInt losslessly via String", () => {
    expect(renderCellValue(BigInt("9223372036854775807"))).toBe(
      "9223372036854775807",
    );
  });

  it("renders a plain object as compact JSON", () => {
    expect(renderCellValue({ a: 1 })).toBe('{"a":1}');
  });

  it("renders nested BigInt inside an object without throwing", () => {
    expect(renderCellValue({ id: BigInt("123") })).toBe('{"id":"123"}');
  });

  it("renders primitives via String", () => {
    expect(renderCellValue("hi")).toBe("hi");
    expect(renderCellValue(42)).toBe("42");
    expect(renderCellValue(true)).toBe("true");
  });
});
