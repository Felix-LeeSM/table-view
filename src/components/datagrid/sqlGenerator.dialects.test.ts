import { describe, it, expect } from "vitest";
import { generateSql, type CoerceError } from "./sqlGenerator";
import type { TableData } from "@/types/schema";

describe("generateSql — MSSQL row edit SQL", () => {
  const MSSQL_DATA: TableData = {
    columns: [
      {
        name: "user id",
        data_type: "nvarchar(64)",
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
      {
        name: "is active",
        data_type: "bit",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [["O'Brien", "old", true]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM [sales].[order detail]",
  };

  it("emits bracket-escaped key-projected T-SQL and bit literals", () => {
    const statements = generateSql(
      MSSQL_DATA,
      "sales",
      "order detail",
      new Map<string, string | null>([
        ["0-1", "new"],
        ["0-2", "false"],
      ]),
      new Set(),
      [],
      { dialect: "mssql" },
    );

    expect(statements).toEqual([
      "UPDATE [sales].[order detail] SET [select] = 'new' WHERE [user id] = 'O''Brien';",
      "UPDATE [sales].[order detail] SET [is active] = 0 WHERE [user id] = 'O''Brien';",
    ]);
  });

  it("escapes closing brackets in MSSQL identifiers", () => {
    const [idColumn, selectColumn] = MSSQL_DATA.columns;
    const data: TableData = {
      ...MSSQL_DATA,
      columns: [
        { ...idColumn!, name: "user]id", data_type: "int" },
        { ...selectColumn!, name: "select]" },
      ],
      rows: [[7, "old"]],
    };

    const statements = generateSql(
      data,
      "sales]east",
      "order]detail",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(),
      [],
      { dialect: "mssql" },
    );

    expect(statements).toEqual([
      "UPDATE [sales]]east].[order]]detail] SET [select]]] = 'new' WHERE [user]]id] = 7;",
    ]);
  });

  it("blocks MSSQL writes without primary-key projection", () => {
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
      [["new-id", "new", "true"]],
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

describe("generateSql — Oracle row edit SQL", () => {
  const ORACLE_DATA: TableData = {
    columns: [
      {
        name: "USER ID",
        data_type: "VARCHAR2",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "SELECT",
        data_type: "VARCHAR2",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "AMOUNT",
        data_type: "NUMBER(10,2)",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "CREATED_AT",
        data_type: "DATE",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [["O'Brien", "old", 1.25, "2026-06-01"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query:
      'SELECT "USER ID", "SELECT", "AMOUNT", "CREATED_AT" FROM "APP"."ORDER DETAIL"',
  };

  it("emits double-quoted key-projected Oracle SQL and Oracle date literals", () => {
    const statements = generateSql(
      ORACLE_DATA,
      "APP",
      "ORDER DETAIL",
      new Map<string, string | null>([
        ["0-1", "new"],
        ["0-2", "12.5"],
        ["0-3", "2026-06-08"],
      ]),
      new Set(),
      [],
      { dialect: "oracle" },
    );

    expect(statements).toEqual([
      `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = 'new' WHERE "USER ID" = 'O''Brien';`,
      `UPDATE "APP"."ORDER DETAIL" SET "AMOUNT" = 12.5 WHERE "USER ID" = 'O''Brien';`,
      `UPDATE "APP"."ORDER DETAIL" SET "CREATED_AT" = DATE '2026-06-08' WHERE "USER ID" = 'O''Brien';`,
    ]);
  });

  it("uses backend-shaped Oracle DATE/TIMESTAMP literals for primary-key WHERE clauses", () => {
    const datePkData: TableData = {
      ...ORACLE_DATA,
      columns: [
        { ...ORACLE_DATA.columns[0]!, name: "CREATED_ON", data_type: "DATE" },
        { ...ORACLE_DATA.columns[1]! },
      ],
      rows: [["2026-06-08 12:34:56", "old"]],
    };
    const timestampPkData: TableData = {
      ...ORACLE_DATA,
      columns: [
        {
          ...ORACLE_DATA.columns[0]!,
          name: "CREATED_AT",
          data_type: "TIMESTAMP(6)",
        },
        { ...ORACLE_DATA.columns[1]! },
      ],
      rows: [["2026-06-08T10:30:00Z", "old"]],
    };
    const timestampTzPkData: TableData = {
      ...ORACLE_DATA,
      columns: [
        {
          ...ORACLE_DATA.columns[0]!,
          name: "CREATED_AT",
          data_type: "TIMESTAMP WITH TIME ZONE",
        },
        { ...ORACLE_DATA.columns[1]! },
      ],
      rows: [["2026-06-08 10:30:00.123456 +09:00", "old"]],
    };

    expect(
      generateSql(
        datePkData,
        "APP",
        "ORDER DETAIL",
        new Map<string, string | null>([["0-1", "new"]]),
        new Set(["row-1-0"]),
        [],
        { dialect: "oracle" },
      ),
    ).toEqual([
      `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = 'new' WHERE "CREATED_ON" = TO_DATE('2026-06-08 12:34:56', 'YYYY-MM-DD HH24:MI:SS');`,
      `DELETE FROM "APP"."ORDER DETAIL" WHERE "CREATED_ON" = TO_DATE('2026-06-08 12:34:56', 'YYYY-MM-DD HH24:MI:SS');`,
    ]);

    expect(
      generateSql(
        timestampPkData,
        "APP",
        "ORDER DETAIL",
        new Map<string, string | null>([["0-1", "new"]]),
        new Set(["row-1-0"]),
        [],
        { dialect: "oracle" },
      ),
    ).toEqual([
      `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = 'new' WHERE "CREATED_AT" = TIMESTAMP '2026-06-08 10:30:00';`,
      `DELETE FROM "APP"."ORDER DETAIL" WHERE "CREATED_AT" = TIMESTAMP '2026-06-08 10:30:00';`,
    ]);

    expect(
      generateSql(
        timestampTzPkData,
        "APP",
        "ORDER DETAIL",
        new Map<string, string | null>([["0-1", "new"]]),
        new Set(["row-1-0"]),
        [],
        { dialect: "oracle" },
      ),
    ).toEqual([
      `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = 'new' WHERE "CREATED_AT" = TO_TIMESTAMP_TZ('2026-06-08 10:30:00.123456 +09:00', 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM');`,
      `DELETE FROM "APP"."ORDER DETAIL" WHERE "CREATED_AT" = TO_TIMESTAMP_TZ('2026-06-08 10:30:00.123456 +09:00', 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM');`,
    ]);
  });

  it("emits NULL explicitly for empty Oracle textual values", () => {
    const statements = generateSql(
      ORACLE_DATA,
      "APP",
      "ORDER DETAIL",
      new Map<string, string | null>([
        ["0-1", ""],
        ["0-3", null],
      ]),
      new Set(),
      [["N1", "", "12.5", null]],
      { dialect: "oracle" },
    );

    expect(statements).toEqual([
      `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = NULL WHERE "USER ID" = 'O''Brien';`,
      `UPDATE "APP"."ORDER DETAIL" SET "CREATED_AT" = NULL WHERE "USER ID" = 'O''Brien';`,
      `INSERT INTO "APP"."ORDER DETAIL" ("USER ID", "SELECT", "AMOUNT", "CREATED_AT") VALUES ('N1', NULL, 12.5, NULL);`,
    ]);
  });

  it("escapes embedded double quotes in Oracle identifiers", () => {
    const [idColumn, selectColumn] = ORACLE_DATA.columns;
    const data: TableData = {
      ...ORACLE_DATA,
      columns: [
        { ...idColumn!, name: 'USER"ID', data_type: "NUMBER" },
        { ...selectColumn!, name: 'SELECT"VALUE' },
      ],
      rows: [[7, "old"]],
    };

    const statements = generateSql(
      data,
      'APP"SCHEMA',
      'ORDER"DETAIL',
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(),
      [],
      { dialect: "oracle" },
    );

    expect(statements).toEqual([
      `UPDATE "APP""SCHEMA"."ORDER""DETAIL" SET "SELECT""VALUE" = 'new' WHERE "USER""ID" = 7;`,
    ]);
  });

  it("blocks Oracle writes without primary-key projection", () => {
    const errors: CoerceError[] = [];
    const dataWithoutPrimaryKey: TableData = {
      ...ORACLE_DATA,
      columns: ORACLE_DATA.columns.map((column) => ({
        ...column,
        is_primary_key: false,
      })),
    };

    const statements = generateSql(
      dataWithoutPrimaryKey,
      "APP",
      "ORDER DETAIL",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(["row-1-0"]),
      [["new-id", "new", "12.5", "2026-06-08"]],
      { dialect: "oracle", onCoerceError: (error) => errors.push(error) },
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
    expect(errors[0]?.message).toContain("Oracle row edits require");
  });
});
