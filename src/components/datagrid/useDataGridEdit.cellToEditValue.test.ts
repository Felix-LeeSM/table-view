import { describe, it, expect } from "vitest";
import { cellToEditValue, cellToEditString } from "./useDataGridEdit";

describe("cellToEditValue — preserves null/empty-string distinction", () => {
  it("returns null for null cells", () => {
    expect(cellToEditValue(null)).toBeNull();
  });

  it("returns null for undefined cells", () => {
    expect(cellToEditValue(undefined)).toBeNull();
  });

  it("returns empty string for empty-string cells (not null)", () => {
    expect(cellToEditValue("")).toBe("");
    expect(cellToEditValue("")).not.toBeNull();
  });

  it("returns primitive strings as-is", () => {
    expect(cellToEditValue("Alice")).toBe("Alice");
    expect(cellToEditValue("42")).toBe("42");
  });

  it("coerces numbers and booleans to strings", () => {
    expect(cellToEditValue(42)).toBe("42");
    expect(cellToEditValue(0)).toBe("0");
    expect(cellToEditValue(true)).toBe("true");
    expect(cellToEditValue(false)).toBe("false");
  });

  it("pretty-prints objects and arrays as JSON", () => {
    expect(cellToEditValue({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(cellToEditValue([1, 2])).toBe("[\n  1,\n  2\n]");
  });
});

describe("cellToEditString — legacy display helper (NULL → '')", () => {
  it("collapses null to empty string (legacy semantics)", () => {
    expect(cellToEditString(null)).toBe("");
    expect(cellToEditString(undefined)).toBe("");
  });

  it("differs from cellToEditValue specifically on null", () => {
    expect(cellToEditString(null)).toBe("");
    expect(cellToEditValue(null)).toBeNull();
  });

  it("agrees with cellToEditValue on non-null inputs", () => {
    const inputs: unknown[] = ["Alice", "", 42, true, { a: 1 }];
    for (const input of inputs) {
      expect(cellToEditString(input)).toBe(cellToEditValue(input));
    }
  });
});
