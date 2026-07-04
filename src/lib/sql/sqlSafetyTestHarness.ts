import { afterAll, beforeAll, expect, vi } from "vitest";
import type { StatementAnalysis } from "./sqlSafety";
import { __resetSqlWasmModuleForTests, preloadSqlWasm } from "./sqlAst";

vi.mock("./wasm/sql_parser_core.js", () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    parse_sql: vi.fn((sql: string) => {
      const trimmed = sql.trim().replace(/;$/, "");
      const upper = trimmed.toUpperCase();

      const g = (m: RegExpMatchArray, i: number): string => {
        const v = m[i];
        if (v === undefined) {
          throw new Error(`sqlSafety test mock: group ${i} missing`);
        }
        return v;
      };
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
      if (/^UPDATE\b/i.test(trimmed)) {
        const hasWhere = /\bWHERE\b/i.test(trimmed);
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
      if (/^WITH\b/i.test(trimmed)) {
        // group 1 = CTE body (inside the `AS (...)` parens), group 2 = the
        // inner statement after the CTE list. Issue #1119: the CTE body is
        // captured so the mock can seed `ctes[]` with a writable body,
        // simulating a future parser that accepts PostgreSQL writable CTEs.
        const m = trimmed.match(
          /^WITH\s+(?:RECURSIVE\s+)?[A-Z_][A-Z0-9_]*\s*(?:\([^)]*\)\s*)?AS\s*\(([^)]*)\)\s*(.+)$/i,
        );
        if (m && m[2]) {
          const buildStmtNode = (sql: string) => {
            const s = sql.trim();
            const u = s.toUpperCase();
            if (u.startsWith("INSERT")) {
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
            if (u.startsWith("UPDATE")) {
              const hasWhere = /\bWHERE\b/i.test(s);
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
            if (u.startsWith("DELETE")) {
              const hasWhere = /\bWHERE\b/i.test(s);
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
          };
          return {
            kind: "with",
            recursive: false,
            // Issue #1119 — seed ctes[] with the (possibly writable) CTE
            // body so the mapper's ctes[] traversal is exercised. The real
            // grammar restricts this to SELECT today; the mock intentionally
            // reflects a widened parser to prove the safety-gating fix.
            ctes: [
              { name: "cte", columns: [], body: buildStmtNode(m[1] ?? "") },
            ],
            inner_statement: buildStmtNode(m[2]),
          };
        }
      }
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
      if (/^SHOW\b/i.test(trimmed)) {
        return {
          kind: "show",
          target: { kind: "variable", name: "stub" },
        };
      }
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
      if (/^COMMENT\b/i.test(trimmed)) {
        return {
          kind: "comment",
          target: { kind: "table", name: "stub" },
          text: { kind: "string", value: "stub" },
        };
      }
      if (/^EXPLAIN\b/i.test(trimmed)) {
        const innerSqlMatch = trimmed.match(
          /^EXPLAIN(?:\s+ANALYZE)?(?:\s+VERBOSE)?(?:\s*\([^)]*\))?\s+(.+)$/i,
        );
        if (innerSqlMatch && innerSqlMatch[1]) {
          const innerSql = innerSqlMatch[1].trim();
          const innerUpper = innerSql.toUpperCase();
          if (innerUpper.startsWith("BEGIN")) {
            return {
              kind: "error",
              error_kind: "unsupported-statement",
              message: "sprint-395 mock: EXPLAIN BEGIN fallthrough",
              at: 0,
            };
          }
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
      return {
        kind: "error",
        error_kind: "unsupported-statement",
        message: "sprint-391 mock fallthrough",
        at: 0,
      };
    }),
  };
});

export function usePreloadedSqlAst(): void {
  beforeAll(async () => {
    __resetSqlWasmModuleForTests();
    await preloadSqlWasm();
  });

  afterAll(() => {
    __resetSqlWasmModuleForTests();
  });
}

export function expectStatementAnalysisShape(
  analysis: StatementAnalysis,
): void {
  expect(Object.keys(analysis).sort()).toEqual(["kind", "reasons", "severity"]);
  expect(typeof analysis.kind).toBe("string");
  expect(typeof analysis.severity).toBe("string");
  expect(Array.isArray(analysis.reasons)).toBe(true);
}
