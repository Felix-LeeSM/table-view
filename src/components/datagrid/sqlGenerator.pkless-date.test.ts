import { describe, it, expect } from "vitest";
import { generateSql } from "./sqlGenerator";
import type { TableData } from "@/types/schema";

// #1441 P3-1 — the PK-less all-column WHERE fallback used to emit a `Date`
// cell as an unquoted JS locale string (`ts = Wed Jul 16 2026 …`), which fails
// to parse or matches the wrong row. It must now route through
// `coerceToSqlLiteral` like the primary-key path, emitting a quoted literal.

function col(name: string, data_type: string, is_primary_key = false) {
  return {
    name,
    data_type,
    nullable: true,
    default_value: null,
    is_primary_key,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

const NO_PK_DATE_DATA: TableData = {
  columns: [col("ts", "timestamp"), col("d", "date"), col("name", "text")],
  rows: [
    [
      new Date("2026-07-16T10:00:00.000Z"),
      new Date("2026-07-16T10:00:00.000Z"),
      "Alice",
    ],
  ],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "",
};

describe("generateSql — PK-less Date literal in the all-column fallback (#1441)", () => {
  it("emits quoted, coerced Date literals instead of an unquoted locale string", () => {
    const edits = new Map<string, string | null>([["0-2", "Bob"]]);
    const statements = generateSql(
      NO_PK_DATE_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.t SET name = 'Bob' WHERE " +
        "ts = '2026-07-16T10:00:00.000Z' AND d = '2026-07-16' AND name = 'Alice';",
    );
    // The failure mode: an unquoted locale string like `Wed Jul 16 2026`.
    expect(statements[0]).not.toMatch(/= Wed |= [A-Z][a-z]{2} /);
  });
});
