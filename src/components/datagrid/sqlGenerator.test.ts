import { describe, it, expect } from "vitest";
import { generateSql } from "./sqlGenerator";
import type { TableData } from "@/types/schema";

const BASE_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice"],
    [2, null],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

describe("generateSql — UPDATE tri-state (null vs empty string vs text)", () => {
  it("emits SET col = NULL when pending edit is null", () => {
    const edits = new Map<string, string | null>([["0-1", null]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.users SET name = NULL WHERE id = 1;",
    );
  });

  it("emits SET col = '' when pending edit is empty string", () => {
    const edits = new Map<string, string | null>([["0-1", ""]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE public.users SET name = '' WHERE id = 1;",
    );
  });

  it("escapes single quotes in string values", () => {
    const edits = new Map<string, string | null>([["0-1", "O'Brien"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements[0]).toBe(
      "UPDATE public.users SET name = 'O''Brien' WHERE id = 1;",
    );
  });

  it("distinguishes null and empty string for two rows in the same batch", () => {
    const edits = new Map<string, string | null>([
      ["0-1", ""], // Alice → '' (empty string)
      ["1-1", null], // null-row → still NULL (explicit)
    ]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );

    expect(statements).toHaveLength(2);
    expect(statements).toContain(
      "UPDATE public.users SET name = '' WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET name = NULL WHERE id = 2;",
    );
  });
});

describe("generateSql — INSERT null vs empty string", () => {
  it("emits NULL for null cells and '' for empty-string cells in new rows", () => {
    const newRows = [
      [null, ""],
      [3, "x"],
    ];
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      newRows,
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      "INSERT INTO public.users (id, name) VALUES (NULL, '');",
    );
    expect(statements[1]).toBe(
      "INSERT INTO public.users (id, name) VALUES (3, 'x');",
    );
  });
});
