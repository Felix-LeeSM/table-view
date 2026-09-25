import { describe, expect, it } from "vitest";
import type { TableData } from "@/types/schema";
import { type CoerceError, generateSql } from "./sqlGenerator";
import { BASE_DATA } from "./sqlGenerator.fixtures";

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
  // Reason: #1433 — a column with no default/identity metadata keeps the
  // existing contract (explicit NULL) even when untouched (undefined
  // sentinel). Omission applies only to default/identity columns.
  it("emits NULL for null/untouched cells and '' for empty-string cells in new rows", () => {
    const newRows = [
      [null, ""],
      [3, "x"],
      // add-row seed — untouched cells are `undefined`; plain columns
      // (no default, not identity) still emit explicit NULL.
      [undefined, undefined],
    ];
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      newRows,
    );

    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe(
      "INSERT INTO public.users (id, name) VALUES (NULL, '');",
    );
    expect(statements[1]).toBe(
      "INSERT INTO public.users (id, name) VALUES (3, 'x');",
    );
    expect(statements[2]).toBe(
      "INSERT INTO public.users (id, name) VALUES (NULL, NULL);",
    );
  });
});

// Purpose: #1433 — omit an untouched server-default/identity column from the
// INSERT column list so the server default/identity takes effect.
describe("generateSql — INSERT omits untouched default/identity columns (#1433)", () => {
  const IDENTITY_DEFAULT_DATA: TableData = {
    columns: [
      {
        name: "id",
        data_type: "serial",
        nullable: false,
        default_value: null,
        is_identity: true,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "status",
        data_type: "text",
        nullable: true,
        default_value: "'active'::text",
        is_primary_key: false,
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
    rows: [],
    total_count: 0,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
  };

  // Reason: #1433 scenario B — on an untouched serial/identity PK an explicit
  // NULL violates NOT NULL and blocks row insertion entirely. The column
  // itself must be omitted. Untouched = the add-row seed's `undefined`
  // sentinel.
  it("omits an untouched identity column so the sequence assigns the value", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[undefined, "pending", "Alice"]],
    );

    expect(statements).toEqual([
      "INSERT INTO public.users (status, name) VALUES ('pending', 'Alice');",
    ]);
  });

  // Reason: #1433 scenario A — on an untouched default column an explicit
  // NULL silently ignores the server default. Omit it so the default applies.
  it("omits an untouched server-default column and keeps explicit values", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[7, undefined, undefined]],
    );

    // id is filled in → kept. status has a default + untouched → omitted.
    // name has no default/identity + untouched → explicit NULL per the
    // existing contract.
    expect(statements).toEqual([
      "INSERT INTO public.users (id, name) VALUES (7, NULL);",
    ]);
  });

  // Reason: #1433 B1 review finding — Duplicate Row
  // (`useDataGridEdit.handleDuplicateRow`) and undo re-INSERT
  // (`buildRestageSnapshot`'s DELETE reversal) copy the original row verbatim,
  // so a real NULL value arrives as `null`. That NULL is data, not
  // "untouched" — omitting it silently substitutes the server default
  // ('active'), a data-loss regression. It must be emitted as an explicit
  // NULL.
  it("keeps a real NULL (duplicate row / undo re-INSERT) as explicit NULL on a default column", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      // Duplicate/restage shape: identity PK carries the source row's real
      // value, the default column carries a real NULL.
      [[42, null, "Bob"]],
    );

    expect(statements).toEqual([
      "INSERT INTO public.users (id, status, name) VALUES (42, NULL, 'Bob');",
    ]);
  });

  // Reason: #1433 B1 review finding — a real NULL on an identity column must
  // also be distinguished from untouched. Emit an explicit NULL rather than
  // omitting, so the DB surfaces the NOT NULL violation and the user sees it
  // (no silent substitution).
  it("keeps a real NULL on an identity column as explicit NULL (no silent omission)", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[null, "archived", "Carol"]],
    );

    expect(statements).toEqual([
      "INSERT INTO public.users (id, status, name) VALUES (NULL, 'archived', 'Carol');",
    ]);
  });

  // Reason: #1433 — when every column is default/identity and all are
  // untouched the column list is empty, so each dialect needs its own
  // all-defaults INSERT form.
  it("emits DEFAULT VALUES when every column is untouched default/identity", () => {
    const allDefaultData: TableData = {
      ...IDENTITY_DEFAULT_DATA,
      columns: IDENTITY_DEFAULT_DATA.columns.slice(0, 2),
    };
    const newRows = [[undefined, undefined]];

    const pg = generateSql(
      allDefaultData,
      "public",
      "users",
      new Map(),
      new Set(),
      newRows,
    );
    expect(pg).toEqual(["INSERT INTO public.users DEFAULT VALUES;"]);

    const mysql = generateSql(
      allDefaultData,
      "app",
      "users",
      new Map(),
      new Set(),
      newRows,
      { dialect: "mysql" },
    );
    expect(mysql).toEqual(["INSERT INTO `app`.`users` () VALUES ();"]);

    // Oracle has no DEFAULT VALUES syntax — DEFAULT keyword on every column.
    const oracle = generateSql(
      allDefaultData,
      "APP",
      "USERS",
      new Map(),
      new Set(),
      newRows,
      { dialect: "oracle" },
    );
    expect(oracle).toEqual([
      'INSERT INTO "APP"."USERS" ("id", "status") VALUES (DEFAULT, DEFAULT);',
    ]);
  });

  // Reason: #1433 — Duplicate Row / undo re-INSERT put a real value in the
  // identity cell. A filled-in value is emitted as-is, never omitted.
  it("keeps an explicitly provided value for an identity column", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[42, "archived", "Bob"]],
    );

    expect(statements).toEqual([
      "INSERT INTO public.users (id, status, name) VALUES (42, 'archived', 'Bob');",
    ]);
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
