import { describe, it, expect } from "vitest";
import { truncateCell, CELL_DISPLAY_LIMIT } from "./format";

describe("truncateCell", () => {
  it("returns the value unchanged when within limit", () => {
    const value = "short value";
    expect(truncateCell(value)).toBe(value);
  });

  it("returns the value unchanged when exactly at limit", () => {
    const value = "a".repeat(CELL_DISPLAY_LIMIT);
    expect(truncateCell(value)).toBe(value);
  });

  it("truncates and appends ellipsis when exceeding limit", () => {
    const value = "a".repeat(300);
    const result = truncateCell(value);
    expect(result.length).toBe(CELL_DISPLAY_LIMIT + 3); // sliced + "..."
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, -3)).toBe("a".repeat(CELL_DISPLAY_LIMIT));
  });

  it("respects a custom limit", () => {
    const value = "abcdefghij";
    expect(truncateCell(value, 5)).toBe("abcde...");
  });

  it("handles empty string", () => {
    expect(truncateCell("")).toBe("");
  });

  it("handles single character", () => {
    expect(truncateCell("x")).toBe("x");
  });

  it("handles value exactly one character over limit", () => {
    const value = "a".repeat(CELL_DISPLAY_LIMIT + 1);
    const result = truncateCell(value);
    expect(result.length).toBe(CELL_DISPLAY_LIMIT + 3);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("CELL_DISPLAY_LIMIT", () => {
  it("is 200", () => {
    expect(CELL_DISPLAY_LIMIT).toBe(200);
  });
});
