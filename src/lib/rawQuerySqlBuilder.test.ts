import { describe, it, expect } from "vitest";
import { buildRawEditSql, type RawEditPlan } from "./rawQuerySqlBuilder";

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

  it("uses NULL when the new value is empty string", () => {
    const edits = new Map([["0-1", ""]]);
    const sqls = buildRawEditSql(ROWS, edits, new Set(), PLAN);
    expect(sqls[0]).toContain('SET "name" = NULL');
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
});
