import { describe, it, expect } from "vitest";
import { generateSql, type CoerceError } from "./sqlGenerator";
import { BASE_DATA } from "./sqlGenerator.fixtures";
import type { TableData } from "@/types/schema";

describe("generateSql — UPDATE tri-state (null vs empty string vs text)", () => {
  it("emits no row-write SQL when row writes are disabled", () => {
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-1", "Alicia"]]),
      new Set(["0"]),
      [[3, "Carol"]],
      { allowRowWrites: false },
    );

    expect(statements).toEqual([]);
  });

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

describe("generateSql — MSSQL edit boundary", () => {
  const MSSQL_DATA: TableData = {
    columns: [
      {
        name: "user id",
        data_type: "int",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "select",
        data_type: "nvarchar(255)",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [[7, "old"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT [user id], [select] FROM [sales].[order detail]",
  };

  it("uses bracket identifiers for schema, table, SET column, and primary-key WHERE", () => {
    const statements = generateSql(
      MSSQL_DATA,
      "sales",
      "order detail",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(["row-1-0"]),
      [],
      { dialect: "mssql" },
    );

    expect(statements).toEqual([
      "UPDATE [sales].[order detail] SET [select] = 'new' WHERE [user id] = 7;",
      "DELETE FROM [sales].[order detail] WHERE [user id] = 7;",
    ]);
  });

  it("blocks MSSQL row writes without a projected primary key", () => {
    const errors: CoerceError[] = [];
    const dataWithoutPrimaryKey: TableData = {
      ...MSSQL_DATA,
      columns: MSSQL_DATA.columns.map((column) => ({
        ...column,
        is_primary_key: false,
      })),
    };

    const statements = generateSql(
      dataWithoutPrimaryKey,
      "sales",
      "order detail",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(["row-1-0"]),
      [[8, "inserted"]],
      { dialect: "mssql", onCoerceError: (error) => errors.push(error) },
    );

    expect(statements).toEqual([]);
    expect(errors.map((error) => error.key)).toEqual([
      "0-1",
      "row-1-0",
      "new-0-0",
    ]);
    expect(errors.every((error) => error.message.includes("primary key"))).toBe(
      true,
    );
  });
});
