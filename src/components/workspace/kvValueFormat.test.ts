import { describe, it, expect } from "vitest";
import { isJsonTreeCapable, jsonTreeValue } from "./kvValueFormat";

// Purpose: lock the JSON-tree eligibility boundary for the read-only KV value
// renderer — KV JSON tree Phase 1 (2026-07-17). A value inflates into an
// interactive tree ONLY when it is a JSON object/array (Mongo `isNestedCapable`
// parity); bare scalars and non-JSON text stay raw. These pure predicates are
// the seam the component branches on, so their edges are pinned here (P1 — the
// lowest layer that can hold the fact).
describe("kvValueFormat JSON-tree eligibility", () => {
  describe("isJsonTreeCapable", () => {
    // Reason: object/array are tree-capable; every scalar (incl. null/undefined)
    // is not — the guard against inflating a one-value key into a single node.
    it.each([
      [{}, true],
      [[], true],
      [{ a: 1 }, true],
      [[1, 2], true],
      [42, false],
      ["hello", false],
      [true, false],
      [null, false],
      [undefined, false],
    ])("returns %j → %s", (input, expected) => {
      expect(isJsonTreeCapable(input)).toBe(expected);
    });
  });

  describe("jsonTreeValue", () => {
    // Reason: parses text and yields the parsed value only for object/array,
    // else null — never throws on malformed/empty/scalar input (raw fallback).
    it.each([
      ["{}", {}],
      ["[]", []],
      ['{"a":1}', { a: 1 }],
      ["[1,2]", [1, 2]],
    ])("parses %s into a tree value", (text, expected) => {
      expect(jsonTreeValue(text)).toEqual(expected);
    });

    it.each([
      ["42"], // JSON number scalar
      ['"42"'], // JSON string scalar
      ["true"], // JSON boolean scalar
      ["null"], // JSON null
      ["{oops"], // malformed JSON
      [""], // empty string
      ["hello"], // free text
    ])("returns null for non-tree input %s", (text) => {
      expect(jsonTreeValue(text)).toBeNull();
    });
  });
});
