import { describe, it, expect } from "vitest";

import {
  resolveResultColumns,
  RESOLVE_REASON,
  type ResolverColumn,
  type SchemaColumnLookup,
} from "./multiTableResolver";
import type {
  SqlColumns,
  SqlFromItem,
  SqlJoinDescriptor,
  SqlSelectStatement,
} from "./sqlAst";

// --- fixture builders --------------------------------------------------

function col(name: string, pk = false): ResolverColumn {
  return { name, is_primary_key: pk };
}

/** Lookup backed by a table-name -> columns record (schema ignored). */
function lookupFrom(
  tables: Record<string, ResolverColumn[]>,
): SchemaColumnLookup {
  return (_schema, table) => tables[table] ?? null;
}

function fromTable(
  table: string,
  alias: string | null = null,
  join: SqlJoinDescriptor = { kind: "comma" },
  schema: string | null = null,
): SqlFromItem {
  return {
    schema,
    table,
    alias,
    join,
    source: { kind: "table", schema, table },
  };
}

function select(
  columns: SqlColumns,
  from: SqlFromItem[],
  extra: Partial<SqlSelectStatement> = {},
): SqlSelectStatement {
  return {
    kind: "select",
    columns,
    from,
    where: null,
    group_by: [],
    having: null,
    order_by: [],
    limit: null,
    set_operation: [],
    ...extra,
  };
}

const innerJoin: SqlJoinDescriptor = {
  kind: "inner-join",
  predicate: { kind: "using", columns: ["id"] },
};

// --- projection attribution -------------------------------------------

describe("resolveResultColumns — projection", () => {
  it("attributes bare columns of a single-instance SELECT", () => {
    const stmt = select({ kind: "named", names: ["id", "name"] }, [
      fromTable("users"),
    ]);
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    const r = resolveResultColumns(stmt, ["id", "name"], lookup);

    expect(r.columns).toEqual([
      {
        kind: "attributed",
        instance: 0,
        schema: null,
        table: "users",
        sourceColumn: "id",
      },
      {
        kind: "attributed",
        instance: 0,
        schema: null,
        table: "users",
        sourceColumn: "name",
      },
    ]);
  });

  it("attributes qualified refs to their aliased instances", () => {
    const stmt = select(
      {
        kind: "expressions",
        items: [
          { kind: "column", reference: { table: "u", column: "id" } },
          { kind: "column", reference: { table: "o", column: "total" } },
        ],
      },
      [fromTable("users", "u"), fromTable("orders", "o", innerJoin)],
    );
    const lookup = lookupFrom({
      users: [col("id", true)],
      orders: [col("total")],
    });

    const r = resolveResultColumns(stmt, ["id", "total"], lookup);

    expect(r.columns[0]).toMatchObject({ instance: 0, table: "users" });
    expect(r.columns[1]).toMatchObject({ instance: 1, table: "orders" });
  });

  it("resolves a bare column uniquely across instances via schema", () => {
    const stmt = select({ kind: "named", names: ["id", "total"] }, [
      fromTable("users", "u"),
      fromTable("orders", "o", innerJoin),
    ]);
    const lookup = lookupFrom({
      users: [col("id", true)],
      orders: [col("total")],
    });

    const r = resolveResultColumns(stmt, ["id", "total"], lookup);

    expect(r.columns[0]).toMatchObject({ instance: 0, sourceColumn: "id" });
    expect(r.columns[1]).toMatchObject({ instance: 1, sourceColumn: "total" });
  });

  it("marks a bare column ambiguous when two instances own it", () => {
    const stmt = select({ kind: "named", names: ["id"] }, [
      fromTable("users", "u"),
      fromTable("orders", "o", innerJoin),
    ]);
    const lookup = lookupFrom({
      users: [col("id", true)],
      orders: [col("id", true)],
    });

    const r = resolveResultColumns(stmt, ["id"], lookup);

    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.ambiguousOrUnknown,
    });
  });

  it("expands `*` into per-instance columns in FROM order", () => {
    const stmt = select({ kind: "star" }, [fromTable("users")]);
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    const r = resolveResultColumns(stmt, ["id", "name"], lookup);

    expect(
      r.columns.map((c) => (c.kind === "attributed" ? c.sourceColumn : null)),
    ).toEqual(["id", "name"]);
  });

  it("keeps same-named self-join columns distinct by position", () => {
    const stmt = select({ kind: "star" }, [
      fromTable("users", "u1"),
      fromTable("users", "u2", innerJoin),
    ]);
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    // #1296 preserves transport order: u1.id, u1.name, u2.id, u2.name.
    const r = resolveResultColumns(stmt, ["id", "name", "id", "name"], lookup);

    expect(
      r.columns.map((c) => (c.kind === "attributed" ? c.instance : null)),
    ).toEqual([0, 0, 1, 1]);
  });

  it("marks expression / function columns unattributable but keeps siblings", () => {
    const stmt = select(
      {
        kind: "expressions",
        items: [
          { kind: "column", reference: { table: null, column: "id" } },
          {
            kind: "expression",
            expression: {
              kind: "function-call",
              name: "count",
              arguments: [{ kind: "star" }],
            },
          },
        ],
      },
      [fromTable("users")],
    );
    const lookup = lookupFrom({ users: [col("id", true)] });

    const r = resolveResultColumns(stmt, ["id", "count"], lookup);

    expect(r.columns[0]).toMatchObject({
      kind: "attributed",
      sourceColumn: "id",
    });
    expect(r.columns[1]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.expression,
    });
  });

  it("attributes identically regardless of LEFT vs INNER join", () => {
    const leftJoin: SqlJoinDescriptor = {
      kind: "left-join",
      predicate: { kind: "using", columns: ["id"] },
    };
    const stmt = select(
      {
        kind: "expressions",
        items: [
          { kind: "column", reference: { table: "u", column: "id" } },
          { kind: "column", reference: { table: "o", column: "total" } },
        ],
      },
      [fromTable("users", "u"), fromTable("orders", "o", leftJoin)],
    );
    const lookup = lookupFrom({
      users: [col("id", true)],
      orders: [col("total")],
    });

    const r = resolveResultColumns(stmt, ["id", "total"], lookup);

    expect(r.columns[0]).toMatchObject({ instance: 0 });
    expect(r.columns[1]).toMatchObject({ instance: 1 });
  });
});

// --- name self-verification -------------------------------------------

describe("resolveResultColumns — name self-verification", () => {
  it("downgrades the whole result when a predicted name mismatches", () => {
    const stmt = select({ kind: "named", names: ["id", "name"] }, [
      fromTable("users"),
    ]);
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    // Result's second column is `nickname`, not the predicted `name`.
    const r = resolveResultColumns(stmt, ["id", "nickname"], lookup);

    expect(r.columns.every((c) => c.kind === "unattributable")).toBe(true);
    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.nameMismatch,
    });
  });

  it("downgrades when `*` expansion count differs from the result (stale cache)", () => {
    const stmt = select({ kind: "star" }, [fromTable("users")]);
    // Cache is stale: only 2 columns known, but the query returned 3.
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    const r = resolveResultColumns(stmt, ["id", "name", "email"], lookup);

    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.columnCountMismatch,
    });
  });

  it("downgrades a `*` when a source table's schema is uncached", () => {
    const stmt = select({ kind: "star" }, [
      fromTable("users"),
      fromTable("orders", null, innerJoin),
    ]);
    const lookup = lookupFrom({ users: [col("id", true)] }); // orders missing

    const r = resolveResultColumns(stmt, ["id", "total"], lookup);

    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.schemaUnavailable,
    });
  });
});

// --- exclusions --------------------------------------------------------

describe("resolveResultColumns — exclusions", () => {
  it("rejects a FROM subquery / derived table", () => {
    const derived: SqlFromItem = {
      schema: null,
      table: "sub",
      alias: "sub",
      join: { kind: "comma" },
      source: {
        kind: "subquery",
        statement: select({ kind: "star" }, [fromTable("users")]),
      },
    };
    const stmt = select({ kind: "named", names: ["id"] }, [derived]);

    const r = resolveResultColumns(stmt, ["id"], lookupFrom({}));

    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.derivedTable,
    });
  });

  it("rejects GROUP BY / HAVING / set-operation results", () => {
    const grouped = select(
      { kind: "named", names: ["id"] },
      [fromTable("users")],
      {
        group_by: [{ table: null, column: "id" }],
      },
    );

    const r = resolveResultColumns(
      grouped,
      ["id"],
      lookupFrom({ users: [col("id")] }),
    );

    expect(r.columns[0]).toEqual({
      kind: "unattributable",
      reason: RESOLVE_REASON.aggregateOrGrouped,
    });
  });
});

// --- instance editability ---------------------------------------------

describe("resolveResultColumns — instanceEditability", () => {
  it("reports PK completeness and positions per instance", () => {
    const stmt = select({ kind: "star" }, [
      fromTable("users", "u"),
      fromTable("orders", "o", innerJoin),
    ]);
    const lookup = lookupFrom({
      users: [col("id", true), col("name")],
      orders: [col("oid", true), col("total")],
    });

    const r = resolveResultColumns(
      stmt,
      ["id", "name", "oid", "total"],
      lookup,
    );

    expect(r.instanceEditability[0]).toEqual({
      instance: 0,
      pkComplete: true,
      pkPositions: { id: 0 },
      missingPk: [],
    });
    expect(r.instanceEditability[1]).toEqual({
      instance: 1,
      pkComplete: true,
      pkPositions: { oid: 2 },
      missingPk: [],
    });
  });

  it("flags an instance whose PK is absent from the result", () => {
    const stmt = select(
      {
        kind: "expressions",
        items: [{ kind: "column", reference: { table: "u", column: "name" } }],
      },
      [fromTable("users", "u")],
    );
    const lookup = lookupFrom({ users: [col("id", true), col("name")] });

    const r = resolveResultColumns(stmt, ["name"], lookup);

    expect(r.instanceEditability[0]).toMatchObject({
      pkComplete: false,
      missingPk: ["id"],
    });
  });
});
