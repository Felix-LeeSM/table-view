/**
 * Sprint 385 — frontend facade test.
 *
 * The facade lazy-loads a wasm-pack-generated module via dynamic
 * `import()`. In a jsdom/vitest environment the real `WebAssembly.
 * instantiateStreaming` path can't fetch a `.wasm` URL, so we mock the
 * module surface and exercise the facade's contract (lazy load, type
 * narrowing, error handling) against a controllable stub.
 *
 * Mock scope (memory/conventions/testing-scenarios/mock-scope/memory.md):
 *   - We mock the WASM module — the unit under test is the TS facade
 *     wrapper, not the WASM binary itself. The Rust crate has its own
 *     `cargo test` suite (31 tests) that covers AC-385-L1..L7 +
 *     AC-385-P1..P10 directly.
 *   - The mock returns ParseResult shapes identical to what the Rust
 *     `serde_wasm_bindgen` bridge produces — that contract is the
 *     boundary we lock here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  parseSql,
  parseSqlPreloaded,
  preloadSqlWasm,
  __resetSqlWasmModuleForTests,
  type SqlParseResult,
} from "./sqlAst";

// vitest hoists `vi.mock` above imports. The mocked module mimics the
// surface of the wasm-pack-generated `sql_parser_core.js`: a `default`
// init function (resolves immediately — no real WASM linear memory
// allocation under jsdom) and a `parse_sql(sql)` function returning
// the serde-wasm-bindgen shape.
vi.mock("./wasm/sql_parser_core.js", () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    parse_sql: vi.fn((sql: string) => {
      // The Rust unit tests exhaustively cover the grammar; here we
      // implement a thin stub that only handles the two SQL strings
      // the facade test actually issues. Anything else surfaces as a
      // sentinel that would fail the assertion clearly.
      if (sql === "SELECT id FROM users WHERE name = 'felix'") {
        return {
          kind: "select",
          columns: { kind: "named", names: ["id"] },
          from: [
            {
              schema: null,
              table: "users",
              alias: null,
              join: { kind: "comma" },
            },
          ],
          where: {
            kind: "comparison",
            left: { table: null, column: "name" },
            op: "eq",
            value: {
              kind: "literal",
              value: { kind: "string", value: "felix" },
            },
          },
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT * FROM users") {
        return {
          kind: "select",
          columns: { kind: "star" },
          from: [
            {
              schema: null,
              table: "users",
              alias: null,
              join: { kind: "comma" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
        } satisfies SqlParseResult;
      }
      // ── sprint-393a SELECT widening ────────────────────────────────
      if (sql === "SELECT a FROM x JOIN y ON x.id = y.x_id") {
        return {
          kind: "select",
          columns: { kind: "named", names: ["a"] },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
            },
            {
              schema: null,
              table: "y",
              alias: null,
              join: {
                kind: "inner-join",
                predicate: {
                  kind: "on",
                  expression: {
                    kind: "column-comparison",
                    left: { table: "x", column: "id" },
                    op: "eq",
                    right: { table: "y", column: "x_id" },
                  },
                },
              },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT a FROM x WHERE x.a BETWEEN 1 AND 10") {
        return {
          kind: "select",
          columns: { kind: "named", names: ["a"] },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
            },
          ],
          where: {
            kind: "between",
            column: { table: "x", column: "a" },
            low: { kind: "literal", value: { kind: "integer", value: 1 } },
            high: { kind: "literal", value: { kind: "integer", value: 10 } },
          },
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT a FROM x ORDER BY a DESC NULLS FIRST LIMIT 5") {
        return {
          kind: "select",
          columns: { kind: "named", names: ["a"] },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [
            {
              column: { table: null, column: "a" },
              direction: "desc",
              nulls: "first",
            },
          ],
          limit: {
            count: { kind: "literal", value: { kind: "integer", value: 5 } },
            offset: null,
          },
        } satisfies SqlParseResult;
      }
      if (sql === "INSERT INTO x VALUES (1)") {
        // Pre-sprint-392 this was an unsupported-statement; sprint-392
        // promotes INSERT to a first-class variant. The facade test that
        // exercises "tagged error union" now uses MERGE (still
        // unsupported in sprint-392) — see updated test below.
        return {
          kind: "insert",
          table: "x",
          columns: [],
          source: {
            kind: "values",
            rows: [[{ kind: "literal", value: { kind: "integer", value: 1 } }]],
          },
          on_conflict: null,
          returning: [],
        } satisfies SqlParseResult;
      }
      if (
        sql ===
        "MERGE INTO x USING y ON x.id = y.id WHEN MATCHED THEN UPDATE SET a = 1"
      ) {
        return {
          kind: "error",
          error_kind: "unsupported-statement",
          message: "sprint-392 does not support MERGE",
          at: 0,
        } satisfies SqlParseResult;
      }
      // ── sprint-392 DML write triad variants ──────────────────────
      if (sql === "INSERT INTO users VALUES (1)") {
        return {
          kind: "insert",
          table: "users",
          columns: [],
          source: {
            kind: "values",
            rows: [[{ kind: "literal", value: { kind: "integer", value: 1 } }]],
          },
          on_conflict: null,
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "INSERT INTO users (id) VALUES ($1)") {
        return {
          kind: "insert",
          table: "users",
          columns: ["id"],
          source: {
            kind: "values",
            rows: [[{ kind: "placeholder", name: "1" }]],
          },
          on_conflict: null,
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING") {
        return {
          kind: "insert",
          table: "users",
          columns: ["id"],
          source: {
            kind: "values",
            rows: [[{ kind: "literal", value: { kind: "integer", value: 1 } }]],
          },
          on_conflict: { kind: "do-nothing" },
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "UPDATE users SET name = 'a' WHERE id = 1") {
        return {
          kind: "update",
          table: "users",
          assignments: [
            {
              column: "name",
              value: { kind: "literal", value: { kind: "string", value: "a" } },
            },
          ],
          from: [],
          where_clause: {
            kind: "comparison",
            column: "id",
            op: "eq",
            value: { kind: "literal", value: { kind: "integer", value: 1 } },
          },
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "UPDATE users SET name = 'a'") {
        return {
          kind: "update",
          table: "users",
          assignments: [
            {
              column: "name",
              value: { kind: "literal", value: { kind: "string", value: "a" } },
            },
          ],
          from: [],
          where_clause: null,
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "DELETE FROM users WHERE id = 1") {
        return {
          kind: "delete",
          table: "users",
          using: [],
          where_clause: {
            kind: "comparison",
            column: "id",
            op: "eq",
            value: { kind: "literal", value: { kind: "integer", value: 1 } },
          },
          returning: [],
        } satisfies SqlParseResult;
      }
      if (sql === "DELETE FROM users") {
        return {
          kind: "delete",
          table: "users",
          using: [],
          where_clause: null,
          returning: [],
        } satisfies SqlParseResult;
      }
      // ── sprint-391 DDL destructive variants ──────────────────────
      if (sql === "DROP TABLE users") {
        return {
          kind: "drop",
          object_type: "table",
          name: "users",
          if_exists: false,
          cascade: null,
        } satisfies SqlParseResult;
      }
      if (sql === "DROP TABLE IF EXISTS users CASCADE") {
        return {
          kind: "drop",
          object_type: "table",
          name: "users",
          if_exists: true,
          cascade: "cascade",
        } satisfies SqlParseResult;
      }
      if (sql === "TRUNCATE users RESTART IDENTITY CASCADE") {
        return {
          kind: "truncate",
          table: "users",
          restart_identity: true,
          cascade: "cascade",
        } satisfies SqlParseResult;
      }
      if (sql === "ALTER TABLE users DROP COLUMN email CASCADE") {
        return {
          kind: "alter-table",
          table: "users",
          action: {
            kind: "drop-column",
            column: "email",
            if_exists: false,
            cascade: "cascade",
          },
        } satisfies SqlParseResult;
      }
      if (sql === "ALTER TABLE users DROP CONSTRAINT pk") {
        return {
          kind: "alter-table",
          table: "users",
          action: {
            kind: "drop-constraint",
            constraint: "pk",
            cascade: null,
          },
        } satisfies SqlParseResult;
      }
      if (sql === "ALTER TABLE users DROP INDEX idx") {
        return {
          kind: "alter-table",
          table: "users",
          action: { kind: "drop-index", index: "idx" },
        } satisfies SqlParseResult;
      }
      // Synthetic "not a parse result" — used to exercise the facade's
      // defensive runtime guard.
      if (sql === "__internal_break__") {
        return { not: "valid" } as unknown;
      }
      return null;
    }),
  };
});

beforeEach(() => {
  // The facade memoizes the module promise; reset between tests so
  // each one observes a fresh init call.
  __resetSqlWasmModuleForTests();
});

describe("parseSql (sprint-385 facade)", () => {
  it("parses SELECT id FROM users WHERE name = 'felix' into the expected AST shape (AC-385-F1)", async () => {
    const result = await parseSql("SELECT id FROM users WHERE name = 'felix'");

    expect(result.kind).toBe("select");
    if (result.kind !== "select") return; // narrow for the rest of the assertions

    expect(result.from).toHaveLength(1);
    const fromItem = result.from[0];
    expect(fromItem).toBeDefined();
    if (fromItem === undefined) return;
    expect(fromItem.table).toBe("users");
    expect(fromItem.join.kind).toBe("comma");
    expect(result.columns).toEqual({ kind: "named", names: ["id"] });
    expect(result.where).not.toBeNull();
    expect(result.where).toEqual({
      kind: "comparison",
      left: { table: null, column: "name" },
      op: "eq",
      value: { kind: "literal", value: { kind: "string", value: "felix" } },
    });
  });

  it("parses SELECT * FROM users as Star + no WHERE", async () => {
    const result = await parseSql("SELECT * FROM users");
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.columns).toEqual({ kind: "star" });
    expect(result.where).toBeNull();
  });

  it("returns a tagged error union (not a thrown exception) for unsupported statements", async () => {
    // Sprint-392 — INSERT is now supported. MERGE remains unsupported.
    const result = await parseSql(
      "MERGE INTO x USING y ON x.id = y.id WHEN MATCHED THEN UPDATE SET a = 1",
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error_kind).toBe("unsupported-statement");
  });

  it("synthesizes a lex-error when the WASM bridge returns a non-conforming value (defensive guard)", async () => {
    const result = await parseSql("__internal_break__");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error_kind).toBe("lex-error");
    expect(result.message).toContain("WASM bridge");
  });

  // ── sprint-391 DDL destructive facade tests (AC-391-F) ───────────────

  it("[AC-391-F01] parses `DROP TABLE users` into a kind:'drop' variant", async () => {
    const result = await parseSql("DROP TABLE users");
    expect(result.kind).toBe("drop");
    if (result.kind !== "drop") return;
    expect(result.object_type).toBe("table");
    expect(result.name).toBe("users");
    expect(result.if_exists).toBe(false);
    expect(result.cascade).toBeNull();
  });

  it("[AC-391-F02] parses `DROP TABLE IF EXISTS users CASCADE` with both flags set", async () => {
    const result = await parseSql("DROP TABLE IF EXISTS users CASCADE");
    expect(result.kind).toBe("drop");
    if (result.kind !== "drop") return;
    expect(result.if_exists).toBe(true);
    expect(result.cascade).toBe("cascade");
  });

  it("[AC-391-F03] parses `TRUNCATE users RESTART IDENTITY CASCADE` with restart_identity + cascade", async () => {
    const result = await parseSql("TRUNCATE users RESTART IDENTITY CASCADE");
    expect(result.kind).toBe("truncate");
    if (result.kind !== "truncate") return;
    expect(result.table).toBe("users");
    expect(result.restart_identity).toBe(true);
    expect(result.cascade).toBe("cascade");
  });

  it("[AC-391-F04] parses `ALTER TABLE users DROP COLUMN email CASCADE` into a drop-column action", async () => {
    const result = await parseSql(
      "ALTER TABLE users DROP COLUMN email CASCADE",
    );
    expect(result.kind).toBe("alter-table");
    if (result.kind !== "alter-table") return;
    expect(result.action.kind).toBe("drop-column");
    if (result.action.kind !== "drop-column") return;
    expect(result.action.column).toBe("email");
    expect(result.action.cascade).toBe("cascade");
  });

  it("[AC-391-F05] parses `ALTER TABLE users DROP CONSTRAINT pk` into a drop-constraint action", async () => {
    const result = await parseSql("ALTER TABLE users DROP CONSTRAINT pk");
    expect(result.kind).toBe("alter-table");
    if (result.kind !== "alter-table") return;
    expect(result.action.kind).toBe("drop-constraint");
    if (result.action.kind !== "drop-constraint") return;
    expect(result.action.constraint).toBe("pk");
    expect(result.action.cascade).toBeNull();
  });

  it("[AC-391-F06] parses `ALTER TABLE users DROP INDEX idx` (MySQL-style) into a drop-index action", async () => {
    const result = await parseSql("ALTER TABLE users DROP INDEX idx");
    expect(result.kind).toBe("alter-table");
    if (result.kind !== "alter-table") return;
    expect(result.action.kind).toBe("drop-index");
    if (result.action.kind !== "drop-index") return;
    expect(result.action.index).toBe("idx");
  });

  it("[AC-391-F07] parseSqlPreloaded returns null when the WASM module has not been loaded", () => {
    // After `__resetSqlWasmModuleForTests`, no async load has happened
    // → sync call must surface `null` so the caller can fall back to its
    // legacy path without throwing.
    expect(parseSqlPreloaded("DROP TABLE users")).toBeNull();
  });

  it("[AC-391-F08] parseSqlPreloaded returns the AST synchronously once the module is preloaded", async () => {
    await preloadSqlWasm();
    const result = parseSqlPreloaded("DROP TABLE users");
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.kind).toBe("drop");
    if (result.kind !== "drop") return;
    expect(result.name).toBe("users");
  });

  // ── sprint-392 DML write triad facade tests (AC-392-F) ─────────────

  it("[AC-392-F01] parses `INSERT INTO users VALUES (1)` into a kind:'insert' variant", async () => {
    const result = await parseSql("INSERT INTO users VALUES (1)");
    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.table).toBe("users");
    expect(result.columns).toEqual([]);
    expect(result.source.kind).toBe("values");
    if (result.source.kind !== "values") return;
    expect(result.source.rows.length).toBe(1);
    const row0 = result.source.rows[0];
    expect(row0).toBeDefined();
    if (row0 === undefined) return;
    expect(row0[0]).toEqual({
      kind: "literal",
      value: { kind: "integer", value: 1 },
    });
  });

  it("[AC-392-F02] parses `INSERT INTO users (id) VALUES ($1)` into a placeholder value", async () => {
    const result = await parseSql("INSERT INTO users (id) VALUES ($1)");
    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.columns).toEqual(["id"]);
    expect(result.source.kind).toBe("values");
    if (result.source.kind !== "values") return;
    const row0 = result.source.rows[0];
    expect(row0).toBeDefined();
    if (row0 === undefined) return;
    expect(row0[0]).toEqual({
      kind: "placeholder",
      name: "1",
    });
  });

  it("[AC-392-F03] parses `INSERT … ON CONFLICT DO NOTHING` into an on_conflict variant", async () => {
    const result = await parseSql(
      "INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING",
    );
    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.on_conflict).toEqual({ kind: "do-nothing" });
  });

  it("[AC-392-F04] parses `UPDATE users SET name = 'a' WHERE id = 1` with where_clause", async () => {
    const result = await parseSql("UPDATE users SET name = 'a' WHERE id = 1");
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.table).toBe("users");
    expect(result.assignments.length).toBe(1);
    const first = result.assignments[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.column).toBe("name");
    expect(result.where_clause).not.toBeNull();
    if (result.where_clause === null) return;
    expect(result.where_clause.kind).toBe("comparison");
  });

  it("[AC-392-F05] parses `UPDATE users SET name = 'a'` with where_clause === null", async () => {
    const result = await parseSql("UPDATE users SET name = 'a'");
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.where_clause).toBeNull();
  });

  it("[AC-392-F06] parses `DELETE FROM users WHERE id = 1` with where_clause", async () => {
    const result = await parseSql("DELETE FROM users WHERE id = 1");
    expect(result.kind).toBe("delete");
    if (result.kind !== "delete") return;
    expect(result.table).toBe("users");
    expect(result.where_clause).not.toBeNull();
  });

  it("[AC-392-F07] parses `DELETE FROM users` with where_clause === null", async () => {
    const result = await parseSql("DELETE FROM users");
    expect(result.kind).toBe("delete");
    if (result.kind !== "delete") return;
    expect(result.where_clause).toBeNull();
  });

  it("[AC-392-F08] parseSqlPreloaded — DML synchronous AST dispatch after preload", async () => {
    await preloadSqlWasm();
    const insert = parseSqlPreloaded("INSERT INTO users VALUES (1)");
    expect(insert).not.toBeNull();
    if (insert === null) return;
    expect(insert.kind).toBe("insert");

    const update = parseSqlPreloaded("UPDATE users SET name = 'a'");
    expect(update).not.toBeNull();
    if (update === null) return;
    expect(update.kind).toBe("update");

    const del = parseSqlPreloaded("DELETE FROM users WHERE id = 1");
    expect(del).not.toBeNull();
    if (del === null) return;
    expect(del.kind).toBe("delete");
  });

  it("[AC-392-F09] runtime guard `isSqlParseResult` accepts INSERT / UPDATE / DELETE shapes", async () => {
    // Indirect: a successful `parseSql` round-trip on each variant
    // implies the union guard accepted the shape. If the guard rejected
    // any variant, the facade would substitute the synthetic
    // `lex-error`. We assert the *positive* path here for all three.
    const insert = await parseSql("INSERT INTO users VALUES (1)");
    expect(insert.kind).toBe("insert");
    const update = await parseSql("UPDATE users SET name = 'a'");
    expect(update.kind).toBe("update");
    const del = await parseSql("DELETE FROM users");
    expect(del.kind).toBe("delete");
  });

  // ── sprint-393a SELECT widening facade tests (AC-393a-Fc) ──────────

  it("[AC-393a-Fc01] parses a SELECT with INNER JOIN into a kind:'select' variant with a 2-item FROM list", async () => {
    const result = await parseSql("SELECT a FROM x JOIN y ON x.id = y.x_id");
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.from).toHaveLength(2);
    const second = result.from[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    expect(second.join.kind).toBe("inner-join");
    if (second.join.kind !== "inner-join") return;
    expect(second.join.predicate.kind).toBe("on");
  });

  it('[AC-393a-Fc02] parses BETWEEN in WHERE into a `kind: "between"` primary', async () => {
    const result = await parseSql("SELECT a FROM x WHERE x.a BETWEEN 1 AND 10");
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.where).not.toBeNull();
    if (result.where === null) return;
    expect(result.where.kind).toBe("between");
    if (result.where.kind !== "between") return;
    expect(result.where.column).toEqual({ table: "x", column: "a" });
    expect(result.where.low).toEqual({
      kind: "literal",
      value: { kind: "integer", value: 1 },
    });
  });

  it("[AC-393a-Fc03] parses ORDER BY a DESC NULLS FIRST LIMIT 5 into ordering + limit slots", async () => {
    const result = await parseSql(
      "SELECT a FROM x ORDER BY a DESC NULLS FIRST LIMIT 5",
    );
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.order_by).toHaveLength(1);
    const first = result.order_by[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.direction).toBe("desc");
    expect(first.nulls).toBe("first");
    expect(result.limit).not.toBeNull();
    if (result.limit === null) return;
    expect(result.limit.count).toEqual({
      kind: "literal",
      value: { kind: "integer", value: 5 },
    });
    expect(result.limit.offset).toBeNull();
  });

  it("[AC-393a-Fc04] parseSqlPreloaded returns the widened SELECT shape synchronously after preload", async () => {
    await preloadSqlWasm();
    const r = parseSqlPreloaded("SELECT a FROM x JOIN y ON x.id = y.x_id");
    // The default jsdom mock returns the mocked SELECT-widening shape;
    // the contract under test is that the runtime guard accepts the
    // wider FROM-list and the call resolves synchronously.
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.kind).toBe("select");
  });

  it("[AC-393a-Fc05] runtime guard accepts every widened SELECT shape (BETWEEN / JOIN / ORDER LIMIT)", async () => {
    // All three statements should round-trip through `parseSql` without
    // the runtime guard substituting the synthetic `lex-error`.
    const join = await parseSql("SELECT a FROM x JOIN y ON x.id = y.x_id");
    expect(join.kind).toBe("select");
    const between = await parseSql(
      "SELECT a FROM x WHERE x.a BETWEEN 1 AND 10",
    );
    expect(between.kind).toBe("select");
    const ordered = await parseSql(
      "SELECT a FROM x ORDER BY a DESC NULLS FIRST LIMIT 5",
    );
    expect(ordered.kind).toBe("select");
  });
});
