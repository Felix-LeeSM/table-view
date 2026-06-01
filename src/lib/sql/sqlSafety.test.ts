// AC-185-01 — sqlSafety analyzer 단위 테스트. 12 cases per Sprint 185 contract.
// date 2026-05-01.
//
// Sprint 254 (2026-05-09) — `Severity` union 을 `"safe" | "danger"` 에서
// 3-tier `"info" | "warn" | "danger"` 로 split. 기존 `"safe"` 어서션을 INFO
// (read / metadata) 또는 WARN (write surface) 로 명시적으로 매핑한다. ADR
// 0023 grill Q2-(a) — write 표면 (INSERT / UPDATE WHERE / DELETE WHERE / CREATE
// / ALTER additive) 가 명시적으로 WARN 임을 union 으로 표현. DML CTE
// 인식도 함께 추가 — `WITH x AS (UPDATE …) SELECT *` 는 INFO 가 아니라
// wrapped statement 의 severity 와 정합.
//
// Sprint 391 (2026-05-17) — DDL destructive (DROP / TRUNCATE / ALTER … DROP)
// 분류 callsite 가 정규식 → AST 기반(`parseSqlPreloaded`) 으로 부분 이행.
// 본 test suite 의 모든 기존 case 는 *preload 없이* 정규식 fallback 으로
// 동일 결과를 반환해야 하고, 신규 AC-391-X case 는 *preload 후* AST
// 경로로 동일 분류를 반환해야 한다. 둘 다 PASS = `analyzeStatement` 의
// 반환 shape 가 변경 없음을 입증.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";
import { __resetSqlWasmModuleForTests, preloadSqlWasm } from "./sqlAst";

// Mock the WASM module surface the same way sqlAst.test.ts does — both
// suites need the synchronous `parseSqlPreloaded` path to resolve to a
// real Rust AST shape so sqlSafety's AST callsite can be exercised in
// jsdom (where `.wasm` loading would otherwise fail).
import { vi } from "vitest";

vi.mock("./wasm/sql_parser_core.js", () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    parse_sql: vi.fn((sql: string) => {
      // Inline mini-parser: reproduce the Rust ParseResult shape for
      // every DDL destructive variant that the AC-391-X suite asserts.
      // Anything outside this list returns `null` so `parseSqlPreloaded`
      // falls back to its caller's regex path.
      const trimmed = sql.trim().replace(/;$/, "");
      const upper = trimmed.toUpperCase();

      // The regex below uses anchored groups; if `.match` succeeds the
      // capture groups we reference are guaranteed non-undefined. The
      // helper centralises the `string | undefined` → `string` narrowing
      // with a single non-null assertion site (vs. one per group).
      const g = (m: RegExpMatchArray, i: number): string => {
        const v = m[i];
        if (v === undefined) {
          throw new Error(`sqlSafety test mock: group ${i} missing`);
        }
        return v;
      };
      // DROP <obj> [IF EXISTS] <name> [CASCADE|RESTRICT]
      const dropMatch = trimmed.match(
        /^DROP\s+(TABLE|DATABASE|INDEX|VIEW|SCHEMA|SEQUENCE|TYPE)(\s+IF\s+EXISTS)?\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (dropMatch) {
        return {
          kind: "drop",
          object_type: g(dropMatch, 1).toLowerCase(),
          name: g(dropMatch, 3),
          if_exists: Boolean(dropMatch[2]),
          cascade: dropMatch[5]
            ? (dropMatch[5].toLowerCase() as "cascade" | "restrict")
            : null,
        };
      }
      // TRUNCATE [TABLE] <name> [(RESTART|CONTINUE) IDENTITY] [CASCADE|RESTRICT]
      const truncateMatch = trimmed.match(
        /^TRUNCATE(\s+TABLE)?\s+(\S+?)(\s+(RESTART|CONTINUE)\s+IDENTITY)?(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (truncateMatch) {
        const ri = truncateMatch[4]
          ? truncateMatch[4].toUpperCase() === "RESTART"
          : null;
        return {
          kind: "truncate",
          table: g(truncateMatch, 2),
          restart_identity: ri,
          cascade: truncateMatch[6]
            ? (truncateMatch[6].toLowerCase() as "cascade" | "restrict")
            : null,
        };
      }
      // ALTER TABLE <name> DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]
      const alterColMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+COLUMN(\s+IF\s+EXISTS)?\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (alterColMatch) {
        return {
          kind: "alter-table",
          table: g(alterColMatch, 1),
          action: {
            kind: "drop-column",
            column: g(alterColMatch, 3),
            if_exists: Boolean(alterColMatch[2]),
            cascade: alterColMatch[5]
              ? (alterColMatch[5].toLowerCase() as "cascade" | "restrict")
              : null,
          },
        };
      }
      // ALTER TABLE <name> DROP CONSTRAINT <name> [CASCADE|RESTRICT]
      const alterCstMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+CONSTRAINT\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (alterCstMatch) {
        return {
          kind: "alter-table",
          table: g(alterCstMatch, 1),
          action: {
            kind: "drop-constraint",
            constraint: g(alterCstMatch, 2),
            cascade: alterCstMatch[4]
              ? (alterCstMatch[4].toLowerCase() as "cascade" | "restrict")
              : null,
          },
        };
      }
      // ALTER TABLE <name> DROP INDEX <name>
      const alterIdxMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+INDEX\s+(\S+?)$/i,
      );
      if (alterIdxMatch) {
        return {
          kind: "alter-table",
          table: g(alterIdxMatch, 1),
          action: { kind: "drop-index", index: g(alterIdxMatch, 2) },
        };
      }
      // ── sprint-394 DDL additive: ALTER TABLE … ADD / RENAME ──────
      // The mock only checks the prefix; full AST shape stays minimal —
      // sqlSafety's mapper inspects `action.kind` only.
      const alterAddColMatch = trimmed.match(
        /^ALTER\s+TABLE\s+\S+?\s+ADD\s+COLUMN\b/i,
      );
      if (alterAddColMatch) {
        return {
          kind: "alter-table",
          table: "stub",
          action: {
            kind: "add-column",
            column: {
              name: "stub",
              data_type: { kind: "text" },
              constraints: [],
              source_index: 0,
            },
            if_not_exists: false,
          },
        };
      }
      const alterAddCstMatch = trimmed.match(
        /^ALTER\s+TABLE\s+\S+?\s+ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i,
      );
      if (alterAddCstMatch) {
        return {
          kind: "alter-table",
          table: "stub",
          action: {
            kind: "add-constraint",
            constraint: {
              name: null,
              body: { kind: "primary-key", columns: ["stub"] },
            },
          },
        };
      }
      const alterRenameColMatch = trimmed.match(
        /^ALTER\s+TABLE\s+\S+?\s+RENAME\s+COLUMN\b/i,
      );
      if (alterRenameColMatch) {
        return {
          kind: "alter-table",
          table: "stub",
          action: { kind: "rename-column", old_name: "a", new_name: "b" },
        };
      }
      const alterRenameMatch = trimmed.match(
        /^ALTER\s+TABLE\s+\S+?\s+RENAME\s+TO\b/i,
      );
      if (alterRenameMatch) {
        return {
          kind: "alter-table",
          table: "stub",
          action: { kind: "rename-table", new_name: "stub" },
        };
      }
      // ── sprint-394 DDL additive: CREATE TABLE / INDEX / VIEW ─────
      if (/^CREATE\s+TABLE\b/i.test(trimmed)) {
        return {
          kind: "create-table",
          table: { schema: null, table: "stub" },
          if_not_exists: false,
          columns: [
            {
              name: "id",
              data_type: { kind: "integer" },
              constraints: [],
              source_index: 0,
            },
          ],
          table_constraints: [],
        };
      }
      if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(trimmed)) {
        const unique = /^CREATE\s+UNIQUE\s+INDEX\b/i.test(trimmed);
        return {
          kind: "create-index",
          unique,
          if_not_exists: false,
          name: "stub",
          table: { schema: null, table: "stub" },
          columns: ["stub"],
        };
      }
      if (/^CREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i.test(trimmed)) {
        const or_replace = /^CREATE\s+OR\s+REPLACE\s+VIEW\b/i.test(trimmed);
        return {
          kind: "create-view",
          or_replace,
          name: { schema: null, table: "stub" },
          body: {
            kind: "select",
            columns: { kind: "star" },
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
        };
      }
      // ── sprint-392 DML write triad ─────────────────────────────
      // INSERT — match very loosely; sqlSafety only checks `kind` so
      // the row payload can be a stub.
      if (/^INSERT\s+INTO\b/i.test(trimmed)) {
        return {
          kind: "insert",
          table: "stub",
          columns: [],
          source: { kind: "values", rows: [[]] },
          on_conflict: null,
          on_duplicate_key_update: null,
          returning: [],
        };
      }
      if (/^CALL\b/i.test(trimmed)) {
        return {
          kind: "call",
          procedure: { schema: null, name: "stub" },
          arguments: [],
        };
      }
      // UPDATE — detect WHERE presence so sqlSafety can branch on
      // where_clause === null. Use a coarse `\bWHERE\b` test against the
      // upper-cased string.
      if (/^UPDATE\b/i.test(trimmed)) {
        const hasWhere = /\bWHERE\b/i.test(trimmed);
        return {
          kind: "update",
          table: "stub",
          assignments: [],
          from: [],
          // Sprint-393b — DML WHERE uses unified `SqlSelectExpr` shape
          // (left is a `SqlColumnRef`, not a bare `string`).
          where_clause: hasWhere
            ? {
                kind: "comparison",
                left: { table: null, column: "id" },
                op: "eq",
                value: {
                  kind: "literal",
                  value: { kind: "integer", value: 1 },
                },
              }
            : null,
          returning: [],
        };
      }
      if (/^DELETE\s+FROM\b/i.test(trimmed)) {
        const hasWhere = /\bWHERE\b/i.test(trimmed);
        return {
          kind: "delete",
          table: "stub",
          using: [],
          where_clause: hasWhere
            ? {
                kind: "comparison",
                left: { table: null, column: "id" },
                op: "eq",
                value: {
                  kind: "literal",
                  value: { kind: "integer", value: 1 },
                },
              }
            : null,
          returning: [],
        };
      }
      if (/^MERGE\b/i.test(trimmed) && !/\bTHEN\s+DELETE\b/i.test(trimmed)) {
        return {
          kind: "merge",
          target: { schema: null, table: "users" },
          target_alias: null,
          source: { schema: null, table: "incoming" },
          source_alias: null,
          on: {
            kind: "column-comparison",
            left: { table: "users", column: "id" },
            op: "eq",
            right: { table: "incoming", column: "id" },
          },
          clauses: [
            {
              not_matched: false,
              action: "update",
              assignments: [
                [
                  "name",
                  {
                    kind: "column-ref-expr",
                    column: { table: "incoming", column: "name" },
                  },
                ],
              ],
              columns: [],
              values: [],
            },
          ],
        };
      }
      // SELECT — sprint-393a routes SELECT through the AST. Return the
      // widened SELECT shape so the runtime guard accepts the value and
      // `statementAnalysisFromAst` returns `kind: "select"` / `info`.
      if (/^SELECT\b/.test(upper)) {
        if (/^SELECT\s+1$/i.test(trimmed)) {
          return {
            kind: "select",
            columns: {
              kind: "expressions",
              items: [
                {
                  kind: "expression",
                  expression: {
                    kind: "literal",
                    value: {
                      kind: "literal",
                      value: { kind: "integer", value: 1 },
                    },
                  },
                },
              ],
            },
            from: [],
            where: null,
            group_by: [],
            having: null,
            order_by: [],
            limit: null,
            set_operation: [],
          };
        }
        if (/^SELECT\s+COUNT\(\*\)\s+FROM\b/i.test(trimmed)) {
          return {
            kind: "select",
            columns: {
              kind: "expressions",
              items: [
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
          };
        }
        return {
          kind: "select",
          columns: { kind: "star" },
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
        };
      }
      // Sprint-393b — WITH CTE wrap. The mock detects the inner verb
      // (SELECT / INSERT / UPDATE / DELETE) by peeking past the CTE list
      // and produces a `with` parse result with the inner statement
      // shaped to match the inner verb. The classifier under test is
      // `statementAnalysisFromAst`'s `with` recursion.
      if (/^WITH\b/i.test(trimmed)) {
        // Strip the WITH prefix and re-route the inner statement
        // through this same mock so we get a real inner-statement shape.
        // Match: WITH [RECURSIVE]? <ident> AS (...) <inner-tokens>
        const m = trimmed.match(
          /^WITH\s+(?:RECURSIVE\s+)?[A-Z_][A-Z0-9_]*\s*(?:\([^)]*\)\s*)?AS\s*\([^)]*\)\s*(.+)$/i,
        );
        if (m && m[1]) {
          const innerSql = m[1].trim();
          const innerUpper = innerSql.toUpperCase();
          const innerResult = (() => {
            if (innerUpper.startsWith("INSERT")) {
              return {
                kind: "insert",
                table: "stub",
                columns: [],
                source: { kind: "values", rows: [[]] },
                on_conflict: null,
                on_duplicate_key_update: null,
                returning: [],
              };
            }
            if (innerUpper.startsWith("UPDATE")) {
              const hasWhere = /\bWHERE\b/i.test(innerSql);
              return {
                kind: "update",
                table: "stub",
                assignments: [],
                from: [],
                where_clause: hasWhere
                  ? {
                      kind: "comparison",
                      left: { table: null, column: "id" },
                      op: "eq",
                      value: {
                        kind: "literal",
                        value: { kind: "integer", value: 1 },
                      },
                    }
                  : null,
                returning: [],
              };
            }
            if (innerUpper.startsWith("DELETE")) {
              const hasWhere = /\bWHERE\b/i.test(innerSql);
              return {
                kind: "delete",
                table: "stub",
                using: [],
                where_clause: hasWhere
                  ? {
                      kind: "comparison",
                      left: { table: null, column: "id" },
                      op: "eq",
                      value: {
                        kind: "literal",
                        value: { kind: "integer", value: 1 },
                      },
                    }
                  : null,
                returning: [],
              };
            }
            return {
              kind: "select",
              columns: { kind: "star" },
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
            };
          })();
          return {
            kind: "with",
            recursive: false,
            ctes: [],
            inner_statement: innerResult,
          };
        }
      }
      // ── sprint-395 misc grammar mocks ─────────────────────────────
      // GRANT — match very loosely; sqlSafety only checks `kind` so the
      // privileges/object/grantees shapes can be stubs.
      if (/^GRANT\b/i.test(trimmed)) {
        return {
          kind: "grant",
          privileges: [{ kind: "select", columns: [] }],
          object: { kind: "table", tables: [{ schema: null, table: "stub" }] },
          grantees: [{ kind: "role", name: "stub" }],
          with_grant_option: false,
        };
      }
      if (/^REVOKE\b/i.test(trimmed)) {
        return {
          kind: "revoke",
          privileges: [{ kind: "select", columns: [] }],
          object: { kind: "table", tables: [{ schema: null, table: "stub" }] },
          revokees: [{ kind: "role", name: "stub" }],
          grant_option_for: false,
          cascade: null,
        };
      }
      // SHOW — sqlSafety only checks `kind`; target shape is a stub.
      if (/^SHOW\b/i.test(trimmed)) {
        return {
          kind: "show",
          target: { kind: "variable", name: "stub" },
        };
      }
      // SET — sqlSafety only checks `kind`. Note `Token::Set` is already
      // a keyword (sprint-392 UPDATE SET) — top-level SET still matches.
      if (/^SET\b/i.test(trimmed)) {
        return {
          kind: "set-stmt",
          scope: "default",
          name: "stub",
          value: {
            kind: "literal",
            value: { kind: "string", value: "stub" },
          },
        };
      }
      // COPY — direction-aware mock so X08/X09 distinguish FROM vs TO.
      if (/^COPY\b/i.test(trimmed)) {
        const isTo = /\bTO\b/i.test(trimmed);
        return {
          kind: "copy",
          direction: isTo ? "to" : "from",
          target: {
            kind: "table",
            table: { schema: null, table: "stub" },
            columns: [],
          },
          source: isTo ? { kind: "stdout" } : { kind: "stdin" },
          options: [],
        };
      }
      // COMMENT — sqlSafety only checks `kind`.
      if (/^COMMENT\b/i.test(trimmed)) {
        return {
          kind: "comment",
          target: { kind: "table", name: "stub" },
          text: { kind: "string", value: "stub" },
        };
      }
      // EXPLAIN — wrap with the appropriate inner shape so the
      // EXPLAIN-inheritance branch (D1) is exercised. The mock peeks at
      // the inner verb to construct the inner_statement shape.
      if (/^EXPLAIN\b/i.test(trimmed)) {
        // Strip the EXPLAIN [ANALYZE] [VERBOSE] [(opts)] prefix.
        const innerSqlMatch = trimmed.match(
          /^EXPLAIN(?:\s+ANALYZE)?(?:\s+VERBOSE)?(?:\s*\([^)]*\))?\s+(.+)$/i,
        );
        if (innerSqlMatch && innerSqlMatch[1]) {
          const innerSql = innerSqlMatch[1].trim();
          const innerUpper = innerSql.toUpperCase();
          // Reject the BEGIN smoke-test inner verb so the regex fallback
          // exercises (AC-395-X11). Any other inner is fed back through
          // the mock — recursion via a wrapping function is awkward in
          // a vi.mock, so we inline the cases we care about.
          if (innerUpper.startsWith("BEGIN")) {
            return {
              kind: "error",
              error_kind: "unsupported-statement",
              message: "sprint-395 mock: EXPLAIN BEGIN fallthrough",
              at: 0,
            };
          }
          // Build inner statement shape based on first verb.
          let inner: unknown;
          if (innerUpper.startsWith("INSERT")) {
            inner = {
              kind: "insert",
              table: "stub",
              columns: [],
              source: { kind: "values", rows: [[]] },
              on_conflict: null,
              on_duplicate_key_update: null,
              returning: [],
            };
          } else if (innerUpper.startsWith("UPDATE")) {
            const hasWhere = /\bWHERE\b/i.test(innerSql);
            inner = {
              kind: "update",
              table: "stub",
              assignments: [],
              from: [],
              where_clause: hasWhere
                ? {
                    kind: "comparison",
                    left: { table: null, column: "id" },
                    op: "eq",
                    value: {
                      kind: "literal",
                      value: { kind: "integer", value: 1 },
                    },
                  }
                : null,
              returning: [],
            };
          } else if (innerUpper.startsWith("DELETE")) {
            const hasWhere = /\bWHERE\b/i.test(innerSql);
            inner = {
              kind: "delete",
              table: "stub",
              using: [],
              where_clause: hasWhere
                ? {
                    kind: "comparison",
                    left: { table: null, column: "id" },
                    op: "eq",
                    value: {
                      kind: "literal",
                      value: { kind: "integer", value: 1 },
                    },
                  }
                : null,
              returning: [],
            };
          } else if (innerUpper.startsWith("MERGE")) {
            inner = {
              kind: "merge",
              target: { schema: null, table: "users" },
              target_alias: null,
              source: { schema: null, table: "incoming" },
              source_alias: null,
              on: {
                kind: "column-comparison",
                left: { table: "users", column: "id" },
                op: "eq",
                right: { table: "incoming", column: "id" },
              },
              clauses: [
                {
                  not_matched: false,
                  action: "do-nothing",
                  assignments: [],
                  columns: [],
                  values: [],
                },
              ],
            };
          } else {
            // Default: SELECT.
            inner = {
              kind: "select",
              columns: { kind: "star" },
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
            };
          }
          return {
            kind: "explain",
            analyze: /\bANALYZE\b/i.test(trimmed),
            verbose: /\bVERBOSE\b/i.test(trimmed),
            options: [],
            inner_statement: inner,
          };
        }
      }
      // Anything else → error variant; sqlSafety's AST callsite then
      // falls through to its legacy regex matcher.
      return {
        kind: "error",
        error_kind: "unsupported-statement",
        message: "sprint-391 mock fallthrough",
        at: 0,
      };
    }),
  };
});

describe("sqlSafety.analyzeStatement", () => {
  it("[AC-185-01a] DELETE without WHERE → danger", () => {
    const a = analyzeStatement("DELETE FROM users");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-185-01b] DELETE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("DELETE FROM users WHERE id = 1");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01c] UPDATE without WHERE → danger", () => {
    const a = analyzeStatement("UPDATE users SET active = false");
    expect(a.kind).toBe("dml-update");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
  });

  it("[AC-185-01d] UPDATE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("UPDATE users SET active = false WHERE id = 1");
    expect(a.kind).toBe("dml-update");
    expect(a.severity).toBe("warn");
  });

  it("[AC-185-01e] DROP TABLE → danger", () => {
    const a = analyzeStatement("DROP TABLE users");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP TABLE"]);
  });

  it("[AC-185-01f] DROP DATABASE → danger", () => {
    const a = analyzeStatement("DROP DATABASE app");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP DATABASE"]);
  });

  it("[AC-185-01g] TRUNCATE → danger", () => {
    const a = analyzeStatement("TRUNCATE TABLE events");
    expect(a.kind).toBe("ddl-truncate");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["TRUNCATE"]);
  });

  it("[AC-185-01h] INSERT INTO → dml-insert / info (Sprint 403)", () => {
    const a = analyzeStatement("INSERT INTO users (id, name) VALUES (1, 'a')");
    expect(a.kind).toBe("dml-insert");
    expect(a.severity).toBe("info");
  });

  it("[AC-439-X01] CALL fallback → routine-call / warn", () => {
    const a = analyzeStatement("CALL refresh_user_stats()");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-448-X01] CALL user-variable fallback stays routine-call / warn", () => {
    const a = analyzeStatement("CALL refresh_user_stats(@user_id)");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01i] SELECT → info (Sprint 254: read tier)", () => {
    const a = analyzeStatement("SELECT * FROM users");
    expect(a.kind).toBe("select");
    expect(a.severity).toBe("info");
  });

  it("[AC-185-01j] case-insensitive (delete from t) → danger", () => {
    const a = analyzeStatement("delete from users");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");
  });

  it("[AC-185-01k] strips line comments before analysis", () => {
    const a = analyzeStatement(
      "-- this comment hides nothing\nDELETE FROM users -- inline\n",
    );
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");

    const b = analyzeStatement(
      "/* block comment */ DELETE FROM users WHERE id = 1",
    );
    expect(b.kind).toBe("dml-delete");
    // Sprint 254 — bounded DELETE WHERE is now WARN (was safe).
    expect(b.severity).toBe("warn");
  });

  it("[AC-185-01l] subquery WHERE counted as outer WHERE present (warn)", () => {
    const a = analyzeStatement(
      "DELETE FROM t WHERE id IN (SELECT id FROM u WHERE flag = 1)",
    );
    expect(a.kind).toBe("dml-delete");
    // Sprint 254 — bounded DELETE WHERE = WARN.
    expect(a.severity).toBe("warn");
  });

  it("empty SQL → other / info (graceful, Sprint 254)", () => {
    const a = analyzeStatement("");
    expect(a.kind).toBe("other");
    // Sprint 254 — empty / unknown statements default to INFO so the
    // SafeMode matrix never escalates an unrecognised input. WARN is
    // reserved for *known* write surfaces.
    expect(a.severity).toBe("info");
  });

  it("ALTER additive / CREATE → sprint-394 classifications (was ddl-other / warn before sprint-394)", () => {
    // Sprint-394 — ALTER ADD COLUMN is now `ddl-alter-add` / warn with
    // a pinned reason (D2). CREATE INDEX is `ddl-create` / info / no
    // reasons. The pre-sprint-394 baseline classified both as
    // `ddl-other` / warn / no reasons.
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN x int");
    expect(a.kind).toBe("ddl-alter-add");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    const b = analyzeStatement("CREATE INDEX idx_x ON users (x)");
    expect(b.kind).toBe("ddl-create");
    expect(b.severity).toBe("info");
    expect(b.reasons).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Sprint 187 — analyzer extension for structure-surface DDL.
  // -------------------------------------------------------------------------

  it("[AC-187-01a] DROP INDEX → danger / ddl-drop", () => {
    const a = analyzeStatement("DROP INDEX idx_users_email");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP INDEX"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-187-01b] DROP VIEW → danger / ddl-drop", () => {
    const a = analyzeStatement("DROP VIEW v_active_users");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP VIEW"]);
  });

  it("[AC-187-01c] ALTER TABLE … DROP COLUMN → danger / ddl-alter-drop", () => {
    const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
    expect(a.kind).toBe("ddl-alter-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["ALTER TABLE DROP COLUMN"]);
  });

  it("[AC-187-01d] ALTER TABLE … DROP CONSTRAINT → danger / ddl-alter-drop", () => {
    const a = analyzeStatement(
      "ALTER TABLE orders DROP CONSTRAINT fk_orders_user",
    );
    expect(a.kind).toBe("ddl-alter-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["ALTER TABLE DROP CONSTRAINT"]);
  });

  it("[AC-187-01e] ALTER TABLE … ADD COLUMN is ddl-alter-add / warn / pinned reason (Sprint 394)", () => {
    // Sprint 187: classified as `ddl-other` / warn / [].
    // Sprint 394 (D2): kind moves to `ddl-alter-add`, severity stays
    // `warn`, and the reasons list now carries the pinned D2 string.
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
    expect(a.kind).toBe("ddl-alter-add");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    expect(isDangerous(a)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sprint 254 (2026-05-09) — 3-tier classifier corpus. ADR 0023 grill Q2-(a)
  // "3-tier severity 채택" 의 정식 분류:
  //   - INFO: SELECT / WITH …SELECT (no DML CTE) / EXPLAIN / SHOW / DESCRIBE / DESC.
  //   - WARN: UPDATE WHERE / DELETE WHERE / ALTER additive.
  //   - STOP (danger): DROP / TRUNCATE / WHERE-less DELETE·UPDATE / ALTER DROP /
  //     GRANT / REVOKE.
  // DML CTE (`WITH x AS (UPDATE …) SELECT *`) 는 INFO 가 아니어야 한다 — wrapped
  // statement 의 first keyword (UPDATE/DELETE/INSERT) 에 따라 severity 결정.
  // -------------------------------------------------------------------------

  describe("Sprint 254 — 3-tier severity classifier", () => {
    // ── INFO tier ─────────────────────────────────────────────────────────
    it("[AC-254-01a] SELECT → info", () => {
      const a = analyzeStatement("SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01b] WITH … SELECT (no DML CTE) → info", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1 AS n) SELECT n FROM t");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01c] EXPLAIN → info", () => {
      const a = analyzeStatement("EXPLAIN SELECT * FROM users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01d] SHOW TABLES → config-read / info (sprint-395 update)", () => {
      // Pre-sprint-395: kind="info" (legacy regex bucket).
      // Sprint-395 (X06 / D4): SHOW classifies as `config-read` with
      // severity:"info" — separate metadata-read kind from EXPLAIN/DESC.
      // `isInfoStatement` continues to return true (severity-based).
      const a = analyzeStatement("SHOW TABLES");
      expect(a.kind).toBe("config-read");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01e] DESCRIBE → info", () => {
      const a = analyzeStatement("DESCRIBE users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01f] DESC users (MySQL short form) → info", () => {
      const a = analyzeStatement("DESC users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    // ── WARN tier ─────────────────────────────────────────────────────────
    it("[AC-403-01] INSERT INTO → dml-insert / info", () => {
      const a = analyzeStatement("INSERT INTO users (id) VALUES (1)");
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-02b] UPDATE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02c] DELETE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02d] CREATE TABLE → ddl-create / info (sprint-394 update)", () => {
      // Pre-sprint-394: classified as `ddl-other` / warn. Sprint-394
      // moves CREATE TABLE / INDEX / VIEW to `ddl-create` / info per
      // the contract — these are non-destructive constructions and do
      // not require a warn dialog.
      const a = analyzeStatement("CREATE TABLE foo (id int)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-02e] ALTER TABLE … ADD COLUMN (additive) → ddl-alter-add / warn (sprint-394 update)", () => {
      // Sprint-394 kind change — kept under the same `warn` tier (the
      // schema-changing nature of ADD COLUMN warrants the warn dialog).
      const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02f] CREATE INDEX → ddl-create / info (sprint-394 update)", () => {
      const a = analyzeStatement("CREATE INDEX idx_x ON users (x)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    // ── STOP tier (danger 보존) ───────────────────────────────────────────
    it("[AC-254-03a] DROP TABLE → danger", () => {
      const a = analyzeStatement("DROP TABLE users");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03b] TRUNCATE → danger", () => {
      const a = analyzeStatement("TRUNCATE TABLE events");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03c] DELETE without WHERE → danger", () => {
      const a = analyzeStatement("DELETE FROM users");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03d] UPDATE without WHERE → danger", () => {
      const a = analyzeStatement("UPDATE users SET active = 0");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03e] ALTER TABLE … DROP COLUMN → danger", () => {
      const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03f] GRANT → permission-change / warn (sprint-395 update)", () => {
      // Pre-sprint-395: ddl-other / danger.
      // Sprint-395 (X01 / D5): permission-change / warn / pinned reason.
      const a = analyzeStatement("GRANT SELECT ON users TO bob");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["GRANT — 권한 변경"]);
    });

    it("[AC-254-03g] REVOKE → permission-change / warn (sprint-395 update)", () => {
      // Pre-sprint-395: ddl-other / danger.
      // Sprint-395 (X02 / D5): permission-change / warn / pinned reason.
      const a = analyzeStatement("REVOKE SELECT ON users FROM bob");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["REVOKE — 권한 변경"]);
    });

    // ── DML CTE — `WITH x AS (UPDATE …) SELECT *` ─────────────────────────
    it("[AC-254-04a] WITH x AS (UPDATE …) SELECT * → warn (DML CTE wrapped)", () => {
      const a = analyzeStatement(
        "WITH x AS (UPDATE users SET active = false WHERE id = 1 RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-04b] WITH x AS (DELETE …) SELECT * → warn (DML CTE wrapped, bounded)", () => {
      const a = analyzeStatement(
        "WITH x AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-04c] WITH x AS (DELETE …) SELECT * — DELETE no WHERE → danger (DML CTE)", () => {
      const a = analyzeStatement(
        "WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("danger");
    });

    it("[AC-403-01b] WITH x AS (INSERT …) SELECT * → info (DML CTE wrapped)", () => {
      const a = analyzeStatement(
        "WITH x AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("info");
    });

    it("[AC-254-04e] WITH x AS (SELECT 1) SELECT * — pure read CTE → info (regression)", () => {
      const a = analyzeStatement("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
      expect(a.severity).toBe("info");
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 255 (2026-05-09) — `isInfoStatement` 휴리스틱은 raw editor 의 WARN
  // dialog mount 직전에 INFO (read-only / metadata) statement 을 식별해
  // dialog skip → 직접 IPC 로 우회하는 분기를 위해 신설. INFO corpus =
  // SELECT / WITH …SELECT / EXPLAIN / SHOW / DESCRIBE / DESC.
  //
  // Sprint 254 (2026-05-09) — 본문 단순화 (severity === "info" 직접 비교)
  // 후에도 매핑 동일 (kind="select" / kind="info" 모두 severity:"info").
  // -------------------------------------------------------------------------

  describe("isInfoStatement (Sprint 255)", () => {
    it("[AC-255-01a] SELECT → INFO", () => {
      expect(isInfoStatement(analyzeStatement("SELECT * FROM users"))).toBe(
        true,
      );
    });

    it("[AC-255-01b] WITH …SELECT (no DML CTE) → INFO", () => {
      expect(
        isInfoStatement(
          analyzeStatement("WITH t AS (SELECT 1 AS n) SELECT n FROM t"),
        ),
      ).toBe(true);
    });

    it("[AC-255-01c] EXPLAIN → INFO", () => {
      expect(
        isInfoStatement(analyzeStatement("EXPLAIN SELECT * FROM users")),
      ).toBe(true);
    });

    it("[AC-255-01d] EXPLAIN ANALYZE → INFO", () => {
      expect(
        isInfoStatement(
          analyzeStatement("EXPLAIN ANALYZE SELECT * FROM users"),
        ),
      ).toBe(true);
    });

    it("[AC-255-01e] SHOW → INFO", () => {
      expect(isInfoStatement(analyzeStatement("SHOW TABLES"))).toBe(true);
    });

    it("[AC-255-01f] DESCRIBE → INFO", () => {
      expect(isInfoStatement(analyzeStatement("DESCRIBE users"))).toBe(true);
    });

    it("[AC-255-01g] DESC (MySQL short form) → INFO", () => {
      expect(isInfoStatement(analyzeStatement("DESC users"))).toBe(true);
    });

    it("[AC-255-01h] case-insensitive (lowercase explain) → INFO", () => {
      expect(isInfoStatement(analyzeStatement("explain select 1"))).toBe(true);
    });

    it("[AC-403-06] INSERT → INFO (no WARN dialog candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("INSERT INTO users (id) VALUES (1)")),
      ).toBe(true);
    });

    it("[AC-255-01j] UPDATE WHERE → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(
          analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1"),
        ),
      ).toBe(false);
    });

    it("[AC-255-01k] DELETE WHERE → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("DELETE FROM users WHERE id = 1")),
      ).toBe(false);
    });

    it("[AC-255-01l] CREATE TABLE → INFO (sprint-394 — ddl-create / info)", () => {
      // Pre-sprint-394: NOT INFO (WARN candidate via `ddl-other`).
      // Sprint-394 (per contract): CREATE TABLE is non-destructive
      // construction → `ddl-create` / info. The safe-mode UI may now
      // skip its warn dialog for plain CREATE TABLE.
      expect(
        isInfoStatement(analyzeStatement("CREATE TABLE foo (id int)")),
      ).toBe(true);
    });

    it("[AC-255-01m] ALTER TABLE … ADD COLUMN (additive) → NOT INFO (ddl-alter-add / warn)", () => {
      // Sprint-394 keeps ALTER ADD as warn (the schema-modifying nature
      // warrants the warn dialog). The `kind` is `ddl-alter-add`; the
      // severity tier is unchanged.
      expect(
        isInfoStatement(
          analyzeStatement("ALTER TABLE users ADD COLUMN nickname text"),
        ),
      ).toBe(false);
    });

    it("[AC-255-01n] DROP TABLE → NOT INFO (STOP candidate, severity danger)", () => {
      expect(isInfoStatement(analyzeStatement("DROP TABLE users"))).toBe(false);
    });

    it("[AC-255-01o] empty input → INFO (Sprint 254 default)", () => {
      // Sprint 254 — empty / unknown defaults to INFO (severity: "info").
      // INFO heuristic returns true so the WARN dialog never mounts on
      // an empty buffer; the upstream `if (!sql) return` already short-
      // circuits the empty path so the change is defensive only.
      expect(isInfoStatement(analyzeStatement(""))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 391 (2026-05-17) — AST-based DDL destructive classifier callsite.
  // 본 블록은 *WASM 모듈을 명시적으로 preload* 한 뒤 `analyzeStatement` 가
  // `parseSqlPreloaded` 경로를 거치는 것을 가정한다. 모든 case 의 반환 shape
  // (`kind` / `severity` / `reasons`) 는 정규식 fallback 과 *동일* — 호출자
  // 영향 0 임을 입증.
  // -------------------------------------------------------------------------
  describe("Sprint 391 — AST-based DDL destructive classifier (AC-391-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      // Other describe blocks below this point (없지만 안전) 가 정규식
      // fallback 을 가정하지 않도록 reset.
      __resetSqlWasmModuleForTests();
    });

    it("[AC-391-X01] DROP TABLE users → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02] DROP TABLE IF EXISTS users CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE IF EXISTS users CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02b] DROP SCHEMA public CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP SCHEMA public CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SCHEMA"]);
    });

    it("[AC-391-X02c] DROP SEQUENCE my_seq → ddl-drop / danger via AST (new variant)", () => {
      // Pre-sprint-391 regex did NOT match SEQUENCE — it fell through to
      // the `^DROP\b/^ALTER\b/^CREATE\b` catch-all (`ddl-other` / WARN).
      // The AST path correctly classifies it as `ddl-drop` / DANGER.
      // This is the *only* case where AST vs regex differ; sqlSafety
      // test suite previously had no SEQUENCE coverage so no regression.
      const a = analyzeStatement("DROP SEQUENCE my_seq");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SEQUENCE"]);
    });

    it("[AC-391-X02d] DROP TYPE my_enum CASCADE → ddl-drop / danger via AST (new variant)", () => {
      const a = analyzeStatement("DROP TYPE my_enum CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TYPE"]);
    });

    it("[AC-391-X03] TRUNCATE TABLE events → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE TABLE events");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X04] TRUNCATE users RESTART IDENTITY CASCADE → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE users RESTART IDENTITY CASCADE");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X05] ALTER TABLE users DROP COLUMN email → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP COLUMN"]);
    });

    it("[AC-391-X06] ALTER TABLE users DROP CONSTRAINT pk CASCADE → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement(
        "ALTER TABLE users DROP CONSTRAINT pk CASCADE",
      );
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP CONSTRAINT"]);
    });

    it("[AC-391-X06b] ALTER TABLE users DROP INDEX idx → ddl-alter-drop / danger via AST (MySQL-style)", () => {
      // Pre-sprint-391 regex matched COLUMN/CONSTRAINT only — `DROP INDEX`
      // on ALTER TABLE fell through to `ddl-other` / WARN. AST correctly
      // classifies it as `ddl-alter-drop` / DANGER. Existing sqlSafety
      // tests do not cover this so no regression.
      const a = analyzeStatement("ALTER TABLE users DROP INDEX idx");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP INDEX"]);
    });

    it("[AC-391-X07] SELECT regression — AST path classifies SELECT as info (sprint-393a)", () => {
      // Sprint-393a — SELECT routes through the AST. The widened shape
      // (FROM list, etc.) maps to `kind:'select'` / `severity:'info'` —
      // same result as the pre-sprint-393a regex path.
      const a = analyzeStatement("SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-391-X07b] DELETE regression — DML still routes through regex (AST scope is DDL only)", () => {
      // Sprint-391 AST does NOT cover DML. The DELETE branch fires
      // before the DDL preload-AST branch, so this case is unaffected.
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
    });

    it("[AC-391-X08] AST callsite preserves the `StatementAnalysis` shape contract (kind / severity / reasons keys)", () => {
      const a = analyzeStatement("DROP TABLE users CASCADE");
      // Shape is exactly the same as the regex-era output — caller
      // narrowing (`a.kind === "ddl-drop"`) continues to work.
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(typeof a.kind).toBe("string");
      expect(typeof a.severity).toBe("string");
      expect(Array.isArray(a.reasons)).toBe(true);
      expect(isDangerous(a)).toBe(true);
      expect(isInfoStatement(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 392 (2026-05-18) — AST-based DML write triad classifier callsite.
  // Mirrors the sprint-391 block: preload the WASM module so
  // `parseSqlPreloaded` resolves to a real AST shape (the mock above
  // implements an inline mini-parser), then assert every DML case routes
  // through the AST without changing the return shape contract.
  // -------------------------------------------------------------------------
  describe("Sprint 392 — AST-based DML write triad classifier (AC-392-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-403-01c] INSERT INTO users VALUES (1) → dml-insert / info via AST", () => {
      const a = analyzeStatement("INSERT INTO users VALUES (1)");
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-02b] UPDATE WHERE → dml-update / warn via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-02c] UPDATE without WHERE → dml-update / danger + reason via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a'");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
    });

    it("[AC-403-03b] DELETE WHERE → dml-delete / warn via AST", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-03c] DELETE without WHERE → dml-delete / danger + reason via AST", () => {
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    });

    it("[AC-403-01d] INSERT … ON CONFLICT DO UPDATE → dml-insert / info via AST", () => {
      const a = analyzeStatement(
        "INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'",
      );
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    it("[AC-403-04] AST path matches DML kind prefix contract", () => {
      const insert = analyzeStatement(
        "INSERT INTO users (id, name) VALUES (1, 'a')",
      );
      expect(insert.kind).toBe("dml-insert");
      expect(insert.severity).toBe("info");

      const updateWhere = analyzeStatement(
        "UPDATE users SET active = false WHERE id = 1",
      );
      expect(updateWhere.kind).toBe("dml-update");
      expect(updateWhere.severity).toBe("warn");

      const deleteNoWhere = analyzeStatement("DELETE FROM users");
      expect(deleteNoWhere.kind).toBe("dml-delete");
      expect(deleteNoWhere.severity).toBe("danger");
    });

    it("[AC-392-X08] AST callsite preserves the `StatementAnalysis` shape contract for DML", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(typeof a.kind).toBe("string");
      expect(typeof a.severity).toBe("string");
      expect(Array.isArray(a.reasons)).toBe(true);
      // `warn` severity → not dangerous, not info.
      expect(isDangerous(a)).toBe(false);
      expect(isInfoStatement(a)).toBe(false);
    });

    it("[AC-439-X02] CALL AST path → routine-call / warn", () => {
      const a = analyzeStatement("CALL refresh_user_stats()");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    });

    it("[AC-448-X02] CALL user-variable AST path → routine-call / warn", () => {
      const a = analyzeStatement("CALL refresh_user_stats(@user_id)");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    });
  });

  describe("Sprint 403 — DML kind/severity contract", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-403-01] INSERT → dml-insert / info", () => {
      const a = analyzeStatement("INSERT INTO t VALUES (1)");
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-02] UPDATE WHERE → dml-update / warn", () => {
      const a = analyzeStatement("UPDATE t SET a = 1 WHERE id = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-403-03] DELETE WHERE → dml-delete / warn", () => {
      const a = analyzeStatement("DELETE FROM t WHERE id = 1");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 393a (2026-05-18) — AST-based SELECT classifier callsite.
  // SELECT widening (FROM-list / JOIN family / WHERE expression widening /
  // GROUP BY / HAVING / ORDER BY / LIMIT) routes through the AST and is
  // classified as `kind:'select'` / `severity:'info'` / `reasons:[]`. The
  // sprint-393a contract pins severity NOT to escalate for read-only joins /
  // aggregations / paging — that decision is deferred to a later sprint.
  // -------------------------------------------------------------------------
  describe("Sprint 393a — AST-based SELECT widening classifier (AC-393a-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-393a-X01] SELECT with JOIN + WHERE → select / info / [] via AST", () => {
      const a = analyzeStatement(
        "SELECT a FROM x JOIN y ON x.id = y.x_id WHERE x.flag = 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X02] SELECT with ORDER BY + LIMIT OFFSET → select / info / []", () => {
      const a = analyzeStatement(
        "SELECT a FROM x ORDER BY a LIMIT 10 OFFSET 5",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-443-X01] SELECT with MySQL LIMIT offset,count → select / info / []", () => {
      const a = analyzeStatement("SELECT a FROM x LIMIT 10, 20");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X03] every widened SELECT clause populated → still select / info / []", () => {
      // AC-393a-F01's full-clause-chain input — exercises FROM + WHERE +
      // GROUP BY + HAVING + ORDER BY + LIMIT + OFFSET in one statement.
      const a = analyzeStatement(
        "SELECT a FROM x WHERE x.a > 1 GROUP BY a HAVING a > 0 ORDER BY a LIMIT 5 OFFSET 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393a-X04] existing sqlSafety tests regress to zero — SELECT path stays info", () => {
      // Spot-check the pre-sprint-393a SELECT inputs route through AST
      // and stay classified the same way as the regex path did. The full
      // regression-zero guarantee is pinned by the other AC-185 / AC-254
      // cases above (which run without preload).
      expect(analyzeStatement("SELECT * FROM users").severity).toBe("info");
      expect(
        analyzeStatement("SELECT id, name FROM users WHERE id = 1").severity,
      ).toBe("info");
    });

    it("[AC-393a-X05] StatementAnalysis return shape unchanged (kind / severity / reasons only)", () => {
      const a = analyzeStatement("SELECT a FROM x JOIN y ON x.id = y.x_id");
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(isInfoStatement(a)).toBe(true);
      expect(isDangerous(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 393b — AST-based SELECT widening 2 + CTE wrap classifier
  // (AC-393b-X). The classifier inherits the inner statement's
  // classification (D1/D2) when the top-level kind is `with`.
  // -------------------------------------------------------------------------
  describe("Sprint 393b — AST-based CTE wrap + IN-list classifier (AC-393b-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-393b-X01] WITH wrapping SELECT → select / info / []", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM t");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X02] WITH wrapping INSERT → dml-insert / info (inherits inner DML classification)", () => {
      const a = analyzeStatement(
        "WITH t AS (SELECT 1) INSERT INTO x SELECT * FROM t",
      );
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    it("[AC-393b-X03] WITH wrapping UPDATE WHERE → update / warn", () => {
      const a = analyzeStatement(
        "WITH t AS (SELECT 1) UPDATE x SET a = 1 WHERE x.id = 1",
      );
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X04] WITH wrapping UPDATE without WHERE → update / danger + reason", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) UPDATE x SET a = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("danger");
      // Per D2, the reasons list is the inner statement's reasons,
      // unchanged (verbatim). The sprint-392 "UPDATE without WHERE clause"
      // surfaces.
      expect(a.reasons).toContain("UPDATE without WHERE clause");
    });

    it("[AC-393b-X05] WITH wrapping DELETE without WHERE → delete / danger + reason", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) DELETE FROM x");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toContain("DELETE without WHERE clause");
    });

    it("[AC-393b-X06] SELECT with UNION → still select / info / []", () => {
      const a = analyzeStatement("SELECT a FROM x UNION SELECT a FROM y");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-393b-X07] DELETE with IN-list (sprint-392 deferral lifted) → delete / warn / no extra reasons", () => {
      const a = analyzeStatement("DELETE FROM x WHERE x.id IN (1, 2, 3)");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-393b-X08] existing sqlSafety regression — bare SELECT path still info", () => {
      // The existing classifier behavior for SELECT must be preserved.
      expect(analyzeStatement("SELECT * FROM users").severity).toBe("info");
      // The existing classifier behavior for DELETE WHERE → warn must
      // be preserved.
      expect(analyzeStatement("DELETE FROM x WHERE id = 1").severity).toBe(
        "warn",
      );
    });

    it("[AC-393b-X09] StatementAnalysis return shape unchanged for the new `with` path", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM t");
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(isInfoStatement(a)).toBe(true);
      expect(isDangerous(a)).toBe(false);
    });
  });

  describe("Sprint 482 — PostgreSQL parser Safe Mode kickoff (AC-482-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-482-X01] no-FROM SELECT stays select / info / []", () => {
      const a = analyzeStatement("SELECT 1");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-482-X02] SELECT-list function call stays select / info / []", () => {
      const a = analyzeStatement("SELECT count(*) FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  describe("Sprint 483 — PostgreSQL function-call expression Safe Mode (AC-483-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-483-X01] predicate function call stays select / info / []", () => {
      const a = analyzeStatement(
        "SELECT name FROM users WHERE lower(name) = 'felix'",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-483-X02] HAVING function call stays select / info / []", () => {
      const a = analyzeStatement(
        "SELECT region FROM sales GROUP BY region HAVING count(*) > 1",
      );
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  describe("Sprint 484 — PostgreSQL MERGE Safe Mode (AC-484-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-484-X01] parsed MERGE classifies as dml-merge / warn / []", () => {
      // Reason: MERGE is a conditional write surface and must not flow
      // through the read-only SELECT/other INFO paths. (2026-05-27)
      const a = analyzeStatement(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN UPDATE SET name = incoming.name",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-484-X02] unsupported MERGE fallback is warn, not info", () => {
      // Reason: unsupported MERGE shapes are still writes; fallback must
      // keep them out of INFO-tier execution. (2026-05-27)
      const a = analyzeStatement(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["MERGE — conditional write"]);
    });

    it("[AC-484-X03] EXPLAIN ANALYZE MERGE inherits MERGE warn tier", () => {
      // Reason: EXPLAIN ANALYZE can execute the inner statement, so
      // MERGE must inherit the DML classification. (2026-05-27)
      const a = analyzeStatement(
        "EXPLAIN ANALYZE MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DO NOTHING",
      );
      expect(a.kind).toBe("dml-merge");
      expect(a.severity).toBe("warn");
    });
  });

  describe("Sprint 485 — PostgreSQL DO block Safe Mode boundary (AC-485-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-485-X01] DO block classifies as routine-call / warn, not info", () => {
      const a = analyzeStatement("DO $$ BEGIN RAISE NOTICE 'hi'; END $$");
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["DO — procedural block execution"]);
    });

    it("[AC-485-X02] comment-prefixed DO keeps routine-call / warn", () => {
      const a = analyzeStatement(
        "-- maintenance\nDO $$ BEGIN RAISE NOTICE 'hi'; END $$",
      );
      expect(a.kind).toBe("routine-call");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["DO — procedural block execution"]);
    });
  });

  describe("Sprint 486 — PostgreSQL extension tolerance Safe Mode (AC-486-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-486-X01] extension operator SELECT stays select / info", () => {
      const a = analyzeStatement("SELECT id FROM docs WHERE title % 'table'");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-486-X02] extension type CREATE TABLE stays ddl-create / info", () => {
      const a = analyzeStatement(
        "CREATE TABLE docs (title citext, attrs hstore, embedding vector(3), geom geometry(Point, 4326))",
      );
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 394 (2026-05-18) — AST-based DDL additive classifier callsite.
  // Pre-condition: WASM module preloaded (the mock above produces
  // create-table / create-index / create-view / alter-table-additive
  // shapes). Every case asserts the documented (kind, severity, reasons)
  // triple. Reason strings are pinned per D2 — reviewers must reject
  // silent rewording.
  // -------------------------------------------------------------------------
  describe("Sprint 394 — AST-based DDL additive classifier (AC-394-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-394-X01] CREATE TABLE → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE TABLE t (a INTEGER)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X02] CREATE INDEX → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE INDEX idx ON t (a)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X03] CREATE VIEW → ddl-create / info / [] via AST", () => {
      const a = analyzeStatement("CREATE VIEW v AS SELECT a FROM t");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X04] CREATE OR REPLACE VIEW does NOT escalate severity (D1)", () => {
      // D1: OR REPLACE on a view re-points the body but does not touch
      // existing rows / schema. The classification stays `info` —
      // identical to plain CREATE VIEW.
      const a = analyzeStatement("CREATE OR REPLACE VIEW v AS SELECT a FROM t");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-394-X05] ALTER TABLE ADD COLUMN → ddl-alter-add / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t ADD COLUMN c TEXT");
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
      // Pinned per D2 — verbatim match required.
      expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    });

    it("[AC-394-X06] ALTER TABLE ADD CONSTRAINT → ddl-alter-add / warn / pinned reason (D2)", () => {
      const a = analyzeStatement(
        "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)",
      );
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — ADD CONSTRAINT (schema 변경)"]);
    });

    it("[AC-394-X07] ALTER TABLE RENAME TO → ddl-alter-rename / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t RENAME TO t2");
      expect(a.kind).toBe("ddl-alter-rename");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — RENAME (이름 변경)"]);
    });

    it("[AC-394-X08] ALTER TABLE RENAME COLUMN → ddl-alter-rename / warn / pinned reason (D2)", () => {
      const a = analyzeStatement("ALTER TABLE t RENAME COLUMN a TO b");
      expect(a.kind).toBe("ddl-alter-rename");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["ALTER TABLE — RENAME COLUMN (이름 변경)"]);
    });

    it("[AC-394-X09] CREATE FUNCTION falls back to regex (ddl-create / info — D3 fallback contract)", () => {
      // The AST parser surfaces SyntaxError for CREATE FUNCTION (out of
      // scope this sprint). The classifier falls back to the regex path
      // which classifies `^CREATE\b` as `ddl-create` / info. The regex
      // path matches the AST classification for parity.
      const a = analyzeStatement(
        "CREATE FUNCTION foo() RETURNS void AS bar LANGUAGE plpgsql",
      );
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    it("[AC-394-X10] existing sqlSafety regression — DROP TABLE still danger via AST", () => {
      // Sanity — adding the sprint-394 branches must not regress the
      // sprint-391 DDL destructive classifier.
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
    });

    it("[AC-394-X11] StatementAnalysis return shape unchanged for the new DDL additive paths", () => {
      const cases = [
        "CREATE TABLE t (a INTEGER)",
        "CREATE INDEX idx ON t (a)",
        "CREATE VIEW v AS SELECT a FROM t",
        "ALTER TABLE t ADD COLUMN c TEXT",
        "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)",
        "ALTER TABLE t RENAME TO t2",
        "ALTER TABLE t RENAME COLUMN a TO b",
      ];
      for (const sql of cases) {
        const a = analyzeStatement(sql);
        expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
        expect(typeof a.kind).toBe("string");
        expect(typeof a.severity).toBe("string");
        expect(Array.isArray(a.reasons)).toBe(true);
      }
    });
  });

  describe("Sprint 395 — AST-based misc grammar classifier (AC-395-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-395-X01] GRANT → permission-change / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("GRANT SELECT ON users TO alice");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["GRANT — 권한 변경"]);
    });

    it("[AC-395-X02] REVOKE → permission-change / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("REVOKE SELECT ON users FROM alice");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["REVOKE — 권한 변경"]);
    });

    it("[AC-395-X03] EXPLAIN SELECT → inherits inner SELECT classification (D1)", () => {
      const a = analyzeStatement("EXPLAIN SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X04] EXPLAIN DELETE (no WHERE) → inherits inner DELETE classification (D1)", () => {
      const a = analyzeStatement("EXPLAIN DELETE FROM users");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("danger");
      // The sprint-392 "WHERE 없는 DELETE" string passes through verbatim.
      expect(a.reasons).toContain("DELETE without WHERE clause");
    });

    it("[AC-395-X05] EXPLAIN ANALYZE UPDATE WHERE → update / danger (sprint-392 baseline) — inherits inner", () => {
      // Sprint-392 baseline classifies bare UPDATE WHERE as `update` /
      // `danger` when AST parses but the WHERE is in `unsupported-
      // expression` territory (`x.a > 0` qualified-column comparison was
      // not in sprint-392's narrow WHERE). Sprint-393b widened that —
      // qualified-column WHERE now parses, so the analysis returns
      // `update` / `warn` (bounded). EXPLAIN inherits per D1. We assert
      // the kind + severity; reasons are empty when WHERE is present.
      const a = analyzeStatement(
        "EXPLAIN ANALYZE UPDATE users SET a = 1 WHERE id = 1",
      );
      expect(a.kind).toBe("dml-update");
      // Bounded UPDATE WHERE — sprint-393b classifies as `warn`.
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X06] SHOW → config-read / info / empty reasons (D4)", () => {
      const a = analyzeStatement("SHOW search_path");
      expect(a.kind).toBe("config-read");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X07] SET → config-write / info / empty reasons (D3)", () => {
      const a = analyzeStatement("SET timezone = 'UTC'");
      expect(a.kind).toBe("config-write");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X08] COPY FROM → data-movement / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("COPY users FROM '/tmp/u.csv'");
      expect(a.kind).toBe("data-movement");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["COPY FROM — 대량 import"]);
    });

    it("[AC-395-X09] COPY TO → data-movement / warn / pinned reason (D5)", () => {
      const a = analyzeStatement("COPY users TO '/tmp/u.csv'");
      expect(a.kind).toBe("data-movement");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["COPY TO — 대량 export"]);
    });

    it("[AC-395-X10] COMMENT → metadata / info / empty reasons", () => {
      const a = analyzeStatement("COMMENT ON TABLE users IS 'all'");
      expect(a.kind).toBe("metadata");
      expect(a.severity).toBe("info");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-395-X11] EXPLAIN BEGIN → AST falls back; regex EXPLAIN branch returns info", () => {
      // BEGIN is not a supported inner statement for EXPLAIN (out of
      // scope), so the AST parser returns Error(...). The classifier
      // falls back to the regex path which classifies `^EXPLAIN\b` as
      // `info` / `info` / [].
      const a = analyzeStatement("EXPLAIN BEGIN");
      expect(a.severity).toBe("info");
    });

    it("[AC-395-X12] existing regression — DROP TABLE still danger via AST", () => {
      // Sanity — adding the sprint-395 branches must not regress the
      // sprint-391 DDL destructive classifier.
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
    });

    it("[AC-395-X13] StatementAnalysis return shape unchanged for the new misc paths", () => {
      const cases = [
        "GRANT SELECT ON users TO alice",
        "REVOKE SELECT ON users FROM alice",
        "EXPLAIN SELECT * FROM users",
        "SHOW search_path",
        "SET timezone = 'UTC'",
        "COPY users FROM '/tmp/u.csv'",
        "COMMENT ON TABLE users IS 'all'",
      ];
      for (const sql of cases) {
        const a = analyzeStatement(sql);
        expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
        expect(typeof a.kind).toBe("string");
        expect(typeof a.severity).toBe("string");
        expect(Array.isArray(a.reasons)).toBe(true);
      }
    });
  });
});
