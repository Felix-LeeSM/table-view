import { describe, it, expect, vi } from "vitest";
import {
  generateSql,
  coerceToSqlLiteral,
  type CoerceError,
} from "./sqlGenerator";
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

  it("escapes embedded double quotes in Oracle identifiers", () => {
    const [idColumn, selectColumn] = ORACLE_DATA.columns;
    const data: TableData = {
      ...ORACLE_DATA,
      columns: [
        { ...idColumn!, name: 'USER"ID' },
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

// ---------------------------------------------------------------------------
// Sprint 343 (2026-05-15) — inline JSON tree edits: jsonb + Postgres ARRAY.
// Locks the path-key parser + per-cell dispatch so the inline tree (Mongo's
// DocumentTreePanel mounted in the RDB grid) can edit / delete leaves through
// `:dot.path` pendingEdit keys without the SQL generator collapsing them to
// invalid statements. 작성 이유: Sprint 343 V1 — RDB 가 마침내 nested
// edit 을 받아들임. 회귀 가드: 일반 cell-edit 동작 (no `:path`) 은 영향 X.
// ---------------------------------------------------------------------------

const JSONB_DATA: TableData = {
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
      name: "meta",
      data_type: "jsonb",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "tags",
      data_type: "text[]",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, { verified: true, role: "user" }, ["alpha", "beta", "gamma"]]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

describe("generateSql — JSONB nested edits (Sprint 343)", () => {
  // Sprint 344 (2026-05-15) — AC-344-E-07: 모든 jsonb_set 호출이 4-arg
  // form (`, true`) 으로 통일되었다. Sprint 343 의 6개 assertion 을 갱신.
  // create_missing=true 는 기존 leaf-set 의미를 깨지 않으며 (이미 존재하는
  // key 는 그대로 덮어쓰기), 신규 add-key 가 동작하도록 확장만 한다.
  it("emits jsonb_set for a single nested string leaf", () => {
    const edits = new Map<string, string | null>([["0-1:role", "admin"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"role"}', '"admin"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("recognises numeric / boolean / null leaves as raw JSON (not quoted strings)", () => {
    const edits = new Map<string, string | null>([
      ["0-1:age", "42"],
      ["0-1:active", "true"],
      ["0-1:nickname", "null"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Sprint 344 — 4-arg form. create_missing=true 가 모든 jsonb_set 에 추가됨.
    expect(statements[0]).toContain(
      `jsonb_set(meta, '{"age"}', '42'::jsonb, true)`,
    );
    expect(statements[0]).toContain(`'{"active"}', 'true'::jsonb, true)`);
    expect(statements[0]).toContain(`'{"nickname"}', 'null'::jsonb, true)`);
  });

  it("chains multiple nested edits into a single UPDATE", () => {
    const edits = new Map<string, string | null>([
      ["0-1:role", "admin"],
      ["0-1:dept", "eng"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Inner-to-outer reading: jsonb_set wraps the previous jsonb_set
    // so the second call sees the first's output as its base.
    // Sprint 344 — both calls now carry `, true`.
    expect(statements[0]).toMatch(
      /UPDATE public\.users SET meta = jsonb_set\(jsonb_set\(meta, '\{"role"\}', '"admin"'::jsonb, true\), '\{"dept"\}', '"eng"'::jsonb, true\) WHERE id = 1;/,
    );
  });

  it("routes __op__:unset into a `#-` (jsonb path delete)", () => {
    const edits = new Map<string, string | null>([
      ["0-1:legacyField", "__op__:unset"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // `#-` (path-delete) is unaffected by Sprint 344's 4-arg change — only
    // jsonb_set acquires the create_missing flag.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = meta #- '{"legacyField"}' WHERE id = 1;`,
    );
  });

  it("expands bracket-index segments into separate path components", () => {
    // `tags[0].name` → `'{"tags","0","name"}'` (jsonb path components are
    // text — Postgres accepts the numeric-looking element either way).
    const edits = new Map<string, string | null>([
      ["0-1:friends[0].name", "Marie"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    // Sprint 344 — 4-arg form on the chained jsonb_set output.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"friends","0","name"}', '"Marie"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("top-level cell edit on the same jsonb cell shadows any nested edits", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([
      ["0-1", `{"replaced":true}`],
      ["0-1:role", "admin"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toHaveLength(1);
    // Top-level wins → emits whatever coerceToSqlLiteral produces for the
    // raw jsonb input (textual fallback, single-quote escaped).
    expect(statements[0]).toContain("UPDATE public.users SET meta =");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ key: "0-1:role" });
  });
});

describe("generateSql — Postgres ARRAY nested edits (Sprint 343)", () => {
  it("reassigns the whole array on a single index edit (1-based out → 0-based in)", () => {
    const edits = new Map<string, string | null>([["0-2:[1]", "BETA"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['alpha', 'BETA', 'gamma']::text[] WHERE id = 1;`,
    );
  });

  it("splices out an element on __op__:unset", () => {
    const edits = new Map<string, string | null>([["0-2:[1]", "__op__:unset"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['alpha', 'gamma']::text[] WHERE id = 1;`,
    );
  });

  it("combines edits and deletes by index in one UPDATE", () => {
    const edits = new Map<string, string | null>([
      ["0-2:[0]", "ALPHA"],
      ["0-2:[1]", "__op__:unset"],
      ["0-2:[2]", "GAMMA"],
    ]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['ALPHA', 'GAMMA']::text[] WHERE id = 1;`,
    );
  });

  it("rejects non-index ARRAY paths (e.g. `meta.role` on a text[] column)", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([["0-2:meta.role", "admin"]]);
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors[0]?.message).toMatch(/single-index ARRAY paths/);
  });

  it("rejects nested edits on a non-structural column (e.g. text)", () => {
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([
      ["0-2:foo", "bar"], // would be valid on jsonb, but tags is text[] ARRAY
    ]);
    // Use the BASE_DATA shape where `name` is plain text.
    const baseTextEdits = new Map<string, string | null>([["0-1:foo", "bar"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      baseTextEdits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors[0]?.message).toMatch(
      /only supported on jsonb or Postgres ARRAY/,
    );
    // sanity: the array-specific path rejection still fires through the
    // ARRAY dispatch when invoked on tags column.
    expect(edits).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sprint 344 (2026-05-15) — Slice E — Generator dispatch for inline-tree
// `+ key` / `+ item` adds (`pendingByPath` 의 새 path commit). 작성 이유:
// Slice B/C 가 새 key/item 을 commit 했을 때 sqlGenerator 가 올바른
// SQL 로 변환해야 한다.
//  - AC-344-E-01: jsonb create-missing key — 기존 key 옆에 새 key 추가.
//  - AC-344-E-02: jsonb null base — SQL NULL 셀에 add 시 COALESCE wrap.
//  - AC-344-E-03: ARRAY push past end (regression lock — 이미 동작).
//  - AC-344-E-04: 비-structural (text) 컬럼 nested-add reject (regression).
//  - AC-344-E-07 의 4-arg form universal 확인은 위 Sprint 343 block 의
//    기존 6 assertion 갱신으로 cover.
// ---------------------------------------------------------------------------

describe("generateSql — Slice E add-key / add-item dispatch (Sprint 344)", () => {
  it("AC-344-E-01: jsonb create-missing key — existing key 옆에 새 key add", () => {
    // pendingEdits Map { "0-1:newKey" => "42" } on jsonb cell `{existing:"foo"}`
    // → jsonb_set(meta, '{"newKey"}', '42'::jsonb, true) 가 emit 된다.
    // create_missing=true 가 없으면 (Sprint 343 동작) 새 key 가 만들어지지 않음.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, { existing: "foo" }, []]],
    };
    const edits = new Map<string, string | null>([["0-1:newKey", "42"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(meta, '{"newKey"}', '42'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-02: jsonb null base — cell SQL null + add → COALESCE wrap", () => {
    // Row 의 meta 가 SQL NULL 인 경우. jsonb_set(NULL, ...) 은 NULL 을
    // 반환하므로 add 가 사실상 no-op. Sprint 344 generator 는 base 를
    // COALESCE(meta, '{}'::jsonb) 로 wrap 해서 empty object 위에 key 를
    // 생성한다. 한 번만 wrap 되고 chained jsonb_set 가 그 결과를 재사용.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, null, []]],
    };
    const edits = new Map<string, string | null>([["0-1:newKey", "42"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{"newKey"}', '42'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-02 follow-up: jsonb null base + chained adds 가 한 번만 COALESCE wrap", () => {
    // 같은 cell 에 두 개의 nested add. 첫 jsonb_set 는 COALESCE 위에 적용,
    // 두 번째는 첫 jsonb_set 의 결과를 그대로 base 로 사용한다 — 두 번
    // COALESCE 가 들어가면 SQL 이 깨진다.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, null, []]],
    };
    const edits = new Map<string, string | null>([
      ["0-1:role", "admin"],
      ["0-1:dept", "eng"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(jsonb_set(COALESCE(meta, '{}'::jsonb), '{"role"}', '"admin"'::jsonb, true), '{"dept"}', '"eng"'::jsonb, true) WHERE id = 1;`,
    );
  });

  it("AC-344-E-03: ARRAY push past end — current cell `[a,b]` + `[2]` => append", () => {
    // 이미 emitArrayUpdate 의 `extraIndexes` 분기로 동작 — 회귀 가드만.
    // pending `"0-2:[2]" => "c"` 가 `cellValue.length === 2` 보다 큰 인덱스이므로
    // 새 원소로 append. text[] element type 가 textual 이므로 'c' 로 quote.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, ["a", "b"]]],
    };
    const edits = new Map<string, string | null>([["0-2:[2]", "c"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['a', 'b', 'c']::text[] WHERE id = 1;`,
    );
  });

  it("AC-344-E-03 follow-up: ARRAY 두 인덱스 sequential push (`[N]` + `[N+1]`)", () => {
    // Slice C 의 두 번 연속 + item commit 회귀 가드 — 두 새 인덱스가
    // 모두 append 되어 ARRAY['a','b','c','d'] 가 emit 된다.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, ["a", "b"]]],
    };
    const edits = new Map<string, string | null>([
      ["0-2:[2]", "c"],
      ["0-2:[3]", "d"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['a', 'b', 'c', 'd']::text[] WHERE id = 1;`,
    );
  });

  it("AC-344-E-04: 비-structural (text) 컬럼 nested-add → onCoerceError, no SQL", () => {
    // BASE_DATA 의 `name` 은 text — nested edit 자체가 부적절. 기존
    // Sprint 343 의 "only supported on jsonb or Postgres ARRAY" 메시지가
    // 그대로 fire. Slice E 는 새 동작을 추가하지 않으며 regression-lock 만.
    const errors: CoerceError[] = [];
    const edits = new Map<string, string | null>([["0-1:newKey", "v"]]);
    const statements = generateSql(
      BASE_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e) },
    );
    expect(statements).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.key).toBe("0-1:newKey");
    expect(errors[0]?.message).toMatch(
      /only supported on jsonb or Postgres ARRAY/,
    );
  });

  it("AC-344-E-01 edge: add + edit + unset mixed on same jsonb cell", () => {
    // 같은 jsonb 컬럼에 (a) 기존 key edit (b) 새 key add (c) 다른 key unset
    // 세 가지가 한 번에 — 모두 4-arg jsonb_set + `#-` chain 으로 통합.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, { existing: "foo", legacy: "bar" }, []]],
    };
    const edits = new Map<string, string | null>([
      ["0-1:existing", "renamed"],
      ["0-1:newKey", "42"],
      ["0-1:legacy", "__op__:unset"],
    ]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    // Insertion order: existing → newKey → legacy. existing 와 newKey 모두
    // 4-arg jsonb_set, legacy 는 `#-` path-delete.
    expect(statements[0]).toBe(
      `UPDATE public.users SET meta = jsonb_set(jsonb_set(meta, '{"existing"}', '"renamed"'::jsonb, true), '{"newKey"}', '42'::jsonb, true) #- '{"legacy"}' WHERE id = 1;`,
    );
  });

  it("AC-344-E-03 edge: empty array + first item push (`[0]`)", () => {
    // 빈 array 셀에 첫 item 을 push. base length=0 이므로 `[0]` 이
    // extraIndexes 로 분류되어 append.
    const DATA: TableData = {
      ...JSONB_DATA,
      rows: [[1, {}, []]],
    };
    const edits = new Map<string, string | null>([["0-2:[0]", "first"]]);
    const statements = generateSql(
      DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.users SET tags = ARRAY['first']::text[] WHERE id = 1;`,
    );
  });
});

// Sprint 347 (2026-05-15) — MySQL / SQLite JSON dispatch. `dialect` option
// routes nested edits to per-DBMS emit. MySQL uses JSON_SET / JSON_REMOVE
// against the jQuery-style `'$.path'` literals (vs Postgres' segment-array
// `'{a,b,c}'`). SQLite stays rejected with a clear message until a
// follow-up sprint plumbs `json1` extension dispatch.
const MYSQL_JSON_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "int",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "meta",
      data_type: "json",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, { verified: true, role: "user" }]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM app.users LIMIT 100 OFFSET 0",
};

describe("generateSql — MySQL JSON nested edits (Sprint 347)", () => {
  it("AC-344-E-01 (MySQL): emits JSON_SET for a single nested string leaf", () => {
    const edits = new Map<string, string | null>([["0-1:role", "admin"]]);
    const statements = generateSql(
      MYSQL_JSON_DATA,
      "app",
      "users",
      edits,
      new Set(),
      [],
      { dialect: "mysql" },
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE `app`.`users` SET `meta` = JSON_SET(`meta`, '$.role', CAST('\"admin\"' AS JSON)) WHERE `id` = 1;",
    );
  });

  it("emits chained JSON_SET for multiple nested leaves", () => {
    const edits = new Map<string, string | null>([
      ["0-1:role", "admin"],
      ["0-1:dept", "eng"],
    ]);
    const statements = generateSql(
      MYSQL_JSON_DATA,
      "app",
      "users",
      edits,
      new Set(),
      [],
      { dialect: "mysql" },
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /UPDATE `app`\.`users` SET `meta` = JSON_SET\(JSON_SET\(`meta`, '\$\.role', CAST\('"admin"' AS JSON\)\), '\$\.dept', CAST\('"eng"' AS JSON\)\) WHERE `id` = 1;/,
    );
  });

  it("routes __op__:unset through JSON_REMOVE", () => {
    const edits = new Map<string, string | null>([
      ["0-1:role", "__op__:unset"],
    ]);
    const statements = generateSql(
      MYSQL_JSON_DATA,
      "app",
      "users",
      edits,
      new Set(),
      [],
      { dialect: "mysql" },
    );
    expect(statements[0]).toBe(
      "UPDATE `app`.`users` SET `meta` = JSON_REMOVE(`meta`, '$.role') WHERE `id` = 1;",
    );
  });

  it("expands bracket-index path to MySQL JSON $.tags[0].name form", () => {
    const edits = new Map<string, string | null>([
      ["0-1:friends[0].name", "Marie"],
    ]);
    const statements = generateSql(
      MYSQL_JSON_DATA,
      "app",
      "users",
      edits,
      new Set(),
      [],
      { dialect: "mysql" },
    );
    expect(statements[0]).toBe(
      "UPDATE `app`.`users` SET `meta` = JSON_SET(`meta`, '$.friends[0].name', CAST('\"Marie\"' AS JSON)) WHERE `id` = 1;",
    );
  });

  it("scalar value types: number / bool / null pass through correctly", () => {
    const cases: Array<[string, string]> = [
      ["42", "42"],
      ["true", "TRUE"],
      ["false", "FALSE"],
      ["null", "CAST('null' AS JSON)"],
    ];
    for (const [input, expected] of cases) {
      const edits = new Map<string, string | null>([["0-1:k", input]]);
      const statements = generateSql(
        MYSQL_JSON_DATA,
        "app",
        "users",
        edits,
        new Set(),
        [],
        { dialect: "mysql" },
      );
      expect(statements[0]).toBe(
        `UPDATE \`app\`.\`users\` SET \`meta\` = JSON_SET(\`meta\`, '$.k', ${expected}) WHERE \`id\` = 1;`,
      );
    }
  });

  it("wraps null cell base in COALESCE(col, JSON_OBJECT())", () => {
    const dataWithNullCell: TableData = {
      ...MYSQL_JSON_DATA,
      rows: [[1, null]],
    };
    const edits = new Map<string, string | null>([["0-1:newKey", "42"]]);
    const statements = generateSql(
      dataWithNullCell,
      "app",
      "users",
      edits,
      new Set(),
      [],
      { dialect: "mysql" },
    );
    expect(statements[0]).toBe(
      "UPDATE `app`.`users` SET `meta` = JSON_SET(COALESCE(`meta`, JSON_OBJECT()), '$.newKey', 42) WHERE `id` = 1;",
    );
  });

  it("Postgres jsonb path is not affected by dialect:mysql on a different column type", () => {
    // jsonb dataset with dialect:mysql → falls through (data_type is 'jsonb'
    // which the mysql branch rejects), so `onCoerceError` fires. This guards
    // the cross-dialect: a Postgres-typed schema accidentally combined with
    // dialect:mysql shouldn't silently emit broken SQL.
    const edits = new Map<string, string | null>([["0-1:role", "admin"]]);
    const errors: string[] = [];
    const statements = generateSql(
      JSONB_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
      {
        dialect: "mysql",
        onCoerceError: (e) => errors.push(e.message),
      },
    );
    expect(statements).toHaveLength(0);
    expect(errors[0]).toMatch(/Nested edits are only supported/);
  });
});

describe("generateSql — MySQL row-write quoting and key projection (#444)", () => {
  const MYSQL_QUOTED_DATA: TableData = {
    columns: [
      {
        name: "user id",
        data_type: "varchar",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "select",
        data_type: "varchar",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "meta",
        data_type: "json",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "score",
        data_type: "int",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [["O'Brien", "old", { role: "user" }, 7]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM `app-db`.`order detail` LIMIT 100 OFFSET 0",
  };

  it("quotes schema/table/column identifiers and projects row identity through primary keys", () => {
    const statements = generateSql(
      MYSQL_QUOTED_DATA,
      "app-db",
      "order detail",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(["row-1-0"]),
      [["N'1", "fresh", null, ""]],
      { dialect: "mysql" },
    );

    expect(statements).toEqual([
      "UPDATE `app-db`.`order detail` SET `select` = 'new' WHERE `user id` = 'O''Brien';",
      "DELETE FROM `app-db`.`order detail` WHERE `user id` = 'O''Brien';",
      "INSERT INTO `app-db`.`order detail` (`user id`, `select`, `meta`, `score`) VALUES ('N''1', 'fresh', NULL, NULL);",
    ]);
    expect(statements[0]).not.toContain("old");
    expect(statements[0]).not.toContain("score = 7");
  });

  it("preserves MySQL JSON scalar/null handling under quoted identifiers", () => {
    const statements = generateSql(
      MYSQL_QUOTED_DATA,
      "app-db",
      "order detail",
      new Map<string, string | null>([
        ["0-2:role", "admin"],
        ["0-2:active", "true"],
        ["0-2:nickname", "null"],
      ]),
      new Set(),
      [],
      { dialect: "mysql" },
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "UPDATE `app-db`.`order detail` SET `meta` = JSON_SET(JSON_SET(JSON_SET(`meta`, '$.role', CAST('\"admin\"' AS JSON)), '$.active', TRUE), '$.nickname', CAST('null' AS JSON)) WHERE `user id` = 'O''Brien';",
    );
  });
});

describe("generateSql — SQLite JSON nested edits (Sprint 347)", () => {
  // Sprint 347 (2026-05-15) — SQLite has no formal JSON column type
  // (data_type comes through as TEXT/JSON depending on driver). Until
  // `json1` extension dispatch lands, nested edits on a `json` column under
  // dialect:sqlite are rejected with a clear message rather than emitting
  // broken SQL.
  const SQLITE_DATA: TableData = {
    columns: [
      {
        name: "id",
        data_type: "INTEGER",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "meta",
        data_type: "json",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [[1, { role: "user" }]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM main.users LIMIT 100 OFFSET 0",
  };

  it("rejects nested edits with a deferred message", () => {
    const edits = new Map<string, string | null>([["0-1:role", "admin"]]);
    const errors: string[] = [];
    const statements = generateSql(
      SQLITE_DATA,
      "main",
      "users",
      edits,
      new Set(),
      [],
      {
        dialect: "sqlite",
        onCoerceError: (e) => errors.push(e.message),
      },
    );
    expect(statements).toHaveLength(0);
    expect(errors[0]).toMatch(/SQLite JSON column edits/);
  });
});

describe("generateSql — SQLite row-write quoting (Sprint 454)", () => {
  const SQLITE_QUOTED_DATA: TableData = {
    columns: [
      {
        name: "user id",
        data_type: "TEXT",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "select",
        data_type: "TEXT",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ],
    rows: [["O'Brien", "old"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: 'SELECT * FROM "main"."order detail"',
  };

  it("quotes SQLite identifiers and escapes string PK row identity", () => {
    const statements = generateSql(
      SQLITE_QUOTED_DATA,
      "main",
      "order detail",
      new Map<string, string | null>([["0-1", "new"]]),
      new Set(["row-1-0"]),
      [["N'1", "fresh"]],
      { dialect: "sqlite" },
    );

    expect(statements).toEqual([
      `UPDATE "main"."order detail" SET "select" = 'new' WHERE "user id" = 'O''Brien';`,
      `DELETE FROM "main"."order detail" WHERE "user id" = 'O''Brien';`,
      `INSERT INTO "main"."order detail" ("user id", "select") VALUES ('N''1', 'fresh');`,
    ]);
  });
});

// Sprint 348 (2026-05-15) — jsonb[] inner-path edit. Sprint 343 deferred
// the element edit on jsonb[] / json[] columns; the path syntax for an
// inner edit is `[N].inner.path`. The emit reassigns the whole array
// (ARRAY[...]::jsonb[]) with edited slots wrapped in jsonb_set / #- and
// untouched slots referencing `col[i+1]` (Postgres 1-indexed).
const JSONB_ARRAY_DATA: TableData = {
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
      name: "items",
      data_type: "jsonb[]",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, [{ a: 1 }, { b: 2 }, { c: 3 }]]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.t LIMIT 100 OFFSET 0",
};

describe("generateSql — jsonb[] inner-path edit (Sprint 348)", () => {
  it("emits ARRAY[...] with jsonb_set on the edited slot", () => {
    const edits = new Map<string, string | null>([["0-1:[1].b", "20"]]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1], jsonb_set(items[2], '{"b"}', '20'::jsonb, true), items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("inner-path delete uses #-", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[0].a", "__op__:unset"],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1] #- '{"a"}', items[2], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("whole-element delete drops the slot", () => {
    const edits = new Map<string, string | null>([["0-1:[1]", "__op__:unset"]]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[items[1], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("whole-element replace emits jsonb literal in that slot", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[1]", '{"replaced":true}'],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    // safeStringifyCell on a JSON-text string still re-encodes once — the
    // resulting jsonb literal carries the inner string verbatim (callers
    // who want a parsed-object replace must commit the structural value
    // via the tree's coerce helper which produces a JS object, not a JSON
    // text).
    expect(statements[0]).toContain("items[1]");
    expect(statements[0]).toContain("'::jsonb");
    expect(statements[0]).toContain("items[3]");
  });

  it("two inner edits on the same element chain jsonb_set", () => {
    const edits = new Map<string, string | null>([
      ["0-1:[0].a", "10"],
      ["0-1:[0].b", "20"],
    ]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toBe(
      `UPDATE public.t SET items = ARRAY[jsonb_set(jsonb_set(items[1], '{"a"}', '10'::jsonb, true), '{"b"}', '20'::jsonb, true), items[2], items[3]]::jsonb[] WHERE id = 1;`,
    );
  });

  it("inner-path edit on missing index rejects", () => {
    const edits = new Map<string, string | null>([["0-1:[10].x", "1"]]);
    const errors: string[] = [];
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
      { onCoerceError: (e) => errors.push(e.message) },
    );
    expect(statements).toHaveLength(0);
    expect(errors[0]).toMatch(/add the element first/);
  });

  it("push past end of array (whole-element)", () => {
    const edits = new Map<string, string | null>([["0-1:[3]", '{"new":1}']]);
    const statements = generateSql(
      JSONB_ARRAY_DATA,
      "public",
      "t",
      edits,
      new Set(),
      [],
    );
    expect(statements[0]).toContain("items[1], items[2], items[3]");
    expect(statements[0]).toContain("::jsonb[]");
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

// ---------------------------------------------------------------------------
// Sprint 75 — coerceToSqlLiteral: pure-function type coercion per column type.
// ---------------------------------------------------------------------------

describe("coerceToSqlLiteral — tri-state (null, '', value)", () => {
  it("null + any type → SQL NULL (ADR 0009 tri-state)", () => {
    expect(coerceToSqlLiteral(null, "text")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "integer")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "boolean")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral(null, "date")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
  });

  it("'' + textual types → preserved as '' (ADR 0009)", () => {
    // Textual family: text/varchar/char/citext/string/json/jsonb — ADR 0009
    // explicitly distinguishes '' (empty string) from NULL for these types.
    expect(coerceToSqlLiteral("", "text")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "varchar")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "character varying")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "char")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "citext")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "string")).toEqual({
      kind: "sql",
      sql: "''",
    });
    expect(coerceToSqlLiteral("", "json")).toEqual({ kind: "sql", sql: "''" });
    expect(coerceToSqlLiteral("", "jsonb")).toEqual({ kind: "sql", sql: "''" });
  });

  it("'' + non-textual types → SQL NULL (empty picker = explicit clear)", () => {
    // Sprint 75 AC-01: empty input on integer/numeric/boolean/date/etc
    // collapses to NULL because `SET col = ''` is invalid for those types
    // and the user clearing a picker almost always means "null me out".
    expect(coerceToSqlLiteral("", "integer")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "bigint")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "smallint")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "serial")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "numeric")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "decimal")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "real")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "double precision")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "boolean")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "bool")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "date")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "timestamp")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "timestamptz")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "datetime")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "time")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
    expect(coerceToSqlLiteral("", "uuid")).toEqual({
      kind: "sql",
      sql: "NULL",
    });
  });
});

describe("coerceToSqlLiteral — integer family", () => {
  it('"42" + integer → 42 (unquoted)', () => {
    expect(coerceToSqlLiteral("42", "integer")).toEqual({
      kind: "sql",
      sql: "42",
    });
  });

  it('"-1" + integer → -1 (unquoted, leading minus allowed)', () => {
    expect(coerceToSqlLiteral("-1", "integer")).toEqual({
      kind: "sql",
      sql: "-1",
    });
  });

  it("bigint / smallint / serial all accept integer literals", () => {
    expect(coerceToSqlLiteral("123456789", "bigint")).toEqual({
      kind: "sql",
      sql: "123456789",
    });
    expect(coerceToSqlLiteral("5", "smallint")).toEqual({
      kind: "sql",
      sql: "5",
    });
    expect(coerceToSqlLiteral("1", "serial")).toEqual({
      kind: "sql",
      sql: "1",
    });
  });

  it('"abc" + integer → error (non-numeric)', () => {
    const result = coerceToSqlLiteral("abc", "integer");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/integer/i);
    }
  });

  it('"3.14" + integer → error (decimals belong to numeric)', () => {
    const result = coerceToSqlLiteral("3.14", "integer");
    expect(result.kind).toBe("error");
  });

  it("empty minus or trailing garbage → error", () => {
    expect(coerceToSqlLiteral("-", "integer").kind).toBe("error");
    expect(coerceToSqlLiteral("12a", "integer").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — numeric family", () => {
  it('"3.14" + numeric → 3.14 (unquoted)', () => {
    expect(coerceToSqlLiteral("3.14", "numeric")).toEqual({
      kind: "sql",
      sql: "3.14",
    });
  });

  it('".5" + numeric → .5 (leading decimal accepted)', () => {
    expect(coerceToSqlLiteral(".5", "numeric")).toEqual({
      kind: "sql",
      sql: ".5",
    });
  });

  it('"-1" + numeric → -1 (leading minus accepted)', () => {
    expect(coerceToSqlLiteral("-1", "numeric")).toEqual({
      kind: "sql",
      sql: "-1",
    });
  });

  it("decimal / float / double precision / real accept numeric literals", () => {
    expect(coerceToSqlLiteral("1.2", "decimal")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "float")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "double precision")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
    expect(coerceToSqlLiteral("1.2", "real")).toEqual({
      kind: "sql",
      sql: "1.2",
    });
  });

  it('"abc" + numeric → error', () => {
    const result = coerceToSqlLiteral("abc", "numeric");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/numeric/i);
    }
  });

  it("bare minus / bare dot / scientific notation → error", () => {
    expect(coerceToSqlLiteral("-", "numeric").kind).toBe("error");
    expect(coerceToSqlLiteral(".", "numeric").kind).toBe("error");
    // Scientific notation is intentionally rejected in the first pass — see
    // the sqlGenerator.ts NUMERIC_RE comment.
    expect(coerceToSqlLiteral("1e3", "numeric").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — boolean family", () => {
  it('"true" / "t" / "1" → TRUE (case-insensitive)', () => {
    expect(coerceToSqlLiteral("true", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("TRUE", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("True", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("t", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("T", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("1", "boolean")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
  });

  it('"false" / "f" / "0" → FALSE (case-insensitive)', () => {
    expect(coerceToSqlLiteral("false", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("FALSE", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("f", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
    expect(coerceToSqlLiteral("0", "boolean")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
  });

  it("bool alias works the same as boolean", () => {
    expect(coerceToSqlLiteral("true", "bool")).toEqual({
      kind: "sql",
      sql: "TRUE",
    });
    expect(coerceToSqlLiteral("false", "bool")).toEqual({
      kind: "sql",
      sql: "FALSE",
    });
  });

  it('"maybe" + boolean → error', () => {
    const result = coerceToSqlLiteral("maybe", "boolean");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/boolean/i);
    }
  });
});

describe("coerceToSqlLiteral — date family", () => {
  it("\"2026-04-24\" + date → '2026-04-24' (quoted)", () => {
    expect(coerceToSqlLiteral("2026-04-24", "date")).toEqual({
      kind: "sql",
      sql: "'2026-04-24'",
    });
  });

  it('"yesterday" + date → error', () => {
    const result = coerceToSqlLiteral("yesterday", "date");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/date/i);
    }
  });

  it("rejects time-only / datetime values as date", () => {
    expect(coerceToSqlLiteral("10:00", "date").kind).toBe("error");
    expect(coerceToSqlLiteral("2026-04-24T10:00:00", "date").kind).toBe(
      "error",
    );
  });
});

describe("coerceToSqlLiteral — timestamp family", () => {
  it("ISO datetime with T-separator → quoted literal", () => {
    expect(coerceToSqlLiteral("2026-04-24T10:00:00", "timestamp")).toEqual({
      kind: "sql",
      sql: "'2026-04-24T10:00:00'",
    });
  });

  it("ISO datetime with space separator → quoted literal", () => {
    expect(coerceToSqlLiteral("2026-04-24 10:00:00", "timestamp")).toEqual({
      kind: "sql",
      sql: "'2026-04-24 10:00:00'",
    });
  });

  it("timestamptz accepts trailing Z", () => {
    expect(coerceToSqlLiteral("2026-04-24T10:00:00Z", "timestamptz")).toEqual({
      kind: "sql",
      sql: "'2026-04-24T10:00:00Z'",
    });
  });

  it("datetime alias routes to timestamp family", () => {
    expect(coerceToSqlLiteral("2026-04-24 10:00:00", "datetime")).toEqual({
      kind: "sql",
      sql: "'2026-04-24 10:00:00'",
    });
  });

  it("invalid timestamp → error", () => {
    const result = coerceToSqlLiteral("not-a-date", "timestamp");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/timestamp/i);
    }
  });
});

describe("coerceToSqlLiteral — time family", () => {
  it('"10:00" + time → quoted literal', () => {
    expect(coerceToSqlLiteral("10:00", "time")).toEqual({
      kind: "sql",
      sql: "'10:00'",
    });
  });

  it('"10:00:30" + time → quoted literal', () => {
    expect(coerceToSqlLiteral("10:00:30", "time")).toEqual({
      kind: "sql",
      sql: "'10:00:30'",
    });
  });

  it('"25:00" / "abc" + time → error', () => {
    // Note: the regex here only enforces digit shape, not range semantics.
    // "25:00" matches because HH is two digits. We accept the looseness here
    // and delegate real validation to the DB engine.
    expect(coerceToSqlLiteral("abc", "time").kind).toBe("error");
  });
});

describe("coerceToSqlLiteral — uuid family", () => {
  it("standard 36-char UUID → quoted literal", () => {
    expect(
      coerceToSqlLiteral("550e8400-e29b-41d4-a716-446655440000", "uuid"),
    ).toEqual({
      kind: "sql",
      sql: "'550e8400-e29b-41d4-a716-446655440000'",
    });
  });

  it("uppercase hex UUID is accepted (case-insensitive)", () => {
    expect(
      coerceToSqlLiteral("550E8400-E29B-41D4-A716-446655440000", "uuid"),
    ).toEqual({
      kind: "sql",
      sql: "'550E8400-E29B-41D4-A716-446655440000'",
    });
  });

  it("invalid UUID shape → error", () => {
    const result = coerceToSqlLiteral("not-a-uuid", "uuid");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/uuid/i);
    }
  });
});

describe("coerceToSqlLiteral — textual family (escape path preserved)", () => {
  it("simple string + text → quoted", () => {
    expect(coerceToSqlLiteral("Alice", "text")).toEqual({
      kind: "sql",
      sql: "'Alice'",
    });
  });

  it("single-quote escape still works (O''Brien)", () => {
    expect(coerceToSqlLiteral("O'Brien", "text")).toEqual({
      kind: "sql",
      sql: "'O''Brien'",
    });
  });

  it("varchar / json / jsonb use the same escape path", () => {
    expect(coerceToSqlLiteral("abc", "varchar")).toEqual({
      kind: "sql",
      sql: "'abc'",
    });
    expect(coerceToSqlLiteral('{"a":1}', "json")).toEqual({
      kind: "sql",
      sql: "'{\"a\":1}'",
    });
    expect(coerceToSqlLiteral("[1,2]", "jsonb")).toEqual({
      kind: "sql",
      sql: "'[1,2]'",
    });
  });

  it("unknown type → falls back to escape path (safe default)", () => {
    expect(coerceToSqlLiteral("blob-like", "bytea")).toEqual({
      kind: "sql",
      sql: "'blob-like'",
    });
    expect(coerceToSqlLiteral("anything", "mystery_type")).toEqual({
      kind: "sql",
      sql: "'anything'",
    });
  });
});

// ---------------------------------------------------------------------------
// Sprint 75 — generateSql integration: UPDATE emits type-aware literals and
// exposes coercion failures via onCoerceError. Valid edits in the same batch
// are unaffected by sibling failures.
// ---------------------------------------------------------------------------

const TYPED_DATA: TableData = {
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
      name: "age",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "active",
      data_type: "boolean",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "note",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, 42, true, "hi"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "",
};

describe("generateSql — Sprint 75 type-aware UPDATE literals", () => {
  it("integer column emits unquoted literal for valid integer string", () => {
    const edits = new Map<string, string | null>([["0-1", "99"]]);
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      edits,
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET age = 99 WHERE id = 1;",
    ]);
  });

  it("boolean column emits TRUE/FALSE (uppercase SQL literals)", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-2", "t"]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET active = TRUE WHERE id = 1;",
    ]);
  });

  it("non-textual empty string is coerced to NULL", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([
        ["0-1", ""],
        ["0-2", ""],
      ]),
      new Set(),
      [],
    );
    // age (integer) + active (boolean) both emit NULL
    expect(statements).toContain(
      "UPDATE public.users SET age = NULL WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET active = NULL WHERE id = 1;",
    );
  });

  it("textual empty string is preserved as '' (ADR 0009 invariant)", () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-3", ""]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET note = '' WHERE id = 1;",
    ]);
  });

  it("coercion failure is excluded from SQL and reported via onCoerceError", () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-1", "abc"]]),
      new Set(),
      [],
      { onCoerceError: onError },
    );
    expect(statements).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const errCall = onError.mock.calls[0]![0];
    expect(errCall.key).toBe("0-1");
    expect(errCall.rowIdx).toBe(0);
    expect(errCall.colIdx).toBe(1);
    expect(errCall.message).toMatch(/integer/i);
  });

  it("valid + invalid edits in same batch: valid ones still emit, invalid ones report errors", () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([
        ["0-1", "abc"], // invalid integer
        ["0-2", "true"], // valid boolean
        ["0-3", "hello"], // valid text
      ]),
      new Set(),
      [],
      { onCoerceError: onError },
    );
    // Two valid statements emitted.
    expect(statements).toHaveLength(2);
    expect(statements).toContain(
      "UPDATE public.users SET active = TRUE WHERE id = 1;",
    );
    expect(statements).toContain(
      "UPDATE public.users SET note = 'hello' WHERE id = 1;",
    );
    // Error reported for only the invalid one.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].key).toBe("0-1");
  });

  it("null value on a non-nullable-looking column still emits NULL (validation is DB's job)", () => {
    // The generator doesn't enforce nullable constraints — that's the DB's
    // responsibility. A null → NULL emission is always valid syntactically.
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map<string, string | null>([["0-1", null]]),
      new Set(),
      [],
    );
    expect(statements).toEqual([
      "UPDATE public.users SET age = NULL WHERE id = 1;",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sprint 75 attempt 2 — INSERT coercion. Closes the gap where new-row cells
// bypassed `coerceToSqlLiteral` and emitted `'42'` on integer columns or
// `''` on integer columns instead of `42` / `NULL`. Mirrors the UPDATE-side
// coercion contract: empty string on non-textual → NULL, typed strings →
// unquoted numbers / TRUE/FALSE / quoted dates, and coercion failure skips
// the INSERT entirely with a per-cell error report.
// ---------------------------------------------------------------------------

describe("generateSql — Sprint 75 attempt 2 INSERT coercion", () => {
  it("integer column + \"\" → row uses NULL, not ''", () => {
    // A user adds a new row, leaves `age` blank. Pre-attempt-2 this emitted
    // `VALUES (…, '', …)` which PostgreSQL would reject with
    // `invalid input syntax for type integer`. Attempt 2 routes through
    // `coerceToSqlLiteral` so the empty string collapses to NULL (ADR 0009).
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "", "true", "ok"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, NULL, TRUE, 'ok');",
    ]);
  });

  it('integer column + "42" → row uses 42 unquoted', () => {
    // String inputs on integer columns coerce to unquoted integer literals.
    // The INSERT path now behaves identically to the UPDATE path (which has
    // shipped this for a sprint already).
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [["42", "7", "false", "hi"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (42, 7, FALSE, 'hi');",
    ]);
  });

  it('boolean column + "true" → row uses TRUE', () => {
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, null, "true", null]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, NULL, TRUE, NULL);",
    ]);
  });

  it("date column + \"2026-04-24\" → row uses '2026-04-24' (quoted ISO literal)", () => {
    const DATE_DATA: TableData = {
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
          name: "dob",
          data_type: "date",
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
      executed_query: "",
    };
    const statements = generateSql(
      DATE_DATA,
      "public",
      "patients",
      new Map(),
      new Set(),
      [[1, "2026-04-24"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.patients (id, dob) VALUES (1, '2026-04-24');",
    ]);
  });

  it('integer column + "abc" → no INSERT for that row, onCoerceError fires with a correlatable key', () => {
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "abc", "true", "note"]],
      { onCoerceError: onError },
    );
    // Row is dropped entirely — no partially-valid INSERT.
    expect(statements).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]![0];
    // Correlatable key: `new-${newRowIdx}-${colIdx}` so the UI can scope the
    // hint to the offending new-row cell without colliding with UPDATE keys.
    expect(call.key).toBe("new-0-1");
    expect(call.rowIdx).toBe(0);
    expect(call.colIdx).toBe(1);
    expect(call.message).toMatch(/integer/i);
  });

  it("mixed-batch INSERT: valid rows keep INSERT, invalid row is skipped with error", () => {
    // Row A (valid), Row B (one invalid cell → skipped), Row C (valid).
    // AC-03 independence: sibling row failures must not taint valid rows.
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [
        [1, "10", "true", "row A"], // valid
        [2, "abc", "false", "row B"], // invalid integer → skipped
        [3, "30", "false", "row C"], // valid
      ],
      { onCoerceError: onError },
    );

    // Two statements emitted — A and C, B dropped.
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      "INSERT INTO public.users (id, age, active, note) VALUES (1, 10, TRUE, 'row A');",
    );
    expect(statements[1]).toBe(
      "INSERT INTO public.users (id, age, active, note) VALUES (3, 30, FALSE, 'row C');",
    );
    // Exactly one error, keyed to new-row 1 (row B) column 1 (age).
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].key).toBe("new-1-1");
    expect(onError.mock.calls[0]![0].rowIdx).toBe(1);
    expect(onError.mock.calls[0]![0].colIdx).toBe(1);
  });

  it("multiple invalid cells in a single new row report one error per cell, row still skipped", () => {
    // Two invalid cells in the same row — the UI needs both hints so the user
    // can fix them in one pass. Row emission is still atomic (all-or-nothing).
    const onError = vi.fn<(err: CoerceError) => void>();
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, "abc", "maybe", "text"]],
      { onCoerceError: onError },
    );
    expect(statements).toHaveLength(0);
    // Two errors: age + active.
    expect(onError).toHaveBeenCalledTimes(2);
    const keys = onError.mock.calls.map((c) => c[0].key).sort();
    expect(keys).toEqual(["new-0-1", "new-0-2"]);
  });

  // Sprint 306 (2026-05-14) — BigInt freeze 회귀 가드. normalizeNewRowCell
  // 의 typeof === "object" 분기가 raw JSON.stringify 였을 때 nested BigInt
  // 입력에서 throw. 또한 buildWhereClause 가 Decimal 을 만나면 [object
  // Object] 로 떨어졌던 sprint-305 회귀.
  it("nested BigInt 가 들어있는 new-row object 도 throw 없이 INSERT", () => {
    const DATA: TableData = {
      ...BASE_DATA,
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
          name: "payload",
          data_type: "jsonb",
          nullable: true,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ],
    };
    expect(() =>
      generateSql(DATA, "public", "items", new Map(), new Set(), [
        [99, { big: BigInt("9223372036854775807") }],
      ]),
    ).not.toThrow();
  });

  it("DELETE/UPDATE WHERE 가 BigInt pk 를 toString 으로 직렬화", () => {
    const BIG_DATA: TableData = {
      ...BASE_DATA,
      rows: [[BigInt("9223372036854775807"), "Big"]],
    };
    const statements = generateSql(
      BIG_DATA,
      "public",
      "users",
      new Map(),
      new Set(["row-key-0"]),
      [],
    );
    expect(statements[0]).toBe(
      "DELETE FROM public.users WHERE id = 9223372036854775807;",
    );
  });

  it("raw number/boolean primitives in new-row cells are normalised before coercion", () => {
    // New-row editors sometimes store typed primitives (number / boolean)
    // rather than strings. The generator normalises to string before coerce
    // so an integer cell receiving JS `3` emits `3` unquoted, and a boolean
    // cell receiving `true` emits `TRUE`.
    const statements = generateSql(
      TYPED_DATA,
      "public",
      "users",
      new Map(),
      new Set(),
      [[1, 3, true, "ok"]],
    );
    expect(statements).toEqual([
      "INSERT INTO public.users (id, age, active, note) VALUES (1, 3, TRUE, 'ok');",
    ]);
  });
});
