/**
 * Sprint 432 — checked-in SQL WASM artifact regression.
 *
 * `sqlAst.test.ts` intentionally mocks the wasm-pack module to keep facade
 * tests small. This file loads the real checked-in `.wasm` bytes, so Rust
 * parser changes that forget to refresh `src/lib/sql/wasm/` fail in Vitest.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSqlWasmModuleForTests,
  parseSql,
  parseSqlPreloaded,
  preloadSqlWasm,
} from "./sqlAst";
import initSqlParserCore, {
  complete_sql as completeSqlFromWasm,
} from "./wasm/sql_parser_core.js";

vi.mock("./wasm/sql_parser_core.js", async () => {
  const actual = await vi.importActual<
    typeof import("./wasm/sql_parser_core.js")
  >("./wasm/sql_parser_core.js");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const wasmUrl = new URL("./wasm/sql_parser_core_bg.wasm", import.meta.url);
  const rootFlagIndex = process.argv.indexOf("--root");
  const testRoot =
    process.argv.find((arg) => arg.startsWith("--root="))?.slice(7) ??
    (rootFlagIndex >= 0 ? process.argv[rootFlagIndex + 1] : undefined) ??
    process.env.PWD ??
    process.cwd();
  const servedPath = decodeURIComponent(wasmUrl.pathname);
  const wasmPath =
    wasmUrl.protocol === "file:"
      ? fileURLToPath(wasmUrl)
      : servedPath.startsWith("/@fs/")
        ? servedPath.replace(/^\/@fs\//, "/")
        : resolve(testRoot, servedPath.replace(/^\//, ""));
  const wasm = readFileSync(wasmPath);
  const wasmBytes = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength,
  );

  return {
    ...actual,
    default: vi.fn(async () => {
      actual.initSync({ module: wasmBytes });
      return undefined;
    }),
  };
});

describe("checked-in SQL WASM artifact", () => {
  beforeEach(() => {
    __resetSqlWasmModuleForTests();
  });

  it("[AC-432-W01] parseSql accepts MySQL LIMIT offset,count through real WASM", async () => {
    const result = await parseSql("SELECT a FROM x LIMIT 10, 20");

    expect(result.kind).toBe("select");
    if (result.kind !== "select") return;
    expect(result.limit).toEqual({
      count: { kind: "literal", value: { kind: "integer", value: 20 } },
      offset: { kind: "literal", value: { kind: "integer", value: 10 } },
    });
  });

  it("[AC-432-W02] parseSqlPreloaded uses the refreshed real WASM artifact", async () => {
    await preloadSqlWasm();

    const result = parseSqlPreloaded("SELECT a FROM x LIMIT 10, 20");

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.kind).toBe("select");
  });

  it("[AC-434-W01] parseSql accepts MySQL ON DUPLICATE KEY UPDATE through real WASM", async () => {
    const result = await parseSql(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = VALUES(name), id = ?",
    );

    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.on_conflict ?? null).toBeNull();
    expect(result.on_duplicate_key_update?.assignments).toEqual([
      {
        column: "name",
        value: { kind: "values-column", column: "name" },
      },
      {
        column: "id",
        value: { kind: "placeholder", name: "" },
      },
    ]);
  });

  it("[AC-434-W02] parseSql accepts DEFAULT RHS in ON DUPLICATE KEY UPDATE through real WASM", async () => {
    const result = await parseSql(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = DEFAULT",
    );

    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.on_duplicate_key_update?.assignments).toEqual([
      {
        column: "name",
        value: { kind: "default" },
      },
    ]);
  });

  it("[AC-439-W01] parseSql accepts MySQL CALL through real WASM", async () => {
    const result = await parseSql(
      "CALL reporting.refresh_user_stats(?, 'x', 1)",
    );

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.procedure).toEqual({
      schema: "reporting",
      name: "refresh_user_stats",
    });
    expect(result.arguments).toEqual([
      { kind: "placeholder", name: "" },
      { kind: "literal", value: { kind: "string", value: "x" } },
      { kind: "literal", value: { kind: "integer", value: 1 } },
    ]);
  });

  it("[AC-439-W02] parseSql emits schema null for bare CALL through real WASM", async () => {
    const result = await parseSql("CALL refresh_user_stats()");

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.procedure).toEqual({
      schema: null,
      name: "refresh_user_stats",
    });
    expect(result.arguments).toEqual([]);
  });

  it("[AC-448-W01] parseSql accepts bounded MySQL user-variable CALL arguments through real WASM", async () => {
    const result = await parseSql("CALL refresh_user_stats(@user_id)");

    expect(result.kind).toBe("call");
    if (result.kind !== "call") return;
    expect(result.arguments).toEqual([
      { kind: "user-variable", name: "user_id" },
    ]);
  });

  it.each([
    ["function call", "CALL refresh_user_stats(NOW())"],
    ["arithmetic", "CALL refresh_user_stats(1 + 2)"],
    ["subquery", "CALL refresh_user_stats((SELECT id FROM users))"],
    ["bare identifier", "CALL refresh_user_stats(user_id)"],
    ["system variable", "CALL refresh_user_stats(@@session_sql_mode)"],
  ])(
    "[AC-448-W02] rejects unsupported CALL argument form: %s",
    async (_label, sql) => {
      const result = await parseSql(sql);

      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(["syntax-error", "lex-error"]).toContain(result.error_kind);
    },
  );

  it("[AC-454-W01] complete_sql gates MariaDB RETURNING through real WASM", async () => {
    await initSqlParserCore();

    expect(mariaDbCompletionLabels("10.0.4-MariaDB")).not.toContain(
      "RETURNING",
    );
    expect(mariaDbCompletionLabels("10.0.5-MariaDB")).toContain("RETURNING");
    expect(mariaDbCompletionLabels("10.4.34-MariaDB")).toContain("RETURNING");
  });

  it("[AC-461-W01] complete_sql marks SQLite dot commands non-executable through real WASM", async () => {
    await initSqlParserCore();

    const result = completeSqlFromWasm(
      ".s",
      2,
      2,
      "sqlite",
      "sqlite-cli",
      "",
      "rev-sqlite",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
        detail?: string;
        runtimeExecutable?: boolean;
      }>;
    };
    const schemaCommand = result.items.find((item) => item.label === ".schema");

    expect(schemaCommand).toMatchObject({
      kind: "meta-command",
      runtimeExecutable: false,
      detail: "sqlite-cli command; not executable by Table View",
    });
  });

  it("complete_sql returns relation catalog candidates, not psql commands, after FROM through real WASM", async () => {
    await initSqlParserCore();

    const result = completeSqlFromWasm(
      "SELECT * FROM ",
      14,
      14,
      "postgresql",
      "psql",
      "",
      "rev-catalog",
      "",
      "",
      "public\nanalytics",
      [
        "table\tpublic\tusers\tpublic.users",
        "view\tanalytics\tactive_users\tanalytics.active_users",
      ].join("\n"),
      "public\tusers\temail\tpublic.users",
      "public\tslugify\tpublic.slugify\ttext\ttext",
      "",
    ) as {
      items: Array<{
        label: string;
        kind: string;
        apply?: string;
        detail?: string;
      }>;
    };

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "public",
          kind: "schema",
          apply: "public",
        }),
        expect.objectContaining({
          label: "users",
          kind: "table",
          detail: "public",
        }),
        expect.objectContaining({
          label: "active_users",
          kind: "view",
          detail: "analytics",
        }),
      ]),
    );
    expect(result.items.map((item) => item.kind)).not.toContain("meta-command");
    expect(result.items.map((item) => item.kind)).not.toContain("column");
    expect(result.items.map((item) => item.kind)).not.toContain("function");
    expect(result.items.map((item) => item.kind)).not.toContain("keyword");
  });
});

function mariaDbCompletionLabels(serverVersion: string): string[] {
  const result = completeSqlFromWasm(
    "RET",
    3,
    3,
    "mariadb",
    "mysql-client",
    serverVersion,
    "rev-mariadb",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ) as { items: Array<{ label: string }> };
  return result.items.map((item) => item.label);
}
