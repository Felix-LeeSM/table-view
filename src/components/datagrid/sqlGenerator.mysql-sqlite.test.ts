import { describe, it, expect } from "vitest";
import { generateSql } from "./sqlGenerator";
import { JSONB_DATA, MYSQL_JSON_DATA } from "./sqlGenerator.fixtures";
import type { TableData } from "@/types/schema";

// Sprint 347 (2026-05-15) — MySQL / SQLite JSON dispatch. `dialect` option
// routes nested edits to per-DBMS emit. MySQL uses JSON_SET / JSON_REMOVE
// against the jQuery-style `'$.path'` literals (vs Postgres' segment-array
// `'{a,b,c}'`). SQLite stays rejected with a clear message until a
// follow-up sprint plumbs `json1` extension dispatch.

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
