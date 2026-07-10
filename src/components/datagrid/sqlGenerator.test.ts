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
  // Reason: #1433 잠금 갱신 — default/identity 메타가 없는 컬럼은 미입력
  // (undefined sentinel)이어도 기존 계약(명시 NULL) 유지. 생략은
  // default/identity 컬럼에만 적용 (2026-07-10)
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

// Purpose: #1433 — server-default/identity 컬럼 미입력 시 INSERT 컬럼 목록에서
// 생략해 서버 default/identity가 동작하게 한다 (wave 27 데이터 무결성, 2026-07-10)
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

  // Reason: #1433 시나리오 B — serial/identity PK 미입력 시 명시 NULL이
  // NOT NULL 위반을 일으켜 행 추가 전면 불가. 컬럼 자체를 생략해야 한다.
  // 미입력 = add-row seed 의 `undefined` sentinel (2026-07-10)
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

  // Reason: #1433 시나리오 A — default 컬럼 미입력 시 명시 NULL이 server
  // default를 silent 무시. 생략해서 default가 적용되게 한다 (2026-07-10)
  it("omits an untouched server-default column and keeps explicit values", () => {
    const statements = generateSql(
      IDENTITY_DEFAULT_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[7, undefined, undefined]],
    );

    // id는 입력됨 → 유지. status는 default 있음 + 미입력 → 생략.
    // name은 default/identity 없음 + 미입력 → 기존 계약대로 명시 NULL.
    expect(statements).toEqual([
      "INSERT INTO public.users (id, name) VALUES (7, NULL);",
    ]);
  });

  // Reason: #1433 리뷰 B1 — Duplicate Row(useDataGridEdit.handleDuplicateRow)와
  // undo 재-INSERT(buildRestageSnapshot의 DELETE reversal)는 원본 행을 verbatim
  // 복사하므로 실제 NULL 값이 `null`로 유입된다. 이 NULL은 "미입력"이 아니라
  // 데이터다 — 생략하면 server default('active')로 silent 치환되는 데이터
  // 유실 회귀. 명시 NULL로 emit해야 한다 (2026-07-10)
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

  // Reason: #1433 리뷰 B1 — identity 컬럼의 실 NULL도 미입력과 구분되어야
  // 한다. 생략이 아니라 명시 NULL emit — DB가 NOT NULL 위반을 표면화해서
  // 사용자가 알 수 있게 (silent 치환 금지) (2026-07-10)
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

  // Reason: #1433 — 모든 컬럼이 default/identity이고 전부 미입력이면 컬럼
  // 목록이 비므로 dialect별 all-defaults INSERT 형태가 필요하다 (2026-07-10)
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

    // Oracle에는 DEFAULT VALUES 구문이 없음 — 컬럼 전체에 DEFAULT 키워드.
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

  // Reason: #1433 — Duplicate Row/undo 재-INSERT는 identity 셀에 실제 값을
  // 담는다. 입력된 값은 생략하지 않고 그대로 emit해야 한다 (2026-07-10)
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
