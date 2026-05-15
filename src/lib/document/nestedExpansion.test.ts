// Sprint 321 (2026-05-15) — Slice F.1: nested expansion utility.
//
// 작성 이유: sentinel cell expand popover 의 단위 함수가 (a) 1-depth
// 만 추출하고 (b) nested-of-nested 는 `isNested === true` 로 표시
// 하며 (c) BSON canonical singleton (`$oid` 등) 은 composite 으로
// 취급하지 않고 (d) scalar 는 null 반환 하는지 회귀 가드.

import { describe, it, expect } from "vitest";
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
