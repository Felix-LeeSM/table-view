// Phase 28 Slice F.1 (2026-05-15): nested expansion utility.
//
// Reason: regression guard that the unit function behind the sentinel cell
// expand popover (a) extracts one level only, (b) marks nested-of-nested
// entries with `isNested === true`, (c) does not treat BSON canonical
// singletons (`$oid` etc.) as composites, and (d) returns null for scalars.

import { describe, expect, it } from "vitest";
import { getNestedExpansion } from "./nestedExpansion";

describe("getNestedExpansion (Sprint 321 F.1)", () => {
  it("returns null for scalar values", () => {
    expect(getNestedExpansion(42)).toBeNull();
    expect(getNestedExpansion("hello")).toBeNull();
    expect(getNestedExpansion(true)).toBeNull();
    expect(getNestedExpansion(null)).toBeNull();
    expect(getNestedExpansion(undefined)).toBeNull();
  });

  it("expands a plain object into object-entry rows", () => {
    const result = getNestedExpansion({ a: 1, b: "two" });
    expect(result).not.toBeNull();
    expect(result!.containerKind).toBe("object");
    expect(result!.entries).toEqual([
      { kind: "object-entry", key: "a", value: 1, isNested: false },
      { kind: "object-entry", key: "b", value: "two", isNested: false },
    ]);
  });

  it("marks nested-of-nested entries with isNested=true", () => {
    const result = getNestedExpansion({
      a: { deep: 1 },
      b: [1, 2, 3],
      c: "scalar",
    });
    expect(result).not.toBeNull();
    const map = new Map(
      result!.entries
        .filter((e) => e.kind === "object-entry")
        .map((e) => [e.key, e.isNested]),
    );
    expect(map.get("a")).toBe(true);
    expect(map.get("b")).toBe(true);
    expect(map.get("c")).toBe(false);
  });

  it("expands an array into array-entry rows preserving index", () => {
    const result = getNestedExpansion(["x", { nested: 1 }, 7]);
    expect(result).not.toBeNull();
    expect(result!.containerKind).toBe("array");
    expect(result!.entries).toEqual([
      { kind: "array-entry", index: 0, value: "x", isNested: false },
      {
        kind: "array-entry",
        index: 1,
        value: { nested: 1 },
        isNested: true,
      },
      { kind: "array-entry", index: 2, value: 7, isNested: false },
    ]);
  });

  it("treats canonical BSON singletons ($oid, $date, $numberLong, ...) as scalars", () => {
    expect(getNestedExpansion({ $oid: "65abcdef0123456789abcdef" })).toBeNull();
    expect(getNestedExpansion({ $date: "2024-01-01T00:00:00Z" })).toBeNull();
    expect(getNestedExpansion({ $numberLong: "9999999999" })).toBeNull();
  });

  it("returns null for sentinel strings (caller must supply raw value)", () => {
    expect(getNestedExpansion("{...}")).toBeNull();
    expect(getNestedExpansion("[3 items]")).toBeNull();
  });
});
