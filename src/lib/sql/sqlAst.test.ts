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
              source: { kind: "table", schema: null, table: "users" },
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
          set_operation: [],
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
              source: { kind: "table", schema: null, table: "users" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
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
              source: { kind: "table", schema: null, table: "x" },
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
              source: { kind: "table", schema: null, table: "y" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
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
              source: { kind: "table", schema: null, table: "x" },
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
          set_operation: [],
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
              source: { kind: "table", schema: null, table: "x" },
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
          set_operation: [],
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
          // Sprint-393b — DML WHERE migrates to the unified SqlSelectExpr
          // shape (column-as-ColumnRef left, instead of bare string).
          where_clause: {
            kind: "comparison",
            left: { table: null, column: "id" },
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
            left: { table: null, column: "id" },
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
      // ── sprint-394 DDL additive variants ─────────────────────────
      if (sql === "CREATE TABLE users (id INTEGER, name TEXT)") {
        return {
          kind: "create-table",
          table: { schema: null, table: "users" },
          if_not_exists: false,
          columns: [
            {
              name: "id",
              data_type: { kind: "integer" },
              constraints: [],
              source_index: 0,
            },
            {
              name: "name",
              data_type: { kind: "text" },
              constraints: [],
              source_index: 1,
            },
          ],
          table_constraints: [],
        } satisfies SqlParseResult;
      }
      if (sql === "CREATE UNIQUE INDEX idx ON users (email)") {
        return {
          kind: "create-index",
          unique: true,
          if_not_exists: false,
          name: "idx",
          table: { schema: null, table: "users" },
          columns: ["email"],
        } satisfies SqlParseResult;
      }
      if (sql === "CREATE OR REPLACE VIEW v AS SELECT 1") {
        return {
          kind: "create-view",
          or_replace: true,
          name: { schema: null, table: "v" },
          body: {
            kind: "select",
            columns: { kind: "named", names: ["1"] },
            from: [
              {
                schema: null,
                table: "stub",
                alias: null,
                join: { kind: "comma" },
                source: { kind: "table", schema: null, table: "stub" },
              },
            ],
            where: null,
            group_by: [],
            having: null,
            order_by: [],
            limit: null,
            set_operation: [],
          },
        } satisfies SqlParseResult;
      }
      if (sql === "ALTER TABLE users ADD COLUMN email TEXT") {
        return {
          kind: "alter-table",
          table: "users",
          action: {
            kind: "add-column",
            column: {
              name: "email",
              data_type: { kind: "text" },
              constraints: [],
              source_index: 0,
            },
            if_not_exists: false,
          },
        } satisfies SqlParseResult;
      }
      if (sql === "ALTER TABLE users RENAME TO members") {
        return {
          kind: "alter-table",
          table: "users",
          action: { kind: "rename-table", new_name: "members" },
        } satisfies SqlParseResult;
      }
      // Synthetic "not a parse result" — used to exercise the facade's
      // defensive runtime guard.
      if (sql === "__internal_break__") {
        return { not: "valid" } as unknown;
      }
      // ── sprint-393b SELECT widening 2 — minimal stubs ──────────────
      if (sql === "WITH t AS (SELECT 1) SELECT * FROM t") {
        return {
          kind: "with",
          recursive: false,
          ctes: [
            {
              name: "t",
              columns: [],
              body: {
                kind: "select",
                columns: { kind: "star" },
                from: [
                  {
                    schema: null,
                    table: "t",
                    alias: null,
                    join: { kind: "comma" },
                    source: { kind: "table", schema: null, table: "t" },
                  },
                ],
                where: null,
                group_by: [],
                having: null,
                order_by: [],
                limit: null,
                set_operation: [],
              },
            },
          ],
          inner_statement: {
            kind: "select",
            columns: { kind: "star" },
            from: [
              {
                schema: null,
                table: "t",
                alias: null,
                join: { kind: "comma" },
                source: { kind: "table", schema: null, table: "t" },
              },
            ],
            where: null,
            group_by: [],
            having: null,
            order_by: [],
            limit: null,
            set_operation: [],
          },
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT a FROM x UNION ALL SELECT a FROM y") {
        const stub_y: SqlParseResult = {
          kind: "select",
          columns: { kind: "named", names: ["a"] },
          from: [
            {
              schema: null,
              table: "y",
              alias: null,
              join: { kind: "comma" },
              source: { kind: "table", schema: null, table: "y" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
        };
        return {
          kind: "select",
          columns: { kind: "named", names: ["a"] },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
              source: { kind: "table", schema: null, table: "x" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [{ operator: "union-all", statement: stub_y }],
        } satisfies SqlParseResult;
      }
      if (
        sql === "SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM x"
      ) {
        return {
          kind: "select",
          columns: {
            kind: "expressions",
            items: [
              {
                kind: "expression",
                expression: {
                  kind: "window-function",
                  name: "row_number",
                  arguments: [],
                  over: {
                    partition_by: [{ table: null, column: "a" }],
                    order_by: [
                      {
                        column: { table: null, column: "b" },
                        direction: "asc",
                        nulls: "unspecified",
                      },
                    ],
                    frame: null,
                  },
                },
              },
            ],
          },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
              source: { kind: "table", schema: null, table: "x" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n' END FROM x") {
        return {
          kind: "select",
          columns: {
            kind: "expressions",
            items: [
              {
                kind: "expression",
                expression: {
                  kind: "case",
                  operand: null,
                  when_clauses: [
                    {
                      condition: {
                        kind: "comparison",
                        left: { table: "x", column: "a" },
                        op: "gt",
                        value: {
                          kind: "literal",
                          value: { kind: "integer", value: 0 },
                        },
                      },
                      result: {
                        kind: "literal",
                        value: {
                          kind: "literal",
                          value: { kind: "string", value: "p" },
                        },
                      },
                    },
                  ],
                  else_clause: {
                    kind: "literal",
                    value: {
                      kind: "literal",
                      value: { kind: "string", value: "n" },
                    },
                  },
                },
              },
            ],
          },
          from: [
            {
              schema: null,
              table: "x",
              alias: null,
              join: { kind: "comma" },
              source: { kind: "table", schema: null, table: "x" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
        } satisfies SqlParseResult;
      }
      if (sql === "DELETE FROM x WHERE x.id IN (1, 2, 3)") {
        return {
          kind: "delete",
          table: "x",
          using: [],
          where_clause: {
            kind: "in-list",
            column: { table: "x", column: "id" },
            values: [
              { kind: "literal", value: { kind: "integer", value: 1 } },
              { kind: "literal", value: { kind: "integer", value: 2 } },
              { kind: "literal", value: { kind: "integer", value: 3 } },
            ],
          },
          returning: [],
        } satisfies SqlParseResult;
      }
      // ── sprint-395 misc grammar stubs ─────────────────────────────
      if (sql === "GRANT SELECT ON users TO alice") {
        return {
          kind: "grant",
          privileges: [{ kind: "select", columns: [] }],
          object: {
            kind: "table",
            tables: [{ schema: null, table: "users" }],
          },
          grantees: [{ kind: "role", name: "alice" }],
          with_grant_option: false,
        } satisfies SqlParseResult;
      }
      if (sql === "REVOKE SELECT ON users FROM alice CASCADE") {
        return {
          kind: "revoke",
          privileges: [{ kind: "select", columns: [] }],
          object: {
            kind: "table",
            tables: [{ schema: null, table: "users" }],
          },
          revokees: [{ kind: "role", name: "alice" }],
          grant_option_for: false,
          cascade: "cascade",
        } satisfies SqlParseResult;
      }
      if (sql === "EXPLAIN ANALYZE SELECT * FROM users") {
        const inner: SqlParseResult = {
          kind: "select",
          columns: { kind: "star" },
          from: [
            {
              schema: null,
              table: "users",
              alias: null,
              join: { kind: "comma" },
              source: { kind: "table", schema: null, table: "users" },
            },
          ],
          where: null,
          group_by: [],
          having: null,
          order_by: [],
          limit: null,
          set_operation: [],
        };
        return {
          kind: "explain",
          analyze: true,
          verbose: false,
          options: [],
          inner_statement: inner,
        } satisfies SqlParseResult;
      }
      if (sql === "SHOW search_path") {
        return {
          kind: "show",
          target: { kind: "variable", name: "search_path" },
        } satisfies SqlParseResult;
      }
      if (sql === "SET timezone = 'UTC'") {
        return {
          kind: "set-stmt",
          scope: "default",
          name: "timezone",
          value: {
            kind: "literal",
            value: { kind: "string", value: "UTC" },
          },
        } satisfies SqlParseResult;
      }
      if (sql === "COPY users FROM '/tmp/users.csv'") {
        return {
          kind: "copy",
          direction: "from",
          target: {
            kind: "table",
            table: { schema: null, table: "users" },
            columns: [],
          },
          source: { kind: "file", path: "/tmp/users.csv" },
          options: [],
        } satisfies SqlParseResult;
      }
      if (sql === "COMMENT ON TABLE users IS 'all'") {
        return {
          kind: "comment",
          target: { kind: "table", name: "users" },
          text: { kind: "string", value: "all" },
        } satisfies SqlParseResult;
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

  // ── sprint-393b SELECT widening 2 facade tests (AC-393b-F) ─────────

  it("[AC-393b-F01] parses `WITH t AS (SELECT 1) SELECT * FROM t` into a `with` top-level", async () => {
    const result = await parseSql("WITH t AS (SELECT 1) SELECT * FROM t");
    expect(result.kind).toBe("with");
    if (result.kind !== "with") return;
    expect(result.recursive).toBe(false);
    expect(result.ctes).toHaveLength(1);
    expect(result.ctes[0]?.name).toBe("t");
    expect(result.inner_statement.kind).toBe("select");
  });

  it("[AC-393b-F02] parses UNION ALL into a `set_operation` chain entry", async () => {
    const result = await parseSql("SELECT a FROM x UNION ALL SELECT a FROM y");
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.set_operation).toHaveLength(1);
    expect(result.set_operation[0]?.operator).toBe("union-all");
  });

  it("[AC-393b-F03] parses a window function into a `window-function` expression item", async () => {
    const result = await parseSql(
      "SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM x",
    );
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.columns.kind).toBe("expressions");
    if (result.columns.kind !== "expressions") return;
    const item = result.columns.items[0];
    expect(item).toBeDefined();
    if (!item || item.kind !== "expression") return;
    expect(item.expression.kind).toBe("window-function");
    if (item.expression.kind !== "window-function") return;
    expect(item.expression.over.partition_by).toHaveLength(1);
    expect(item.expression.over.order_by).toHaveLength(1);
  });

  it("[AC-393b-F04] parses CASE in SELECT list into a `case` expression item", async () => {
    const result = await parseSql(
      "SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n' END FROM x",
    );
    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.columns.kind).toBe("expressions");
    if (result.columns.kind !== "expressions") return;
    const item = result.columns.items[0];
    if (!item || item.kind !== "expression") return;
    expect(item.expression.kind).toBe("case");
  });

  it("[AC-393b-F05] parses DELETE with IN-list — the sprint-392 deferral is lifted", async () => {
    const result = await parseSql("DELETE FROM x WHERE x.id IN (1, 2, 3)");
    expect(result.kind).toBe("delete");
    if (result.kind !== "delete") return;
    expect(result.where_clause).not.toBeNull();
    if (result.where_clause === null) return;
    expect(result.where_clause.kind).toBe("in-list");
  });

  it("[AC-393b-F06] parseSqlPreloaded returns the WITH shape synchronously after preload", async () => {
    await preloadSqlWasm();
    const r = parseSqlPreloaded("WITH t AS (SELECT 1) SELECT * FROM t");
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.kind).toBe("with");
  });

  it("[AC-393b-F07] runtime guard accepts every sprint-393b widened shape (WITH / UNION / window / CASE / IN-list)", async () => {
    const w = await parseSql("WITH t AS (SELECT 1) SELECT * FROM t");
    expect(w.kind).toBe("with");
    const u = await parseSql("SELECT a FROM x UNION ALL SELECT a FROM y");
    expect(u.kind).toBe("select");
    const win = await parseSql(
      "SELECT row_number() OVER (PARTITION BY a ORDER BY b) FROM x",
    );
    expect(win.kind).toBe("select");
    const c = await parseSql(
      "SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n' END FROM x",
    );
    expect(c.kind).toBe("select");
    const i = await parseSql("DELETE FROM x WHERE x.id IN (1, 2, 3)");
    expect(i.kind).toBe("delete");
  });

  // ── sprint-394 DDL additive facade tests (AC-394-F) ───────────────

  it("[AC-394-F01] parses `CREATE TABLE users (id INTEGER, name TEXT)` into a kind:'create-table'", async () => {
    const result = await parseSql("CREATE TABLE users (id INTEGER, name TEXT)");
    expect(result.kind).toBe("create-table");
    if (result.kind !== "create-table") return;
    expect(result.table.table).toBe("users");
    expect(result.if_not_exists).toBe(false);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]?.name).toBe("id");
    expect(result.columns[0]?.data_type.kind).toBe("integer");
    expect(result.table_constraints).toEqual([]);
  });

  it("[AC-394-F02] parses `CREATE UNIQUE INDEX idx ON users (email)` into a kind:'create-index' with unique=true", async () => {
    const result = await parseSql("CREATE UNIQUE INDEX idx ON users (email)");
    expect(result.kind).toBe("create-index");
    if (result.kind !== "create-index") return;
    expect(result.unique).toBe(true);
    expect(result.name).toBe("idx");
    expect(result.columns).toEqual(["email"]);
  });

  it("[AC-394-F03] parses `CREATE OR REPLACE VIEW v AS SELECT 1` with or_replace=true", async () => {
    const result = await parseSql("CREATE OR REPLACE VIEW v AS SELECT 1");
    expect(result.kind).toBe("create-view");
    if (result.kind !== "create-view") return;
    expect(result.or_replace).toBe(true);
    expect(result.name.table).toBe("v");
    expect(result.body.kind).toBe("select");
  });

  it("[AC-394-F04] parses `ALTER TABLE users ADD COLUMN email TEXT` with action.kind='add-column'", async () => {
    const result = await parseSql("ALTER TABLE users ADD COLUMN email TEXT");
    expect(result.kind).toBe("alter-table");
    if (result.kind !== "alter-table") return;
    expect(result.action.kind).toBe("add-column");
    if (result.action.kind !== "add-column") return;
    expect(result.action.if_not_exists).toBe(false);
    expect(result.action.column.name).toBe("email");
    expect(result.action.column.data_type.kind).toBe("text");
  });

  it("[AC-394-F05] parses `ALTER TABLE users RENAME TO members` with action.kind='rename-table'", async () => {
    const result = await parseSql("ALTER TABLE users RENAME TO members");
    expect(result.kind).toBe("alter-table");
    if (result.kind !== "alter-table") return;
    expect(result.action.kind).toBe("rename-table");
    if (result.action.kind !== "rename-table") return;
    expect(result.action.new_name).toBe("members");
  });

  it("[AC-394-F06] parseSqlPreloaded returns the new top-level shapes synchronously after preload", async () => {
    await preloadSqlWasm();
    const create = parseSqlPreloaded(
      "CREATE TABLE users (id INTEGER, name TEXT)",
    );
    expect(create).not.toBeNull();
    if (create === null) return;
    expect(create.kind).toBe("create-table");

    const index = parseSqlPreloaded("CREATE UNIQUE INDEX idx ON users (email)");
    expect(index).not.toBeNull();
    if (index === null) return;
    expect(index.kind).toBe("create-index");

    const view = parseSqlPreloaded("CREATE OR REPLACE VIEW v AS SELECT 1");
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.kind).toBe("create-view");

    // parseSqlPreloaded null contract: untouched module returns null.
    __resetSqlWasmModuleForTests();
    expect(parseSqlPreloaded("CREATE TABLE foo (id INTEGER)")).toBeNull();
    // re-prime for any later tests in this file.
    await preloadSqlWasm();
  });

  it("[AC-394-F07] runtime guard accepts every sprint-394 widened shape (CREATE TABLE / INDEX / VIEW / ALTER ADD / RENAME)", async () => {
    // All five statements should round-trip through `parseSql` without
    // the runtime guard substituting the synthetic `lex-error`.
    const t = await parseSql("CREATE TABLE users (id INTEGER, name TEXT)");
    expect(t.kind).toBe("create-table");
    const i = await parseSql("CREATE UNIQUE INDEX idx ON users (email)");
    expect(i.kind).toBe("create-index");
    const v = await parseSql("CREATE OR REPLACE VIEW v AS SELECT 1");
    expect(v.kind).toBe("create-view");
    const ac = await parseSql("ALTER TABLE users ADD COLUMN email TEXT");
    expect(ac.kind).toBe("alter-table");
    const rn = await parseSql("ALTER TABLE users RENAME TO members");
    expect(rn.kind).toBe("alter-table");
  });

  // ── sprint-395 misc facade tests (AC-395-F) ──────────────────────

  it("[AC-395-F01] parses `GRANT SELECT ON users TO alice` into a kind:'grant' variant", async () => {
    const result = await parseSql("GRANT SELECT ON users TO alice");
    expect(result.kind).toBe("grant");
    if (result.kind !== "grant") return;
    expect(result.privileges).toHaveLength(1);
    expect(result.privileges[0]?.kind).toBe("select");
    expect(result.object.kind).toBe("table");
    expect(result.grantees).toHaveLength(1);
    expect(result.with_grant_option).toBe(false);
  });

  it("[AC-395-F02] parses `REVOKE SELECT ON users FROM alice CASCADE` with cascade", async () => {
    const result = await parseSql("REVOKE SELECT ON users FROM alice CASCADE");
    expect(result.kind).toBe("revoke");
    if (result.kind !== "revoke") return;
    expect(result.cascade).toBe("cascade");
    expect(result.grant_option_for).toBe(false);
  });

  it("[AC-395-F03] parses `EXPLAIN ANALYZE SELECT * FROM users` with analyze=true and inner SELECT", async () => {
    const result = await parseSql("EXPLAIN ANALYZE SELECT * FROM users");
    expect(result.kind).toBe("explain");
    if (result.kind !== "explain") return;
    expect(result.analyze).toBe(true);
    expect(result.verbose).toBe(false);
    expect(result.inner_statement.kind).toBe("select");
  });

  it("[AC-395-F04] parses `SHOW search_path` into a kind:'show' variant", async () => {
    const result = await parseSql("SHOW search_path");
    expect(result.kind).toBe("show");
    if (result.kind !== "show") return;
    expect(result.target.kind).toBe("variable");
    if (result.target.kind !== "variable") return;
    expect(result.target.name).toBe("search_path");
  });

  it("[AC-395-F05] parses `SET timezone = 'UTC'` into a kind:'set-stmt' variant", async () => {
    const result = await parseSql("SET timezone = 'UTC'");
    expect(result.kind).toBe("set-stmt");
    if (result.kind !== "set-stmt") return;
    expect(result.scope).toBe("default");
    expect(result.name).toBe("timezone");
    expect(result.value.kind).toBe("literal");
  });

  it("[AC-395-F06] parses `COPY users FROM '/tmp/users.csv'` with direction 'from'", async () => {
    const result = await parseSql("COPY users FROM '/tmp/users.csv'");
    expect(result.kind).toBe("copy");
    if (result.kind !== "copy") return;
    expect(result.direction).toBe("from");
    expect(result.source.kind).toBe("file");
    if (result.source.kind !== "file") return;
    expect(result.source.path).toBe("/tmp/users.csv");
  });

  it("[AC-395-F07] parses `COMMENT ON TABLE users IS 'all'` into a kind:'comment' variant", async () => {
    const result = await parseSql("COMMENT ON TABLE users IS 'all'");
    expect(result.kind).toBe("comment");
    if (result.kind !== "comment") return;
    expect(result.target.kind).toBe("table");
    if (result.target.kind !== "table") return;
    expect(result.target.name).toBe("users");
    expect(result.text.kind).toBe("string");
  });

  it("[AC-395-F08] parseSqlPreloaded returns each new sprint-395 top-level shape synchronously after preload", async () => {
    await preloadSqlWasm();
    const grant = parseSqlPreloaded("GRANT SELECT ON users TO alice");
    expect(grant).not.toBeNull();
    expect(grant?.kind).toBe("grant");

    const explain = parseSqlPreloaded("EXPLAIN ANALYZE SELECT * FROM users");
    expect(explain?.kind).toBe("explain");

    const show = parseSqlPreloaded("SHOW search_path");
    expect(show?.kind).toBe("show");

    const setStmt = parseSqlPreloaded("SET timezone = 'UTC'");
    expect(setStmt?.kind).toBe("set-stmt");

    const copy = parseSqlPreloaded("COPY users FROM '/tmp/users.csv'");
    expect(copy?.kind).toBe("copy");

    const comment = parseSqlPreloaded("COMMENT ON TABLE users IS 'all'");
    expect(comment?.kind).toBe("comment");

    // Null contract — untouched module returns null.
    __resetSqlWasmModuleForTests();
    expect(parseSqlPreloaded("GRANT SELECT ON users TO alice")).toBeNull();
    // Re-prime for any later tests.
    await preloadSqlWasm();
  });

  it("[AC-395-F09] runtime guard accepts every sprint-395 widened shape (GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT)", async () => {
    // Every new statement should round-trip through `parseSql` without
    // the runtime guard substituting the synthetic `lex-error`.
    const g = await parseSql("GRANT SELECT ON users TO alice");
    expect(g.kind).toBe("grant");
    const r = await parseSql("REVOKE SELECT ON users FROM alice CASCADE");
    expect(r.kind).toBe("revoke");
    const e = await parseSql("EXPLAIN ANALYZE SELECT * FROM users");
    expect(e.kind).toBe("explain");
    const h = await parseSql("SHOW search_path");
    expect(h.kind).toBe("show");
    const s = await parseSql("SET timezone = 'UTC'");
    expect(s.kind).toBe("set-stmt");
    const c = await parseSql("COPY users FROM '/tmp/users.csv'");
    expect(c.kind).toBe("copy");
    const m = await parseSql("COMMENT ON TABLE users IS 'all'");
    expect(m.kind).toBe("comment");
  });
});
