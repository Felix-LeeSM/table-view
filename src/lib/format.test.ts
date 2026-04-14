import { describe, it, expect } from "vitest";
import {
  truncateCell,
  CELL_DISPLAY_LIMIT,
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "./format";
import type { CopyRowData } from "./format";

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

// ── Copy format utilities ─────────────────────────────────────────────

function makeCopyData(overrides: Partial<CopyRowData> = {}): CopyRowData {
  return {
    columns: ["id", "name"],
    rows: [
      [1, "Alice"],
      [2, "Bob"],
    ],
    schema: "public",
    table: "users",
    ...overrides,
  };
}

describe("rowsToPlainText", () => {
  it("produces tab-separated text with header row", () => {
    const result = rowsToPlainText(makeCopyData());
    const lines = result.split("\n");
    expect(lines[0]).toBe("id\tname");
    expect(lines[1]).toBe("1\tAlice");
    expect(lines[2]).toBe("2\tBob");
  });

  it("handles null values as empty strings", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [[1, null]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe("1\t");
  });

  it("handles object values by JSON-stringifying them", () => {
    const result = rowsToPlainText(
      makeCopyData({ rows: [[1, { key: "val" }]] }),
    );
    const lines = result.split("\n");
    expect(lines[1]).toBe('1\t{"key":"val"}');
  });

  it("handles empty rows", () => {
    const result = rowsToPlainText(makeCopyData({ rows: [] }));
    const lines = result.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("id\tname");
  });
});

describe("rowsToJson", () => {
  it("produces a JSON array of objects", () => {
    const result = rowsToJson(makeCopyData());
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("handles null values as JSON null", () => {
    const result = rowsToJson(makeCopyData({ rows: [[1, null]] }));
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([{ id: 1, name: null }]);
  });

  it("handles empty rows", () => {
    const result = rowsToJson(makeCopyData({ rows: [] }));
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([]);
  });
});

describe("rowsToCsv", () => {
  it("produces CSV text with header row", () => {
    const result = rowsToCsv(makeCopyData());
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
  });

  it("escapes fields containing commas", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, "Bob, Jr."]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe('1,"Bob, Jr."');
  });

  it("escapes fields containing double quotes", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, 'say "hello"']] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe('1,"say ""hello"""');
  });

  it("escapes fields containing newlines", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, "line1\nline2"]] }));
    // CSV field with newline is wrapped in quotes
    expect(result).toContain('"line1\nline2"');
  });

  it("handles null values as empty strings", () => {
    const result = rowsToCsv(makeCopyData({ rows: [[1, null]] }));
    const lines = result.split("\n");
    expect(lines[1]).toBe("1,");
  });
});

describe("rowsToSqlInsert", () => {
  it("produces INSERT INTO statements", () => {
    const result = rowsToSqlInsert(makeCopyData());
    expect(result).toContain(
      "INSERT INTO public.users (id, name) VALUES (1, 'Alice');",
    );
    expect(result).toContain(
      "INSERT INTO public.users (id, name) VALUES (2, 'Bob');",
    );
  });

  it("handles null values as NULL", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[1, null]] }));
    expect(result).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, NULL);",
    );
  });

  it("escapes single quotes in string values", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[1, "O'Brien"]] }));
    expect(result).toBe(
      "INSERT INTO public.users (id, name) VALUES (1, 'O''Brien');",
    );
  });

  it("handles numeric values without quotes", () => {
    const result = rowsToSqlInsert(makeCopyData({ rows: [[42, "test"]] }));
    expect(result).toContain("VALUES (42, 'test')");
  });

  it("handles boolean values", () => {
    const result = rowsToSqlInsert({
      columns: ["flag"],
      rows: [[true]],
      schema: "public",
      table: "flags",
    });
    expect(result).toBe("INSERT INTO public.flags (flag) VALUES (true);");
  });

  it("handles empty schema (no prefix)", () => {
    const result = rowsToSqlInsert({
      columns: ["id"],
      rows: [[1]],
      schema: "",
      table: "test",
    });
    expect(result).toBe("INSERT INTO test (id) VALUES (1);");
  });
});
