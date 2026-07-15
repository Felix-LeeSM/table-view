import { describe, it, expect } from "vitest";
import { buildRawEditSql, type RawEditPlan } from "./rawQuerySqlBuilder";
import { coerceToSqlLiteral } from "./sqlLiteral";

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name", "email"],
};

const ROWS: unknown[][] = [
  [1, "Alice", "alice@example.com"],
  [2, "Bob", "bob@example.com"],
];

describe("buildRawEditSql", () => {
  it("builds an UPDATE for a single cell edit", () => {
    const edits = new Map([["0-1", "Alicia"]]);
    const sqls = buildRawEditSql(ROWS, edits, new Set(), PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."users" SET "name" = 'Alicia' WHERE "id" = 1;`,
    ]);
  });

  it("emits one UPDATE per pending edit and uses the row's PK value", () => {
    const edits = new Map([
      ["0-1", "Alicia"],
      ["1-2", "bobby@example.com"],
    ]);
    const sqls = buildRawEditSql(ROWS, edits, new Set(), PLAN);
    expect(sqls).toContain(
      `UPDATE "public"."users" SET "name" = 'Alicia' WHERE "id" = 1;`,
    );
    expect(sqls).toContain(
      `UPDATE "public"."users" SET "email" = 'bobby@example.com' WHERE "id" = 2;`,
    );
    expect(sqls).toHaveLength(2);
  });

  it("escapes single quotes in the new value", () => {
    const edits = new Map([["0-1", "O'Hara"]]);
    const sqls = buildRawEditSql(ROWS, edits, new Set(), PLAN);
    expect(sqls[0]).toContain(`'O''Hara'`);
  });

  it("preserves empty string as '' when no column type is supplied (unknown family)", () => {
    // Issue #1436 — without a declared data type the builder can't tell a
    // textual column from a numeric one, so it preserves `''` (the safe,
    // no-data-loss default) instead of forcing NULL. Real callers thread
    // `resultColumnTypes` so numeric columns still collapse empty → NULL.
    const edits = new Map([["0-1", ""]]);
    const sqls = buildRawEditSql(ROWS, edits, new Set(), PLAN);
    expect(sqls[0]).toContain(`SET "name" = ''`);
  });

  it("builds DELETE statements for pending row deletions", () => {
    const deletes = new Set(["row-1-0", "row-1-1"]);
    const sqls = buildRawEditSql(ROWS, new Map(), deletes, PLAN);
    expect(sqls).toContain(`DELETE FROM "public"."users" WHERE "id" = 1;`);
    expect(sqls).toContain(`DELETE FROM "public"."users" WHERE "id" = 2;`);
  });

  it("supports composite primary keys via AND in the WHERE clause", () => {
    const compositePlan: RawEditPlan = {
      schema: "public",
      table: "memberships",
      pkColumns: ["org_id", "user_id"],
      resultColumnNames: ["org_id", "user_id", "role"],
    };
    const compositeRows = [[10, 100, "admin"]];
    const edits = new Map([["0-2", "owner"]]);
    const sqls = buildRawEditSql(
      compositeRows,
      edits,
      new Set(),
      compositePlan,
    );
    expect(sqls[0]).toBe(
      `UPDATE "public"."memberships" SET "role" = 'owner' WHERE "org_id" = 10 AND "user_id" = 100;`,
    );
  });

  it("quotes identifiers containing special characters", () => {
    const oddPlan: RawEditPlan = {
      schema: "Weird Schema",
      table: 'My"Table',
      pkColumns: ["pk"],
      resultColumnNames: ["pk", "Some Column"],
    };
    const sqls = buildRawEditSql(
      [[1, "x"]],
      new Map([["0-1", "y"]]),
      new Set(),
      oddPlan,
    );
    expect(sqls[0]).toBe(
      `UPDATE "Weird Schema"."My""Table" SET "Some Column" = 'y' WHERE "pk" = 1;`,
    );
  });

  it("returns empty list when there are no pending changes", () => {
    expect(buildRawEditSql(ROWS, new Map(), new Set(), PLAN)).toEqual([]);
  });

  it("ignores edits that reference nonexistent column or row indices", () => {
    const badEdits = new Map([
      ["99-0", "x"],
      ["0-99", "y"],
    ]);
    expect(buildRawEditSql(ROWS, badEdits, new Set(), PLAN)).toEqual([]);
  });

  // [AC-182-04b] Superseded by issue #1436: the historical unconditional
  // "" → SQL NULL convention destroyed a user's intended empty string on
  // textual columns. The builder is now type-aware — a non-textual column
  // still collapses empty → NULL (below), while a textual/unknown column
  // preserves `''` (covered by the issue #1436 suite).
  it("[AC-182-04b] collapses empty string to NULL only for a non-textual column", () => {
    const numericPlan: RawEditPlan = {
      ...PLAN,
      resultColumnTypes: ["integer", "text", "integer"],
    };
    const edits = new Map([["0-2", ""]]); // clear the integer `email`-position col
    const sqls = buildRawEditSql(ROWS, edits, new Set(), numericPlan);
    expect(sqls).toEqual([
      `UPDATE "public"."users" SET "email" = NULL WHERE "id" = 1;`,
    ]);
  });
});

// --- type-aware empty-string coercion (issue #1436) --------------------

// SELECT id (int), bio (text), age (int) FROM people — result columns carry
// their declared data type so the builder coerces the same way the structured
// grid does.
const TYPED_PLAN: RawEditPlan = {
  schema: "public",
  table: "people",
  pkColumns: ["id"],
  resultColumnNames: ["id", "bio", "age"],
  resultColumnTypes: ["integer", "text", "integer"],
};
const TYPED_ROWS: unknown[][] = [[1, "hello", 30]];

describe("buildRawEditSql — type-aware empty string (issue #1436)", () => {
  it("preserves an empty string on a textual column as '' (not NULL)", () => {
    const edits = new Map([["0-1", ""]]); // clear the `bio` text cell
    const sqls = buildRawEditSql(TYPED_ROWS, edits, new Set(), TYPED_PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."people" SET "bio" = '' WHERE "id" = 1;`,
    ]);
  });

  it("emits NULL when a non-textual column is cleared to empty", () => {
    const edits = new Map([["0-2", ""]]); // clear the `age` integer cell
    const sqls = buildRawEditSql(TYPED_ROWS, edits, new Set(), TYPED_PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."people" SET "age" = NULL WHERE "id" = 1;`,
    ]);
  });

  it("emits an unquoted numeric literal for an integer column", () => {
    const edits = new Map([["0-2", "42"]]);
    const sqls = buildRawEditSql(TYPED_ROWS, edits, new Set(), TYPED_PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."people" SET "age" = 42 WHERE "id" = 1;`,
    ]);
  });

  it("matches the structured grid's coerceToSqlLiteral literal per input", () => {
    // The structured grid emits `coerceToSqlLiteral(value, data_type, dialect)`
    // verbatim; the raw builder must produce the identical literal.
    const cases: Array<{ col: number; type: string; value: string }> = [
      { col: 1, type: "text", value: "" }, // textual empty → ''
      { col: 1, type: "text", value: "O'Hara" }, // escaping
      { col: 2, type: "integer", value: "" }, // numeric empty → NULL
      { col: 2, type: "integer", value: "7" }, // numeric literal
    ];
    for (const { col, type, value } of cases) {
      const sqls = buildRawEditSql(
        TYPED_ROWS,
        new Map([[`0-${col}`, value]]),
        new Set(),
        TYPED_PLAN,
      );
      const expectedLiteral = coerceToSqlLiteral(value, type, "postgresql");
      expect(expectedLiteral.kind).toBe("sql");
      const literal = expectedLiteral.kind === "sql" ? expectedLiteral.sql : "";
      expect(sqls[0]).toContain(`= ${literal} WHERE`);
    }
  });

  it("routes multi-table edits through the same type-aware coercion", () => {
    const plan: RawEditPlan = {
      ...MULTI_PLAN,
      resultColumnTypes: ["integer", "text", "integer", "numeric"],
    };
    // clear users.name (col 1, text) → '' ; clear orders.total (col 3, numeric) → NULL
    const sqls = buildRawEditSql(
      MULTI_ROWS,
      new Map([
        ["0-1", ""],
        ["0-3", ""],
      ]),
      new Set(),
      plan,
    );
    expect(sqls).toContain(
      `UPDATE "public"."users" SET "name" = '' WHERE "id" = 1;`,
    );
    expect(sqls).toContain(
      `UPDATE "public"."orders" SET "total" = NULL WHERE "id" = 10;`,
    );
  });
});

// --- NULL primary key (issue #1299, IS NULL fix mirrors #1305) ---------

describe("buildRawEditSql — NULL primary key handling", () => {
  it("skips a single-table edit when the row's PK is NULL (no `= NULL`)", () => {
    // A NULL PK can't identify a source row; the legacy builder emitted
    // `WHERE "id" = NULL` (matches nothing). We now skip the statement.
    const rows: unknown[][] = [[null, "Ghost", "g@x.com"]];
    const edits = new Map([["0-1", "Renamed"]]);
    const sqls = buildRawEditSql(rows, edits, new Set(), PLAN);
    expect(sqls).toEqual([]);
  });
});

// --- multi-table per-column edits (issue #1299) ------------------------

import type { MultiTablePlan } from "./rawQuerySqlBuilder";

// SELECT u.id, u.name, o.id, o.total FROM users u JOIN orders o ...
// columns:      0     1      2      3
const MULTI_PLAN: RawEditPlan = {
  schema: "",
  table: "",
  pkColumns: [],
  resultColumnNames: ["id", "name", "id", "total"],
  dialect: "postgresql",
  multi: {
    instances: [
      {
        schema: "public",
        table: "users",
        pkColumns: ["id"],
        pkPositions: { id: 0 },
      },
      {
        schema: "public",
        table: "orders",
        pkColumns: ["id"],
        pkPositions: { id: 2 },
      },
    ],
    columns: [
      { instance: 0, sourceColumn: "id", editable: true, readonlyReason: null },
      {
        instance: 0,
        sourceColumn: "name",
        editable: true,
        readonlyReason: null,
      },
      { instance: 1, sourceColumn: "id", editable: true, readonlyReason: null },
      {
        instance: 1,
        sourceColumn: "total",
        editable: true,
        readonlyReason: null,
      },
    ],
  } satisfies MultiTablePlan,
};

// user 1 (Alice) has two orders → two result rows for the same user.
const MULTI_ROWS: unknown[][] = [
  [1, "Alice", 10, 100],
  [1, "Alice", 11, 250],
];

describe("buildRawEditSql — multi-table (issue #1299)", () => {
  it("routes an edit to the owning table with a positional PK WHERE", () => {
    const edits = new Map([["0-3", "999"]]); // orders.total on row 0
    const sqls = buildRawEditSql(MULTI_ROWS, edits, new Set(), MULTI_PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."orders" SET "total" = '999' WHERE "id" = 10;`,
    ]);
  });

  it("edits the users instance by its own PK position", () => {
    const edits = new Map([["1-1", "Alicia"]]); // users.name on row 1
    const sqls = buildRawEditSql(MULTI_ROWS, edits, new Set(), MULTI_PLAN);
    expect(sqls).toEqual([
      `UPDATE "public"."users" SET "name" = 'Alicia' WHERE "id" = 1;`,
    ]);
  });

  it("ignores DELETE keys entirely (row delete disabled multi-table)", () => {
    const sqls = buildRawEditSql(
      MULTI_ROWS,
      new Map(),
      new Set(["row-1-0", "row-1-1"]),
      MULTI_PLAN,
    );
    expect(sqls).toEqual([]);
  });

  it("locks a LEFT JOIN unmatched row (instance PK all NULL) — no UPDATE", () => {
    // orders side unmatched: its PK column (idx 2) is NULL.
    const rows: unknown[][] = [[1, "Alice", null, null]];
    const edits = new Map([["0-3", "50"]]); // try to edit orders.total
    const sqls = buildRawEditSql(rows, edits, new Set(), MULTI_PLAN);
    expect(sqls).toEqual([]);
  });

  it("emits `IS NULL` for a NULL column inside a composite PK tuple", () => {
    const compositePlan: RawEditPlan = {
      schema: "",
      table: "",
      pkColumns: [],
      resultColumnNames: ["org_id", "user_id", "role"],
      dialect: "postgresql",
      multi: {
        instances: [
          {
            schema: "public",
            table: "memberships",
            pkColumns: ["org_id", "user_id"],
            pkPositions: { org_id: 0, user_id: 1 },
          },
        ],
        columns: [
          {
            instance: 0,
            sourceColumn: "org_id",
            editable: true,
            readonlyReason: null,
          },
          {
            instance: 0,
            sourceColumn: "user_id",
            editable: true,
            readonlyReason: null,
          },
          {
            instance: 0,
            sourceColumn: "role",
            editable: true,
            readonlyReason: null,
          },
        ],
      },
    };
    // Partial-null composite: org_id set, user_id NULL → not fully locked.
    const rows: unknown[][] = [[10, null, "member"]];
    const edits = new Map([["0-2", "owner"]]);
    const sqls = buildRawEditSql(rows, edits, new Set(), compositePlan);
    expect(sqls).toEqual([
      `UPDATE "public"."memberships" SET "role" = 'owner' WHERE "org_id" = 10 AND "user_id" IS NULL;`,
    ]);
  });

  it("uses dialect-aware identifier quoting (mysql backticks)", () => {
    const mysqlPlan: RawEditPlan = { ...MULTI_PLAN, dialect: "mysql" };
    const edits = new Map([["0-1", "Alicia"]]);
    const sqls = buildRawEditSql(MULTI_ROWS, edits, new Set(), mysqlPlan);
    expect(sqls).toEqual([
      "UPDATE `public`.`users` SET `name` = 'Alicia' WHERE `id` = 1;",
    ]);
  });

  // Adversarial: two result columns are BOTH `a.id` (`SELECT a.id AS x,
  // a.id AS y`). Editing the second one must still UPDATE the source column
  // `id` — a name-keyed builder would ambiguously resolve the duplicate name.
  it("targets the true source column when two aliases share it", () => {
    const dupPlan: RawEditPlan = {
      schema: "",
      table: "",
      pkColumns: [],
      resultColumnNames: ["id", "id"],
      dialect: "postgresql",
      multi: {
        instances: [
          {
            schema: "public",
            table: "a",
            pkColumns: ["id"],
            pkPositions: { id: 0 },
          },
        ],
        columns: [
          {
            instance: 0,
            sourceColumn: "id",
            editable: true,
            readonlyReason: null,
          },
          {
            instance: 0,
            sourceColumn: "id",
            editable: true,
            readonlyReason: null,
          },
        ],
      },
    };
    const rows: unknown[][] = [[7, 7]];
    const edits = new Map([["0-1", "8"]]); // edit the `y` alias (col 1)
    const sqls = buildRawEditSql(rows, edits, new Set(), dupPlan);
    expect(sqls).toEqual([
      `UPDATE "public"."a" SET "id" = '8' WHERE "id" = 7;`,
    ]);
  });
});
