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
          table: "users",
          where: {
            column: "name",
            op: "=",
            literal: { kind: "string", value: "felix" },
          },
        } satisfies SqlParseResult;
      }
      if (sql === "SELECT * FROM users") {
        return {
          kind: "select",
          columns: { kind: "star" },
          table: "users",
          where: null,
        } satisfies SqlParseResult;
      }
      if (sql === "INSERT INTO x VALUES (1)") {
        return {
          kind: "error",
          error_kind: "unsupported-statement",
          message: "sprint-385 only supports SELECT",
          at: 0,
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

    expect(result.table).toBe("users");
    expect(result.columns).toEqual({ kind: "named", names: ["id"] });
    expect(result.where).not.toBeNull();
    expect(result.where).toEqual({
      column: "name",
      op: "=",
      literal: { kind: "string", value: "felix" },
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
    const result = await parseSql("INSERT INTO x VALUES (1)");
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
});
